import { supabase, initAuth } from "./auth.js";
import { SUPABASE_URL } from "./config.js";

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const money = (n) => n == null ? "—" : Number(n).toLocaleString("es-ES", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtDateTime = (iso) => new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

// Accepts either a raw "Cookie" header value or a full "Copy as cURL" command
// pasted from DevTools, and pulls out just the cookie string either way.
function extractCookie(raw) {
  const trimmed = raw.trim();
  const curlMatch = trimmed.match(/-H\s+['"]cookie:\s*([^'"]+)['"]/i) || trimmed.match(/--cookie\s+['"]([^'"]+)['"]/i);
  if (curlMatch) return curlMatch[1].trim();
  return trimmed;
}

async function renderAll() {
  const loadNote = document.getElementById("loadNote");
  loadNote.style.display = "block";
  const { data, error } = await supabase.from("witme_panama_invoiced_monthly").select("*").order("year").order("month");
  loadNote.style.display = "none";
  if (error) { console.error(error); return; }

  const body = document.getElementById("panamaBody");
  const empty = document.getElementById("panamaEmpty");
  empty.style.display = data.length ? "none" : "block";

  body.innerHTML = data.map(r => `<tr>
    <td style="text-align:left;">${MONTHS[r.month - 1]} ${r.year}</td>
    <td>${money(r.invoiced_total)}</td>
    <td>${r.invoice_count}</td>
    <td>${r.credit_count}</td>
    <td style="text-align:left;">${fmtDateTime(r.last_pulled_at)}</td>
  </tr>`).join("");

  const total = data.reduce((s, r) => s + Number(r.invoiced_total), 0);
  const lastPulled = data.reduce((max, r) => !max || r.last_pulled_at > max ? r.last_pulled_at : max, null);

  document.getElementById("kpiStrip").innerHTML = `
    <div class="kpi"><div class="label">FACTURADO TOTAL</div><div class="value">${money(total)}</div><div class="foot">${data.length} mes${data.length === 1 ? "" : "es"} con datos</div></div>
    <div class="kpi"><div class="label">ÚLTIMA ACTUALIZACIÓN</div><div class="value" style="font-size:16px;">${lastPulled ? fmtDateTime(lastPulled) : "—"}</div><div class="foot">manual, vía EBI-PAC</div></div>
  `;
}

initAuth(renderAll);

document.getElementById("syncBtn").addEventListener("click", async () => {
  const msg = document.getElementById("syncMsg");
  const btn = document.getElementById("syncBtn");
  const raw = document.getElementById("cookieInput").value;
  const cookie = extractCookie(raw);
  if (!cookie) {
    msg.textContent = "Pega la cookie o el comando cURL primero.";
    msg.className = "form-msg error";
    return;
  }

  btn.disabled = true;
  msg.textContent = "Actualizando… puede tardar unos segundos.";
  msg.className = "form-msg";

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/ebipac-panama-sync`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ cookie }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

    const months = json.monthsUpdated || [];
    msg.textContent = `Listo: ${json.documentsFetched} documentos, ${months.length} mes(es) actualizado(s).`;
    msg.className = "form-msg ok";
    document.getElementById("cookieInput").value = "";
    await renderAll();
  } catch (err) {
    console.error(err);
    msg.textContent = `No se pudo actualizar: ${err.message}`;
    msg.className = "form-msg error";
  } finally {
    btn.disabled = false;
  }
});
