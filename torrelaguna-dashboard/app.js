const state = {
  data: null,
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
const DECISION_KEY = "torrelaguna-field-alert-decisions";
const MOVEMENT_KEY_PREFIX = "obra-control-local-movements";
const PACKAGE_SCHEMA_VERSION = "obra-control.v0.3";
const DASHBOARD_BUILD = "20260505-sprint3-handoff";
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

function loadDecisions() {
  try {
    state.decisions = JSON.parse(localStorage.getItem(DECISION_KEY) || "{}");
  } catch {
    state.decisions = {};
  }
}

function saveDecisions() {
  localStorage.setItem(DECISION_KEY, JSON.stringify(state.decisions));
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
      ([label, value]) => `
        <div class="meta-line">
          <span>${label}</span>
          <strong>${value || "Sin dato"}</strong>
        </div>
      `
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
  $("#sourceWorkbook").textContent = `${state.data.project.sourceWorkbook} · ${state.data.project.sourceSheet || "CORTES_OBRA"}`;
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

function renderClient() {
  const { summary, project } = state.data;
  const actas = state.data.actas.filter((acta) => acta.value > 0);
  const chapters = state.data.chapters.filter((chapter) => chapter.executed > 0).slice(0, 7);
  const maxActa = Math.max(...actas.map((acta) => acta.value), 1);
  const contractTotal = summary.contractTotal || summary.budgetTotal;
  const executedTotal = summary.executedContractTotal || summary.executedTotal;
  const balance = Math.max(contractTotal - executedTotal, 0);

  $("#clientFreshness").textContent = `Corte generado desde ${project.sourceSheet || "CORTES_OBRA"} · ${project.generatedAt || project.updatedAt}`;
  $("#clientProgressValue").textContent = formatPercent(summary.contractProgress || summary.progress);
  $("#clientContractTotal").textContent = formatMoney(contractTotal);
  $("#clientExecutedTotal").textContent = formatMoney(executedTotal);
  $("#clientBalanceTotal").textContent = formatMoney(balance);
  $("#clientActiveActivities").textContent = `${summary.activeActivityCount} / ${summary.activityCount}`;
  $("#clientUpdatedTotal").textContent = formatMoney(summary.updatedTotal || 0);
  $("#clientNotExecuted").textContent = formatMoney(summary.notExecutedTotal || 0);
  $("#clientAlerts").textContent = activePending().length;

  $("#clientActas").innerHTML = actas
    .map((acta) => {
      const width = Math.max((acta.value / maxActa) * 100, 4);
      return `
        <button class="client-acta" data-acta="${acta.name}">
          <span>${acta.name.replace("ACTA DE OBRA ", "Acta ")}</span>
          <strong>${formatMoney(acta.value)}</strong>
          <i style="width:${width}%"></i>
        </button>
      `;
    })
    .join("");

  $("#clientChapters").innerHTML = chapters
    .map((chapter, index) => `
      <button class="client-front" data-chapter-index="${index}">
        <span>${chapter.name}</span>
        <strong>${formatMoney(chapter.executed)}</strong>
        <small>${chapter.active} actividades · ${formatPercent(chapter.progress)}</small>
      </button>
    `)
    .join("");

  document.querySelectorAll(".client-acta").forEach((button) => {
    button.addEventListener("click", () => {
      const acta = actas.find((item) => item.name === button.dataset.acta);
      openInspector(acta.name, "Resumen ejecutivo del corte de obra.", [
        ["Valor directo", formatMoney(acta.value)],
        ["Actividades", acta.items],
        ["Registros", acta.movements],
        ["Cantidad reportada", number.format(acta.quantity)],
      ]);
    });
  });

  document.querySelectorAll(".client-front").forEach((button) => {
    button.addEventListener("click", () => {
      const chapter = chapters[Number(button.dataset.chapterIndex)];
      openInspector(chapter.name, "Frente de obra con avance valorizado acumulado.", [
        ["Ejecutado directo", formatMoney(chapter.executed)],
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

function entryValues() {
  return {
    acta: $("#entryActa")?.value || "nuevo",
    date: $("#entryDate")?.value || "",
    type: $("#entryType")?.value || "avance",
    quantity: Number($("#entryQuantity")?.value || 0),
    unit: ($("#entryUnit")?.value || "").trim(),
    source: ($("#entrySource")?.value || "").trim(),
    description: ($("#entryDescription")?.value || "").trim(),
    note: ($("#entryNote")?.value || "").trim(),
  };
}

function normalizeUnitToken(unit) {
  return String(unit || "")
    .toLowerCase()
    .replace("m²", "m2")
    .replace("m³", "m3")
    .replace(/^un$|^u$/, "und");
}

function parseEntryText(raw) {
  const base = entryValues();
  const entry = { ...base, quantity: 0, unit: "", source: base.source, description: "", note: "", rawLine: raw };
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
  $("#entryQuantity").value = entry.quantity || "";
  $("#entryUnit").value = entry.unit || "";
  $("#entrySource").value = entry.source || "";
  $("#entryType").value = entry.type || "avance";
  $("#entryDescription").value = entry.description || "";
  $("#entryNote").value = entry.note || "";
}

function parseQuickEntry(options = {}) {
  const raw = ($("#quickEntry")?.value || "").trim();
  if (!raw) return;
  const entry = parseEntryText(raw.split(/\n+/).find((line) => line.trim()) || raw);
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
  const lines = ($("#quickEntry")?.value || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return;

  const created = lines.map((line, index) => {
    const entry = parseEntryText(line);
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

    return movementFromEntry(entry, activity, status, {
      rawLine: line,
      lineNumber: index + 1,
      reviewReason,
      candidates: candidateSnapshot(suggestions),
    });
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
  });

  state.movements.unshift(movement);
  saveMovements();
  state.selectedMatchRow = null;
  $("#entryForm").reset();
  setDefaultEntryDate();
  renderIngestion();
  openInspector(statusLabel(status), movement.reportedDescription || movement.activity?.description || "Movimiento guardado.", [
    ["Acta", movement.acta],
    ["Cantidad", `${number.format(movement.quantity)} ${movement.unit || ""}`],
    ["Ítem destino", movement.activity ? `${movement.activity.item} · ${movement.activity.description}` : "Pendiente"],
    ["Valor simulado", formatMoney(movement.simulatedValue)],
    ["Fuente", movement.source || "Sin fuente"],
  ], movementActions(movement));
}

function setDefaultEntryDate() {
  const input = $("#entryDate");
  if (input && !input.value) {
    const localDate = new Date();
    localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset());
    input.value = localDate.toISOString().slice(0, 10);
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
                <span class="row-meta">${movement.acta} · ${movement.source || "Sin fuente"} · ${movement.date || "sin fecha"}${movement.architectFeedback ? ` · Feedback: ${movementFeedbackLabel(movement.architectFeedback)}` : ""}${movement.reviewReason ? ` · ${movement.reviewReason}` : ""}</span>
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
        ["Observación", movement.note || "Sin observación"],
        ["Revisión", movement.reviewReason || "Sin alerta adicional"],
        ["Feedback arquitecto", movementFeedbackLabel(movement.architectFeedback)],
        ["Candidatos", movement.candidates?.map((candidate) => `${candidate.item} (${candidate.score}%): ${candidate.description}`).join(" | ")],
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
    project: state.data.project.name,
    exportedAt: new Date().toISOString(),
    decisions,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "torrelaguna-revisiones-dashboard.json";
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
      note: "Paquete generado desde prototipo estático. No modifica el Excel fuente.",
    },
    counts,
    totals,
    actaDrafts: draftRows(),
    localStorageKeys: {
      movements: movementStorageKey(),
      decisions: DECISION_KEY,
    },
    decisions,
    movements: state.movements,
  };
}

function exportMovements() {
  const payload = buildHandoffPackage();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "obra-control-paquete-migracion.json";
  link.click();
  URL.revokeObjectURL(url);
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

  $("#entryForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    createMovement(false);
  });
  $("#saveAsPending")?.addEventListener("click", () => createMovement(true));
  $("#entryForm")?.addEventListener("reset", () => {
    window.setTimeout(() => {
      state.selectedMatchRow = null;
      setDefaultEntryDate();
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
  state.data.actas.forEach((acta) => {
    const option = document.createElement("option");
    option.value = acta.name;
    option.textContent = acta.name;
    select.append(option);
    entryActa?.append(option.cloneNode(true));
  });
}

async function boot() {
  const response = await fetch("./data/torrelaguna.json");
  state.data = await response.json();
  loadDecisions();
  loadMovements();
  populateFilters();
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
