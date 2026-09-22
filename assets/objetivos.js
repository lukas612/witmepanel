import { supabase, initAuth } from "./auth.js";

const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep"];
const MARKET_ORDER = ["España", "Portugal", "Italia", "Rumania", "Polonia", "Alemania", "México"];
const VERTICAL_ORDER = ["", "Deudas", "Creditio", "Instadinero", "Moneya", "Cdirecto"];

const money = (n) => n == null ? "—" : n.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const pct = (n) => n == null ? "—" : `${n.toFixed(1)}%`;

const state = { month: null }; // 1-9, or "year" for full-year accumulation
let rows = null;

initAuth(renderAll);

function renderMonthSeg() {
  const seg = document.getElementById("monthSeg");
  const buttons = MONTHS.map((m, i) => `<button data-month="${i + 1}" aria-pressed="${state.month === i + 1}">${m}</button>`);
  buttons.push(`<button data-month="year" aria-pressed="${state.month === "year"}">Año completo</button>`);
  seg.innerHTML = buttons.join("");
  seg.querySelectorAll("button").forEach(b => {
    b.addEventListener("click", () => {
      state.month = b.dataset.month === "year" ? "year" : Number(b.dataset.month);
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
  const revenueCampaigns = sum("revenue_campaigns");
  const revenueMonetization = sum("revenue_monetization");
  return {
    market: group[0].market,
    vertical: group[0].vertical,
    responsable: group[0].responsable,
    revenue, cost, profit,
    roi_pct: (cost != null && cost !== 0 && profit != null) ? (profit / cost * 100) : null,
    revenue_campaigns: revenueCampaigns,
    revenue_monetization: revenueMonetization,
    roi_campaigns_pct: null // averaging/summing a % across months isn't meaningful; shown as "—"
  };
}

function rowsForSelection() {
  if (state.month === "year") {
    const groups = new Map();
    for (const r of rows) {
      const key = `${r.market}|||${r.vertical}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    return [...groups.values()].map(accumulate);
  }
  return rows.filter(r => r.month === state.month);
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
    <div class="kpi"><div class="label">INGRESOS OBJETIVO</div><div class="value">${money(revenue)}</div><div class="foot">${marketTotals.length} mercados</div></div>
    <div class="kpi"><div class="label">COSTE OBJETIVO</div><div class="value">${money(cost)}</div><div class="foot">objetivo del periodo</div></div>
    <div class="kpi"><div class="label">BENEFICIO OBJETIVO</div><div class="value ${profit < 0 ? "neg" : "pos"}">${money(profit)}</div><div class="foot">margen ${revenue ? (profit / revenue * 100).toFixed(1) + "%" : "—"}</div></div>
    <div class="kpi"><div class="label">ROI OBJETIVO</div><div class="value ${roi != null && roi < 0 ? "neg" : "pos"}">${pct(roi)}</div><div class="foot">beneficio / coste</div></div>
  `;
}

function renderTable(list) {
  const showCampaigns = state.month === "year" || state.month >= 4;

  const head = document.getElementById("targetsHead");
  head.innerHTML = `
    <th style="text-align:left;">Mercado</th>
    <th style="text-align:left;">Vertical</th>
    <th style="text-align:left;">Responsable</th>
    <th>Ingresos</th>
    <th>Coste</th>
    <th>Beneficio</th>
    <th>ROI</th>
    ${showCampaigns ? `<th>Ing. campañas</th><th>Ing. monetización</th><th>ROI campañas</th>` : ""}
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
      bodyHtml += marketRowHtml(totalRow, showCampaigns);
    }
    for (const r of verticalRows) {
      bodyHtml += verticalRowHtml(r, showCampaigns);
    }
  }

  document.getElementById("targetsBody").innerHTML = bodyHtml;

  const grandRoi = grand.cost ? (grand.profit / grand.cost * 100) : null;
  const foot = document.getElementById("targetsFoot");
  foot.innerHTML = `
    <td style="text-align:left;">Total</td>
    <td style="text-align:left;"></td>
    <td style="text-align:left;"></td>
    <td>${money(grand.revenue)}</td>
    <td>${money(grand.cost)}</td>
    <td class="${grand.profit < 0 ? "neg" : "pos"}">${money(grand.profit)}</td>
    <td class="${grandRoi != null && grandRoi < 0 ? "neg" : "pos"}">${pct(grandRoi)}</td>
    ${showCampaigns ? `<td></td><td></td><td></td>` : ""}
  `;
}

function marketRowHtml(r, showCampaigns) {
  return `<tr class="market-row">
    <td style="text-align:left;">${escapeHtml(r.market)}</td>
    <td style="text-align:left;">Total</td>
    <td style="text-align:left;"></td>
    <td>${money(r.revenue)}</td>
    <td>${money(r.cost)}</td>
    <td class="${(r.profit || 0) < 0 ? "neg" : "pos"}">${money(r.profit)}</td>
    <td class="${r.roi_pct != null && r.roi_pct < 0 ? "neg" : "pos"}">${pct(r.roi_pct)}</td>
    ${showCampaigns ? `<td>${money(r.revenue_campaigns)}</td><td>${money(r.revenue_monetization)}</td><td class="${r.roi_campaigns_pct != null && r.roi_campaigns_pct < 0 ? "neg" : ""}">${pct(r.roi_campaigns_pct)}</td>` : ""}
  </tr>`;
}

function verticalRowHtml(r, showCampaigns) {
  return `<tr class="vertical-row">
    <td style="text-align:left;"></td>
    <td style="text-align:left;">${escapeHtml(r.vertical)}</td>
    <td style="text-align:left;">${escapeHtml(r.responsable || "—")}</td>
    <td>${money(r.revenue)}</td>
    <td>${money(r.cost)}</td>
    <td class="${(r.profit || 0) < 0 ? "neg" : (r.profit ? "pos" : "")}">${money(r.profit)}</td>
    <td class="${r.roi_pct != null && r.roi_pct < 0 ? "neg" : ""}">${pct(r.roi_pct)}</td>
    ${showCampaigns ? `<td>${money(r.revenue_campaigns)}</td><td>${money(r.revenue_monetization)}</td><td class="${r.roi_campaigns_pct != null && r.roi_campaigns_pct < 0 ? "neg" : ""}">${pct(r.roi_campaigns_pct)}</td>` : ""}
  </tr>`;
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function render() {
  document.querySelectorAll("#monthSeg button").forEach(b => {
    const val = b.dataset.month === "year" ? "year" : Number(b.dataset.month);
    b.setAttribute("aria-pressed", String(val === state.month));
  });
  const list = rowsForSelection();
  renderKpis(list);
  renderTable(list);
}

async function renderAll() {
  const loadNote = document.getElementById("loadNote");
  loadNote.style.display = "block";
  loadNote.textContent = "Cargando datos…";
  loadNote.style.color = "";
  try {
    const { data, error } = await supabase.from("witme_targets_monthly").select("*");
    if (error) throw error;
    rows = data;
    if (!rows.length) {
      loadNote.textContent = "No hay objetivos cargados.";
      document.getElementById("kpiStrip").style.display = "none";
      return;
    }
    if (state.month == null) {
      const months = [...new Set(rows.map(r => r.month))].sort((a, b) => b - a);
      state.month = months[0];
    }
    renderMonthSeg();
    render();
    loadNote.style.display = "none";
  } catch (err) {
    console.error(err);
    loadNote.textContent = "No se pudieron cargar los datos. Puede que tu cuenta no tenga acceso a este panel — contacta al administrador.";
    loadNote.style.color = "var(--neg)";
  }
}
