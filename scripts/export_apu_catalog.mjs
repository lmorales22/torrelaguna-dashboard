import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const defaultDbPath = path.resolve(projectRoot, "../APU Machine/apu-machine/database/apu_machine.db");
const dbPath = process.env.APU_MACHINE_DB || defaultDbPath;
const outputPath = process.env.APU_CATALOG_OUTPUT || path.join(projectRoot, "torrelaguna-dashboard/data/apu_catalog.json");

function sqliteJson(sql) {
  const raw = execFileSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8", maxBuffer: 1024 * 1024 * 64 });
  return JSON.parse(raw || "[]");
}

function sqliteValue(sql) {
  return Number(execFileSync("sqlite3", [dbPath, sql], { encoding: "utf8" }).trim() || 0);
}

const counts = {
  apuActivities: sqliteValue("select count(*) from apu_activities"),
  apuResources: sqliteValue("select count(*) from apu_resources"),
  historicalRows: sqliteValue("select count(*) from price_items"),
  historicalUniqueItems: sqliteValue(`
    select count(*) from (
      select description_norm, coalesce(unit_norm, '') as unit_norm
      from price_items
      where description_norm is not null and trim(description_norm) <> ''
      group by description_norm, coalesce(unit_norm, '')
    )
  `),
};

const categories = sqliteJson(`
  select
    coalesce(category, 'SIN CATEGORIA') as name,
    count(*) as count
  from apu_activities
  group by coalesce(category, 'SIN CATEGORIA')
  order by count desc, name asc
`);

const activities = sqliteJson(`
  select
    activity_key as id,
    activity_code as code,
    description,
    description_norm as norm,
    unit,
    unit_norm as unitNorm,
    category,
    subcategory,
    round(coalesce(calculated_unit_price, original_unit_price, 0), 0) as unitPrice,
    lines_count as linesCount,
    calculation_status as status,
    review_reason as reviewReason
  from apu_activities
  where description is not null and trim(description) <> ''
  order by coalesce(category, ''), coalesce(subcategory, ''), description
`);

const historicalItems = sqliteJson(`
  select
    description_norm as norm,
    min(description) as description,
    coalesce(unit_norm, '') as unit,
    count(*) as frequency,
    group_concat(distinct source_group) as sourceGroups,
    round(avg(unit_price), 0) as avgUnitPrice,
    round(min(unit_price), 0) as minUnitPrice,
    round(max(unit_price), 0) as maxUnitPrice
  from price_items
  where description_norm is not null
    and trim(description_norm) <> ''
    and description is not null
    and trim(description) <> ''
  group by description_norm, coalesce(unit_norm, '')
  order by frequency desc, description asc
`);

const catalog = {
  schemaVersion: "obra-control-apu-catalog.v0.1",
  generatedAt: new Date().toISOString(),
  source: {
    name: "APU Machine",
    database: "apu_machine.db",
    note: "Catálogo derivado para autocompletado y sugerencias. No contiene filas crudas de Excel.",
  },
  counts,
  categories,
  activities,
  historicalItems,
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(catalog)}\n`);

console.log(`APU catalog exported: ${outputPath}`);
console.log(`${activities.length} APU activities, ${historicalItems.length} historical unique items`);
