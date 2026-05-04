const state = {
  data: null,
  section: "overview",
  query: "",
  acta: "all",
  activityStatus: "all",
  pendingStatus: "all",
  decisions: {},
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

function formatMoney(value) {
  return money.format(Math.round(value || 0));
}

function formatPercent(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

function normalize(text) {
  return String(text || "").toLowerCase();
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

function clearDecisions() {
  state.decisions = {};
  saveDecisions();
  renderAll();
  closeInspector();
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
  state.data.actas.forEach((acta) => {
    const option = document.createElement("option");
    option.value = acta.name;
    option.textContent = acta.name;
    select.append(option);
  });
}

async function boot() {
  const response = await fetch("./data/torrelaguna.json");
  state.data = await response.json();
  loadDecisions();
  populateFilters();
  bindEvents();
  renderAll();
  const initialSection = location.hash.replace("#", "");
  if (initialSection && document.getElementById(initialSection)) {
    document.querySelector(`.nav-item[data-section="${initialSection}"]`)?.click();
  }
}

boot().catch((error) => {
  document.body.innerHTML = `<main class="workspace"><h1>No se pudo cargar el dashboard</h1><p>${error.message}</p></main>`;
});
