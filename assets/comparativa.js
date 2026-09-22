import { supabase, initAuth } from "./auth.js";

const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep"];
const MARKET_ORDER = ["España", "Portugal", "Italia", "Rumania", "Polonia", "Alemania", "México", "Colombia", "Brasil", "Affiliate", "Otros"];
const VERTICAL_ORDER = ["", "Deudas", "Creditio", "Instadinero", "Moneya", "Cdirecto", "Creditodirecto", "Smartrata", "Everflow", "Api-partners"];

const money = (n) => n == null ? "—" : n.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const pct = (n) => n == null ? "—" : `${n.toFixed(1)}%`;

const QUARTERS = { q1: [1, 2, 3], q2: [4, 5, 6], q3: [7, 8, 9] };
const QUARTER_LABELS = { q1: "Q1", q2: "Q2", q3: "Q3" };

const state = { month: null, chartGran: "month", metric: "revenue" };
let targetRows = null;
let resultRows = null;
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

function monthsForSelection() {
  if (state.month === "year") return [1,2,3,4,5,6,7,8,9];
  if (state.month in QUARTERS) return QUARTERS[state.month];
  return [state.month];
}

// Aggregate a set of monthly rows (source table) into one row per market/vertical,
// summing revenue/cost and recomputing profit as revenue-cost (never summing each
// row's own profit -- some rows have cost/revenue-only lines with no profit of
// their own).
function aggregateByKey(sourceRows, months) {
  const filtered = sourceRows.filter(r => months.includes(r.month));
  const groups = new Map();
  for (const r of filtered) {
    const key = `${r.market}|||${r.vertical}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const out = new Map();
  for (const [key, group] of groups) {
    const sum = (field) => {
      const vals = group.map(r => r[field]).filter(v => v != null);
      return vals.length ? vals.reduce((a, b) => a + Number(b), 0) : null;
    };
    const revenue = sum("revenue");
    const cost = sum("cost");
    const profit = (revenue != null || cost != null) ? (revenue || 0) - (cost || 0) : null;
    out.set(key, {
      market: group[0].market,
      vertical: group[0].vertical,
      responsable: group[0].responsable,
      revenue, cost, profit,
    });
  }
  return out;
}

function combinedRows() {
  const months = monthsForSelection();
  const targets = aggregateByKey(targetRows, months);
  const results = aggregateByKey(resultRows, months);

  const keys = new Set([...targets.keys(), ...results.keys()]);
  const rows = [];
  for (const key of keys) {
    const t = targets.get(key);
    const r = results.get(key);
    const base = r || t;
    const pctRevenue = (t && t.revenue) ? (r ? (r.revenue || 0) / t.revenue * 100 : 0) : null;
    const pctProfit = (t && t.profit) ? (r ? (r.profit || 0) / t.profit * 100 : 0) : null;
    rows.push({
      market: base.market,
      vertical: base.vertical,
      responsable: (r && r.responsable) || (t && t.responsable) || null,
      obj_revenue: t ? t.revenue : null,
      real_revenue: r ? r.revenue : null,
      pct_revenue: pctRevenue,
      obj_profit: t ? t.profit : null,
      real_profit: r ? r.profit : null,
      pct_profit: pctProfit,
    });
  }
  return rows;
}

function renderKpis(rows) {
  const marketTotals = rows.filter(r => r.vertical === "");
  const objRevenue = marketTotals.reduce((s, r) => s + (r.obj_revenue || 0), 0);
  const realRevenue = marketTotals.reduce((s, r) => s + (r.real_revenue || 0), 0);
  const objProfit = marketTotals.reduce((s, r) => s + (r.obj_profit || 0), 0);
  const realProfit = marketTotals.reduce((s, r) => s + (r.real_profit || 0), 0);
  const pctRevenue = objRevenue ? (realRevenue / objRevenue * 100) : null;
  const pctProfit = objProfit ? (realProfit / objProfit * 100) : null;

  const strip = document.getElementById("kpiStrip");
  strip.style.display = "grid";
  strip.innerHTML = `
    <div class="kpi"><div class="label">INGRESOS REALES</div><div class="value">${money(realRevenue)}</div><div class="foot">objetivo ${money(objRevenue)}</div></div>
    <div class="kpi"><div class="label">% CUMPLIMIENTO INGRESOS</div><div class="value ${pctRevenue != null && pctRevenue < 100 ? "neg" : "pos"}">${pct(pctRevenue)}</div><div class="foot">real / objetivo</div></div>
    <div class="kpi"><div class="label">BENEFICIO REAL</div><div class="value ${realProfit < 0 ? "neg" : "pos"}">${money(realProfit)}</div><div class="foot">objetivo ${money(objProfit)}</div></div>
    <div class="kpi"><div class="label">% CUMPLIMIENTO BENEFICIO</div><div class="value ${pctProfit != null && pctProfit < 100 ? "neg" : "pos"}">${pct(pctProfit)}</div><div class="foot">real / objetivo</div></div>
  `;
}

function renderTable(rows) {
  const head = document.getElementById("cmpHead");
  head.innerHTML = `
    <th style="text-align:left;">Mercado</th>
    <th style="text-align:left;">Vertical</th>
    <th style="text-align:left;">Responsable</th>
    <th>Ingresos obj.</th>
    <th>Ingresos real</th>
    <th>% cumpl.</th>
    <th>Beneficio obj.</th>
    <th>Beneficio real</th>
    <th>% cumpl.</th>
  `;

  const byMarket = new Map();
  for (const r of rows) {
    if (!byMarket.has(r.market)) byMarket.set(r.market, []);
    byMarket.get(r.market).push(r);
  }
  const markets = [...byMarket.keys()].sort((a, b) => marketSortKey(a) - marketSortKey(b));

  let bodyHtml = "";
  const grand = { objRevenue: 0, realRevenue: 0, objProfit: 0, realProfit: 0 };

  for (const market of markets) {
    const items = byMarket.get(market).sort((a, b) => verticalSortKey(a.vertical) - verticalSortKey(b.vertical));
    const totalRow = items.find(r => r.vertical === "");
    const verticalRows = items.filter(r => r.vertical !== "");

    if (totalRow) {
      grand.objRevenue += totalRow.obj_revenue || 0;
      grand.realRevenue += totalRow.real_revenue || 0;
      grand.objProfit += totalRow.obj_profit || 0;
      grand.realProfit += totalRow.real_profit || 0;
      bodyHtml += rowHtml(totalRow, "market-row", "Total");
    }
    for (const r of verticalRows) {
      bodyHtml += rowHtml(r, "vertical-row", null);
    }
  }

  document.getElementById("cmpBody").innerHTML = bodyHtml;

  const grandPctRevenue = grand.objRevenue ? (grand.realRevenue / grand.objRevenue * 100) : null;
  const grandPctProfit = grand.objProfit ? (grand.realProfit / grand.objProfit * 100) : null;
  const foot = document.getElementById("cmpFoot");
  foot.innerHTML = `
    <td style="text-align:left;">Total</td>
    <td style="text-align:left;"></td>
    <td style="text-align:left;"></td>
    <td>${money(grand.objRevenue)}</td>
    <td>${money(grand.realRevenue)}</td>
    <td class="${grandPctRevenue != null && grandPctRevenue < 100 ? "neg" : "pos"}">${pct(grandPctRevenue)}</td>
    <td>${money(grand.objProfit)}</td>
    <td class="${grand.realProfit < 0 ? "neg" : "pos"}">${money(grand.realProfit)}</td>
    <td class="${grandPctProfit != null && grandPctProfit < 100 ? "neg" : "pos"}">${pct(grandPctProfit)}</td>
  `;
}

function rowHtml(r, rowClass, verticalLabel) {
  return `<tr class="${rowClass}">
    <td style="text-align:left;">${rowClass === "market-row" ? escapeHtml(r.market) : ""}</td>
    <td style="text-align:left;">${escapeHtml(verticalLabel || r.vertical)}</td>
    <td style="text-align:left;">${escapeHtml(r.responsable || "—")}</td>
    <td>${money(r.obj_revenue)}</td>
    <td>${money(r.real_revenue)}</td>
    <td class="${r.pct_revenue != null && r.pct_revenue < 100 ? "neg" : (r.pct_revenue != null ? "pos" : "")}">${pct(r.pct_revenue)}</td>
    <td>${money(r.obj_profit)}</td>
    <td class="${(r.real_profit || 0) < 0 ? "neg" : (r.real_profit ? "pos" : "")}">${money(r.real_profit)}</td>
    <td class="${r.pct_profit != null && r.pct_profit < 100 ? "neg" : (r.pct_profit != null ? "pos" : "")}">${pct(r.pct_profit)}</td>
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
  const rows = combinedRows();
  renderKpis(rows);
  renderTable(rows);
}

// Market-total (vertical='') revenue/profit per month, summed across all markets, for one source table.
function marketTotalsByMonth(sourceRows) {
  const byMonth = new Map();
  for (const r of sourceRows) {
    if (r.vertical !== "") continue;
    const cur = byMonth.get(r.month) || { revenue: 0, profit: 0 };
    cur.revenue += r.revenue || 0;
    cur.profit += r.profit || 0;
    byMonth.set(r.month, cur);
  }
  return byMonth;
}

function seriesFor(byMonth, field, granularity) {
  if (granularity === "quarter") {
    const labels = [], values = [];
    for (const q of Object.keys(QUARTERS)) {
      const months = QUARTERS[q].filter(m => byMonth.has(m));
      if (!months.length) continue;
      labels.push(QUARTER_LABELS[q]);
      values.push(months.reduce((s, m) => s + byMonth.get(m)[field], 0));
    }
    return { labels, values };
  }
  const months = [...byMonth.keys()].sort((a, b) => a - b);
  return { labels: months.map(m => MONTHS[m - 1]), values: months.map(m => byMonth.get(m)[field]) };
}

function renderChart() {
  const objByMonth = marketTotalsByMonth(targetRows);
  const realByMonth = marketTotalsByMonth(resultRows);
  const obj = seriesFor(objByMonth, state.metric, state.chartGran);
  const real = seriesFor(realByMonth, state.metric, state.chartGran);
  // Real covers more months/markets than Objetivo; use Real's labels (the fuller set) and
  // look up Objetivo's value per label (missing = null, not 0).
  const objByLabel = new Map(obj.labels.map((l, i) => [l, obj.values[i]]));
  const objAligned = real.labels.map(l => objByLabel.has(l) ? objByLabel.get(l) : null);

  const metricLabel = state.metric === "profit" ? "BENEFICIO" : "INGRESOS";
  const granLabel = state.chartGran === "quarter" ? "TRIMESTRE" : "MES";
  document.getElementById("chartTitle").textContent = `${metricLabel} — OBJETIVO VS REAL POR ${granLabel} (€) — 2026`;

  drawChart(real.labels, objAligned, real.values);
}

function drawChart(labels, objetivo, real) {
  const box = document.getElementById("cmpChart").parentElement;
  if (typeof Chart === "undefined") {
    box.innerHTML = '<div style="color:var(--ink-soft); font-size:13px; padding:20px;">No se ha podido cargar la librería de gráficos (Chart.js). Los KPIs y la tabla siguen funcionando con normalidad.</div>';
    return;
  }
  const ctx = document.getElementById("cmpChart").getContext("2d");
  const gridColor = getComputedStyle(document.body).getPropertyValue("--line").trim();
  const inkSoft = getComputedStyle(document.body).getPropertyValue("--ink-soft").trim();
  const accent = getComputedStyle(document.body).getPropertyValue("--accent").trim();

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        { type: "bar", label: "Objetivo", data: objetivo, backgroundColor: "transparent", borderColor: inkSoft, borderWidth: 1.5, borderDash: [4, 3] },
        { type: "bar", label: "Real", data: real, backgroundColor: accent + "33", borderColor: accent, borderWidth: 1.5 }
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
    const [{ data: targets, error: tErr }, { data: results, error: rErr }] = await Promise.all([
      supabase.from("witme_targets_monthly").select("*"),
      supabase.from("witme_results_monthly").select("*"),
    ]);
    if (tErr) throw tErr;
    if (rErr) throw rErr;
    targetRows = targets;
    resultRows = results;
    if (!resultRows.length) {
      loadNote.textContent = "No hay datos cargados.";
      document.getElementById("kpiStrip").style.display = "none";
      return;
    }
    if (state.month == null) {
      const months = [...new Set(resultRows.map(r => r.month))].sort((a, b) => b - a);
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
    document.getElementById("metricSeg").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-metric]");
      if (!btn) return;
      state.metric = btn.dataset.metric;
      document.querySelectorAll("#metricSeg button").forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
      renderChart();
    });
    loadNote.style.display = "none";
  } catch (err) {
    console.error(err);
    loadNote.textContent = "No se pudieron cargar los datos. Puede que tu cuenta no tenga acceso a este panel — contacta al administrador.";
    loadNote.style.color = "var(--neg)";
  }
}
