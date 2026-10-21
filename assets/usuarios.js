import { supabase, initAuth } from "./auth.js";
import { SUPABASE_URL } from "./config.js";
import { getMyAccess } from "./permissions.js";

const SECTIONS = [
  { key: "facturacion", label: "Facturación" },
  { key: "objetivos", label: "Objetivos" },
  { key: "viajes", label: "Viajes" },
  { key: "estado", label: "Estado" },
];

let users = [], access = [];

initAuth(renderAll);

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s == null ? "" : s;
  return div.innerHTML;
}

async function fetchAll() {
  const [{ data: u, error: uErr }, { data: a, error: aErr }] = await Promise.all([
    supabase.from("witme_users").select("*").order("display_name"),
    supabase.from("witme_section_access").select("*"),
  ]);
  if (uErr) throw uErr;
  if (aErr) throw aErr;
  users = u; access = a;
}

function sectionsFor(email) {
  return new Set(access.filter(a => a.email === email).map(a => a.section_key));
}

async function toggleSection(email, sectionKey, checked) {
  if (checked) {
    const { error } = await supabase.from("witme_section_access").upsert({ email, section_key: sectionKey });
    if (error) { alert("No se pudo guardar."); console.error(error); return false; }
  } else {
    const { error } = await supabase.from("witme_section_access").delete().eq("email", email).eq("section_key", sectionKey);
    if (error) { alert("No se pudo guardar."); console.error(error); return false; }
  }
  return true;
}

async function toggleAdmin(email, isAdmin) {
  const { error } = await supabase.from("witme_users").update({ is_admin: isAdmin }).eq("email", email);
  if (error) { alert("No se pudo guardar."); console.error(error); return false; }
  return true;
}

async function revokeUser(email) {
  if (!confirm(`¿Revocar el acceso de ${email}? Dejará de poder ver cualquier sección del panel (su cuenta no se borra de Supabase, solo pierde los permisos).`)) return;
  const { error } = await supabase.from("witme_users").delete().eq("email", email);
  if (error) { alert("No se pudo revocar."); console.error(error); return; }
  users = users.filter(u => u.email !== email);
  access = access.filter(a => a.email !== email);
  renderUsersTable();
}

function renderUsersTable() {
  const body = document.getElementById("usersBody");
  body.innerHTML = users.map(u => {
    const granted = sectionsFor(u.email);
    const sectionCells = SECTIONS.map(s => `
      <td class="section-cell">
        <input type="checkbox" data-email="${escapeHtml(u.email)}" data-section="${s.key}" ${granted.has(s.key) ? "checked" : ""} ${u.is_admin ? "disabled title='Ya tiene acceso a todo (administrador)'" : ""}>
      </td>`).join("");
    return `<tr>
      <td style="text-align:left;">${escapeHtml(u.display_name || "—")}</td>
      <td style="text-align:left;">${escapeHtml(u.email)}</td>
      ${sectionCells}
      <td class="section-cell"><input type="checkbox" data-admin-email="${escapeHtml(u.email)}" ${u.is_admin ? "checked" : ""}></td>
      <td><button class="btn-icon-delete" data-revoke-email="${escapeHtml(u.email)}" title="Revocar acceso">🗑</button></td>
    </tr>`;
  }).join("");
}

document.getElementById("usersBody").addEventListener("change", async (e) => {
  const sectionBox = e.target.closest("input[data-section]");
  const adminBox = e.target.closest("input[data-admin-email]");
  if (sectionBox) {
    const ok = await toggleSection(sectionBox.dataset.email, sectionBox.dataset.section, sectionBox.checked);
    if (!ok) { sectionBox.checked = !sectionBox.checked; return; }
    const u = users.find(u => u.email === sectionBox.dataset.email);
    if (u) {
      if (sectionBox.checked) access.push({ email: u.email, section_key: sectionBox.dataset.section });
      else access = access.filter(a => !(a.email === u.email && a.section_key === sectionBox.dataset.section));
    }
  } else if (adminBox) {
    const ok = await toggleAdmin(adminBox.dataset.adminEmail, adminBox.checked);
    if (!ok) { adminBox.checked = !adminBox.checked; return; }
    const u = users.find(u => u.email === adminBox.dataset.adminEmail);
    if (u) u.is_admin = adminBox.checked;
    renderUsersTable();
  }
});

document.getElementById("usersBody").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-revoke-email]");
  if (btn) revokeUser(btn.dataset.revokeEmail);
});

document.getElementById("inviteBtn").addEventListener("click", async () => {
  const msg = document.getElementById("inviteMsg");
  const btn = document.getElementById("inviteBtn");
  const email = document.getElementById("newEmail").value.trim().toLowerCase();
  const displayName = document.getElementById("newName").value.trim();
  const isAdmin = document.getElementById("newIsAdmin").checked;
  const selectedSections = [...document.querySelectorAll("#newSections input:checked")].map(i => i.value);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    msg.textContent = "Introduce un email válido.";
    msg.className = "form-msg error";
    return;
  }

  btn.disabled = true;
  msg.className = "form-msg";
  msg.textContent = "Invitando…";
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const redirectTo = new URL("index.html", window.location.href).href;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-invite-user`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, redirectTo }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

    const { error: userErr } = await supabase.from("witme_users")
      .upsert({ email, display_name: displayName || null, is_admin: isAdmin });
    if (userErr) throw userErr;

    await supabase.from("witme_section_access").delete().eq("email", email);
    if (selectedSections.length) {
      const { error: secErr } = await supabase.from("witme_section_access")
        .insert(selectedSections.map(section_key => ({ email, section_key })));
      if (secErr) throw secErr;
    }

    msg.textContent = json.alreadyExisted ? "Ya tenía cuenta — permisos actualizados." : "Invitación enviada.";
    msg.className = "form-msg ok";
    document.getElementById("newEmail").value = "";
    document.getElementById("newName").value = "";
    document.getElementById("newIsAdmin").checked = false;
    document.querySelectorAll("#newSections input").forEach(i => { i.checked = false; });

    await fetchAll();
    renderUsersTable();
  } catch (err) {
    console.error(err);
    msg.textContent = `No se pudo invitar: ${err.message || err}`;
    msg.className = "form-msg error";
  } finally {
    btn.disabled = false;
  }
});

async function renderAll() {
  const loadNote = document.getElementById("loadNote");
  const pageBody = document.getElementById("pageBody");
  const myAccess = await getMyAccess();
  if (!myAccess.isAdmin) {
    pageBody.style.display = "none";
    loadNote.style.display = "block";
    loadNote.textContent = "Esta pantalla es solo para administradores.";
    loadNote.style.color = "var(--neg)";
    return;
  }

  loadNote.style.display = "block";
  loadNote.textContent = "Cargando datos…";
  loadNote.style.color = "";
  try {
    await fetchAll();
    renderUsersTable();
    loadNote.style.display = "none";
  } catch (err) {
    console.error(err);
    loadNote.textContent = "No se pudieron cargar los datos.";
    loadNote.style.color = "var(--neg)";
  }
}
