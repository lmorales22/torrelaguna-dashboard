const state = {
  data: null,
  catalog: null,
  catalogPool: [],
  catalogStatus: "loading",
  dailyContext: {},
  aliases: {},
  section: "overview",
  query: "",
  acta: "all",
  activityStatus: "all",
  pendingStatus: "all",
  decisions: {},
  movements: [],
  selectedMatchRow: null,
  movementFilter: "all",
};

const money = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat("es-CO", {
  maximumFractionDigits: 2,
});

const $ = (selector) => document.querySelector(selector);
const LEGACY_DECISION_KEY = "torrelaguna-field-alert-decisions";
const DECISION_KEY_PREFIX = "obra-control-local-decisions";
const MOVEMENT_KEY_PREFIX = "obra-control-local-movements";
const CONTEXT_KEY_PREFIX = "obra-control-daily-context";
const ALIAS_KEY_PREFIX = "obra-control-alias-memory";
const DEFAULT_DATA_URL = "./data/torrelaguna.json";
const DEFAULT_CATALOG_URL = "./data/apu_catalog.json";
const PACKAGE_SCHEMA_VERSION = "obra-control.v0.3";
const DASHBOARD_BUILD = "20260505-sprint11-client-soft";
const DEFAULT_UNITS = ["m2", "ml", "m", "und", "gl", "kg", "m3"];
const DEFAULT_SOURCES = ["Medina", "Albeiro", "Grillo", "Jairo", "Visita de obra", "Memoria de obra", "Foto soporte"];
const ENTRY_TEMPLATES = [
  { id: "avance", label: "Avance", type: "avance", note: "Cantidad ejecutada en campo." },
  { id: "adicional", label: "Adicional", type: "adicional", note: "Posible actividad fuera de alcance base." },
  { id: "correccion", label: "Corrección", type: "correccion", note: "Ajuste de cantidad o clasificación." },
  { id: "no_ejecutado", label: "No ejecutado", type: "no_ejecutado", note: "Actividad descontada o anulada." },
  { id: "reproceso", label: "Reproceso", type: "correccion", note: "Revisión por reproceso o corrección en campo." },
  { id: "soporte", label: "Soporte foto", type: "avance", note: "Pendiente adjuntar o validar soporte fotográfico." },
  { id: "pendiente", label: "Verificar", type: "avance", note: "Pendiente confirmar ubicación, alcance o cantidad." },
  { id: "frente", label: "Frente/Piso", type: "avance", note: "Registrar frente, piso o ubicación exacta del avance." },
];
const STOP_WORDS = new Set([
  "con",
  "para",
  "por",
  "sin",
  "del",
  "los",
  "las",
  "una",
  "uno",
  "incluye",
  "suministro",
  "instalacion",
  "instalación",
  "actividad",
  "obra",
  "tipo",
  "en",
  "de",
  "y",
  "o",
]);

function formatMoney(value) {
  return money.format(Math.round(value || 0));
}

function formatPercent(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

function normalize(text) {
  return String(text || "").toLowerCase();
}

function normalizeLoose(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensFor(text) {
  return normalizeLoose(text)
    .split(" ")
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function truncate(text, limit = 150) {
  const value = String(text || "");
  return value.length > limit ? `${value.slice(0, limit - 1).trim()}...` : value;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function matchesQuery(...values) {
  if (!state.query) return true;
  const haystack = values.map(normalize).join(" ");
  return haystack.includes(state.query);
}

function pendingKey(item) {
  return [item.status, item.acta, item.sourceRow, item.sourceDescription].join("::");
}

function decisionFor(item) {
  return state.decisions[pendingKey(item)];
}

function isResolved(item) {
  return Boolean(decisionFor(item)?.resolved);
}

function decisionStorageKey() {
  const projectName = normalizeLoose(state.data?.project?.name || "obra");
  return `${DECISION_KEY_PREFIX}:${projectName || "obra"}`;
}

function loadDecisions() {
  try {
    const scoped = localStorage.getItem(decisionStorageKey());
    const legacy = localStorage.getItem(LEGACY_DECISION_KEY);
    state.decisions = JSON.parse(scoped || legacy || "{}");
  } catch {
    state.decisions = {};
  }
}

function saveDecisions() {
  localStorage.setItem(decisionStorageKey(), JSON.stringify(state.decisions));
}

function movementStorageKey() {
  const projectName = normalizeLoose(state.data?.project?.name || "obra");
  return `${MOVEMENT_KEY_PREFIX}:${projectName || "obra"}`;
}

function loadMovements() {
  try {
    state.movements = JSON.parse(localStorage.getItem(movementStorageKey()) || "[]");
  } catch {
    state.movements = [];
  }
}

function saveMovements() {
  localStorage.setItem(movementStorageKey(), JSON.stringify(state.movements));
}

function decisionEntries() {
  return Object.entries(state.decisions).filter(([, decision]) => decision?.resolved);
}

function activePending() {
  return state.data.pending.filter((item) => !isResolved(item));
}

function resolvedPending() {
  return state.data.pending.filter((item) => isResolved(item));
}

function projectName() {
  return state.data?.project?.name || "Obra";
}

function projectSubtitle() {
  return state.data?.project?.subtitle || "Seguimiento de obra";
}

function projectSlug() {
  return normalizeLoose(projectName()).replace(/\s+/g, "-") || "obra";
}

function renderProjectChrome() {
  const project = state.data.project;
  document.title = `${projectName()} | Dashboard de obra`;
  $("#brandName").textContent = projectName();
  $("#brandSubtitle").textContent = "Obra Control";
  $("#projectEyebrow").textContent = projectSubtitle();
  $("#workspaceTitle").textContent = "Dashboard de campo";
  $("#clientProjectName").textContent = projectName();
  $("#sourceWorkbook").textContent = `${project.sourceWorkbook} · ${project.sourceSheet || "CORTES_OBRA"}`;
}

function filteredActivities() {
  const { activities } = state.data;
  return activities.filter((activity) => {
    const actaMatch =
      state.acta === "all" || activity.sources.some((source) => source.acta === state.acta);
    const statusMatch = state.activityStatus === "all" || activity.status === state.activityStatus;
    return (
      actaMatch &&
      statusMatch &&
      matchesQuery(activity.item, activity.description, activity.chapter, activity.status)
    );
  });
}

function filteredSources() {
  return state.data.sources.filter((source) => {
    const actaMatch = state.acta === "all" || source.acta === state.acta;
    return (
      actaMatch &&
      matchesQuery(
        source.item,
        source.description,
        source.acta,
        source.sourceDescription,
        source.file
      )
    );
  });
}

function filteredPending() {
  return state.data.pending.filter((item) => {
    const actaMatch = state.acta === "all" || item.acta === state.acta;
    const resolved = isResolved(item);
    const statusMatch =
      state.pendingStatus === "RESUELTO"
        ? resolved
        : state.pendingStatus === "all"
          ? !resolved
          : item.status === state.pendingStatus && !resolved;
    return (
      actaMatch &&
      statusMatch &&
      matchesQuery(item.status, item.acta, item.sourceDescription, item.note, item.candidates)
    );
  });
}

function parseCandidates(text) {
  if (!text) return [];
  return String(text)
    .split(" | ")
    .map((part) => {
      const match = part.match(/^(.+?) \\(([^)]+)\\):\\s*(.+)$/);
      return match
        ? { item: match[1], score: match[2], description: match[3] }
        : { item: "", score: "", description: part };
    })
    .filter((candidate) => candidate.description);
}

function openInspector(title, body, meta = [], actions = []) {
  $("#inspectorTitle").textContent = title;
  $("#inspectorBody").textContent = body;
  $("#inspectorMeta").innerHTML = meta
    .map(
      ([label, value]) => {
        const displayValue = value === 0 || value === false ? String(value) : value || "Sin dato";
        return `
        <div class="meta-line">
          <span>${label}</span>
          <strong>${displayValue}</strong>
        </div>
      `;
      }
    )
    .join("");
  $("#inspectorActions").innerHTML = actions
    .map(
      (action) => `
        <button class="action-button ${action.kind || ""}" data-action="${action.id}">
          ${action.label}
        </button>
      `
    )
    .join("");
  actions.forEach((action) => {
    $(`#inspectorActions [data-action="${action.id}"]`)?.addEventListener("click", action.onClick);
  });
  $("#inspector").classList.add("open");
}

function closeInspector() {
  $("#inspector").classList.remove("open");
}

function renderSummary() {
  const { summary } = state.data;
  const remainingPending = activePending();
  const resolvedCount = resolvedPending().length;
  const pendingUnmatched = remainingPending.filter((item) => item.status === "SIN_COINCIDENCIA").length;
  const pendingReview = remainingPending.filter((item) => item.status === "REVISAR").length;
  $("#progressValue").textContent = formatPercent(summary.progress);
  $("#progressLabel").textContent = `${summary.activeActivityCount} de ${summary.activityCount} actividades con avance`;
  $("#executedValue").textContent = formatMoney(summary.executedTotal);
  $("#sourceCount").textContent = `${summary.sourceMovementCount} celdas de acta leídas`;
  $("#balanceValue").textContent = formatMoney(summary.balanceTotal);
  $("#activeCount").textContent = `${summary.sourceItemCount} ítems con avance`;
  $("#pendingValue").textContent = remainingPending.length;
  $("#pendingLabel").textContent = `${pendingUnmatched} sin coincidencia · ${pendingReview} por revisar · ${resolvedCount} revisados`;
  $("#todayPriority").textContent = `${remainingPending.length} alertas activas`;
  $("#riskSignal").textContent = `${summary.statusCounts["Sobreejecutado"] || 0} actividades sobreejecutadas`;
  $("#budgetTotal").textContent = `Presupuesto directo ${formatMoney(summary.budgetTotal)}`;
  $("#progressBar").style.width = `${Math.min(summary.progress * 100, 100)}%`;
  $("#executedSplit").textContent = formatMoney(summary.executedTotal);
  $("#notExecutedSplit").textContent = formatMoney(summary.notExecutedTotal);
  $("#additionalSplit").textContent = formatMoney(summary.additionalTotal);
}

function renderChapterBars() {
  const max = Math.max(...state.data.chapters.slice(0, 7).map((chapter) => chapter.executed), 1);
  $("#chapterBars").innerHTML = state.data.chapters
    .slice(0, 7)
    .map((chapter) => {
      const width = Math.max((chapter.executed / max) * 100, 3);
      return `
        <div class="bar-row">
          <div class="bar-label">
            <strong title="${chapter.name}">${chapter.name}</strong>
            <div class="bar-track"><span class="bar-fill" style="width:${width}%"></span></div>
          </div>
          <span class="row-meta">${formatMoney(chapter.executed)}</span>
        </div>
      `;
    })
    .join("");
}

function renderActas() {
  $("#actaRows").innerHTML = state.data.actas
    .map((acta) => {
      const hasValue = acta.value > 0;
      return `
        <article class="acta-row" data-acta="${acta.name}">
          <div>
            <strong>${acta.name}</strong>
            <span class="row-meta">${acta.movements} movimientos · ${acta.items} ítems</span>
          </div>
          <div class="row-meta">
            Ejecutado ${formatMoney(acta.value)} · ${number.format(acta.quantity)} unidades acumuladas en el corte
          </div>
          <span class="status-pill ${hasValue ? "ok" : "warn"}">${hasValue ? "Leído" : "Sin datos"}</span>
        </article>
      `;
    })
    .join("");

  document.querySelectorAll(".acta-row").forEach((row) => {
    row.addEventListener("click", () => {
      const acta = state.data.actas.find((item) => item.name === row.dataset.acta);
      openInspector(acta.name, "Resumen del corte leído directamente desde la hoja viva CORTES_OBRA.", [
        ["Valor cargado", formatMoney(acta.value)],
        ["Movimientos", acta.movements],
        ["Ítems", acta.items],
        ["Cantidad acumulada", number.format(acta.quantity)],
        ["Fuente", `${state.data.project.sourceSheet || "CORTES_OBRA"} · ${state.data.project.sourceWorkbook}`],
      ]);
    });
  });
}

function actaSequence(name) {
  const match = String(name || "").match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function clientWeekRows(contractTotal, executedTotal) {
  const directTotal = state.data.actas
    .filter((acta) => acta.value > 0)
    .reduce((sum, acta) => sum + (acta.value || 0), 0);
  const contractFactor = directTotal ? executedTotal / directTotal : 1;
  let cumulative = 0;
  return state.data.actas
    .filter((acta) => acta.value > 0)
    .sort((a, b) => actaSequence(a.name) - actaSequence(b.name))
    .map((acta, index) => {
      const contractValue = (acta.value || 0) * contractFactor;
      cumulative += contractValue;
      return {
        ...acta,
        week: index + 1,
        label: `Semana ${index + 1}`,
        directValue: acta.value || 0,
        contractValue,
        cumulative,
        cumulativeProgress: contractTotal ? cumulative / contractTotal : 0,
      };
    });
}

function clientReportModel() {
  const { summary, project } = state.data;
  const contractTotal = summary.contractTotal || summary.budgetTotal;
  const executedTotal = summary.executedContractTotal || summary.executedTotal;
  const balance = Math.max(contractTotal - executedTotal, 0);
  const weeks = clientWeekRows(contractTotal, executedTotal);
  const directTotal = weeks.reduce((sum, week) => sum + (week.directValue || 0), 0);
  const contractFactor = directTotal ? executedTotal / directTotal : 1;
  const chapters = state.data.chapters
    .filter((chapter) => chapter.executed > 0)
    .map((chapter) => ({ ...chapter, displayExecuted: chapter.executed * contractFactor }))
    .slice(0, 7);
  const maxWeek = Math.max(...weeks.map((week) => week.contractValue), 1);
  const latestWeek = weeks[weeks.length - 1];
  const bestWeek = [...weeks].sort((a, b) => b.contractValue - a.contractValue)[0];
  const averageWeek = weeks.length ? weeks.reduce((sum, week) => sum + week.contractValue, 0) / weeks.length : 0;
  const progress = summary.contractProgress || summary.progress || 0;

  return {
    summary,
    project,
    contractTotal,
    executedTotal,
    balance,
    weeks,
    chapters,
    maxWeek,
    latestWeek,
    bestWeek,
    averageWeek,
    progress,
  };
}

function renderClient() {
  const {
    summary,
    project,
    contractTotal,
    executedTotal,
    balance,
    weeks,
    chapters,
    maxWeek,
    latestWeek,
    bestWeek,
    averageWeek,
    progress,
  } = clientReportModel();

  $("#clientFreshness").textContent = `Corte generado desde ${project.sourceSheet || "CORTES_OBRA"} · ${project.generatedAt || project.updatedAt}`;
  $("#clientProgressValue").textContent = formatPercent(progress);
  $(".client-progress")?.style.setProperty("--client-progress", `${Math.min(Math.max(progress * 100, 0), 100)}%`);
  $("#clientProgressContext").textContent = "Ejecutado a corte";
  $("#clientHeroStatus").textContent =
    progress >= 0.75 ? "Avance alto" : progress >= 0.45 ? "Obra en ejecución" : "Corte inicial";
  $("#clientHeroWeeks").textContent = `${weeks.length} semanas valorizadas`;
  $("#clientHeroSource").textContent = project.sourceSheet || "CORTES_OBRA";
  $("#clientContractTotal").textContent = formatMoney(contractTotal);
  $("#clientExecutedTotal").textContent = formatMoney(executedTotal);
  $("#clientLatestWeek").textContent = formatMoney(latestWeek?.contractValue || 0);
  $("#clientAverageWeek").textContent = formatMoney(averageWeek);
  $("#clientBalanceTotal").textContent = formatMoney(balance);
  $("#clientActiveActivities").textContent = `${summary.activeActivityCount} / ${summary.activityCount}`;
  $("#clientBriefProgress").textContent = `${formatPercent(progress)} ejecutado · ${weeks.length} semanas con avance · ${formatMoney(balance)} por ejecutar.`;
  $("#clientUpdatedTotal").textContent = formatMoney(summary.updatedTotal || 0);
  $("#clientNotExecuted").textContent = formatMoney(summary.notExecutedTotal || 0);
  $("#clientAlerts").textContent = activePending().length;

  $("#clientWeeks").innerHTML = weeks
    .map((week) => {
      const width = Math.max((week.contractValue / maxWeek) * 100, 4);
      const cumulativeWidth = Math.max(Math.min(week.cumulativeProgress * 100, 100), 4);
      return `
        <button class="client-week" data-week="${week.week}">
          <div>
            <span>${week.label}</span>
            <small>${week.name.replace("ACTA DE OBRA ", "Acta ")}</small>
          </div>
          <strong>${formatMoney(week.contractValue)}</strong>
          <em>${week.items} actividades · acumulado ${formatPercent(week.cumulativeProgress)}</em>
          <i style="width:${width}%"></i>
          <b style="width:${cumulativeWidth}%"></b>
        </button>
      `;
    })
    .join("");

  $("#clientRhythm").innerHTML = `
    <button class="rhythm-item" data-rhythm="latest">
      <span>Semana reciente</span>
      <strong>${latestWeek ? latestWeek.label : "Sin avance"}</strong>
      <small>${latestWeek ? `${formatMoney(latestWeek.contractValue)} · ${latestWeek.items} actividades` : "No hay semanas cargadas"}</small>
    </button>
    <button class="rhythm-item" data-rhythm="best">
      <span>Mayor avance semanal</span>
      <strong>${bestWeek ? bestWeek.label : "Sin avance"}</strong>
      <small>${bestWeek ? `${formatMoney(bestWeek.contractValue)} · ${bestWeek.name.replace("ACTA DE OBRA ", "Acta ")}` : "No hay semanas cargadas"}</small>
    </button>
    <button class="rhythm-item" data-rhythm="average">
      <span>Ritmo promedio</span>
      <strong>${formatMoney(averageWeek)}</strong>
      <small>${weeks.length} semanas con registro valorizado</small>
    </button>
  `;

  $("#clientChapters").innerHTML = chapters
    .map((chapter, index) => `
      <button class="client-front" data-chapter-index="${index}">
        <span>${chapter.name}</span>
        <strong>${formatMoney(chapter.displayExecuted)}</strong>
        <small>${chapter.active} actividades · ${formatPercent(chapter.progress)}</small>
      </button>
    `)
    .join("");

  document.querySelectorAll(".client-week").forEach((button) => {
    button.addEventListener("click", () => {
      const week = weeks.find((item) => String(item.week) === button.dataset.week);
      openInspector(`${week.label} · ${week.name}`, "Resumen ejecutivo semanal leído desde la hoja de cortes.", [
        ["Valor semanal contractual", formatMoney(week.contractValue)],
        ["Valor directo leído", formatMoney(week.directValue)],
        ["Avance acumulado", formatPercent(week.cumulativeProgress)],
        ["Actividades", week.items],
        ["Registros", week.movements],
        ["Cantidad reportada", number.format(week.quantity)],
      ]);
    });
  });

  document.querySelectorAll("[data-rhythm]").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.rhythm;
      const title = kind === "latest" ? "Semana reciente" : kind === "best" ? "Mayor avance semanal" : "Ritmo promedio";
      const week = kind === "best" ? bestWeek : latestWeek;
      openInspector(title, "Lectura ejecutiva para conversación con cliente.", [
        ["Semana", week ? `${week.label} · ${week.name}` : "Sin registro"],
        ["Valor", kind === "average" ? formatMoney(averageWeek) : formatMoney(week?.contractValue || 0)],
        ["Semanas leídas", weeks.length],
        ["Fuente", `${project.sourceWorkbook} · ${project.sourceSheet || "CORTES_OBRA"}`],
      ]);
    });
  });

  document.querySelectorAll(".client-front").forEach((button) => {
    button.addEventListener("click", () => {
      const chapter = chapters[Number(button.dataset.chapterIndex)];
      openInspector(chapter.name, "Frente de obra con avance valorizado acumulado.", [
        ["Ejecutado contractual", formatMoney(chapter.displayExecuted)],
        ["Ejecutado directo leído", formatMoney(chapter.executed)],
        ["Presupuesto directo", formatMoney(chapter.budget)],
        ["Avance", formatPercent(chapter.progress)],
        ["Actividades con avance", chapter.active],
      ]);
    });
  });

  document.querySelectorAll("[data-client-action]").forEach((button) => {
    button.onclick = () => {
      const action = button.dataset.clientAction;
      const copy = {
        "scope-updated": [
          "Presupuesto actualizado directo",
          "Valor directo resultante de cantidades actualizadas dentro de la hoja de cortes.",
          formatMoney(summary.updatedTotal || 0),
        ],
        "scope-not-executed": [
          "No ejecutado directo",
          "Valor directo identificado como no ejecutado en la lectura actual del archivo.",
          formatMoney(summary.notExecutedTotal || 0),
        ],
        "scope-alerts": [
          "Alertas internas",
          "Señales de control que conviene resolver antes de presentar una versión formal al cliente.",
          `${activePending().length} alertas activas`,
        ],
      }[action];
      openInspector(copy[0], copy[1], [
        ["Valor", copy[2]],
        ["Fuente", `${project.sourceWorkbook} · ${project.sourceSheet || "CORTES_OBRA"}`],
      ]);
    };
  });
}

function localDateString(date = new Date()) {
  const localDate = new Date(date);
  localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset());
  return localDate.toISOString().slice(0, 10);
}

function contextStorageKey() {
  const projectName = normalizeLoose(state.data?.project?.name || "obra");
  return `${CONTEXT_KEY_PREFIX}:${projectName || "obra"}`;
}

function aliasStorageKey() {
  const projectName = normalizeLoose(state.data?.project?.name || "obra");
  return `${ALIAS_KEY_PREFIX}:${projectName || "obra"}`;
}

function defaultDailyContext() {
  return {
    acta: "nuevo",
    date: localDateString(),
    source: "",
    zone: "",
    fieldMode: false,
  };
}

function loadDailyContext() {
  try {
    state.dailyContext = { ...defaultDailyContext(), ...JSON.parse(localStorage.getItem(contextStorageKey()) || "{}") };
  } catch {
    state.dailyContext = defaultDailyContext();
  }
}

function saveDailyContext() {
  localStorage.setItem(contextStorageKey(), JSON.stringify(state.dailyContext));
}

function loadAliases() {
  try {
    state.aliases = JSON.parse(localStorage.getItem(aliasStorageKey()) || "{}");
  } catch {
    state.aliases = {};
  }
}

function saveAliases() {
  localStorage.setItem(aliasStorageKey(), JSON.stringify(state.aliases));
}

function currentDailyContext() {
  return {
    acta: $("#partActa")?.value || state.dailyContext.acta || "nuevo",
    date: $("#partDate")?.value || state.dailyContext.date || localDateString(),
    source: ($("#partSource")?.value || state.dailyContext.source || "").trim(),
    zone: ($("#partZone")?.value || state.dailyContext.zone || "").trim(),
    fieldMode: Boolean($("#fieldMode")?.checked),
  };
}

function applyDailyContextToForm({ overwrite = false } = {}) {
  const context = state.dailyContext;
  if ($("#partActa")) $("#partActa").value = context.acta || "nuevo";
  if ($("#partDate")) $("#partDate").value = context.date || localDateString();
  if ($("#partSource")) $("#partSource").value = context.source || "";
  if ($("#partZone")) $("#partZone").value = context.zone || "";
  if ($("#fieldMode")) $("#fieldMode").checked = Boolean(context.fieldMode);
  document.body.classList.toggle("field-mode", Boolean(context.fieldMode));

  if (overwrite || !$("#entryActa")?.value || $("#entryActa")?.value === "nuevo") $("#entryActa").value = context.acta || "nuevo";
  if (overwrite || !$("#entryDate")?.value) $("#entryDate").value = context.date || localDateString();
  if (overwrite || !$("#entrySource")?.value) $("#entrySource").value = context.source || "";
  renderContextSummary();
}

function updateDailyContext(partial = {}) {
  state.dailyContext = { ...defaultDailyContext(), ...state.dailyContext, ...partial };
  saveDailyContext();
  applyDailyContextToForm();
}

function renderContextSummary() {
  const target = $("#contextSummary");
  if (!target) return;
  const context = currentDailyContext();
  const pieces = [
    context.date || "sin fecha",
    context.acta === "nuevo" ? "nuevo corte" : context.acta,
    context.source || "sin fuente",
    context.zone || "sin frente",
  ];
  target.textContent = pieces.join(" · ");
}

function entryValues() {
  const context = currentDailyContext();
  return {
    acta: $("#entryActa")?.value || context.acta || "nuevo",
    date: $("#entryDate")?.value || context.date || "",
    type: $("#entryType")?.value || "avance",
    quantity: Number($("#entryQuantity")?.value || 0),
    unit: ($("#entryUnit")?.value || "").trim(),
    source: ($("#entrySource")?.value || context.source || "").trim(),
    description: ($("#entryDescription")?.value || "").trim(),
    note: ($("#entryNote")?.value || "").trim(),
    zone: context.zone,
  };
}

function normalizeUnitToken(unit) {
  return String(unit || "")
    .toLowerCase()
    .replace("m²", "m2")
    .replace("m³", "m3")
    .replace(/^un$|^u$/, "und");
}

const MONTHS_ES = {
  ene: 0,
  enero: 0,
  feb: 1,
  febrero: 1,
  mar: 2,
  marzo: 2,
  abr: 3,
  abril: 3,
  may: 4,
  mayo: 4,
  jun: 5,
  junio: 5,
  jul: 6,
  julio: 6,
  ago: 7,
  agosto: 7,
  sep: 8,
  sept: 8,
  septiembre: 8,
  oct: 9,
  octubre: 9,
  nov: 10,
  noviembre: 10,
  dic: 11,
  diciembre: 11,
};

function parseDateHint(text) {
  const value = normalizeLoose(text);
  const numeric = value.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
  if (numeric) {
    const year = numeric[3]
      ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3])
      : new Date().getFullYear();
    return localDateString(new Date(year, Number(numeric[2]) - 1, Number(numeric[1])));
  }
  const named = value.match(/\b(\d{1,2})(?:\s+de)?\s+(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)\b/);
  if (!named) return "";
  return localDateString(new Date(new Date().getFullYear(), MONTHS_ES[named[2]], Number(named[1])));
}

function detectSource(text) {
  const normalized = normalizeLoose(text);
  const known = sourceOptions().find((source) => normalized.includes(normalizeLoose(source)));
  if (known) return known;
  const explicit = text.match(/\b(?:fuente|procedencia|soporte|contratista)\s*[:\-]?\s*([^,;:]+)/i);
  return explicit ? explicit[1].trim() : "";
}

function quickSharedContext(raw) {
  const context = currentDailyContext();
  const colonIndex = raw.indexOf(":");
  const prefix = colonIndex > -1 && colonIndex < 80 ? raw.slice(0, colonIndex) : "";
  const source = detectSource(prefix || raw) || context.source;
  const date = parseDateHint(prefix || raw) || context.date;
  return {
    ...context,
    source,
    date,
    prefix,
    body: prefix ? raw.slice(colonIndex + 1) : raw,
  };
}

function splitQuickEntries(raw) {
  const shared = quickSharedContext(raw);
  const body = shared.body
    .replace(/\r/g, "\n")
    .replace(/\s*,\s*(?=-?\d+(?:[.,]\d+)?\s*(?:m2|m²|m3|m³|ml|und|un|u|gl|kg|m)\b)/gi, "\n");
  return body
    .split(/\n+|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ line, shared }));
}

function parseEntryText(raw, overrides = {}) {
  const base = { ...entryValues(), ...overrides };
  const entry = {
    ...base,
    quantity: 0,
    unit: "",
    source: base.source || "",
    description: "",
    note: base.note || "",
    rawLine: raw,
    zone: base.zone || "",
  };
  const quantityMatch = raw.match(/(-?\d+(?:[.,]\d+)?)\s*(m2|m²|m3|m³|ml|und|un|u|gl|kg|m)\b/i);
  const sourceMatch = raw.match(/\b(?:fuente|procedencia|soporte|contratista)\s*[:\-]?\s*([^,;]+)/i);
  const typeMatch = raw.match(/\b(adicional|correcci[oó]n|no ejecutado|avance)\b/i);
  let description = raw;

  if (quantityMatch) {
    entry.quantity = Number(quantityMatch[1].replace(",", "."));
    entry.unit = normalizeUnitToken(quantityMatch[2]);
    description = description.replace(quantityMatch[0], "");
  }
  if (sourceMatch) {
    entry.source = sourceMatch[1].trim();
    description = description.replace(sourceMatch[0], "");
  }
  if (typeMatch) {
    const normalizedType = normalizeLoose(typeMatch[1]);
    entry.type =
      normalizedType.includes("adicional")
        ? "adicional"
        : normalizedType.includes("correccion")
          ? "correccion"
          : normalizedType.includes("no ejecutado")
            ? "no_ejecutado"
            : "avance";
    description = description.replace(typeMatch[0], "");
  }

  entry.description = description.replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, "").replace(/\s+/g, " ");
  return entry;
}

function fillEntryForm(entry) {
  $("#entryActa").value = entry.acta || currentDailyContext().acta || "nuevo";
  $("#entryDate").value = entry.date || currentDailyContext().date || localDateString();
  $("#entryQuantity").value = entry.quantity || "";
  $("#entryUnit").value = entry.unit || "";
  $("#entrySource").value = entry.source || "";
  $("#entryType").value = entry.type || "avance";
  $("#entryDescription").value = entry.description || "";
  $("#entryNote").value = entry.note || (entry.zone ? `Frente: ${entry.zone}` : "");
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

function sourceOptions() {
  return uniqueValues([
    state.dailyContext.source,
    ...DEFAULT_SOURCES,
    ...state.movements.map((movement) => movement.source),
  ]).slice(0, 18);
}

function unitOptions() {
  return uniqueValues([
    ...DEFAULT_UNITS,
    ...state.data.activities.map((activity) => activity.unit),
    ...state.data.sources.map((source) => source.sourceUnit),
  ]).slice(0, 20);
}

function suggestedActivities() {
  const active = state.data.activities
    .filter((activity) => activity.executedValue > 0 || activity.status !== "Sin avance")
    .sort((a, b) => (b.executedValue || b.budgetValue) - (a.executedValue || a.budgetValue))
    .slice(0, 8);
  if (active.length) return active;
  return [...state.data.activities].sort((a, b) => b.budgetValue - a.budgetValue).slice(0, 8);
}

function aliasKey(description, unit = "") {
  return `${normalizeLoose(description)}|${normalizeLoose(unit)}`;
}

function aliasEntries() {
  return Object.entries(state.aliases || {})
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => (b.count || 0) - (a.count || 0));
}

function aliasForEntry(entry) {
  return state.aliases[aliasKey(entry.description, entry.unit)] || state.aliases[aliasKey(entry.description, "")] || null;
}

function learnAlias(entry, activity) {
  if (!activity || !entry.description || normalizeLoose(entry.description) === normalizeLoose(activity.description)) return;
  const key = aliasKey(entry.description, entry.unit);
  state.aliases[key] = {
    description: entry.description,
    unit: entry.unit,
    row: activity.row,
    item: activity.item,
    activityDescription: activity.description,
    count: (state.aliases[key]?.count || 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  saveAliases();
}

function favoriteActivities() {
  const usage = state.movements.reduce((acc, movement) => {
    if (movement.activity?.row) acc[movement.activity.row] = (acc[movement.activity.row] || 0) + 5;
    return acc;
  }, {});
  aliasEntries().forEach((alias) => {
    if (alias.row) usage[alias.row] = (usage[alias.row] || 0) + Math.min(alias.count || 1, 6);
  });
  return [...state.data.activities]
    .map((activity) => ({
      ...activity,
      favoriteScore: (usage[activity.row] || 0) + (activity.executedValue > 0 ? 4 : 0) + Math.min((activity.budgetValue || 0) / 1000000, 5),
    }))
    .sort((a, b) => b.favoriteScore - a.favoriteScore)
    .slice(0, 12);
}

function applyAliasSuggestion(key) {
  const alias = state.aliases[key];
  if (!alias) return;
  const activity = state.data.activities.find((item) => String(item.row) === String(alias.row));
  $("#entryDescription").value = alias.description || "";
  $("#entryUnit").value = alias.unit || activity?.unit || "";
  state.selectedMatchRow = activity?.row || null;
  renderIngestion();
  $("#entryQuantity")?.focus();
}

function catalogPools() {
  return state.catalogPool || [];
}

function scoreCatalogItem(item, entry) {
  const queryTokens = tokensFor(entry.description);
  const unit = normalizeLoose(entry.unit);
  const text = normalizeLoose([
    item.code,
    item.description,
    item.category,
    item.subcategory,
    item.unit,
  ].join(" "));
  const overlap = queryTokens.filter((token) => text.includes(token));
  const overlapScore = queryTokens.length ? (overlap.length / queryTokens.length) * 60 : 0;
  const phrase = normalizeLoose(entry.description);
  const phraseScore = phrase && text.includes(phrase.slice(0, 24)) ? 18 : 0;
  const unitScore = unit && normalizeLoose(item.unit) === unit ? 12 : unit ? -6 : 0;
  const memoryScore =
    item.catalogKind === "apu"
      ? Math.min(Number(item.linesCount || 0), 18)
      : Math.min(Math.log10(Number(item.frequency || 1) + 1) * 12, 18);

  return Math.max(0, Math.min(99, Math.round(overlapScore + phraseScore + unitScore + memoryScore)));
}

function catalogSuggestions(entry = entryValues()) {
  if (!state.catalog) return [];
  const hasQuery = Boolean(entry.description || entry.unit);
  const pool = catalogPools();
  if (!hasQuery) {
    return [
      ...(state.catalog.activities || [])
        .map((item, index) => ({ ...item, catalogKind: "apu", catalogIndex: index }))
        .filter((item) => item.linesCount > 6)
        .sort((a, b) => (b.linesCount || 0) - (a.linesCount || 0))
        .slice(0, 5)
        .map((item) => ({ item, score: 0 })),
      ...(state.catalog.historicalItems || [])
        .map((item, index) => ({ ...item, catalogKind: "historial", catalogIndex: index }))
        .slice(0, 3)
        .map((item) => ({ item, score: 0 })),
    ];
  }
  return pool
    .map((item) => ({ item, score: scoreCatalogItem(item, entry) }))
    .filter((match) => match.score > 16)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

function catalogCandidateSnapshot(entry = entryValues()) {
  return catalogSuggestions(entry).slice(0, 4).map(({ item, score }) => ({
    kind: item.catalogKind,
    code: item.code || "",
    description: item.description,
    unit: item.unit,
    category: item.category || "",
    score,
  }));
}

function applyCatalogSuggestion(kind, index) {
  const source = kind === "apu" ? state.catalog?.activities : state.catalog?.historicalItems;
  const item = source?.[Number(index)];
  if (!item) return;
  $("#entryDescription").value = item.description || "";
  $("#entryUnit").value = item.unit || "";
  $("#entryNote").value = kind === "apu"
    ? `Sugerido por APU Machine: ${item.code || "sin código"} · ${item.category || "sin categoría"}`
    : `Sugerido por histórico APU Machine: frecuencia ${item.frequency || 1}`;
  state.selectedMatchRow = null;
  autoSelectClearMatch();
  renderIngestion();
  $("#entryQuantity")?.focus();
}

function applyActivitySuggestion(row) {
  const activity = state.data.activities.find((item) => String(item.row) === String(row));
  if (!activity) return;
  state.selectedMatchRow = activity.row;
  $("#entryDescription").value = activity.description;
  $("#entryUnit").value = activity.unit;
  $("#entryType").value = "avance";
  const balance = Number(activity.balanceQty || 0);
  if (balance > 0 && !Number($("#entryQuantity").value || 0)) {
    $("#entryQuantity").value = number.format(balance).replace(/\./g, "").replace(",", ".");
  }
  renderIngestion();
  $("#entryQuantity")?.focus();
}

function applySourceSuggestion(source) {
  $("#entrySource").value = source;
  renderIngestion();
}

function applyTemplate(kind) {
  const template = ENTRY_TEMPLATES.find((item) => item.id === kind);
  if (!template) return;
  $("#entryType").value = template.type;
  if (!$("#entryNote").value) {
    const zone = currentDailyContext().zone;
    $("#entryNote").value = zone ? `${template.note} Frente: ${zone}.` : template.note;
  }
  if (template.type === "adicional") {
    state.selectedMatchRow = null;
  }
  renderIngestion();
  $("#entryDescription")?.focus();
}

function parseQuickEntry(options = {}) {
  const raw = ($("#quickEntry")?.value || "").trim();
  if (!raw) return;
  const parsed = splitQuickEntries(raw)[0];
  if (!parsed) return;
  updateDailyContext({
    date: parsed.shared.date,
    source: parsed.shared.source,
  });
  const entry = parseEntryText(parsed.line, parsed.shared);
  fillEntryForm(entry);
  state.selectedMatchRow = null;
  autoSelectClearMatch();
  renderIngestion();
  if (options.autoSave === true) {
    autoSaveClearEntry();
  }
}

function scoreActivity(activity, entry) {
  const descriptionTokens = tokensFor(entry.description);
  const unit = normalizeLoose(entry.unit);
  if (!descriptionTokens.length && !unit) return 0;
  const alias = aliasForEntry(entry);
  if (alias && String(alias.row) === String(activity.row)) return 97;

  const activityText = normalizeLoose([
    activity.item,
    activity.description,
    activity.chapter,
    activity.unit,
  ].join(" "));
  const activityDescription = normalizeLoose(activity.description);
  const overlap = descriptionTokens.filter((token) => activityText.includes(token));
  const overlapScore = descriptionTokens.length ? (overlap.length / descriptionTokens.length) * 62 : 0;
  const phraseScore =
    entry.description && activityDescription.includes(normalizeLoose(entry.description).slice(0, 28))
      ? 15
      : 0;
  const itemScore = normalizeLoose(entry.description).includes(normalizeLoose(activity.item)) ? 18 : 0;
  const unitScore = unit && normalizeLoose(activity.unit) === unit ? 14 : unit ? -10 : 0;
  const chapterScore = overlap.some((token) => normalizeLoose(activity.chapter).includes(token)) ? 8 : 0;

  return Math.max(0, Math.min(99, Math.round(overlapScore + phraseScore + itemScore + unitScore + chapterScore)));
}

function matchConfidence(score) {
  if (score >= 70) return "Alta";
  if (score >= 45) return "Media";
  return "Baja";
}

function matchSuggestions(entry) {
  return state.data.activities
    .map((activity) => ({ activity, score: scoreActivity(activity, entry) }))
    .filter((match) => match.score > 18)
    .sort((a, b) => b.score - a.score)
    .slice(0, 7);
}

function clearMatchCandidate(entry = entryValues(), suggestions = matchSuggestions(entry)) {
  const best = suggestions[0];
  if (!best) return null;
  const next = suggestions[1];
  const unitMatches =
    entry.unit && normalizeLoose(entry.unit) === normalizeLoose(best.activity.unit);
  const unambiguousGap = !next || best.score - next.score >= 16;
  const isClear =
    entry.type !== "adicional" &&
    entry.description &&
    entry.quantity > 0 &&
    unitMatches &&
    best.score >= 78 &&
    unambiguousGap;
  return isClear ? best : null;
}

function autoSelectClearMatch() {
  const entry = entryValues();
  const clear = clearMatchCandidate(entry);
  if (clear) {
    state.selectedMatchRow = clear.activity.row;
  }
  return clear;
}

function autoSaveClearEntry() {
  const clear = autoSelectClearMatch();
  renderIngestion();
  if (!clear) {
    openInspector("Revisión necesaria", "No guardé automáticamente porque la coincidencia no es suficientemente clara o hay una alerta de unidad/cantidad.", [
      ["Acción", "Selecciona una sugerencia o guarda como pendiente."],
    ]);
    return;
  }
  const entry = entryValues();
  if (entry.type === "avance" && entry.quantity > Math.max(clear.activity.balanceQty || 0, 0)) {
    openInspector("Cantidad por revisar", "Preseleccioné el ítem, pero no guardé automáticamente porque la cantidad supera el saldo visible de la matriz.", [
      ["Ítem sugerido", `${clear.activity.item} · ${clear.activity.description}`],
      ["Cantidad reportada", `${number.format(entry.quantity)} ${entry.unit}`],
      ["Saldo visible", `${number.format(clear.activity.balanceQty)} ${clear.activity.unit}`],
    ]);
    return;
  }
  createMovement(false);
}

function processQuickLines() {
  const raw = ($("#quickEntry")?.value || "").trim();
  const entries = splitQuickEntries(raw);
  if (!entries.length) return;
  updateDailyContext({
    date: entries[0].shared.date,
    source: entries[0].shared.source,
  });

  const created = entries.map(({ line, shared }, index) => {
    const entry = parseEntryText(line, shared);
    const suggestions = matchSuggestions(entry);
    const clear = clearMatchCandidate(entry, suggestions);
    const activity = clear?.activity || null;
    let status = movementStatus(activity, entry, false);
    let reviewReason = "";

    if (!entry.description || !entry.quantity || entry.quantity <= 0 || !entry.unit) {
      status = "PENDIENTE_REVISION";
      reviewReason = "Faltan datos mínimos para cargar sin revisión.";
    } else if (entry.type === "adicional") {
      status = "ADICIONAL_PENDIENTE_APU";
      reviewReason = "Posible adicional; requiere validación de alcance/APU.";
    } else if (!activity) {
      status = "PENDIENTE_REVISION";
      reviewReason = suggestions.length
        ? "Hay candidatos, pero ninguno cumple la confianza para carga automática."
        : "No se encontró candidato suficiente en la matriz.";
    } else if (selectedUnitMismatch(activity, entry)) {
      status = "REVISAR_UNIDAD";
      reviewReason = `Unidad reportada ${entry.unit}; unidad matriz ${activity.unit}.`;
    } else if (entry.type === "avance" && entry.quantity > Math.max(activity.balanceQty || 0, 0)) {
      status = "REVISAR_CANTIDAD";
      reviewReason = `Cantidad supera saldo visible (${number.format(activity.balanceQty)} ${activity.unit}).`;
    }

    const movement = movementFromEntry(entry, activity, status, {
      rawLine: line,
      lineNumber: index + 1,
      reviewReason,
      candidates: candidateSnapshot(suggestions),
      apuCandidates: catalogCandidateSnapshot(entry),
    });
    learnAlias(entry, activity);
    return movement;
  });

  state.movements = [...created, ...state.movements];
  saveMovements();
  renderIngestion();
  const confirmed = created.filter((movement) => movement.status === "CONFIRMADO").length;
  openInspector("Líneas procesadas", "Convertí el texto pegado en movimientos locales clasificados.", [
    ["Líneas leídas", created.length],
    ["Confirmadas", confirmed],
    ["Para revisar", created.length - confirmed],
    ["Excel fuente", "Sin cambios"],
  ]);
}

function selectedActivity() {
  if (!state.selectedMatchRow) return null;
  return state.data.activities.find((activity) => String(activity.row) === String(state.selectedMatchRow));
}

function selectedUnitMismatch(activity, entry) {
  return Boolean(activity && entry.unit && normalizeLoose(activity.unit) !== normalizeLoose(entry.unit));
}

function candidateSnapshot(suggestions) {
  return suggestions.slice(0, 4).map(({ activity, score }) => ({
    row: activity.row,
    item: activity.item,
    description: activity.description,
    unit: activity.unit,
    chapter: activity.chapter,
    score,
  }));
}

function movementStatus(activity, entry, forcePending = false) {
  if (forcePending) return entry.type === "adicional" ? "ADICIONAL_PENDIENTE_APU" : "PENDIENTE_REVISION";
  if (!activity) return entry.type === "adicional" ? "ADICIONAL_PENDIENTE_APU" : "PENDIENTE_REVISION";
  if (selectedUnitMismatch(activity, entry)) return "REVISAR_UNIDAD";
  return "CONFIRMADO";
}

function movementValue(activity, entry) {
  if (!activity || !entry.quantity) return 0;
  const sign = entry.type === "no_ejecutado" ? -1 : 1;
  return sign * entry.quantity * (activity.unitPrice || 0);
}

function movementFromEntry(entry, activity, status, extra = {}) {
  return {
    id: extra.id || `mov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    project: state.data.project.name,
    acta: entry.acta === "nuevo" ? `Corte ${entry.date || "sin fecha"}` : entry.acta,
    date: entry.date,
    type: entry.type,
    reportedDescription: entry.description,
    quantity: entry.quantity,
    unit: entry.unit,
    source: entry.source,
    note: entry.note,
    zone: entry.zone,
    status,
    activity: activity
      ? {
          row: activity.row,
          item: activity.item,
          description: activity.description,
          chapter: activity.chapter,
          unit: activity.unit,
          unitPrice: activity.unitPrice,
        }
      : null,
    simulatedValue: movementValue(activity, entry),
    ...extra,
  };
}

function validationMessages(activity, entry, suggestions) {
  const messages = [];
  if (!entry.description) {
    messages.push(["danger", "Falta la actividad reportada en campo."]);
  }
  if (!entry.quantity || entry.quantity <= 0) {
    messages.push(["danger", "Falta una cantidad mayor que cero."]);
  }
  if (!entry.unit) {
    messages.push(["warn", "Falta la unidad reportada; sin unidad es difícil auditar el movimiento."]);
  }
  if (!activity && entry.type !== "adicional") {
    messages.push(["warn", "No hay ítem confirmado. Puede guardarse como pendiente, no como cargado."]);
  }
  if (activity && selectedUnitMismatch(activity, entry)) {
    messages.push(["warn", `La unidad reportada (${entry.unit}) no coincide con la matriz (${activity.unit}).`]);
  }
  if (activity && entry.type === "avance" && entry.quantity > Math.max(activity.balanceQty || 0, 0)) {
    messages.push(["warn", `La cantidad supera el saldo presupuestal visible (${number.format(activity.balanceQty)} ${activity.unit}).`]);
  }
  if (!activity && suggestions.length > 1 && suggestions[0].score - suggestions[1].score < 18) {
    messages.push(["warn", "Hay varias actividades parecidas. Conviene pedir confirmación antes de cargar."]);
  }
  if (entry.type === "adicional") {
    messages.push(["ok", "Se tratará como posible adicional y deberá pasar por revisión/APU antes de cargarse formalmente."]);
  }
  if (!messages.length) {
    messages.push(["ok", "Movimiento listo para guardar como confirmado en esta maqueta."]);
  }
  return messages;
}

function createMovement(forcePending = false) {
  const entry = entryValues();
  const activity = forcePending ? selectedActivity() : selectedActivity();
  if (!entry.description && !entry.source && !activity) {
    openInspector("Movimiento incompleto", "Agrega una actividad reportada, una fuente o selecciona un ítem antes de guardar.", [
      ["Estado", "No guardado"],
    ]);
    return;
  }
  if (!forcePending && !activity) {
    openInspector("Confirma el destino", "La app no carga una cantidad contra la matriz si el arquitecto no confirma el ítem destino.", [
      ["Actividad reportada", entry.description || "Sin descripción"],
      ["Acción sugerida", "Selecciona una coincidencia o guarda como pendiente."],
    ]);
    return;
  }

  const status = movementStatus(activity, entry, forcePending);
  const movement = movementFromEntry(entry, activity, status, {
    candidates: candidateSnapshot(matchSuggestions(entry)),
    apuCandidates: catalogCandidateSnapshot(entry),
  });

  learnAlias(entry, activity);
  updateDailyContext({
    acta: entry.acta,
    date: entry.date,
    source: entry.source,
    zone: entry.zone,
  });
  state.movements.unshift(movement);
  saveMovements();
  state.selectedMatchRow = null;
  $("#entryForm").reset();
  applyDailyContextToForm();
  renderIngestion();
  openInspector(statusLabel(status), movement.reportedDescription || movement.activity?.description || "Movimiento guardado.", [
    ["Acta", movement.acta],
    ["Cantidad", `${number.format(movement.quantity)} ${movement.unit || ""}`],
    ["Ítem destino", movement.activity ? `${movement.activity.item} · ${movement.activity.description}` : "Pendiente"],
    ["Valor simulado", formatMoney(movement.simulatedValue)],
    ["Fuente", movement.source || "Sin fuente"],
    ["Frente", movement.zone || "Sin frente"],
  ], movementActions(movement));
}

function setDefaultEntryDate() {
  const input = $("#entryDate");
  if (input && !input.value) {
    input.value = state.dailyContext.date || localDateString();
  }
}

function statusLabel(status) {
  return {
    CONFIRMADO: "Confirmado",
    REVISAR_UNIDAD: "Revisar unidad",
    REVISAR_CANTIDAD: "Revisar cantidad",
    PENDIENTE_REVISION: "Pendiente",
    ADICIONAL_PENDIENTE_APU: "Adicional",
  }[status] || status;
}

function movementStatusClass(status) {
  if (status === "CONFIRMADO") return "ok";
  if (status === "REVISAR_UNIDAD" || status === "REVISAR_CANTIDAD" || status === "ADICIONAL_PENDIENTE_APU") return "warn";
  return "danger";
}

function mutateMovement(id, updater) {
  state.movements = state.movements.map((movement) =>
    movement.id === id ? updater({ ...movement }) : movement
  );
  saveMovements();
  renderIngestion();
}

function deleteMovement(id) {
  state.movements = state.movements.filter((movement) => movement.id !== id);
  saveMovements();
  renderIngestion();
  closeInspector();
}

function duplicateMovement(id) {
  const movement = state.movements.find((item) => item.id === id);
  if (!movement) return;
  state.movements.unshift({
    ...movement,
    id: `mov-${Date.now()}`,
    createdAt: new Date().toISOString(),
    note: [movement.note, "Duplicado desde bandeja."].filter(Boolean).join(" "),
  });
  saveMovements();
  renderIngestion();
}

function movementFeedbackLabel(feedback) {
  return {
    correcto: "Correcto",
    corregir_item: "Corregir ítem",
    corregir_unidad: "Corregir unidad",
    no_corresponde: "No corresponde",
  }[feedback] || "Sin feedback";
}

function applyMovementFeedback(id, feedback) {
  mutateMovement(id, (item) => {
    const next = {
      ...item,
      architectFeedback: feedback,
      feedbackAt: new Date().toISOString(),
    };
    if (feedback === "correcto" && item.activity && item.status !== "REVISAR_CANTIDAD") {
      next.status = "CONFIRMADO";
      next.reviewReason = "";
    }
    if (feedback === "corregir_item") {
      next.status = "PENDIENTE_REVISION";
      next.reviewReason = "Arquitecto solicitó corregir el ítem destino.";
    }
    if (feedback === "corregir_unidad") {
      next.status = "REVISAR_UNIDAD";
      next.reviewReason = "Arquitecto solicitó corregir la unidad.";
    }
    if (feedback === "no_corresponde") {
      next.status = "PENDIENTE_REVISION";
      next.reviewReason = "Arquitecto indicó que este movimiento no corresponde.";
    }
    return next;
  });
}

function movementActions(movement) {
  const actions = [
    {
      id: "feedback-correct",
      label: "Feedback: correcto",
      kind: "secondary",
      onClick: () => applyMovementFeedback(movement.id, "correcto"),
    },
    {
      id: "feedback-item",
      label: "Corregir ítem",
      kind: "secondary",
      onClick: () => applyMovementFeedback(movement.id, "corregir_item"),
    },
    {
      id: "feedback-unit",
      label: "Corregir unidad",
      kind: "secondary",
      onClick: () => applyMovementFeedback(movement.id, "corregir_unidad"),
    },
    {
      id: "feedback-na",
      label: "No corresponde",
      kind: "danger",
      onClick: () => applyMovementFeedback(movement.id, "no_corresponde"),
    },
    {
      id: "movement-review",
      label: "Marcar para revisar",
      kind: "secondary",
      onClick: () =>
        mutateMovement(movement.id, (item) => ({
          ...item,
          status: "PENDIENTE_REVISION",
          reviewedAt: new Date().toISOString(),
        })),
    },
    {
      id: "movement-duplicate",
      label: "Duplicar movimiento",
      kind: "secondary",
      onClick: () => duplicateMovement(movement.id),
    },
    {
      id: "movement-delete",
      label: "Eliminar movimiento local",
      kind: "danger",
      onClick: () => deleteMovement(movement.id),
    },
  ];
  if (movement.activity && movement.status !== "CONFIRMADO") {
    actions.unshift({
      id: "movement-confirm",
      label: "Confirmar movimiento",
      onClick: () =>
        mutateMovement(movement.id, (item) => ({
          ...item,
          status: "CONFIRMADO",
          reviewedAt: new Date().toISOString(),
        })),
    });
  }
  return actions;
}

function movementBucketKey(movement) {
  if (movement.status === "CONFIRMADO") return "confirmed";
  if (movement.status === "ADICIONAL_PENDIENTE_APU") return "additional";
  if (movement.status === "REVISAR_CANTIDAD") return "quantity";
  return "review";
}

function movementBucketCounts() {
  return state.movements.reduce(
    (acc, movement) => {
      acc.all += 1;
      acc[movementBucketKey(movement)] += 1;
      return acc;
    },
    { all: 0, confirmed: 0, review: 0, quantity: 0, additional: 0 }
  );
}

function filteredMovements() {
  if (state.movementFilter === "all") return state.movements;
  return state.movements.filter((movement) => movementBucketKey(movement) === state.movementFilter);
}

function renderMovementBuckets() {
  const target = $("#movementBuckets");
  if (!target) return;
  const counts = movementBucketCounts();
  const buckets = [
    ["all", "Todos", counts.all],
    ["confirmed", "Listos", counts.confirmed],
    ["review", "Revisión", counts.review],
    ["quantity", "Cantidad", counts.quantity],
    ["additional", "Adicionales", counts.additional],
  ];
  target.innerHTML = buckets
    .map(([key, label, count]) => `
      <button class="${state.movementFilter === key ? "active" : ""}" data-movement-filter="${key}">
        <span>${label}</span>
        <strong>${count}</strong>
      </button>
    `)
    .join("");
  document.querySelectorAll("[data-movement-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.movementFilter = button.dataset.movementFilter;
      renderIngestion();
    });
  });
}

function renderEntryAssist() {
  const unitList = $("#unitSuggestions");
  const sourceList = $("#sourceSuggestions");
  if (unitList) {
    unitList.innerHTML = unitOptions().map((unit) => `<option value="${unit}"></option>`).join("");
  }
  if (sourceList) {
    sourceList.innerHTML = sourceOptions().map((source) => `<option value="${source}"></option>`).join("");
  }

  $("#activityAssist").innerHTML = suggestedActivities()
    .map((activity) => `
      <button type="button" data-assist-activity="${activity.row}">
        <strong>${activity.item} · ${activity.unit}</strong>
        <span>${truncate(activity.description, 72)}</span>
      </button>
    `)
    .join("");

  $("#sourceAssist").innerHTML = sourceOptions()
    .slice(0, 8)
    .map((source) => `<button type="button" data-assist-source="${source}">${source}</button>`)
    .join("");

  $("#templateAssist").innerHTML = ENTRY_TEMPLATES
    .map((template) => `<button type="button" data-assist-template="${template.id}">${template.label}</button>`)
    .join("");

  document.querySelectorAll("[data-assist-activity]").forEach((button) => {
    button.addEventListener("click", () => applyActivitySuggestion(button.dataset.assistActivity));
  });
  document.querySelectorAll("[data-assist-source]").forEach((button) => {
    button.addEventListener("click", () => applySourceSuggestion(button.dataset.assistSource));
  });
  document.querySelectorAll("[data-assist-template]").forEach((button) => {
    button.addEventListener("click", () => applyTemplate(button.dataset.assistTemplate));
  });

  $("#favoriteAssist").innerHTML = favoriteActivities()
    .map((activity) => `
      <button type="button" data-assist-activity="${activity.row}">
        <strong>${activity.item} · ${activity.unit}</strong>
        <span>${truncate(activity.description, 68)}</span>
      </button>
    `)
    .join("");

  document.querySelectorAll("#favoriteAssist [data-assist-activity]").forEach((button) => {
    button.addEventListener("click", () => applyActivitySuggestion(button.dataset.assistActivity));
  });

  const aliases = aliasEntries().slice(0, 8);
  $("#aliasAssist").innerHTML = aliases.length
    ? aliases
        .map((alias) => `<button type="button" data-assist-alias="${alias.key}">${truncate(alias.description, 42)}</button>`)
        .join("")
    : `<span class="empty-inline">Aparecerán cuando corrijas coincidencias.</span>`;

  document.querySelectorAll("[data-assist-alias]").forEach((button) => {
    button.addEventListener("click", () => applyAliasSuggestion(button.dataset.assistAlias));
  });
}

function renderApuAssist(entry = entryValues()) {
  const target = $("#apuAssist");
  const meta = $("#apuCatalogMeta");
  if (!target || !meta) return;

  if (state.catalogStatus === "unavailable") {
    meta.textContent = "Catálogo no disponible en esta publicación.";
    target.innerHTML = `<p class="empty">El ingreso sigue funcionando con la matriz del proyecto.</p>`;
    return;
  }

  const counts = state.catalog?.counts;
  meta.textContent = counts
    ? `${number.format(counts.apuActivities)} actividades APU · ${number.format(counts.historicalUniqueItems)} conceptos históricos únicos.`
    : "Cargando catálogo histórico...";

  const suggestions = catalogSuggestions(entry);
  target.innerHTML = suggestions.length
    ? suggestions
        .map(({ item, score }) => {
          const kindLabel = item.catalogKind === "apu" ? "APU" : "Histórico";
          const price = item.unitPrice || item.avgUnitPrice;
          const support = item.catalogKind === "apu"
            ? `${item.category || "Sin categoría"}${item.subcategory ? ` · ${item.subcategory}` : ""}`
            : `${number.format(item.frequency || 1)} apariciones · ${(item.sourceGroups || "").split(",").slice(0, 2).join(", ")}`;
          const confidence = score ? `${matchConfidence(score)} · ${score}%` : "Sugerencia frecuente";
          return `
            <button type="button" data-catalog-kind="${item.catalogKind}" data-catalog-index="${item.catalogIndex}">
              <span>${escapeHtml(kindLabel)} · ${escapeHtml(item.unit || "s/u")}</span>
              <strong>${escapeHtml(truncate(item.description, 118))}</strong>
              <small>${escapeHtml(support)} · ${escapeHtml(confidence)}${price ? ` · ${formatMoney(price)}` : ""}</small>
            </button>
          `;
        })
        .join("")
    : `<p class="empty">Sin coincidencias históricas. El movimiento queda como aprendizaje para depurar el catálogo.</p>`;

  document.querySelectorAll("[data-catalog-kind]").forEach((button) => {
    button.addEventListener("click", () => applyCatalogSuggestion(button.dataset.catalogKind, button.dataset.catalogIndex));
  });
}

function renderIngestion() {
  if (!$("#entryForm")) return;
  const entry = entryValues();
  const suggestions = matchSuggestions(entry);
  if (!state.selectedMatchRow) {
    const clear = clearMatchCandidate(entry, suggestions);
    if (clear) state.selectedMatchRow = clear.activity.row;
  }
  const activity = selectedActivity();
  const validations = validationMessages(activity, entry, suggestions);
  const pendingCount = state.movements.filter((movement) => movement.status !== "CONFIRMADO").length;
  const total = state.movements.reduce((sum, movement) => sum + (movement.simulatedValue || 0), 0);

  $("#ingestCount").textContent = state.movements.length;
  $("#ingestPendingCount").textContent = pendingCount;
  $("#ingestTotalValue").textContent = formatMoney(total);
  renderContextSummary();
  renderEntryAssist();
  renderApuAssist(entry);
  renderMovementBuckets();

  if (activity) {
    const unitMismatch = selectedUnitMismatch(activity, entry);
    $("#entryMatchState").textContent = unitMismatch ? "Revisar unidad" : "Ítem confirmado";
    $("#entryMatchState").className = `status-pill ${unitMismatch ? "warn" : "ok"}`;
    $("#selectedMatch").innerHTML = `
      <span>Ítem destino</span>
      <strong>${activity.item} · ${activity.description}</strong>
      <small>${activity.chapter} · ${activity.unit} · ${formatMoney(activity.unitPrice)}</small>
    `;
  } else {
    $("#entryMatchState").textContent = entry.type === "adicional" ? "Adicional" : "Sin selección";
    $("#entryMatchState").className = `status-pill ${entry.type === "adicional" ? "warn" : ""}`;
    $("#selectedMatch").innerHTML = `
      <span>Ítem destino</span>
      <strong>Selecciona una sugerencia para poder guardar como confirmado.</strong>
    `;
  }

  $("#matchSuggestions").innerHTML =
    suggestions.length
      ? suggestions
          .map(({ activity: item, score }) => `
            <button class="match-option ${String(item.row) === String(state.selectedMatchRow) ? "selected" : ""}" data-row="${item.row}">
              <span>${item.item} · ${item.unit}</span>
              <strong>${item.description}</strong>
              <small>${item.chapter} · ${matchConfidence(score)} coincidencia · ${score}%</small>
            </button>
          `)
          .join("")
      : `<p class="empty">Escribe una actividad de campo para ver coincidencias contra la matriz.</p>`;

  const isAmbiguous =
    entry.description &&
    !activity &&
    suggestions.length > 1 &&
    (suggestions[0].score - suggestions[1].score < 18 || suggestions[0].score < 78);
  $("#ambiguityPanel").innerHTML = isAmbiguous
    ? `
      <div>
        <span>Confirmación por ambigüedad</span>
        <strong>¿A cuál ítem corresponde este avance?</strong>
      </div>
      <div class="ambiguity-options">
        ${suggestions.slice(0, 3).map(({ activity: item, score }) => `
          <button type="button" data-ambiguity-row="${item.row}">
            <span>${item.item} · ${item.unit}</span>
            <strong>${truncate(item.description, 70)}</strong>
            <small>${item.chapter} · ${score}%</small>
          </button>
        `).join("")}
      </div>
    `
    : "";

  document.querySelectorAll("[data-ambiguity-row]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedMatchRow = button.dataset.ambiguityRow;
      renderIngestion();
    });
  });

  document.querySelectorAll(".match-option").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedMatchRow = button.dataset.row;
      renderIngestion();
    });
  });

  $("#entryValidation").innerHTML = validations
    .map(([kind, message]) => `<div class="validation-item ${kind}">${message}</div>`)
    .join("");

  const movementRows = filteredMovements();
  $("#movementLedger").innerHTML =
    movementRows.length
      ? movementRows
          .map((movement) => `
            <article class="movement-row" data-movement="${movement.id}">
              <div>
                <strong>${movement.activity ? `${movement.activity.item} · ${truncate(movement.activity.description, 86)}` : truncate(movement.reportedDescription || "Sin actividad", 92)}</strong>
                <span class="row-meta">${movement.acta} · ${movement.source || "Sin fuente"} · ${movement.date || "sin fecha"}${movement.zone ? ` · ${movement.zone}` : ""}${movement.architectFeedback ? ` · Feedback: ${movementFeedbackLabel(movement.architectFeedback)}` : ""}${movement.reviewReason ? ` · ${movement.reviewReason}` : ""}</span>
              </div>
              <div>
                <strong>${number.format(movement.quantity)} ${movement.unit || ""}</strong>
                <span class="row-meta">${movement.type} · ${formatMoney(movement.simulatedValue)}</span>
              </div>
              <span class="status-pill ${movementStatusClass(movement.status)}">${statusLabel(movement.status)}</span>
            </article>
          `)
          .join("")
      : `<p class="empty">No hay movimientos en este filtro.</p>`;

  document.querySelectorAll(".movement-row").forEach((row) => {
    row.addEventListener("click", () => {
      const movement = state.movements.find((item) => item.id === row.dataset.movement);
      openInspector(statusLabel(movement.status), movement.reportedDescription || movement.activity?.description || "Movimiento de corte.", [
        ["Acta", movement.acta],
        ["Tipo", movement.type],
        ["Cantidad", `${number.format(movement.quantity)} ${movement.unit || ""}`],
        ["Ítem destino", movement.activity ? `${movement.activity.item} · ${movement.activity.description}` : "Pendiente"],
        ["Valor simulado", formatMoney(movement.simulatedValue)],
        ["Fuente", movement.source || "Sin fuente"],
        ["Frente", movement.zone || "Sin frente"],
        ["Observación", movement.note || "Sin observación"],
        ["Revisión", movement.reviewReason || "Sin alerta adicional"],
        ["Feedback arquitecto", movementFeedbackLabel(movement.architectFeedback)],
        ["Candidatos", movement.candidates?.map((candidate) => `${candidate.item} (${candidate.score}%): ${candidate.description}`).join(" | ")],
        ["Memoria APU", movement.apuCandidates?.map((candidate) => `${candidate.kind} ${candidate.code || ""} (${candidate.score}%): ${candidate.description}`).join(" | ")],
      ], movementActions(movement));
    });
  });

  renderDraftSummary();
  renderHandoffSummary();
}

function renderDraftSummary() {
  const target = $("#draftSummary");
  if (!target) return;
  const rows = draftRows();
  target.innerHTML = rows.length
    ? rows
        .map((row) => `
          <article class="draft-row">
            <div>
              <strong>${row.acta}</strong>
              <span class="row-meta">${row.confirmed} confirmados · ${row.pending} pendientes</span>
            </div>
            <div>
              <strong>${formatMoney(row.value)}</strong>
              <span class="row-meta">${row.count} movimientos</span>
            </div>
          </article>
        `)
        .join("")
    : `<p class="empty">Guarda movimientos para ver el borrador de acta.</p>`;
}

function draftRows() {
  const groups = state.movements.reduce((acc, movement) => {
    const key = movement.acta || "Sin acta";
    acc[key] ||= { acta: key, count: 0, confirmed: 0, pending: 0, value: 0 };
    acc[key].count += 1;
    acc[key].value += movement.simulatedValue || 0;
    if (movement.status === "CONFIRMADO") acc[key].confirmed += 1;
    else acc[key].pending += 1;
    return acc;
  }, {});
  return Object.values(groups);
}

function renderHandoffSummary() {
  const target = $("#handoffSummary");
  if (!target) return;
  const payload = buildHandoffPackage();
  const readySignals = [
    ["Esquema", payload.schemaVersion],
    ["Movimientos", payload.counts.all],
    ["Listos", payload.counts.confirmed],
    ["Por revisar", payload.counts.review + payload.counts.quantity + payload.counts.additional],
    ["Feedback", payload.movements.filter((movement) => movement.architectFeedback).length],
    ["Alias", payload.aliases.length],
    ["Valor paquete", formatMoney(payload.totals.simulatedValue)],
  ];
  target.innerHTML = `
    <div class="handoff-grid">
      ${readySignals
        .map(([label, value]) => `
          <div>
            <span>${label}</span>
            <strong>${value}</strong>
          </div>
        `)
        .join("")}
    </div>
    <div class="handoff-note">
      <strong>Contrato de migración</strong>
      <span>El paquete exportado incluye proyecto, resumen, borrador de actas, movimientos, candidatos, feedback y decisiones locales. Sigue usando localStorage hasta conectar una base compartida.</span>
    </div>
  `;
}

function renderActivities() {
  const rows = filteredActivities()
    .sort((a, b) => b.executedValue - a.executedValue)
    .slice(0, 120);

  $("#activityTable").innerHTML =
    rows
      .map((activity) => {
        const pct = Math.min(activity.progress * 100, 140);
        const statusClass =
          activity.status === "Sobreejecutado"
            ? "danger"
            : activity.status === "Adicional"
              ? "warn"
            : activity.status === "En ejecución"
              ? "ok"
              : "";
        return `
          <tr data-row="${activity.row}">
            <td><strong>${activity.item}</strong><br><small>Fila ${activity.row}</small></td>
            <td class="activity-name">${activity.description}<br><small>${activity.chapter}</small></td>
            <td>${activity.unit}</td>
            <td>${number.format(activity.budgetQty)}<br><small>${formatMoney(activity.budgetValue)}</small></td>
            <td>${number.format(activity.executedQty)}<br><small>${formatMoney(activity.executedValue)}</small></td>
            <td>
              ${formatPercent(activity.progress)}
              <div class="mini-progress"><span style="width:${Math.min(pct, 100)}%"></span></div>
            </td>
            <td><span class="status-pill ${statusClass}">${activity.status}</span></td>
          </tr>
        `;
      })
      .join("") || `<tr><td colspan="7" class="empty">No hay actividades con ese filtro.</td></tr>`;

  document.querySelectorAll("#activityTable tr[data-row]").forEach((row) => {
    row.addEventListener("click", () => {
      const activity = state.data.activities.find((item) => String(item.row) === row.dataset.row);
      const sourceText = activity.sources.length
        ? activity.sources
            .map((source) => `${source.acta} fila ${source.sourceRow}: ${number.format(source.sourceQuantity)} ${source.sourceUnit}`)
            .join(" · ")
        : "Sin fuente cargada";
      openInspector(`${activity.item} · ${activity.unit}`, activity.description, [
        ["Capítulo", activity.chapter],
        ["Presupuesto", `${number.format(activity.budgetQty)} · ${formatMoney(activity.budgetValue)}`],
        ["Ejecutado", `${number.format(activity.executedQty)} · ${formatMoney(activity.executedValue)}`],
        ["Avance", formatPercent(activity.progress)],
        ["Estado", activity.status],
        ["Fuentes", sourceText],
      ]);
    });
  });
}

function statusClass(status) {
  if (status === "RESUELTO") return "resolved";
  if (status === "SIN_COINCIDENCIA") return "danger";
  if (status === "REVISAR" || status === "EXCLUIDO") return "warn";
  return "ok";
}

function renderPending() {
  const rows = filteredPending();
  $("#decisionCount").textContent = `${decisionEntries().length} revisiones locales`;
  $("#pendingList").innerHTML =
    rows
      .map((item, index) => `
        <article class="review-row" data-pending-index="${index}">
          <div>
            <strong>${item.acta} · Fila ${item.sourceRow || "s/d"}</strong>
            <span class="row-meta">${item.file || "CONTRATISTAS.xlsx"}</span>
          </div>
          <div>
            <strong>${item.sourceDescription || "Sin descripción"}</strong>
            <span class="row-meta">${item.review || item.note || item.candidates || "Requiere validación manual."}</span>
          </div>
          <span class="status-pill ${statusClass(isResolved(item) ? "RESUELTO" : item.status)}">${isResolved(item) ? "RESUELTO" : item.status}</span>
        </article>
      `)
      .join("") || `<p class="empty">No hay pendientes con ese filtro.</p>`;

  document.querySelectorAll(".review-row").forEach((row) => {
    row.addEventListener("click", () => {
      const item = rows[Number(row.dataset.pendingIndex)];
      const decision = decisionFor(item);
      const candidates = parseCandidates(item.candidates);
      const actions = [];
      if (!decision?.resolved) {
        if (candidates[0]) {
          actions.push({
            id: "approve-first",
            label: `Aprobar candidato: ${candidates[0].item}`,
            onClick: () => resolvePending(item, {
              method: "candidate",
              item: candidates[0].item,
              description: candidates[0].description,
              score: candidates[0].score,
            }),
          });
        }
        actions.push({
          id: "resolve-manual",
            label: "Marcar como revisado",
          kind: "secondary",
          onClick: () => resolvePending(item, { method: "manual" }),
        });
      } else {
        actions.push({
          id: "undo-resolution",
          label: "Reabrir pendiente",
          kind: "danger",
          onClick: () => reopenPending(item),
        });
      }
      openInspector(`${decision?.resolved ? "REVISADO" : item.status} · ${item.acta}`, item.sourceDescription || "Sin descripción de origen.", [
        ["Archivo", item.file],
        ["Fila fuente", item.sourceRow],
        ["Cantidad", `${number.format(item.quantity)} ${item.unit || ""}`],
        ["Sugerencia", item.suggestedDescription || item.suggestedItem || "Sin sugerencia definitiva"],
        ["Alerta", item.review || item.note],
        ["Revisión", decision ? `${decision.method}${decision.item ? ` · ${decision.item}` : ""}` : "Pendiente"],
        ["Candidatos", item.candidates],
      ], actions);
    });
  });
}

function resolvePending(item, payload) {
  state.decisions[pendingKey(item)] = {
    resolved: true,
    ...payload,
    resolvedAt: new Date().toISOString(),
  };
  saveDecisions();
  renderAll();
  openInspector("Revisión registrada", item.sourceDescription || "Alerta revisada.", [
    ["Acta", item.acta],
    ["Fila fuente", item.sourceRow],
    ["Método", payload.method],
    ["Ítem aprobado", payload.item || "Revisión manual"],
  ], [
    {
      id: "undo-resolution",
      label: "Reabrir pendiente",
      kind: "danger",
      onClick: () => reopenPending(item),
    },
  ]);
}

function reopenPending(item) {
  delete state.decisions[pendingKey(item)];
  saveDecisions();
  renderAll();
  closeInspector();
}

function exportDecisions() {
  const decisions = decisionEntries().map(([key, decision]) => ({ key, ...decision }));
  const payload = {
    project: projectName(),
    exportedAt: new Date().toISOString(),
    decisions,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${projectSlug()}-revisiones-dashboard.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function buildHandoffPackage() {
  const counts = movementBucketCounts();
  const decisions = decisionEntries().map(([key, decision]) => ({ key, ...decision }));
  const totals = {
    simulatedValue: state.movements.reduce((sum, movement) => sum + (movement.simulatedValue || 0), 0),
    confirmedValue: state.movements
      .filter((movement) => movement.status === "CONFIRMADO")
      .reduce((sum, movement) => sum + (movement.simulatedValue || 0), 0),
    pendingValue: state.movements
      .filter((movement) => movement.status !== "CONFIRMADO")
      .reduce((sum, movement) => sum + (movement.simulatedValue || 0), 0),
  };
  return {
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    dashboardBuild: DASHBOARD_BUILD,
    project: state.data.project,
    exportedAt: new Date().toISOString(),
    source: {
      workbook: state.data.project.sourceWorkbook,
      sheet: state.data.project.sourceSheet,
      apuCatalog: state.catalog?.counts || null,
      note: "Paquete generado desde prototipo estático. No modifica el Excel fuente.",
    },
    counts,
    totals,
    actaDrafts: draftRows(),
    localStorageKeys: {
      movements: movementStorageKey(),
      decisions: decisionStorageKey(),
      dailyContext: contextStorageKey(),
      aliases: aliasStorageKey(),
      legacyDecisions: LEGACY_DECISION_KEY,
    },
    decisions,
    dailyContext: state.dailyContext,
    aliases: aliasEntries(),
    movements: state.movements,
  };
}

function exportMovements() {
  const payload = buildHandoffPackage();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${projectSlug()}-paquete-migracion.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function reportTimestamp(date = new Date()) {
  return date.toLocaleString("es-CO", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fileDateStamp(date = new Date()) {
  return localDateString(date);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function excelCell(value, style = "") {
  return { value, style };
}

function excelHeader(values) {
  return values.map((value) => excelCell(value, "Header"));
}

function excelCellXml(input) {
  const cell = input && typeof input === "object" && Object.prototype.hasOwnProperty.call(input, "value")
    ? input
    : { value: input, style: "" };
  const value = cell.value ?? "";
  const isNumber = typeof value === "number" && Number.isFinite(value);
  const type = isNumber ? "Number" : "String";
  const style = cell.style ? ` ss:StyleID="${cell.style}"` : "";
  return `<Cell${style}><Data ss:Type="${type}">${xmlEscape(value)}</Data></Cell>`;
}

function safeExcelSheetName(name, index = 0) {
  const cleaned = String(name || `Hoja ${index + 1}`)
    .replace(/[\\/?*[\]:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 31) || `Hoja ${index + 1}`;
}

function worksheetXml(sheet, index) {
  const rows = sheet.rows
    .map((row) => {
      if (!row || !row.length) return "<Row/>";
      return `<Row>${row.map(excelCellXml).join("")}</Row>`;
    })
    .join("");
  const columns = (sheet.widths || [])
    .map((width) => `<Column ss:Width="${Number(width) || 96}"/>`)
    .join("");
  return `
    <Worksheet ss:Name="${xmlEscape(safeExcelSheetName(sheet.name, index))}">
      <Table>${columns}${rows}</Table>
    </Worksheet>
  `;
}

function workbookXml(worksheets) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook
  xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:html="http://www.w3.org/TR/REC-html40">
  <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
    <Author>Tottem Architecture</Author>
    <Company>Tottem Architecture</Company>
    <Created>${new Date().toISOString()}</Created>
  </DocumentProperties>
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal">
      <Alignment ss:Vertical="Top"/>
      <Font ss:FontName="Arial" ss:Size="10" ss:Color="#111512"/>
    </Style>
    <Style ss:ID="Title">
      <Font ss:FontName="Arial" ss:Size="16" ss:Bold="1" ss:Color="#111512"/>
    </Style>
    <Style ss:ID="Muted">
      <Font ss:FontName="Arial" ss:Size="9" ss:Color="#65716B"/>
    </Style>
    <Style ss:ID="Header">
      <Interior ss:Color="#050504" ss:Pattern="Solid"/>
      <Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/>
    </Style>
    <Style ss:ID="Money">
      <NumberFormat ss:Format="$ #,##0"/>
    </Style>
    <Style ss:ID="Percent">
      <NumberFormat ss:Format="0%"/>
    </Style>
    <Style ss:ID="Warn">
      <Interior ss:Color="#F3E2CC" ss:Pattern="Solid"/>
      <Font ss:FontName="Arial" ss:Size="10" ss:Color="#A8662A"/>
    </Style>
    <Style ss:ID="Ok">
      <Interior ss:Color="#DFEEE7" ss:Pattern="Solid"/>
      <Font ss:FontName="Arial" ss:Size="10" ss:Color="#124C3B"/>
    </Style>
  </Styles>
  ${worksheets.map(worksheetXml).join("")}
</Workbook>`;
}

function exportExcelWorkbook(filename, worksheets) {
  const blob = new Blob([workbookXml(worksheets)], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  downloadBlob(blob, filename);
}

function reportMetaRows(title, note = "") {
  const project = state.data.project;
  return [
    [excelCell("TOTTEM Architecture · Obra Control", "Title")],
    [title],
    [],
    ["Proyecto", projectName()],
    ["Alcance", projectSubtitle()],
    ["Fuente", `${project.sourceWorkbook} · ${project.sourceSheet || "CORTES_OBRA"}`],
    ["Corte fuente", project.generatedAt || project.updatedAt || "Sin fecha"],
    ["Exportado", reportTimestamp()],
    ["Nota", note || "Exportable generado desde el dashboard. No modifica el Excel fuente."],
    [],
  ];
}

function clientExcelWorksheets() {
  const model = clientReportModel();
  const audit = model.summary.technicalAudit || {};
  const summaryRows = [
    ...reportMetaRows("Informe cliente", "Lectura ejecutiva valorizada por semana para comité o reunión con cliente."),
    excelHeader(["Indicador", "Valor"]),
    ["Contrato estimado", excelCell(model.contractTotal, "Money")],
    ["Ejecutado a corte", excelCell(model.executedTotal, "Money")],
    ["Avance valorizado", excelCell(model.progress, "Percent")],
    ["Saldo por ejecutar", excelCell(model.balance, "Money")],
    ["Última semana", excelCell(model.latestWeek?.contractValue || 0, "Money")],
    ["Promedio semanal", excelCell(model.averageWeek, "Money")],
    ["Actividades con avance", `${model.summary.activeActivityCount} / ${model.summary.activityCount}`],
    ["Alertas internas activas", activePending().length],
    ["Vínculos externos detectados en auditoría", audit.externalRelationships || 0],
  ];

  const weekRows = [
    ...reportMetaRows("Avance por semana"),
    excelHeader(["Semana", "Acta soporte", "Valor contractual", "Valor directo leído", "Avance acumulado", "Actividades", "Movimientos", "Cantidad reportada"]),
    ...model.weeks.map((week) => [
      week.label,
      week.name,
      excelCell(week.contractValue, "Money"),
      excelCell(week.directValue, "Money"),
      excelCell(week.cumulativeProgress, "Percent"),
      week.items,
      week.movements,
      week.quantity,
    ]),
  ];

  const chapterRows = [
    ...reportMetaRows("Frentes principales"),
    excelHeader(["Frente / capítulo", "Ejecutado contractual", "Ejecutado directo", "Presupuesto directo", "Avance", "Actividades con avance"]),
    ...model.chapters.map((chapter) => [
      chapter.name,
      excelCell(chapter.displayExecuted, "Money"),
      excelCell(chapter.executed, "Money"),
      excelCell(chapter.budget, "Money"),
      excelCell(chapter.progress, "Percent"),
      chapter.active,
    ]),
  ];

  const scopeRows = [
    ...reportMetaRows("Alcance y decisiones"),
    excelHeader(["Señal", "Valor", "Lectura"]),
    ["Presupuesto actualizado directo", excelCell(model.summary.updatedTotal || 0, "Money"), "Valor directo resultante de cantidades actualizadas dentro de la hoja de cortes."],
    ["No ejecutado directo", excelCell(model.summary.notExecutedTotal || 0, "Money"), "Valor directo identificado como no ejecutado en la lectura actual del archivo."],
    ["Adicional estimado directo", excelCell(model.summary.additionalTotal || 0, "Money"), "Lectura técnica; requiere revisión de alcance antes de presentarse como decisión final."],
    ["Alertas internas", activePending().length, "Pendientes que conviene resolver antes de entregar una versión formal al cliente."],
  ];

  return [
    { name: "Resumen cliente", widths: [190, 180, 380], rows: summaryRows },
    { name: "Avance semanal", widths: [92, 150, 126, 126, 104, 94, 94, 110], rows: weekRows },
    { name: "Frentes", widths: [300, 132, 132, 132, 92, 120], rows: chapterRows },
    { name: "Alcance", widths: [220, 132, 420], rows: scopeRows },
  ];
}

function operationalExcelWorksheets() {
  const { summary } = state.data;
  const audit = summary.technicalAudit || {};
  const summaryRows = [
    ...reportMetaRows("Informe operativo", "Incluye presupuesto, actas, fuentes, alertas y movimientos locales del navegador."),
    excelHeader(["Indicador", "Valor"]),
    ["Presupuesto directo", excelCell(summary.budgetTotal, "Money")],
    ["Contrato estimado", excelCell(summary.contractTotal || summary.budgetTotal, "Money")],
    ["Ejecutado directo", excelCell(summary.executedTotal, "Money")],
    ["Ejecutado contractual", excelCell(summary.executedContractTotal || summary.executedTotal, "Money")],
    ["Avance directo", excelCell(summary.progress, "Percent")],
    ["Avance contractual", excelCell(summary.contractProgress || summary.progress, "Percent")],
    ["Celdas de acta leídas", summary.sourceMovementCount],
    ["Ítems con avance", summary.sourceItemCount],
    ["Alertas activas", activePending().length],
    ["Vínculos externos detectados", audit.externalRelationships || 0],
    ["Partes externos detectados", audit.externalParts || 0],
  ];

  const actaRows = [
    ...reportMetaRows("Actas"),
    excelHeader(["Acta", "Movimientos", "Ítems", "Cantidad", "Valor directo", "Sin coincidencia", "Revisar"]),
    ...state.data.actas.map((acta) => [
      acta.name,
      acta.movements,
      acta.items,
      acta.quantity,
      excelCell(acta.value, "Money"),
      acta.unmatched || 0,
      acta.review || 0,
    ]),
  ];

  const activityRows = [
    ...reportMetaRows("Matriz de actividades"),
    excelHeader(["Fila", "Ítem", "Capítulo", "Descripción", "Unidad", "Cant. presupuesto", "Precio unitario", "Valor presupuesto", "Cant. ejecutada", "Valor ejecutado", "Saldo cant.", "Saldo valor", "Avance", "Estado"]),
    ...state.data.activities.map((activity) => [
      activity.row,
      activity.item,
      activity.chapter,
      activity.description,
      activity.unit,
      activity.budgetQty,
      excelCell(activity.unitPrice, "Money"),
      excelCell(activity.budgetValue, "Money"),
      activity.executedQty,
      excelCell(activity.executedValue, "Money"),
      activity.balanceQty,
      excelCell(activity.balanceValue, "Money"),
      excelCell(activity.progress, "Percent"),
      activity.status,
    ]),
  ];

  const sourceRows = [
    ...reportMetaRows("Trazabilidad de fuentes"),
    excelHeader(["Acta", "Fila origen", "Celda cantidad", "Celda valor", "Ítem destino", "Descripción matriz", "Descripción fuente", "Unidad", "Cantidad", "Precio", "Valor", "Archivo", "Hoja", "Nota"]),
    ...state.data.sources.map((source) => [
      source.acta,
      source.sourceRow,
      source.sourceCell,
      source.valueCell,
      source.item,
      source.description,
      source.sourceDescription,
      source.sourceUnit,
      source.sourceQuantity,
      excelCell(source.unitPrice, "Money"),
      excelCell(source.sourceValue, "Money"),
      source.file,
      source.sheet,
      source.note,
    ]),
  ];

  const pendingRows = [
    ...reportMetaRows("Alertas"),
    excelHeader(["Estado", "Acta", "Fila fuente", "Descripción fuente", "Cantidad", "Unidad", "Sugerencia", "Revisión requerida", "Decisión local", "Archivo"]),
    ...state.data.pending.map((item) => {
      const decision = decisionFor(item);
      return [
        isResolved(item) ? excelCell("RESUELTO", "Ok") : excelCell(item.status, item.status === "SIN_COINCIDENCIA" ? "Warn" : ""),
        item.acta,
        item.sourceRow,
        item.sourceDescription,
        item.quantity,
        item.unit,
        item.suggestedDescription || item.suggestedItem || "",
        item.review || item.note || item.candidates || "",
        decision ? `${decision.method}${decision.item ? ` · ${decision.item}` : ""}` : "Pendiente",
        item.file,
      ];
    }),
  ];

  const movementRows = [
    ...reportMetaRows("Movimientos locales", "Bandeja local de este navegador; todavía no modifica el Excel fuente ni una base compartida."),
    excelHeader(["Fecha", "Acta", "Estado", "Tipo", "Actividad reportada", "Ítem destino", "Unidad", "Cantidad", "Valor simulado", "Fuente", "Frente", "Observación", "Feedback", "Revisión"]),
    ...state.movements.map((movement) => [
      movement.date,
      movement.acta,
      movement.status,
      movement.type,
      movement.reportedDescription,
      movement.activity ? `${movement.activity.item} · ${movement.activity.description}` : "Pendiente",
      movement.unit,
      movement.quantity,
      excelCell(movement.simulatedValue || 0, "Money"),
      movement.source,
      movement.zone,
      movement.note,
      movementFeedbackLabel(movement.architectFeedback),
      movement.reviewReason || "",
    ]),
  ];

  return [
    { name: "Resumen operativo", widths: [230, 190], rows: summaryRows },
    { name: "Actas", widths: [170, 100, 80, 100, 126, 110, 90], rows: actaRows },
    { name: "Actividades", widths: [56, 70, 190, 420, 70, 104, 112, 126, 104, 126, 94, 112, 82, 110], rows: activityRows },
    { name: "Fuentes", widths: [150, 80, 92, 92, 90, 300, 360, 70, 90, 110, 120, 220, 120, 240], rows: sourceRows },
    { name: "Alertas", widths: [126, 150, 80, 360, 90, 70, 300, 340, 160, 220], rows: pendingRows },
    { name: "Movimientos locales", widths: [100, 150, 142, 100, 360, 360, 70, 90, 126, 150, 150, 300, 120, 250], rows: movementRows },
  ];
}

function exportClientExcel() {
  exportExcelWorkbook(`${projectSlug()}-informe-cliente-${fileDateStamp()}.xls`, clientExcelWorksheets());
  openInspector("Excel cliente generado", "Descargué un libro compatible con Excel con resumen, avance por semana, frentes y señales de alcance.", [
    ["Proyecto", projectName()],
    ["Fuente", `${state.data.project.sourceWorkbook} · ${state.data.project.sourceSheet || "CORTES_OBRA"}`],
    ["Vínculos externos", "No se crean vínculos externos en este exportable"],
  ]);
}

function exportOperationalExcel() {
  exportExcelWorkbook(`${projectSlug()}-informe-operativo-${fileDateStamp()}.xls`, operationalExcelWorksheets());
  openInspector("Excel operativo generado", "Descargué un libro de trabajo para comité interno con matriz, actas, fuentes, alertas y movimientos locales.", [
    ["Actividades", state.data.activities.length],
    ["Fuentes", state.data.sources.length],
    ["Movimientos locales", state.movements.length],
    ["Excel fuente", "Sin cambios"],
  ]);
}

function clientReportHtml(model = clientReportModel()) {
  const logo = new URL("./assets/tottem-architecture-white.png", location.href).href;
  const weekMax = Math.max(...model.weeks.map((week) => week.contractValue), 1);
  const weekRows = model.weeks
    .map((week) => {
      const width = Math.max((week.contractValue / weekMax) * 100, 4);
      return `
        <tr>
          <td><strong>${escapeHtml(week.label)}</strong><span>${escapeHtml(week.name)}</span></td>
          <td>${formatMoney(week.contractValue)}</td>
          <td>${formatPercent(week.cumulativeProgress)}</td>
          <td>${week.items}</td>
          <td><i style="width:${width}%"></i></td>
        </tr>
      `;
    })
    .join("");
  const chapterRows = model.chapters
    .slice(0, 6)
    .map((chapter) => `
      <tr>
        <td>${escapeHtml(chapter.name)}</td>
        <td>${formatMoney(chapter.displayExecuted)}</td>
        <td>${formatPercent(chapter.progress)}</td>
        <td>${chapter.active}</td>
      </tr>
    `)
    .join("");

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(projectName())} · Informe cliente</title>
    <style>
      @page { size: A4; margin: 16mm; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: #111512;
        background: #f6f7f3;
        font-family: Inter, Arial, sans-serif;
      }
      .report {
        max-width: 980px;
        margin: 0 auto;
        background: #f6f7f3;
      }
      .print-controls {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        padding: 14px 0;
      }
      .print-controls button {
        min-height: 38px;
        border: 1px solid #050504;
        border-radius: 6px;
        background: #050504;
        color: #fff;
        padding: 0 14px;
        cursor: pointer;
        font: inherit;
      }
      .masthead {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 210px;
        gap: 28px;
        align-items: center;
        min-height: 154px;
        padding: 28px;
        color: #fff;
        background: #050504;
      }
      .masthead img {
        width: 210px;
        max-width: 100%;
      }
      .kicker {
        margin: 0 0 10px;
        color: #b7beb7;
        font-size: 11px;
        letter-spacing: .08em;
        text-transform: uppercase;
      }
      h1, h2, p { margin: 0; }
      h1 {
        max-width: 620px;
        font-size: 42px;
        line-height: .95;
      }
      .date-note {
        margin-top: 14px;
        color: #d6dbd5;
        line-height: 1.45;
      }
      .summary {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        border: 1px solid #d8ded8;
        border-top: 0;
        background: #fff;
      }
      .summary div {
        min-height: 96px;
        padding: 16px;
        border-right: 1px solid #d8ded8;
      }
      .summary div:last-child { border-right: 0; }
      .summary span,
      .scope span {
        display: block;
        color: #65716b;
        font-size: 11px;
        text-transform: uppercase;
      }
      .summary strong {
        display: block;
        margin-top: 14px;
        color: #124c3b;
        font-size: 25px;
        line-height: 1;
      }
      .brief {
        display: grid;
        grid-template-columns: minmax(0, 1.2fr) minmax(280px, .8fr);
        gap: 28px;
        padding: 28px 0 8px;
      }
      .brief h2,
      .block h2 {
        font-size: 21px;
        line-height: 1.1;
      }
      .brief p {
        margin-top: 10px;
        color: #65716b;
        line-height: 1.55;
      }
      .progress-ring {
        display: grid;
        place-items: center;
        align-content: center;
        justify-self: end;
        width: 170px;
        height: 170px;
        border: 1px solid #d8ded8;
        border-radius: 50%;
        background: #fff;
      }
      .progress-ring strong {
        color: #124c3b;
        font-size: 44px;
        line-height: 1;
      }
      .progress-ring span {
        margin-top: 8px;
        color: #65716b;
        font-size: 12px;
      }
      .block {
        margin-top: 24px;
        padding-top: 18px;
        border-top: 1px solid #d8ded8;
      }
      table {
        width: 100%;
        margin-top: 14px;
        border-collapse: collapse;
        background: #fff;
      }
      th, td {
        padding: 12px 10px;
        border-bottom: 1px solid #d8ded8;
        text-align: left;
        vertical-align: top;
        font-size: 12px;
      }
      th {
        color: #65716b;
        font-size: 10px;
        text-transform: uppercase;
      }
      td strong,
      td span {
        display: block;
      }
      td span {
        margin-top: 3px;
        color: #65716b;
      }
      td i {
        display: block;
        height: 6px;
        min-width: 12px;
        border-radius: 999px;
        background: #24765e;
      }
      .scope {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 1px;
        margin-top: 14px;
        border: 1px solid #d8ded8;
        background: #d8ded8;
      }
      .scope div {
        min-height: 88px;
        padding: 14px;
        background: #fff;
      }
      .scope strong {
        display: block;
        margin-top: 14px;
        color: #124c3b;
        font-size: 19px;
      }
      footer {
        margin-top: 28px;
        padding-top: 12px;
        border-top: 1px solid #d8ded8;
        color: #65716b;
        font-size: 11px;
        line-height: 1.45;
      }
      @media print {
        body { background: #fff; }
        .report { max-width: none; }
        .print-controls { display: none; }
      }
    </style>
  </head>
  <body>
    <main class="report">
      <div class="print-controls">
        <button type="button" onclick="window.print()">Guardar como PDF</button>
      </div>
      <header class="masthead">
        <div>
          <p class="kicker">Informe de avance para cliente</p>
          <h1>${escapeHtml(projectName())}</h1>
          <p class="date-note">${escapeHtml(projectSubtitle())}<br/>Corte generado desde ${escapeHtml(model.project.sourceSheet || "CORTES_OBRA")} · ${escapeHtml(model.project.generatedAt || model.project.updatedAt || "sin fecha")}</p>
        </div>
        <img src="${logo}" alt="Tottem Architecture" />
      </header>
      <section class="summary">
        <div><span>Contrato estimado</span><strong>${formatMoney(model.contractTotal)}</strong></div>
        <div><span>Ejecutado a corte</span><strong>${formatMoney(model.executedTotal)}</strong></div>
        <div><span>Última semana</span><strong>${formatMoney(model.latestWeek?.contractValue || 0)}</strong></div>
        <div><span>Saldo por ejecutar</span><strong>${formatMoney(model.balance)}</strong></div>
      </section>
      <section class="brief">
        <div>
          <h2>Lectura ejecutiva</h2>
          <p>${formatPercent(model.progress)} ejecutado, ${model.weeks.length} semanas con avance y ${model.summary.activeActivityCount} actividades con movimiento visible. Las actas siguen como soporte técnico, pero la lectura para cliente se presenta por semana.</p>
        </div>
        <div class="progress-ring">
          <strong>${formatPercent(model.progress)}</strong>
          <span>Avance valorizado</span>
        </div>
      </section>
      <section class="block">
        <h2>Avance por semana</h2>
        <table>
          <thead><tr><th>Semana</th><th>Valor</th><th>Acumulado</th><th>Actividades</th><th>Ritmo</th></tr></thead>
          <tbody>${weekRows || `<tr><td colspan="5">Sin semanas valorizadas.</td></tr>`}</tbody>
        </table>
      </section>
      <section class="block">
        <h2>Frentes principales</h2>
        <table>
          <thead><tr><th>Frente</th><th>Ejecutado</th><th>Avance</th><th>Actividades</th></tr></thead>
          <tbody>${chapterRows || `<tr><td colspan="4">Sin frentes valorizados.</td></tr>`}</tbody>
        </table>
      </section>
      <section class="block">
        <h2>Alcance y decisiones</h2>
        <div class="scope">
          <div><span>Presupuesto actualizado directo</span><strong>${formatMoney(model.summary.updatedTotal || 0)}</strong></div>
          <div><span>No ejecutado directo</span><strong>${formatMoney(model.summary.notExecutedTotal || 0)}</strong></div>
          <div><span>Alertas internas</span><strong>${activePending().length}</strong></div>
        </div>
      </section>
      <footer>
        Fuente: ${escapeHtml(model.project.sourceWorkbook)} · ${escapeHtml(model.project.sourceSheet || "CORTES_OBRA")}. Reporte generado desde Obra Control el ${escapeHtml(reportTimestamp())}. Este exportable no modifica el Excel fuente ni crea vínculos externos.
      </footer>
    </main>
  </body>
</html>`;
}

function exportClientPdf() {
  const reportWindow = window.open("", "_blank");
  if (!reportWindow) {
    openInspector("No se pudo abrir el PDF", "El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para generar el informe.", [
      ["Proyecto", projectName()],
    ]);
    return;
  }
  reportWindow.document.open();
  reportWindow.document.write(clientReportHtml());
  reportWindow.document.close();
  reportWindow.focus();
  openInspector("PDF cliente preparado", "Abrí una versión A4 con lenguaje Tottem. Usa el botón Guardar como PDF dentro del informe.", [
    ["Formato", "A4"],
    ["Lectura", "Avance por semana"],
    ["Excel fuente", "Sin cambios"],
  ]);
}

function packageSummaryText(payload = buildHandoffPackage()) {
  return [
    `Proyecto: ${payload.project.name}`,
    `Esquema: ${payload.schemaVersion}`,
    `Fuente: ${payload.source.workbook} · ${payload.source.sheet}`,
    `Movimientos: ${payload.counts.all}`,
    `Listos: ${payload.counts.confirmed}`,
    `Revisión: ${payload.counts.review}`,
    `Cantidad: ${payload.counts.quantity}`,
    `Adicionales: ${payload.counts.additional}`,
    `Valor simulado: ${formatMoney(payload.totals.simulatedValue)}`,
    `Feedback registrado: ${payload.movements.filter((movement) => movement.architectFeedback).length}`,
    `Alias aprendidos: ${payload.aliases.length}`,
  ].join("\n");
}

async function copyPackageSummary() {
  const text = packageSummaryText();
  try {
    await navigator.clipboard.writeText(text);
    openInspector("Resumen copiado", "El resumen del paquete quedó listo para pegarlo en un mensaje de seguimiento.", [
      ["Movimientos", state.movements.length],
      ["Destino sugerido", "Chat, correo o handoff de migración"],
    ]);
  } catch {
    openInspector("Resumen del paquete", text, [
      ["Nota", "El navegador no permitió copiar automáticamente."],
    ]);
  }
}

function importMovements(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(reader.result);
      const incoming = Array.isArray(payload) ? payload : payload.movements;
      if (!Array.isArray(incoming)) throw new Error("El JSON no contiene una lista de movimientos.");
      const stamped = incoming.map((movement, index) => ({
        ...movement,
        id: movement.id || `import-${Date.now()}-${index}`,
        importedAt: new Date().toISOString(),
      }));
      state.movements = [...stamped, ...state.movements];
      saveMovements();
      renderIngestion();
      openInspector("Movimientos importados", "El JSON se cargó en la bandeja local de este navegador.", [
        ["Movimientos", stamped.length],
        ["Excel fuente", "Sin cambios"],
      ]);
    } catch (error) {
      openInspector("No se pudo importar", error.message, [
        ["Archivo", file.name],
      ]);
    }
  };
  reader.readAsText(file);
}

function clearDecisions() {
  state.decisions = {};
  saveDecisions();
  renderAll();
  closeInspector();
}

function clearMovements() {
  state.movements = [];
  state.selectedMatchRow = null;
  saveMovements();
  renderIngestion();
  openInspector("Movimientos locales vaciados", "La maqueta de ingreso quedó limpia en este navegador.", [
    ["Excel fuente", "Sin cambios"],
  ]);
}

function renderTrace() {
  const rows = filteredSources()
    .sort((a, b) => b.sourceValue - a.sourceValue)
    .slice(0, 90);
  $("#traceList").innerHTML =
    rows
      .map((source, index) => `
        <article class="trace-row" data-source-index="${index}">
          <div>
            <strong>${source.acta} · fila ${source.sourceRow}</strong>
            <span class="row-meta">${source.file}</span>
          </div>
          <div>
            <strong title="${source.description}">${source.item} · ${truncate(source.description, 150)}</strong>
            <span class="row-meta" title="${source.sourceDescription}">${number.format(source.sourceQuantity)} ${source.sourceUnit} desde: ${truncate(source.sourceDescription, 190)}</span>
          </div>
          <span class="status-pill ok">${formatMoney(source.sourceValue)}</span>
        </article>
      `)
      .join("") || `<p class="empty">No hay fuentes con ese filtro.</p>`;

  document.querySelectorAll(".trace-row").forEach((row) => {
    row.addEventListener("click", () => {
      const source = rows[Number(row.dataset.sourceIndex)];
      openInspector(`${source.acta} · fila ${source.sourceRow}`, source.sourceDescription, [
        ["Ítem destino", `${source.item} · ${source.description}`],
        ["Cantidad", `${number.format(source.sourceQuantity)} ${source.sourceUnit}`],
        ["Precio matriz", formatMoney(source.unitPrice)],
        ["Valor", formatMoney(source.sourceValue)],
        ["Fuente", `${source.file} · ${source.sheet || "CORTES_OBRA"} · ${source.sourceCell}/${source.valueCell}`],
        ["Observación", source.note],
      ]);
    });
  });
}

function renderAll() {
  renderProjectChrome();
  renderClient();
  renderIngestion();
  renderSummary();
  renderChapterBars();
  renderActas();
  renderActivities();
  renderPending();
  renderTrace();
}

function bindEvents() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      state.section = button.dataset.section;
      history.replaceState(null, "", `#${state.section}`);
      document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      document.querySelectorAll(".section").forEach((section) => section.classList.remove("active"));
      document.getElementById(state.section).classList.add("active");
    });
  });

  document.querySelectorAll(".signal").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".signal").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      document.querySelector(`.nav-item[data-section="${button.dataset.focus}"]`)?.click();
    });
  });

  $("#inspectorClose").addEventListener("click", closeInspector);
  $("#exportDecisions").addEventListener("click", exportDecisions);
  $("#clearDecisions").addEventListener("click", clearDecisions);
  $("#exportClientPdf")?.addEventListener("click", exportClientPdf);
  $("#exportClientExcel")?.addEventListener("click", exportClientExcel);
  $("#exportOpsExcel")?.addEventListener("click", exportOperationalExcel);
  $("#exportMovements")?.addEventListener("click", exportMovements);
  $("#copyPackageSummary")?.addEventListener("click", copyPackageSummary);
  $("#clearMovements")?.addEventListener("click", clearMovements);
  $("#importMovements")?.addEventListener("click", () => $("#movementImportFile")?.click());
  $("#movementImportFile")?.addEventListener("change", (event) => {
    importMovements(event.target.files?.[0]);
    event.target.value = "";
  });
  $("#parseQuickEntry")?.addEventListener("click", parseQuickEntry);
  $("#autoSaveQuickEntry")?.addEventListener("click", () => parseQuickEntry({ autoSave: true }));
  $("#processQuickLines")?.addEventListener("click", processQuickLines);
  $("#quickEntry")?.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      parseQuickEntry({ autoSave: event.shiftKey });
    }
  });

  ["#partActa", "#partDate", "#partSource", "#partZone", "#fieldMode"].forEach((selector) => {
    $(selector)?.addEventListener("input", () => {
      state.dailyContext = currentDailyContext();
      saveDailyContext();
      applyDailyContextToForm();
      renderIngestion();
    });
    $(selector)?.addEventListener("change", () => {
      state.dailyContext = currentDailyContext();
      saveDailyContext();
      applyDailyContextToForm();
      renderIngestion();
    });
  });

  $("#entryForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    createMovement(false);
  });
  $("#saveAsPending")?.addEventListener("click", () => createMovement(true));
  $("#entryForm")?.addEventListener("reset", () => {
    window.setTimeout(() => {
      state.selectedMatchRow = null;
      applyDailyContextToForm();
      renderIngestion();
    }, 0);
  });

  [
    "#entryActa",
    "#entryDate",
    "#entryType",
    "#entryQuantity",
    "#entryUnit",
    "#entrySource",
    "#entryDescription",
    "#entryNote",
  ].forEach((selector) => {
    $(selector)?.addEventListener("input", renderIngestion);
    $(selector)?.addEventListener("change", renderIngestion);
  });

  $("#searchInput").addEventListener("input", (event) => {
    state.query = normalize(event.target.value);
    renderActivities();
    renderPending();
    renderTrace();
  });

  $("#actaFilter").addEventListener("change", (event) => {
    state.acta = event.target.value;
    renderActivities();
    renderPending();
    renderTrace();
  });

  document.querySelectorAll("#activityStatusFilter button").forEach((button) => {
    button.addEventListener("click", () => {
      state.activityStatus = button.dataset.status;
      document.querySelectorAll("#activityStatusFilter button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      renderActivities();
    });
  });

  document.querySelectorAll("#pendingStatusFilter button").forEach((button) => {
    button.addEventListener("click", () => {
      state.pendingStatus = button.dataset.status;
      document.querySelectorAll("#pendingStatusFilter button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      renderPending();
    });
  });
}

function populateFilters() {
  const select = $("#actaFilter");
  const entryActa = $("#entryActa");
  const partActa = $("#partActa");
  state.data.actas.forEach((acta) => {
    const option = document.createElement("option");
    option.value = acta.name;
    option.textContent = acta.name;
    select.append(option);
    entryActa?.append(option.cloneNode(true));
    partActa?.append(option.cloneNode(true));
  });
}

async function loadCatalog() {
  const catalogParam = new URLSearchParams(location.search).get("catalog");
  const catalogUrl = catalogParam && !/^https?:\/\//i.test(catalogParam) ? catalogParam : DEFAULT_CATALOG_URL;
  try {
    const response = await fetch(catalogUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.catalog = await response.json();
    state.catalogPool = [
      ...(state.catalog.activities || []).map((item, index) => ({ ...item, catalogKind: "apu", catalogIndex: index })),
      ...(state.catalog.historicalItems || []).map((item, index) => ({ ...item, catalogKind: "historial", catalogIndex: index })),
    ];
    state.catalogStatus = "ready";
  } catch (error) {
    state.catalog = null;
    state.catalogPool = [];
    state.catalogStatus = "unavailable";
    console.warn("APU catalog unavailable", error);
  }
}

async function boot() {
  const dataParam = new URLSearchParams(location.search).get("data");
  const dataUrl = dataParam && !/^https?:\/\//i.test(dataParam) ? dataParam : DEFAULT_DATA_URL;
  const response = await fetch(dataUrl);
  state.data = await response.json();
  await loadCatalog();
  loadDailyContext();
  loadAliases();
  loadDecisions();
  loadMovements();
  populateFilters();
  applyDailyContextToForm({ overwrite: true });
  bindEvents();
  setDefaultEntryDate();
  renderAll();
  const initialSection = location.hash.replace("#", "");
  if (initialSection && document.getElementById(initialSection)) {
    document.querySelector(`.nav-item[data-section="${initialSection}"]`)?.click();
  }
}

boot().catch((error) => {
  document.body.innerHTML = `<main class="workspace"><h1>No se pudo cargar el dashboard</h1><p>${error.message}</p></main>`;
});
