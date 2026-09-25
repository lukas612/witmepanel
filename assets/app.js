import { supabase, initAuth } from "./auth.js";
import { fetchAllRows } from "./supabaseUtil.js";
import { fetchClientData, buildIndex, computeReviewableMonths, computeAlerts } from "./clientData.js";

const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const MONTHS_FULL = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

const state = { year: 2026, region: "total", view: "region" };
let chart = null;
const yearCache = {};
let opsAlertsCache = null;

const eur = n => n==null ? "—" : n.toLocaleString("es-ES",{style:"currency",currency:"EUR",maximumFractionDigits:0});
const usd = n => n==null ? "—" : n.toLocaleString("es-ES",{style:"currency",currency:"USD",maximumFractionDigits:0});
const daysAgo = (iso) => {
  if (!iso) return "—";
  const days = Math.round((Date.now() - new Date(iso)) / 86400000);
  if (days <= 0) return "hoy";
  if (days === 1) return "hace 1 día";
  return `hace ${days} días`;
};
const pct = n => n==null ? "—" : n.toLocaleString("es-ES",{maximumFractionDigits:1,minimumFractionDigits:1}) + "%";
const pct0 = n => n==null ? "—" : `${n.toFixed(0)}%`;

initAuth(renderAll);

// ---------------- Estado operativo (cross-page alerts) ----------------

async function loadOpsAlerts() {
  if (opsAlertsCache) return opsAlertsCache;
  const [clientAlerts, overdue, cumplimiento, panama] = await Promise.all([
    loadClientAlerts().catch(() => null),
    loadOverdue().catch(() => null),
    loadCumplimiento().catch(() => null),
    loadPanamaInvoiced().catch(() => null),
  ]);
  opsAlertsCache = { clientAlerts, overdue, cumplimiento, panama };
  return opsAlertsCache;
}

async function loadPanamaInvoiced() {
  const rows = await fetchAllRows(supabase, "witme_panama_invoiced_monthly");
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + Number(r.invoiced_total), 0);
  const lastPulled = rows.reduce((max, r) => !max || r.last_pulled_at > max ? r.last_pulled_at : max, null);
  return { total, lastPulled };
}

async function loadClientAlerts() {
  const data = await fetchClientData(supabase);
  const idx = buildIndex(data.rows);
  const reviewableMonths = computeReviewableMonths(idx.months);
  if (!reviewableMonths.length) return null;
  const [year, month] = reviewableMonths[reviewableMonths.length - 1].split("-").map(Number);
  const { missing, deviations } = computeAlerts(idx.byClient, year, month);
  const reviewedMissing = new Set(data.reviews.filter(r => r.alert_type === "missing" && r.year === year && r.month === month).map(r => r.contact_id));
  const reviewedDeviation = new Set(data.reviews.filter(r => r.alert_type === "deviation" && r.year === year && r.month === month).map(r => r.contact_id));
  const unreviewedMissing = missing.filter(m => !reviewedMissing.has(m.contactId)).length;
  const unreviewedDeviation = deviations.filter(d => !reviewedDeviation.has(d.contactId)).length;
  return { year, month, unreviewedMissing, unreviewedDeviation, total: unreviewedMissing + unreviewedDeviation };
}

async function loadOverdue() {
  const rows = await fetchAllRows(supabase, "witme_unpaid_invoices");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let totalEur = 0, overdueEur = 0, count30 = 0;
  for (const r of rows) {
    totalEur += Number(r.pending_eur);
    if (!r.due_date) continue;
    const due = new Date(r.due_date + "T00:00:00");
    const days = Math.round((today - due) / 86400000);
    if (days > 30) { count30++; overdueEur += Number(r.pending_eur); }
  }
  return { totalEur, overdueEur, count30 };
}

async function loadCumplimiento() {
  const [{ data: targets, error: tErr }, { data: results, error: rErr }] = await Promise.all([
    supabase.from("witme_targets_monthly").select("*"),
    supabase.from("witme_results_monthly").select("*"),
  ]);
  if (tErr) throw tErr;
  if (rErr) throw rErr;
  if (!results.length) return null;
  const month = Math.max(...results.map(r => r.month));
  const sum = (rows, field) => rows.filter(r => r.month === month && r.vertical === "").reduce((s, r) => s + (r[field] || 0), 0);
  const objRevenue = sum(targets, "revenue"), realRevenue = sum(results, "revenue");
  const objProfit = sum(targets, "profit"), realProfit = sum(results, "profit");
  return {
    month,
    pctRevenue: objRevenue ? (realRevenue / objRevenue * 100) : null,
    pctProfit: objProfit ? (realProfit / objProfit * 100) : null,
  };
}

function renderOpsAlerts({ clientAlerts, overdue, cumplimiento, panama }) {
  const el = document.getElementById("opsAlerts");
  if (!el) return;

  const clientCard = clientAlerts
    ? `<a class="ops-card ${clientAlerts.total ? "neg" : "pos"}" href="matriz.html">
        <div class="ops-label">CLIENTES CON AVISO</div>
        <div class="ops-value">${clientAlerts.total}</div>
        <div class="ops-foot">${clientAlerts.unreviewedMissing} dejaron de facturar · ${clientAlerts.unreviewedDeviation} atípicos, sin revisar — ${MONTHS_FULL[clientAlerts.month - 1]}</div>
      </a>`
    : `<div class="ops-card"><div class="ops-label">CLIENTES CON AVISO</div><div class="ops-value">—</div><div class="ops-foot">datos insuficientes todavía</div></div>`;

  const overdueCard = overdue
    ? `<a class="ops-card ${overdue.count30 ? "neg" : "pos"}" href="impagados.html">
        <div class="ops-label">FACTURAS VENCIDAS +30 DÍAS</div>
        <div class="ops-value">${overdue.count30}</div>
        <div class="ops-foot">${eur(overdue.overdueEur)} de ${eur(overdue.totalEur)} pendiente total</div>
      </a>`
    : `<div class="ops-card"><div class="ops-label">FACTURAS VENCIDAS +30 DÍAS</div><div class="ops-value">—</div><div class="ops-foot">sin datos</div></div>`;

  const cumplBad = cumplimiento && ((cumplimiento.pctRevenue != null && cumplimiento.pctRevenue < 100) || (cumplimiento.pctProfit != null && cumplimiento.pctProfit < 100));
  const cumplCard = cumplimiento
    ? `<a class="ops-card ${cumplBad ? "neg" : "pos"}" href="comparativa.html">
        <div class="ops-label">CUMPLIMIENTO OBJETIVO — ${MONTHS_FULL[cumplimiento.month - 1].toUpperCase()}</div>
        <div class="ops-value">${pct0(cumplimiento.pctRevenue)} ing. · ${pct0(cumplimiento.pctProfit)} benef.</div>
        <div class="ops-foot">real (operativo) vs objetivo del mes</div>
      </a>`
    : `<div class="ops-card"><div class="ops-label">CUMPLIMIENTO OBJETIVO</div><div class="ops-value">—</div><div class="ops-foot">sin datos</div></div>`;

  const panamaCard = panama
    ? `<a class="ops-card" href="panama.html">
        <div class="ops-label">FACTURADO PANAMÁ (EBI-PAC)</div>
        <div class="ops-value">${usd(panama.total)}</div>
        <div class="ops-foot">actualizado ${daysAgo(panama.lastPulled)} — sin tax/ITBMS</div>
      </a>`
    : `<div class="ops-card"><div class="ops-label">FACTURADO PANAMÁ (EBI-PAC)</div><div class="ops-value">—</div><div class="ops-foot">sin datos todavía</div></div>`;

  el.innerHTML = clientCard + overdueCard + cumplCard + panamaCard;
}

// ---------------- Data ----------------
async function fetchYear(year) {
  if (yearCache[year]) return yearCache[year];

  const [{ data: cfg, error: cfgErr }, { data: rows, error: rowsErr }, { data: invRows, error: invErr }] = await Promise.all([
    supabase.from("witme_year_config").select("*").eq("year", year).single(),
    supabase.from("witme_pnl_monthly").select("*").eq("year", year),
    supabase.from("witme_invoiced_monthly").select("*").eq("year", year)
  ]);
  if (cfgErr) throw cfgErr;
  if (rowsErr) throw rowsErr;
  if (invErr) throw invErr;

  const yearData = { hasSplit: cfg.has_split, visibleMonths: cfg.visible_months, invoicedByMonth: new Array(12).fill(0) };
  invRows.forEach(r => { yearData.invoicedByMonth[r.month - 1] += Number(r.invoiced_eur); });
  for (const region of ["total", "espana", "panama"]) {
    const regionRows = rows.filter(r => r.region === region);
    if (regionRows.length === 0) continue;
    const revenue = new Array(12).fill(null);
    const cost = new Array(12).fill(null);
    const real = new Array(12).fill(false);
    regionRows.forEach(r => {
      const i = r.month - 1;
      revenue[i] = r.revenue != null ? Number(r.revenue) : null;
      cost[i] = r.cost != null ? Number(r.cost) : null;
      real[i] = r.is_real;
    });
    yearData[region] = { revenue, cost, real };
  }

  yearCache[year] = yearData;
  return yearData;
}

function getSeries(yearData) {
  const n = yearData.visibleMonths || 12;
  const set = yearData[state.region] || yearData.total;
  const revenue = set.revenue ? set.revenue.slice(0, n) : null;
  const cost = set.cost.slice(0, n);
  const real = set.real.slice(0, n);
  const hasRevenue = !!revenue;
  const profit = hasRevenue ? revenue.map((r, i) => (r == null || cost[i] == null) ? null : r - cost[i]) : null;
  return { hasRevenue, revenue, cost, profit, real, n };
}

// ---------------- Render ----------------
function renderFilters(yearData) {
  const split = yearData.hasSplit;
  if (!split && state.region !== "total") state.region = "total";
  if (!split && state.view === "compare") state.view = "region";

  document.querySelectorAll("#yearSeg button").forEach(b => {
    b.setAttribute("aria-pressed", String(Number(b.dataset.year) === state.year));
  });
  document.querySelectorAll("#regionSeg button").forEach(b => {
    b.setAttribute("aria-pressed", String(b.dataset.region === state.region));
  });
  document.querySelectorAll("#viewSeg button").forEach(b => {
    b.setAttribute("aria-pressed", String(b.dataset.view === state.view));
  });

  document.querySelectorAll("#regionSeg button[data-region='espana'], #regionSeg button[data-region='panama']")
    .forEach(b => b.disabled = !split);
  document.querySelector("#viewSeg button[data-view='compare']").disabled = !split;

  const yearIrrelevant = state.view === "yoy";
  const regionIrrelevant = state.view === "compare" || state.view === "yoy";
  document.getElementById("yearSeg").style.display = yearIrrelevant ? "none" : "flex";
  document.getElementById("regionSeg").style.display = regionIrrelevant ? "none" : "flex";
  document.getElementById("regionNote").classList.toggle("show", !split && !regionIrrelevant);
  document.getElementById("kpiStrip2").style.display = "none";
}

function regionLabel(region) {
  return region === "total" ? "Total" : (region === "espana" ? "España" : "Panamá");
}

function renderKPIs(s, yearData) {
  const strip = document.getElementById("kpiStrip");
  const strip2 = document.getElementById("kpiStrip2");
  const disabledNote = document.getElementById("regionDisabledNote");

  const realIdx = s.real.map((r, i) => r ? i : -1).filter(i => i >= 0);
  const sum = arr => arr == null ? null : realIdx.reduce((a, i) => a + (arr[i] || 0), 0);

  if (s.hasRevenue) {
    disabledNote.style.display = "none";
    strip.style.display = "grid";
    const rev = sum(s.revenue), cost = sum(s.cost), profit = sum(s.profit);
    const margin = rev ? (profit / rev * 100) : null;
    strip.innerHTML = `
      <div class="kpi"><div class="label">INGRESOS</div><div class="value">${eur(rev)}</div><div class="foot">${realIdx.length} meses con dato real</div></div>
      <div class="kpi"><div class="label">COSTES</div><div class="value">${eur(cost)}</div><div class="foot">España + Panamá</div></div>
      <div class="kpi"><div class="label">BENEFICIO</div><div class="value ${profit<0?'neg':'pos'}">${eur(profit)}</div><div class="foot">${state.year}</div></div>
      <div class="kpi"><div class="label">MARGEN</div><div class="value ${margin<0?'neg':'pos'}">${pct(margin)}</div><div class="foot">sobre ingresos reales</div></div>
    `;

    const invoicedEur = realIdx.reduce((a, i) => a + (yearData.invoicedByMonth[i] || 0), 0);
    const negMonths = realIdx.filter(i => (s.revenue[i] - s.cost[i]) < 0).length;
    strip2.style.display = "grid";
    strip2.innerHTML = `
      <div class="kpi"><div class="label">FACTURADO (HOLDED, España)</div><div class="value">${eur(invoicedEur)}</div><div class="foot">sin IVA, mismos meses</div></div>
      <div class="kpi"><div class="label">MESES EN NEGATIVO</div><div class="value ${negMonths>0?'neg':'pos'}">${negMonths}</div><div class="foot">de ${realIdx.length} meses reales</div></div>
    `;
  } else {
    strip.style.display = "none";
    strip2.style.display = "none";
    disabledNote.style.display = "block";
    const cost = sum(s.cost);
    const label = state.region === "espana" ? "España" : "Panamá";
    disabledNote.innerHTML = `Ingresos no desglosados por país — solo coste disponible para <strong>${label}</strong>: <span style="font-family:'IBM Plex Mono',monospace">${eur(cost)}</span> (${realIdx.length} meses reales).`;
  }
}

function drawChart(labels, datasets) {
  const box = document.getElementById("mainChart").parentElement;
  if (typeof Chart === "undefined") {
    box.innerHTML = '<div style="color:var(--ink-soft); font-size:13px; padding:20px;">No se ha podido cargar la librería de gráficos (Chart.js). Los KPIs y la tabla siguen funcionando con normalidad.</div>';
    return;
  }
  const ctx = document.getElementById("mainChart").getContext("2d");
  const gridColor = getComputedStyle(document.body).getPropertyValue("--line").trim();
  const inkSoft = getComputedStyle(document.body).getPropertyValue("--ink-soft").trim();

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top", align: "end", labels: { color: inkSoft, boxWidth: 12, font: { family: "IBM Plex Mono", size: 11.5 } } },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${eur(c.parsed.y)}` } }
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: inkSoft, font: { family: "IBM Plex Mono", size: 11 } } },
        y: { grid: { color: gridColor }, ticks: { color: inkSoft, font: { family: "IBM Plex Mono", size: 11 }, callback: v => eur(v) } }
      }
    }
  });
}

function renderChart(s) {
  const datasets = [];
  if (s.hasRevenue) {
    datasets.push({ label: "Ingresos", data: s.revenue, borderColor: "#3d7cbf", backgroundColor: "transparent", tension: .25, spanGaps: false });
    datasets.push({ label: "Costes", data: s.cost, borderColor: getComputedStyle(document.body).getPropertyValue("--neg").trim(), backgroundColor: "transparent", tension: .25, spanGaps: false });
    datasets.push({ label: "Beneficio", data: s.profit, borderColor: getComputedStyle(document.body).getPropertyValue("--accent").trim(), backgroundColor: "transparent", tension: .25, spanGaps: false, borderWidth: 2.5 });
  } else {
    const label = state.region === "espana" ? "Costes España" : "Costes Panamá";
    datasets.push({ label, data: s.cost, borderColor: getComputedStyle(document.body).getPropertyValue("--warn").trim(), backgroundColor: "transparent", tension: .25 });
  }

  document.getElementById("chartTitle").textContent = `EVOLUCIÓN MENSUAL — ${state.year} · ${regionLabel(state.region)}`;
  drawChart(MONTHS.slice(0, s.n), datasets);
}

function renderTable(s) {
  const head = document.getElementById("tableHead");
  const body = document.getElementById("tableBody");
  const foot = document.getElementById("tableFoot");

  if (s.hasRevenue) {
    head.innerHTML = `<th>Mes</th><th>Ingresos</th><th>Costes</th><th>Beneficio</th><th>Margen</th><th>Estado</th>`;
    body.innerHTML = MONTHS.slice(0, s.n).map((m, i) => {
      const p = s.profit[i];
      const margin = (s.revenue[i] && p != null) ? (p / s.revenue[i] * 100) : null;
      return `<tr>
        <td>${m}</td>
        <td>${eur(s.revenue[i])}</td>
        <td>${eur(s.cost[i])}</td>
        <td class="${p<0?'neg':(p>0?'pos':'')}">${eur(p)}</td>
        <td class="${margin<0?'neg':''}">${pct(margin)}</td>
        <td><span class="status ${s.real[i]?'real':'est'}">${s.real[i]?'real':'estimado'}</span></td>
      </tr>`;
    }).join("");
    const realIdx = s.real.map((r, i) => r ? i : -1).filter(i => i >= 0);
    const sum = arr => realIdx.reduce((a, i) => a + (arr[i] || 0), 0);
    const trev = sum(s.revenue), tcost = sum(s.cost), tprofit = sum(s.profit);
    const tmargin = trev ? (tprofit / trev * 100) : null;
    foot.innerHTML = `<td>Total (meses reales)</td><td>${eur(trev)}</td><td>${eur(tcost)}</td><td class="${tprofit<0?'neg':'pos'}">${eur(tprofit)}</td><td>${pct(tmargin)}</td><td></td>`;
  } else {
    head.innerHTML = `<th>Mes</th><th>Costes</th><th>Estado</th>`;
    body.innerHTML = MONTHS.slice(0, s.n).map((m, i) => `<tr>
        <td>${m}</td>
        <td>${eur(s.cost[i])}</td>
        <td><span class="status ${s.real[i]?'real':'est'}">${s.real[i]?'real':'estimado'}</span></td>
      </tr>`).join("");
    const realIdx = s.real.map((r, i) => r ? i : -1).filter(i => i >= 0);
    const tcost = realIdx.reduce((a, i) => a + (s.cost[i] || 0), 0);
    foot.innerHTML = `<td>Total (meses reales)</td><td>${eur(tcost)}</td><td></td>`;
  }
}

function profitOf(set, n) {
  return set.revenue.slice(0, n).map((r, i) => (r == null || set.cost[i] == null) ? null : r - set.cost[i]);
}

function renderCompare(yearData) {
  const n = yearData.visibleMonths || 12;
  const esp = yearData.espana, pan = yearData.panama;
  const espProfit = profitOf(esp, n);
  const panProfit = profitOf(pan, n);
  const real = esp.real.slice(0, n).map((r, i) => r && pan.real[i]);
  const realIdx = real.map((r, i) => r ? i : -1).filter(i => i >= 0);
  const sum = arr => realIdx.reduce((a, i) => a + (arr[i] || 0), 0);
  const tEsp = sum(espProfit), tPan = sum(panProfit), diff = tPan - tEsp, combined = tEsp + tPan;

  document.getElementById("regionDisabledNote").style.display = "none";
  const strip = document.getElementById("kpiStrip");
  strip.style.display = "grid";
  strip.innerHTML = `
    <div class="kpi"><div class="label">BENEFICIO ESPAÑA</div><div class="value ${tEsp<0?'neg':'pos'}">${eur(tEsp)}</div><div class="foot">${realIdx.length} meses con dato real</div></div>
    <div class="kpi"><div class="label">BENEFICIO PANAMÁ</div><div class="value ${tPan<0?'neg':'pos'}">${eur(tPan)}</div><div class="foot">${realIdx.length} meses con dato real</div></div>
    <div class="kpi"><div class="label">DIFERENCIA (PA − ES)</div><div class="value ${diff<0?'neg':'pos'}">${eur(diff)}</div><div class="foot">Panamá menos España</div></div>
    <div class="kpi"><div class="label">APORTE DE PANAMÁ</div><div class="value">${pct(combined ? (tPan/combined*100) : null)}</div><div class="foot">sobre el beneficio combinado</div></div>
  `;

  document.getElementById("chartTitle").textContent = `BENEFICIO — ${state.year} · España vs Panamá`;
  drawChart(MONTHS.slice(0, n), [
    { label: "Beneficio España", data: espProfit, borderColor: getComputedStyle(document.body).getPropertyValue("--neg").trim(), backgroundColor: "transparent", tension: .25, spanGaps: false, borderWidth: 2.5 },
    { label: "Beneficio Panamá", data: panProfit, borderColor: getComputedStyle(document.body).getPropertyValue("--accent").trim(), backgroundColor: "transparent", tension: .25, spanGaps: false, borderWidth: 2.5 }
  ]);

  const head = document.getElementById("tableHead");
  const body = document.getElementById("tableBody");
  const foot = document.getElementById("tableFoot");
  head.innerHTML = `<th>Mes</th><th>Beneficio España</th><th>Beneficio Panamá</th><th>Diferencia</th><th>Estado</th>`;
  body.innerHTML = MONTHS.slice(0, n).map((m, i) => {
    const d = (espProfit[i] == null || panProfit[i] == null) ? null : panProfit[i] - espProfit[i];
    return `<tr>
      <td>${m}</td>
      <td class="${espProfit[i]<0?'neg':(espProfit[i]>0?'pos':'')}">${eur(espProfit[i])}</td>
      <td class="${panProfit[i]<0?'neg':(panProfit[i]>0?'pos':'')}">${eur(panProfit[i])}</td>
      <td class="${d<0?'neg':(d>0?'pos':'')}">${eur(d)}</td>
      <td><span class="status ${real[i]?'real':'est'}">${real[i]?'real':'estimado'}</span></td>
    </tr>`;
  }).join("");
  foot.innerHTML = `<td>Total (meses reales)</td><td class="${tEsp<0?'neg':'pos'}">${eur(tEsp)}</td><td class="${tPan<0?'neg':'pos'}">${eur(tPan)}</td><td class="${diff<0?'neg':'pos'}">${eur(diff)}</td><td></td>`;
}

function renderYoY(d25, d26) {
  const n = Math.min(d25.visibleMonths || 12, d26.visibleMonths || 12);
  const t25 = d25.total, t26 = d26.total;
  const rev25 = t25.revenue.slice(0, n), cost25 = t25.cost.slice(0, n), real25 = t25.real.slice(0, n);
  const rev26 = t26.revenue.slice(0, n), cost26 = t26.cost.slice(0, n), real26 = t26.real.slice(0, n);
  const profit25 = rev25.map((r, i) => (r == null || cost25[i] == null) ? null : r - cost25[i]);
  const profit26 = rev26.map((r, i) => (r == null || cost26[i] == null) ? null : r - cost26[i]);
  const real = real25.map((r, i) => r && real26[i]);
  const realIdx = real.map((r, i) => r ? i : -1).filter(i => i >= 0);
  const sum = arr => realIdx.reduce((a, i) => a + (arr[i] || 0), 0);
  const tRev25 = sum(rev25), tRev26 = sum(rev26), tProfit25 = sum(profit25), tProfit26 = sum(profit26);
  const revGrowth = tRev25 ? ((tRev26 - tRev25) / Math.abs(tRev25) * 100) : null;
  const profitGrowth = tProfit25 ? ((tProfit26 - tProfit25) / Math.abs(tProfit25) * 100) : null;
  const growthLabel = g => g == null ? "—" : `${g >= 0 ? '+' : ''}${g.toFixed(1)}% vs 2025`;

  document.getElementById("regionDisabledNote").style.display = "none";
  const strip = document.getElementById("kpiStrip");
  strip.style.display = "grid";
  strip.innerHTML = `
    <div class="kpi"><div class="label">INGRESOS 2025</div><div class="value">${eur(tRev25)}</div><div class="foot">ene–${MONTHS[n-1]}</div></div>
    <div class="kpi"><div class="label">INGRESOS 2026</div><div class="value">${eur(tRev26)}</div><div class="foot">${growthLabel(revGrowth)}</div></div>
    <div class="kpi"><div class="label">BENEFICIO 2025</div><div class="value ${tProfit25<0?'neg':'pos'}">${eur(tProfit25)}</div><div class="foot">ene–${MONTHS[n-1]}</div></div>
    <div class="kpi"><div class="label">BENEFICIO 2026</div><div class="value ${tProfit26<0?'neg':'pos'}">${eur(tProfit26)}</div><div class="foot">${growthLabel(profitGrowth)}</div></div>
  `;

  document.getElementById("chartTitle").textContent = `INTERANUAL — Beneficio 2025 vs 2026 (ene–${MONTHS[n-1]})`;
  drawChart(MONTHS.slice(0, n), [
    { label: "Beneficio 2025", data: profit25, borderColor: getComputedStyle(document.body).getPropertyValue("--ink-soft").trim(), backgroundColor: "transparent", tension: .25, spanGaps: false, borderDash: [4, 3] },
    { label: "Beneficio 2026", data: profit26, borderColor: getComputedStyle(document.body).getPropertyValue("--accent").trim(), backgroundColor: "transparent", tension: .25, spanGaps: false, borderWidth: 2.5 }
  ]);

  const head = document.getElementById("tableHead");
  const body = document.getElementById("tableBody");
  const foot = document.getElementById("tableFoot");
  head.innerHTML = `<th>Mes</th><th>Beneficio 2025</th><th>Beneficio 2026</th><th>Variación</th><th>Estado</th>`;
  body.innerHTML = MONTHS.slice(0, n).map((m, i) => {
    const delta = (profit25[i] == null || profit26[i] == null) ? null : profit26[i] - profit25[i];
    return `<tr>
      <td>${m}</td>
      <td class="${profit25[i]<0?'neg':(profit25[i]>0?'pos':'')}">${eur(profit25[i])}</td>
      <td class="${profit26[i]<0?'neg':(profit26[i]>0?'pos':'')}">${eur(profit26[i])}</td>
      <td class="${delta<0?'neg':(delta>0?'pos':'')}">${eur(delta)}</td>
      <td><span class="status ${real[i]?'real':'est'}">${real[i]?'real':'estimado'}</span></td>
    </tr>`;
  }).join("");
  const totalDelta = tProfit26 - tProfit25;
  foot.innerHTML = `<td>Total (meses reales)</td><td class="${tProfit25<0?'neg':'pos'}">${eur(tProfit25)}</td><td class="${tProfit26<0?'neg':'pos'}">${eur(tProfit26)}</td><td class="${totalDelta<0?'neg':'pos'}">${eur(totalDelta)}</td><td></td>`;
}

function renderCumulative(yearData) {
  const s = getSeries(yearData);

  let running = 0, started = false;
  const cum = s.profit.map(p => {
    if (p == null) return started ? running : null;
    running += p; started = true;
    return running;
  });

  const realIdx = s.real.map((r, i) => (r && s.profit[i] != null) ? i : -1).filter(i => i >= 0);
  let bestIdx = null, worstIdx = null;
  realIdx.forEach(i => {
    if (bestIdx == null || s.profit[i] > s.profit[bestIdx]) bestIdx = i;
    if (worstIdx == null || s.profit[i] < s.profit[worstIdx]) worstIdx = i;
  });
  const negCount = realIdx.filter(i => s.profit[i] < 0).length;
  const finalCum = realIdx.length ? cum[realIdx[realIdx.length - 1]] : null;
  const lastRealMonth = realIdx.length ? MONTHS[realIdx[realIdx.length - 1]] : "—";

  document.getElementById("regionDisabledNote").style.display = "none";
  const strip = document.getElementById("kpiStrip");
  strip.style.display = "grid";
  strip.innerHTML = `
    <div class="kpi"><div class="label">BENEFICIO ACUMULADO</div><div class="value ${finalCum<0?'neg':'pos'}">${eur(finalCum)}</div><div class="foot">a ${lastRealMonth}</div></div>
    <div class="kpi"><div class="label">MEJOR MES</div><div class="value pos">${bestIdx!=null?eur(s.profit[bestIdx]):'—'}</div><div class="foot">${bestIdx!=null?MONTHS[bestIdx]:'—'}</div></div>
    <div class="kpi"><div class="label">PEOR MES</div><div class="value ${worstIdx!=null && s.profit[worstIdx]<0?'neg':'pos'}">${worstIdx!=null?eur(s.profit[worstIdx]):'—'}</div><div class="foot">${worstIdx!=null?MONTHS[worstIdx]:'—'}</div></div>
    <div class="kpi"><div class="label">MESES EN NEGATIVO</div><div class="value ${negCount>0?'neg':'pos'}">${negCount}</div><div class="foot">de ${realIdx.length} meses reales</div></div>
  `;

  document.getElementById("chartTitle").textContent = `BENEFICIO ACUMULADO — ${state.year} · ${regionLabel(state.region)}`;
  drawChart(MONTHS.slice(0, s.n), [
    { label: "Beneficio acumulado", data: cum, borderColor: getComputedStyle(document.body).getPropertyValue("--accent").trim(), backgroundColor: getComputedStyle(document.body).getPropertyValue("--accent-soft").trim(), tension: .25, spanGaps: false, borderWidth: 2.5, fill: true }
  ]);

  const head = document.getElementById("tableHead");
  const body = document.getElementById("tableBody");
  const foot = document.getElementById("tableFoot");
  head.innerHTML = `<th>Mes</th><th>Beneficio del mes</th><th>Acumulado</th><th>Estado</th>`;
  body.innerHTML = MONTHS.slice(0, s.n).map((m, i) => `<tr>
      <td>${m}</td>
      <td class="${s.profit[i]<0?'neg':(s.profit[i]>0?'pos':'')}">${eur(s.profit[i])}</td>
      <td class="${cum[i]<0?'neg':(cum[i]>0?'pos':'')}">${eur(cum[i])}</td>
      <td><span class="status ${s.real[i]?'real':'est'}">${s.real[i]?'real':'estimado'}</span></td>
    </tr>`).join("");
  foot.innerHTML = `<td>Acumulado final</td><td></td><td class="${finalCum<0?'neg':'pos'}">${eur(finalCum)}</td><td></td>`;
}

async function renderAll() {
  const loadNote = document.getElementById("loadNote");
  loadNote.style.display = "block";
  loadNote.textContent = "Cargando datos…";
  loadNote.style.color = "";
  try {
    if (state.view === "yoy") {
      const [d25, d26] = await Promise.all([fetchYear(2025), fetchYear(2026)]);
      renderFilters(state.year === 2025 ? d25 : d26);
      renderYoY(d25, d26);
    } else {
      const yearData = await fetchYear(state.year);
      renderFilters(yearData);
      if (state.view === "compare") {
        renderCompare(yearData);
      } else if (state.view === "cumulative") {
        renderCumulative(yearData);
      } else {
        const s = getSeries(yearData);
        renderKPIs(s, yearData);
        renderChart(s);
        renderTable(s);
      }
    }
    loadNote.style.display = "none";
  } catch (err) {
    console.error(err);
    loadNote.textContent = "No se pudieron cargar los datos. Puede que tu cuenta no tenga acceso a este panel — contacta al administrador.";
    loadNote.style.color = "var(--neg)";
  }
  loadOpsAlerts().then(renderOpsAlerts).catch(err => console.error("ops alerts:", err));
}

document.getElementById("yearSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  state.year = Number(b.dataset.year); renderAll();
});
document.getElementById("regionSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b || b.disabled) return;
  state.region = b.dataset.region; renderAll();
});
document.getElementById("viewSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b || b.disabled) return;
  state.view = b.dataset.view; renderAll();
});
