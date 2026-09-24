import { supabase, initAuth } from "./auth.js";

const MONTHS = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function daysAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function staleClass(days) {
  if (days >= 20) return "neg";
  if (days >= 10) return "";
  return "pos";
}

function coversLabel(row) {
  if (row.covers_until_year == null || row.covers_until_month == null) return "—";
  return `${MONTHS[row.covers_until_month - 1]} ${row.covers_until_year}`;
}

async function renderAll() {
  const loadNote = document.getElementById("loadNote");
  loadNote.style.display = "block";
  const { data, error } = await supabase.from("witme_data_sources").select("*").order("order_index");
  loadNote.style.display = "none";
  if (error) { console.error(error); return; }

  const body = document.getElementById("sourcesBody");
  const empty = document.getElementById("sourcesEmpty");
  empty.style.display = data.length ? "none" : "block";

  body.innerHTML = data.map(row => {
    const days = daysAgo(row.last_updated_at);
    const agoLabel = days === 0 ? "hoy" : days === 1 ? "hace 1 día" : `hace ${days} días`;
    return `<tr>
      <td style="text-align:left;">${row.label}</td>
      <td style="text-align:left;" class="${staleClass(days)}">${fmtDateTime(row.last_updated_at)} (${agoLabel})</td>
      <td style="text-align:left;">${coversLabel(row)}</td>
      <td style="text-align:left; color:var(--ink-soft); font-size:12.5px;">${row.target_note ? row.target_note : "—"}</td>
    </tr>`;
  }).join("");
}

initAuth(renderAll);
