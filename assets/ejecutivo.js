import { supabase, initAuth } from "./auth.js";

const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

const state = { year: 2026 };
let chart = null;
const yearCache = {};

const eur = n => n == null ? "—" : n.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const pct = n => n == null ? "—" : `${n >= 0 ? '+' : ''}${n.toLocaleString("es-ES", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;

initAuth(renderAll);

async function fetchYear(year) {
  if (yearCache[year]) return yearCache[year];
  const [{ data: cfg, error: cfgErr }, { data: pnlRows, error: pnlErr }, { data: invRows, error: invErr }] = await Promise.all([
    supabase.from("witme_year_config").select("*").eq("year", year).single(),
    supabase.from("witme_pnl_monthly").select("*").eq("year", year),
    supabase.from("witme_invoiced_monthly").select("*").eq("year", year).eq("currency", "EUR")
  ]);
  if (cfgErr) throw cfgErr;
  if (pnlErr) throw pnlErr;
  if (invErr) throw invErr;

  const yearData = { hasSplit: cfg.has_split, visibleMonths: cfg.visible_months, invoicedByMonth: new Array(12).fill(0) };
  invRows.forEach(r => { yearData.invoicedByMonth[r.month - 1] += Number(r.invoiced_total); });

  for (const region of ["total", "espana", "panama"]) {
    const regionRows = pnlRows.filter(r => r.region === region);
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

function totals(yearData) {
  const n = yearData.visibleMonths || 12;
  const t = yearData.total;
  const realIdx = t.real.slice(0, n).map((r, i) => r ? i : -1).filter(i => i >= 0);
  const sum = arr => realIdx.reduce((a, i) => a + (arr[i] || 0), 0);
  const revenue = sum(t.revenue);
  const cost = sum(t.cost);
  const profit = revenue - cost;
  const margin = revenue ? (profit / revenue * 100) : null;
  const invoicedEur = realIdx.reduce((a, i) => a + (yearData.invoicedByMonth[i] || 0), 0);
  const negMonths = realIdx.filter(i => (t.revenue[i] - t.cost[i]) < 0).length;

  let panamaShare = null;
  if (yearData.hasSplit && yearData.panama && yearData.espana) {
    const panProfit = realIdx.reduce((a, i) => a + ((yearData.panama.revenue[i] || 0) - (yearData.panama.cost[i] || 0)), 0);
    panamaShare = profit ? (panProfit / profit * 100) : null;
  }

  return { n, realIdx, revenue, cost, profit, margin, invoicedEur, negMonths, panamaShare };
}

function renderKPIs(cur, prev) {
  const growth = (prev && prev.profit) ? ((cur.profit - prev.profit) / Math.abs(prev.profit) * 100) : null;

  document.getElementById("kpiStrip").innerHTML = `
    <div class="kpi"><div class="label">INGRESOS GENERADOS</div><div class="value">${eur(cur.revenue)}</div><div class="foot">${cur.realIdx.length} meses reales</div></div>
    <div class="kpi"><div class="label">COSTES</div><div class="value">${eur(cur.cost)}</div><div class="foot">España + Panamá</div></div>
    <div class="kpi"><div class="label">BENEFICIO GENERADO</div><div class="value ${cur.profit<0?'neg':'pos'}">${eur(cur.profit)}</div><div class="foot">margen ${cur.margin!=null?cur.margin.toFixed(1)+'%':'—'}</div></div>
    <div class="kpi"><div class="label">CRECIMIENTO INTERANUAL</div><div class="value ${growth!=null&&growth<0?'neg':'pos'}">${pct(growth)}</div><div class="foot">beneficio vs mismos meses ${state.year-1}</div></div>
  `;

  const panamaTile = cur.panamaShare != null
    ? `<div class="kpi"><div class="label">APORTE PANAMÁ</div><div class="value">${cur.panamaShare.toFixed(1)}%</div><div class="foot">del beneficio combinado</div></div>`
    : `<div class="kpi"><div class="label">DESGLOSE POR PAÍS</div><div class="value">—</div><div class="foot">no disponible este año</div></div>`;

  document.getElementById("kpiStrip2").innerHTML = `
    <div class="kpi"><div class="label">FACTURADO (HOLDED, EUR, sin IVA)</div><div class="value">${eur(cur.invoicedEur)}</div><div class="foot">España, mismos meses</div></div>
    ${panamaTile}
    <div class="kpi"><div class="label">MESES EN NEGATIVO</div><div class="value ${cur.negMonths>0?'neg':'pos'}">${cur.negMonths}</div><div class="foot">de ${cur.realIdx.length} meses reales</div></div>
    <div class="kpi"><div class="label">PERIODO</div><div class="value" style="font-size:16px;">${state.year}</div><div class="foot">ene–${MONTHS[cur.n-1]}</div></div>
  `;
}

function renderChart(yearData, cur) {
  const box = document.getElementById("mainChart").parentElement;
  if (typeof Chart === "undefined") {
    box.innerHTML = '<div style="color:var(--ink-soft); font-size:13px; padding:20px;">No se ha podido cargar la librería de gráficos (Chart.js). Los KPIs siguen funcionando con normalidad.</div>';
    return;
  }
  const t = yearData.total;
  const n = cur.n;
  const profit = t.revenue.slice(0, n).map((r, i) => (r == null || t.cost[i] == null) ? null : r - t.cost[i]);

  const ctx = document.getElementById("mainChart").getContext("2d");
  const gridColor = getComputedStyle(document.body).getPropertyValue("--line").trim();
  const inkSoft = getComputedStyle(document.body).getPropertyValue("--ink-soft").trim();
  const accent = getComputedStyle(document.body).getPropertyValue("--accent").trim();
  const accentSoft = getComputedStyle(document.body).getPropertyValue("--accent-soft").trim();

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: MONTHS.slice(0, n),
      datasets: [{ label: "Beneficio", data: profit, borderColor: accent, backgroundColor: accentSoft, fill: true, tension: .25, spanGaps: false, borderWidth: 2.5 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => `Beneficio: ${eur(c.parsed.y)}` } }
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: inkSoft, font: { family: "IBM Plex Mono", size: 11 } } },
        y: { grid: { color: gridColor }, ticks: { color: inkSoft, font: { family: "IBM Plex Mono", size: 11 }, callback: v => eur(v) } }
      }
    }
  });
}

async function renderAll() {
  const loadNote = document.getElementById("loadNote");
  loadNote.style.display = "block";
  loadNote.textContent = "Cargando datos…";
  loadNote.style.color = "";
  try {
    const [yearData, prevYearData] = await Promise.all([
      fetchYear(state.year),
      fetchYear(state.year - 1).catch(() => null)
    ]);
    document.querySelectorAll("#yearSeg button").forEach(b => {
      b.setAttribute("aria-pressed", String(Number(b.dataset.year) === state.year));
    });
    document.getElementById("periodSub").textContent = `España & Panamá — ene–${MONTHS[(yearData.visibleMonths||12)-1]} ${state.year}`;

    const cur = totals(yearData);
    const prev = prevYearData ? totals(prevYearData) : null;
    renderKPIs(cur, prev);
    document.getElementById("chartTitle").textContent = `BENEFICIO MENSUAL GENERADO — ${state.year}`;
    renderChart(yearData, cur);
    loadNote.style.display = "none";
  } catch (err) {
    console.error(err);
    loadNote.textContent = "No se pudieron cargar los datos. Puede que tu cuenta no tenga acceso a este panel — contacta al administrador.";
    loadNote.style.color = "var(--neg)";
  }
}

document.getElementById("yearSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  state.year = Number(b.dataset.year); renderAll();
});
