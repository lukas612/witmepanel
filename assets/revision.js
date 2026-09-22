import { supabase, initAuth } from "./auth.js";
import {
  MONTHS, money, monthKey, holdedInvoiceUrl,
  fetchClientData, buildIndex, computeReviewableMonths, computeAlerts, toggleReview
} from "./clientData.js";

const state = { month: null };
let rows = null;       // witme_client_invoiced_monthly
let reviews = null;    // witme_client_alert_reviews
let currentUserEmail = null;

initAuth(renderAll);
document.getElementById("showReviewedMissing").addEventListener("change", () => indexCache && render());
document.getElementById("showReviewedDeviation").addEventListener("change", () => indexCache && render());

async function fetchAll() {
  if (rows && reviews) return;
  const data = await fetchClientData(supabase);
  rows = data.rows;
  reviews = data.reviews;
  currentUserEmail = data.currentUserEmail;
}

async function handleToggleReview(alertType, year, month, contactId, isReviewed) {
  const result = await toggleReview(supabase, alertType, year, month, contactId, isReviewed, currentUserEmail);
  if (isReviewed) {
    reviews = reviews.filter(r => !(r.year === year && r.month === month && r.contact_id === contactId && r.alert_type === alertType));
  } else if (result) {
    reviews.push(result);
  }
  render();
}

function reviewCell(alertType, year, month, contactId, reviewedRow) {
  const isReviewed = !!reviewedRow;
  const btn = document.createElement("button");
  btn.className = "review-btn" + (isReviewed ? " is-reviewed" : "");
  btn.textContent = isReviewed ? "✓ Revisado" : "Marcar revisado";
  btn.addEventListener("click", () => handleToggleReview(alertType, year, month, contactId, isReviewed));
  const wrap = document.createElement("div");
  wrap.appendChild(btn);
  if (isReviewed && reviewedRow.reviewed_by) {
    const meta = document.createElement("span");
    meta.className = "review-meta";
    const d = new Date(reviewedRow.reviewed_at);
    meta.textContent = `${reviewedRow.reviewed_by} · ${d.toLocaleDateString("es-ES")}`;
    wrap.appendChild(meta);
  }
  return wrap;
}

function renderMissing(year, month, missing, showReviewed) {
  const body = document.getElementById("missingBody");
  const empty = document.getElementById("missingEmpty");
  const reviewedMap = new Map(reviews.filter(r => r.alert_type === "missing").map(r => [`${r.year}-${r.month}-${r.contact_id}`, r]));
  body.innerHTML = "";
  let shown = 0;
  for (const item of missing) {
    const key = `${year}-${month}-${item.contactId}`;
    const reviewedRow = reviewedMap.get(key);
    if (reviewedRow && !showReviewed) continue;
    shown++;
    const tr = document.createElement("tr");
    if (reviewedRow) tr.className = "reviewed";
    tr.innerHTML = `<td style="text-align:left;">${escapeHtml(item.name)}</td><td>${money(item.priorAvg)}</td><td class="neg">${money(0)}</td>`;
    const td = document.createElement("td");
    td.className = "review-cell";
    td.appendChild(reviewCell("missing", year, month, item.contactId, reviewedRow));
    tr.appendChild(td);
    body.appendChild(tr);
  }
  empty.style.display = shown === 0 ? "block" : "none";
}

function renderDeviations(year, month, deviations, showReviewed) {
  const body = document.getElementById("deviationBody");
  const empty = document.getElementById("deviationEmpty");
  const reviewedMap = new Map(reviews.filter(r => r.alert_type === "deviation").map(r => [`${r.year}-${r.month}-${r.contact_id}`, r]));
  body.innerHTML = "";
  let shown = 0;
  for (const item of deviations) {
    const key = `${year}-${month}-${item.contactId}`;
    const reviewedRow = reviewedMap.get(key);
    if (reviewedRow && !showReviewed) continue;
    shown++;
    const tr = document.createElement("tr");
    if (reviewedRow) tr.className = "reviewed";
    const pct = (item.dev * 100).toFixed(0);
    const devClass = item.dev > 0 ? "dev-up" : "dev-down";
    const arrow = item.dev > 0 ? "▲" : "▼";
    const invoiceIds = item.curInvoiceIds || [];
    const link = invoiceIds.length
      ? ` <a href="${holdedInvoiceUrl(invoiceIds[0])}" target="_blank" rel="noopener" class="invoice-link" title="${invoiceIds.length > 1 ? `Abrir en Holded (la más reciente de ${invoiceIds.length} facturas)` : "Abrir factura en Holded"}">🧾</a>`
      : "";
    tr.innerHTML = `<td style="text-align:left;">${escapeHtml(item.name)}</td><td>${money(item.avg)}</td><td>${money(item.curAmount)}${link}</td><td class="${devClass}">${arrow} ${pct > 0 ? "+" : ""}${pct}%</td>`;
    const td = document.createElement("td");
    td.className = "review-cell";
    td.appendChild(reviewCell("deviation", year, month, item.contactId, reviewedRow));
    tr.appendChild(td);
    body.appendChild(tr);
  }
  empty.style.display = shown === 0 ? "block" : "none";
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

let indexCache = null;
let reviewableMonths = null;

function render() {
  const [year, month] = state.month.split("-").map(Number);

  document.querySelectorAll("#monthSeg button").forEach(b => {
    b.setAttribute("aria-pressed", String(b.dataset.month === state.month));
  });

  const { missing, deviations } = computeAlerts(indexCache.byClient, year, month);
  const missingReviewed = reviews.filter(r => r.alert_type === "missing" && r.year === year && r.month === month).length;
  const deviationReviewed = reviews.filter(r => r.alert_type === "deviation" && r.year === year && r.month === month).length;

  const strip = document.getElementById("kpiStrip");
  strip.style.display = "grid";
  strip.innerHTML = `
    <div class="kpi"><div class="label">CLIENTES QUE DEJARON DE FACTURAR</div><div class="value ${missing.length ? "neg" : ""}">${missing.length}</div><div class="foot">${missingReviewed} revisado${missingReviewed === 1 ? "" : "s"}</div></div>
    <div class="kpi"><div class="label">FACTURACIÓN ATÍPICA</div><div class="value ${deviations.length ? "neg" : ""}">${deviations.length}</div><div class="foot">${deviationReviewed} revisado${deviationReviewed === 1 ? "" : "s"}</div></div>
    <div class="kpi"><div class="label">MES EN REVISIÓN</div><div class="value" style="font-size:16px;">${MONTHS[month - 1]} ${year}</div><div class="foot">vs. media de los 3 meses anteriores</div></div>
    <div class="kpi"><div class="label">CLIENTES ACTIVOS ESTE MES</div><div class="value">${[...indexCache.byClient.values()].filter(c => (c.byMonth.get(monthKey(year, month))?.eur || 0) > 0).length}</div><div class="foot">con factura &gt;0€</div></div>
  `;

  renderMissing(year, month, missing, document.getElementById("showReviewedMissing").checked);
  renderDeviations(year, month, deviations, document.getElementById("showReviewedDeviation").checked);
}

function renderMonthFilter() {
  const seg = document.getElementById("monthSeg");
  seg.innerHTML = reviewableMonths.map(mk => {
    const [y, m] = mk.split("-").map(Number);
    return `<button data-month="${mk}" aria-pressed="${mk === state.month}">${MONTHS[m - 1]} ${y}</button>`;
  }).join("");
  seg.querySelectorAll("button").forEach(b => {
    b.addEventListener("click", () => { state.month = b.dataset.month; render(); });
  });
}

async function renderAll() {
  const loadNote = document.getElementById("loadNote");
  loadNote.style.display = "block";
  loadNote.textContent = "Cargando datos…";
  loadNote.style.color = "";
  try {
    await fetchAll();
    indexCache = buildIndex(rows);
    reviewableMonths = computeReviewableMonths(indexCache.months);
    if (!reviewableMonths.length) {
      loadNote.textContent = "No hay suficientes meses de datos todavía (hacen falta al menos 4 meses seguidos) para calcular alertas.";
      loadNote.style.color = "var(--warn)";
      document.getElementById("kpiStrip").style.display = "none";
      return;
    }
    if (!state.month || !reviewableMonths.includes(state.month)) state.month = reviewableMonths[reviewableMonths.length - 1];
    renderMonthFilter();
    render();
    loadNote.style.display = "none";
  } catch (err) {
    console.error(err);
    loadNote.textContent = "No se pudieron cargar los datos. Puede que tu cuenta no tenga acceso a este panel — contacta al administrador.";
    loadNote.style.color = "var(--neg)";
  }
}
