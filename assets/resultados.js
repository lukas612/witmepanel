import { supabase, initAuth } from "./auth.js";

const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep"];
const MARKET_ORDER = ["España", "Portugal", "Italia", "Rumania", "Polonia", "Alemania", "México", "Colombia", "Brasil", "Affiliate", "Otros"];
const VERTICAL_ORDER = ["", "Deudas", "Creditio", "Instadinero", "Moneya", "Cdirecto", "Creditodirecto", "Smartrata", "Everflow", "Api-partners"];

const money = (n) => n == null ? "—" : n.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const pct = (n) => n == null ? "—" : `${n.toFixed(1)}%`;

const QUARTERS = { q1: [1, 2, 3], q2: [4, 5, 6], q3: [7, 8, 9] };
const QUARTER_LABELS = { q1: "Q1", q2: "Q2", q3: "Q3" };

const state = { month: null, chartGran: "month" }; // month: 1-9, "q1"/"q2"/"q3", or "year"
let rows = null;
let chart = null;

initAuth(renderAll);

function parseMonthValue(raw) {
  return (raw === "year" || raw in QUARTERS) ? raw : Number(raw);
}

function renderMonthSeg() {
  const seg = document.getElementById("monthSeg");
  const buttons = MONTHS.map((m, i) => `<button data-month="${i + 1}" aria-pressed="${state.month === i + 1}">${m}</button>`);
  for (const q of Object.keys(QUARTERS)) {
    buttons.push(`<button data-month="${q}" aria-pressed="${state.month === q}">${QUARTER_LABELS[q]}</button>`);
  }
  buttons.push(`<button data-month="year" aria-pressed="${state.month === "year"}">Año completo</button>`);
  seg.innerHTML = buttons.join("");
  seg.querySelectorAll("button").forEach(b => {
    b.addEventListener("click", () => {
      state.month = parseMonthValue(b.dataset.month);
      render();
    });
  });
}

function marketSortKey(market) {
  const i = MARKET_ORDER.indexOf(market);
  return i === -1 ? MARKET_ORDER.length : i;
}

function verticalSortKey(vertical) {
  const i = VERTICAL_ORDER.indexOf(vertical);
  return i === -1 ? VERTICAL_ORDER.length : i;
}

// Combine several monthly rows (same market+vertical, different months) into one accumulated row.
function accumulate(group) {
  const sum = (field) => {
    const vals = group.map(r => r[field]).filter(v => v != null);
    return vals.length ? vals.reduce((a, b) => a + Number(b), 0) : null;
  };
  const revenue = sum("revenue");
  const cost = sum("cost");
  const profit = sum("profit");
  return {
    market: group[0].market,
    vertical: group[0].vertical,
    responsable: group[0].responsable,
    revenue, cost, profit,
    roi_pct: (cost != null && cost !== 0 && profit != null) ? (profit / cost * 100) : null,
    revenue_campaigns: sum("revenue_campaigns"),
    revenue_monetization: sum("revenue_monetization"),
    revenue_adsense: sum("revenue_adsense"),
    // Cumplimiento del mes no se puede sumar/promediar de forma válida por trimestre o año
    pct_objetivo_profit: null,
    pct_objetivo_facturacion: null,
  };
}

function rowsForSelection() {
  let source = rows;
  if (state.month === "year") {
    // all months
  } else if (state.month in QUARTERS) {
    const months = QUARTERS[state.month];
    source = rows.filter(r => months.includes(r.month));
  } else {
    return rows.filter(r => r.month === state.month);
  }
  const groups = new Map();
  for (const r of source) {
    const key = `${r.market}|||${r.vertical}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.values()].map(accumulate);
}

function renderKpis(list) {
  const marketTotals = list.filter(r => r.vertical === "");
  const revenue = marketTotals.reduce((s, r) => s + (r.revenue || 0), 0);
  const cost = marketTotals.reduce((s, r) => s + (r.cost || 0), 0);
  const profit = marketTotals.reduce((s, r) => s + (r.profit || 0), 0);
  const roi = cost ? (profit / cost * 100) : null;

  const strip = document.getElementById("kpiStrip");
  strip.style.display = "grid";
  strip.innerHTML = `
    <div class="kpi"><div class="label">INGRESOS REALES</div><div class="value">${money(revenue)}</div><div class="foot">${marketTotals.length} mercados</div></div>
    <div class="kpi"><div class="label">COSTE REAL (pauta + herramientas)</div><div class="value">${money(cost)}</div><div class="foot">objetivo del periodo</div></div>
    <div class="kpi"><div class="label">BENEFICIO OPERATIVO REAL</div><div class="value ${profit < 0 ? "neg" : "pos"}">${money(profit)}</div><div class="foot">margen ${revenue ? (profit / revenue * 100).toFixed(1) + "%" : "—"}</div></div>
    <div class="kpi"><div class="label">ROI REAL</div><div class="value ${roi != null && roi < 0 ? "neg" : "pos"}">${pct(roi)}</div><div class="foot">beneficio / coste</div></div>
  `;
}

function renderTable(list) {
  const showPctObjetivo = typeof state.month === "number";

  const head = document.getElementById("resultsHead");
  head.innerHTML = `
    <th style="text-align:left;">Mercado</th>
    <th style="text-align:left;">Vertical</th>
    <th style="text-align:left;">Responsable</th>
    <th>Ingresos</th>
    <th>Coste</th>
    <th>Beneficio</th>
    <th>ROI</th>
    <th>Ing. campañas</th><th>Ing. monetización</th><th>Ing. adsense</th>
    ${showPctObjetivo ? `<th>% obj. profit</th><th>% obj. facturación</th>` : ""}
  `;

  const byMarket = new Map();
  for (const r of list) {
    if (!byMarket.has(r.market)) byMarket.set(r.market, []);
    byMarket.get(r.market).push(r);
  }
  const markets = [...byMarket.keys()].sort((a, b) => marketSortKey(a) - marketSortKey(b));

  let bodyHtml = "";
  let grand = { revenue: 0, cost: 0, profit: 0 };

  for (const market of markets) {
    const items = byMarket.get(market).sort((a, b) => verticalSortKey(a.vertical) - verticalSortKey(b.vertical));
    const totalRow = items.find(r => r.vertical === "");
    const verticalRows = items.filter(r => r.vertical !== "");

    if (totalRow) {
      grand.revenue += totalRow.revenue || 0;
      grand.cost += totalRow.cost || 0;
      grand.profit += totalRow.profit || 0;
      bodyHtml += marketRowHtml(totalRow, showPctObjetivo);
    }
    for (const r of verticalRows) {
      bodyHtml += verticalRowHtml(r, showPctObjetivo);
    }
  }

  document.getElementById("resultsBody").innerHTML = bodyHtml;

  const grandRoi = grand.cost ? (grand.profit / grand.cost * 100) : null;
  const foot = document.getElementById("resultsFoot");
  foot.innerHTML = `
    <td style="text-align:left;">Total</td>
    <td style="text-align:left;"></td>
    <td style="text-align:left;"></td>
    <td>${money(grand.revenue)}</td>
    <td>${money(grand.cost)}</td>
    <td class="${grand.profit < 0 ? "neg" : "pos"}">${money(grand.profit)}</td>
    <td class="${grandRoi != null && grandRoi < 0 ? "neg" : "pos"}">${pct(grandRoi)}</td>
    <td></td><td></td><td></td>
    ${showPctObjetivo ? `<td></td><td></td>` : ""}
  `;
}

function marketRowHtml(r, showPctObjetivo) {
  return `<tr class="market-row">
    <td style="text-align:left;">${escapeHtml(r.market)}</td>
    <td style="text-align:left;">Total</td>
    <td style="text-align:left;"></td>
    <td>${money(r.revenue)}</td>
    <td>${money(r.cost)}</td>
    <td class="${(r.profit || 0) < 0 ? "neg" : "pos"}">${money(r.profit)}</td>
    <td class="${r.roi_pct != null && r.roi_pct < 0 ? "neg" : "pos"}">${pct(r.roi_pct)}</td>
    <td>${money(r.revenue_campaigns)}</td><td>${money(r.revenue_monetization)}</td><td>${money(r.revenue_adsense)}</td>
    ${showPctObjetivo ? `<td>${pct(r.pct_objetivo_profit)}</td><td>${pct(r.pct_objetivo_facturacion)}</td>` : ""}
  </tr>`;
}

function verticalRowHtml(r, showPctObjetivo) {
  return `<tr class="vertical-row">
    <td style="text-align:left;"></td>
    <td style="text-align:left;">${escapeHtml(r.vertical)}</td>
    <td style="text-align:left;">${escapeHtml(r.responsable || "—")}</td>
    <td>${money(r.revenue)}</td>
    <td>${money(r.cost)}</td>
    <td class="${(r.profit || 0) < 0 ? "neg" : (r.profit ? "pos" : "")}">${money(r.profit)}</td>
    <td class="${r.roi_pct != null && r.roi_pct < 0 ? "neg" : ""}">${pct(r.roi_pct)}</td>
    <td>${money(r.revenue_campaigns)}</td><td>${money(r.revenue_monetization)}</td><td>${money(r.revenue_adsense)}</td>
    ${showPctObjetivo ? `<td>${pct(r.pct_objetivo_profit)}</td><td>${pct(r.pct_objetivo_facturacion)}</td>` : ""}
  </tr>`;
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function render() {
  document.querySelectorAll("#monthSeg button").forEach(b => {
    b.setAttribute("aria-pressed", String(parseMonthValue(b.dataset.month) === state.month));
  });
  const list = rowsForSelection();
  renderKpis(list);
  renderTable(list);
}

// Market-total (vertical='') revenue/cost/profit per month, summed across all markets.
function marketTotalsByMonth() {
  const byMonth = new Map();
  for (const r of rows) {
    if (r.vertical !== "") continue;
    const cur = byMonth.get(r.month) || { revenue: 0, cost: 0, profit: 0 };
    cur.revenue += r.revenue || 0;
    cur.cost += r.cost || 0;
    cur.profit += r.profit || 0;
    byMonth.set(r.month, cur);
  }
  return byMonth;
}

function renderChart() {
  const byMonth = marketTotalsByMonth();
  let labels, revenue, cost, profit;

  if (state.chartGran === "quarter") {
    labels = []; revenue = []; cost = []; profit = [];
    for (const q of Object.keys(QUARTERS)) {
      const months = QUARTERS[q].filter(m => byMonth.has(m));
      if (!months.length) continue;
      labels.push(QUARTER_LABELS[q]);
      revenue.push(months.reduce((s, m) => s + byMonth.get(m).revenue, 0));
      cost.push(months.reduce((s, m) => s + byMonth.get(m).cost, 0));
      profit.push(months.reduce((s, m) => s + byMonth.get(m).profit, 0));
    }
    document.getElementById("chartTitle").textContent = "RESULTADO REAL POR TRIMESTRE (€) — 2026";
  } else {
    const months = [...byMonth.keys()].sort((a, b) => a - b);
    labels = months.map(m => MONTHS[m - 1]);
    revenue = months.map(m => byMonth.get(m).revenue);
    cost = months.map(m => byMonth.get(m).cost);
    profit = months.map(m => byMonth.get(m).profit);
    document.getElementById("chartTitle").textContent = "RESULTADO REAL POR MES (€) — 2026";
  }

  drawChart(labels, revenue, cost, profit);
}

function drawChart(labels, revenue, cost, profit) {
  const box = document.getElementById("resultsChart").parentElement;
  if (typeof Chart === "undefined") {
    box.innerHTML = '<div style="color:var(--ink-soft); font-size:13px; padding:20px;">No se ha podido cargar la librería de gráficos (Chart.js). Los KPIs y la tabla siguen funcionando con normalidad.</div>';
    return;
  }
  const ctx = document.getElementById("resultsChart").getContext("2d");
  const gridColor = getComputedStyle(document.body).getPropertyValue("--line").trim();
  const inkSoft = getComputedStyle(document.body).getPropertyValue("--ink-soft").trim();
  const accent = getComputedStyle(document.body).getPropertyValue("--accent").trim();
  const accentSoft = getComputedStyle(document.body).getPropertyValue("--accent-soft").trim();
  const neg = getComputedStyle(document.body).getPropertyValue("--neg").trim();

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        { type: "bar", label: "Ingresos", data: revenue, backgroundColor: accentSoft, borderColor: accent, borderWidth: 1.5 },
        { type: "bar", label: "Coste", data: cost, backgroundColor: "transparent", borderColor: neg, borderWidth: 1.5 },
        { type: "line", label: "Beneficio", data: profit, borderColor: "#3d7cbf", backgroundColor: "transparent", tension: .25, borderWidth: 2.5 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top", align: "end", labels: { color: inkSoft, boxWidth: 12, font: { family: "IBM Plex Mono", size: 11.5 } } },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${money(c.parsed.y)}` } }
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: inkSoft, font: { family: "IBM Plex Mono", size: 11 } } },
        y: { grid: { color: gridColor }, ticks: { color: inkSoft, font: { family: "IBM Plex Mono", size: 11 }, callback: v => money(v) } }
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
    const { data, error } = await supabase.from("witme_results_monthly").select("*");
    if (error) throw error;
    rows = data;
    if (!rows.length) {
      loadNote.textContent = "No hay resultados cargados.";
      document.getElementById("kpiStrip").style.display = "none";
      return;
    }
    if (state.month == null) {
      const months = [...new Set(rows.map(r => r.month))].sort((a, b) => b - a);
      state.month = months[0];
    }
    renderMonthSeg();
    render();
    renderChart();
    document.getElementById("chartGranSeg").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-gran]");
      if (!btn) return;
      state.chartGran = btn.dataset.gran;
      document.querySelectorAll("#chartGranSeg button").forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
      renderChart();
    });
    loadNote.style.display = "none";
  } catch (err) {
    console.error(err);
    loadNote.textContent = "No se pudieron cargar los datos. Puede que tu cuenta no tenga acceso a este panel — contacta al administrador.";
    loadNote.style.color = "var(--neg)";
  }
}
