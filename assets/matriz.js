import { supabase, initAuth } from "./auth.js";
import { MONTHS, money, fetchClientData, buildIndex, evalClientMonth, toggleReview, holdedInvoiceUrl } from "./clientData.js";

const ALERT_LABELS = { missing: "Dejó de facturar", deviation: "Atípica" };

const state = { sort: "total", search: "", alertType: "all", filterMonth: "all" };
let indexCache = null;   // { byClient, months }
let reviewedSet = null;  // Set("year-month-contactId-alertType") already reviewed
let clientRows = null;   // precomputed per-client cells + totals
let currentUserEmail = null;

initAuth(renderAll);

document.getElementById("clientSearch").addEventListener("input", (e) => {
  state.search = e.target.value.trim().toLowerCase();
  renderTable();
});
document.getElementById("sortSeg").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-sort]");
  if (!btn) return;
  state.sort = btn.dataset.sort;
  document.querySelectorAll("#sortSeg button").forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
  renderTable();
});
document.getElementById("alertTypeSeg").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-type]");
  if (!btn) return;
  state.alertType = btn.dataset.type;
  document.querySelectorAll("#alertTypeSeg button").forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
  renderTable();
});
document.getElementById("monthFilter").addEventListener("change", (e) => {
  state.filterMonth = e.target.value;
  renderTable();
});
document.getElementById("matrixFilterNote").addEventListener("click", (e) => {
  if (!e.target.closest("#clearFilterBtn")) return;
  state.alertType = "all";
  state.filterMonth = "all";
  document.querySelectorAll("#alertTypeSeg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.type === "all")));
  document.getElementById("monthFilter").value = "all";
  renderTable();
});
document.getElementById("matrixBody").addEventListener("click", async (e) => {
  if (e.target.closest("a.invoice-link")) return;
  const td = e.target.closest("td[data-alert]");
  if (!td) return;
  const { contact: contactId, year, month, alert: alertType, reviewed } = td.dataset;
  const isReviewed = reviewed === "1";
  if (!isReviewed) {
    const clientName = td.closest("tr")?.querySelector(".client-cell")?.textContent || "este cliente";
    const monthLabel = `${MONTHS[Number(month) - 1]} ${year}`;
    const confirmed = window.confirm(`¿Marcar como revisada la alerta "${ALERT_LABELS[alertType]}" de ${clientName} en ${monthLabel}?`);
    if (!confirmed) return;
  }
  td.style.cursor = "wait";
  const result = await toggleReview(supabase, alertType, Number(year), Number(month), contactId, isReviewed, currentUserEmail);
  const key = `${year}-${month}-${contactId}-${alertType}`;
  if (isReviewed) reviewedSet.delete(key);
  else if (result) reviewedSet.add(key);
  renderTable();
});

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function buildClientRows() {
  const { byClient, months } = indexCache;
  const rows = [];
  let totalMissingCells = 0;
  let totalDeviationCells = 0;

  for (const [contactId, c] of byClient) {
    let total = 0;
    let alertCount = 0;
    const cells = months.map(mk => {
      const [y, m] = mk.split("-").map(Number);
      const res = evalClientMonth(c, y, m);
      if (res.type === "missing") { totalMissingCells++; alertCount++; }
      if (res.type === "deviation") { totalDeviationCells++; alertCount++; }
      const entry = c.byMonth.get(mk);
      if (entry != null) total += entry.eur;
      return { monthKey: mk, year: y, month: m, ...res };
    });
    rows.push({ contactId, name: c.name, cells, total, alertCount });
  }

  return { rows, totalMissingCells, totalDeviationCells };
}

function isFiltering() {
  return state.alertType !== "all" || state.filterMonth !== "all";
}

function cellMatchesFilter(cell) {
  if (state.filterMonth !== "all" && cell.monthKey !== state.filterMonth) return false;
  if (state.alertType === "all") return cell.type != null;
  return cell.type === state.alertType;
}

function invoiceLinkHtml(invoiceIds) {
  if (!invoiceIds || !invoiceIds.length) return "";
  const url = holdedInvoiceUrl(invoiceIds[0]);
  const label = invoiceIds.length > 1
    ? `Abrir en Holded (la más reciente de ${invoiceIds.length} facturas este mes)`
    : "Abrir factura en Holded";
  return ` <a href="${url}" target="_blank" rel="noopener" class="invoice-link" title="${escapeHtml(label)}">🧾</a>`;
}

function cellHtml(cell, contactId, highlight) {
  const matchCls = highlight ? " cell-match" : "";
  if (cell.type === "missing" || cell.type === "deviation") {
    const key = `${cell.year}-${cell.month}-${contactId}-${cell.type}`;
    const reviewed = reviewedSet.has(key);
    const dataAttrs = `data-contact="${contactId}" data-year="${cell.year}" data-month="${cell.month}" data-alert="${cell.type}" data-reviewed="${reviewed ? 1 : 0}"`;
    const action = reviewed ? "clic para reabrir" : "clic para marcar como revisado";
    const mark = reviewed ? "✓ " : "";
    if (cell.type === "missing") {
      const title = `Dejó de facturar — media 3 meses previos: ${money(cell.priorAvg)} (${action})`;
      return `<td class="cell-missing cell-clickable${matchCls}${reviewed ? " reviewed-cell" : ""}" ${dataAttrs} title="${escapeHtml(title)}">${mark}${money(0)}</td>`;
    }
    const pct = (cell.dev * 100).toFixed(0);
    const cls = cell.dev > 0 ? "cell-dev-up" : "cell-dev-down";
    const title = `${cell.dev > 0 ? "Subida" : "Caída"} atípica — media 3 meses previos: ${money(cell.avg)} (${pct > 0 ? "+" : ""}${pct}%) (${action})`;
    return `<td class="${cls} cell-clickable${matchCls}${reviewed ? " reviewed-cell" : ""}" ${dataAttrs} title="${escapeHtml(title)}">${mark}${money(cell.curAmount)}${invoiceLinkHtml(cell.curInvoiceIds)}</td>`;
  }
  if (cell.curAmount == null) return `<td class="cell-empty${matchCls}">—</td>`;
  return `<td class="${matchCls}">${money(cell.curAmount)}${invoiceLinkHtml(cell.curInvoiceIds)}</td>`;
}

function renderHead() {
  const head = document.getElementById("matrixHead");
  const monthCols = indexCache.months.map(mk => {
    const [y, m] = mk.split("-").map(Number);
    return `<th>${MONTHS[m - 1]} ${String(y).slice(2)}</th>`;
  }).join("");
  head.innerHTML = `<th class="client-col">Cliente</th>${monthCols}<th class="total-col">Total</th>`;
}

function populateMonthFilter() {
  const sel = document.getElementById("monthFilter");
  const options = indexCache.months.map(mk => {
    const [y, m] = mk.split("-").map(Number);
    return `<option value="${mk}">${MONTHS[m - 1]} ${y}</option>`;
  }).join("");
  sel.innerHTML = `<option value="all">Todos los meses</option>${options}`;
}

function renderFilterNote(shownCount, totalCount) {
  const note = document.getElementById("matrixFilterNote");
  if (!isFiltering()) { note.style.display = "none"; return; }
  const typeLabel = state.alertType === "all" ? "cualquier aviso" : `«${ALERT_LABELS[state.alertType]}»`;
  const monthLabel = state.filterMonth === "all"
    ? "en cualquier mes"
    : (() => { const [y, m] = state.filterMonth.split("-").map(Number); return `en ${MONTHS[m - 1]} ${y}`; })();
  note.style.display = "block";
  note.innerHTML = `Mostrando ${shownCount} de ${totalCount} clientes con ${typeLabel} ${monthLabel}. <button id="clearFilterBtn">Quitar filtro</button>`;
}

function renderTable() {
  const search = state.search;
  const filtering = isFiltering();
  let rows = clientRows.rows.filter(r =>
    (!search || r.name.toLowerCase().includes(search)) &&
    (!filtering || r.cells.some(cellMatchesFilter))
  );

  if (state.sort === "total") rows = [...rows].sort((a, b) => b.total - a.total);
  else if (state.sort === "alerts") rows = [...rows].sort((a, b) => b.alertCount - a.alertCount || b.total - a.total);
  else rows = [...rows].sort((a, b) => a.name.localeCompare(b.name, "es"));

  const body = document.getElementById("matrixBody");
  const empty = document.getElementById("matrixEmpty");
  empty.style.display = rows.length ? "none" : "block";
  renderFilterNote(rows.length, clientRows.rows.length);

  body.innerHTML = rows.map(r => {
    const cells = r.cells.map(cell => cellHtml(cell, r.contactId, filtering && cellMatchesFilter(cell))).join("");
    return `<tr><td class="client-cell" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</td>${cells}<td class="total-cell">${money(r.total)}</td></tr>`;
  }).join("");
}

function renderKpis() {
  const strip = document.getElementById("kpiStrip");
  strip.style.display = "grid";
  const months = indexCache.months;
  const rango = months.length
    ? `${MONTHS[Number(months[0].split("-")[1]) - 1]} ${months[0].split("-")[0]} – ${MONTHS[Number(months[months.length - 1].split("-")[1]) - 1]} ${months[months.length - 1].split("-")[0]}`
    : "—";
  strip.innerHTML = `
    <div class="kpi"><div class="label">CLIENTES EN LA MATRIZ</div><div class="value">${indexCache.byClient.size}</div><div class="foot">con al menos una factura en el periodo</div></div>
    <div class="kpi"><div class="label">CELDAS "DEJÓ DE FACTURAR"</div><div class="value ${clientRows.totalMissingCells ? "neg" : ""}">${clientRows.totalMissingCells}</div><div class="foot">en todo el periodo mostrado</div></div>
    <div class="kpi"><div class="label">CELDAS ATÍPICAS</div><div class="value ${clientRows.totalDeviationCells ? "neg" : ""}">${clientRows.totalDeviationCells}</div><div class="foot">±50% vs. media 3 meses previos</div></div>
    <div class="kpi"><div class="label">PERIODO</div><div class="value" style="font-size:16px;">${rango}</div><div class="foot">${months.length} meses con datos</div></div>
  `;
}

async function renderAll() {
  const loadNote = document.getElementById("loadNote");
  loadNote.style.display = "block";
  loadNote.textContent = "Cargando datos…";
  loadNote.style.color = "";
  try {
    const { rows, reviews, currentUserEmail: email } = await fetchClientData(supabase);
    currentUserEmail = email;
    indexCache = buildIndex(rows);
    reviewedSet = new Set(reviews.map(r => `${r.year}-${r.month}-${r.contact_id}-${r.alert_type}`));
    if (!indexCache.months.length) {
      loadNote.textContent = "Todavía no hay datos de facturación por cliente.";
      loadNote.style.color = "var(--warn)";
      document.getElementById("kpiStrip").style.display = "none";
      return;
    }
    clientRows = buildClientRows();
    renderKpis();
    renderHead();
    populateMonthFilter();
    renderTable();
    loadNote.style.display = "none";
  } catch (err) {
    console.error(err);
    loadNote.textContent = "No se pudieron cargar los datos. Puede que tu cuenta no tenga acceso a este panel — contacta al administrador.";
    loadNote.style.color = "var(--neg)";
  }
}
