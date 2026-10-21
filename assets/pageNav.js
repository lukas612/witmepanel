import { supabase } from "./auth.js";
import { getMyAccess, hasSection } from "./permissions.js";

// `section: null` means always visible to anyone logged in. `section: "admin"`
// means visible only to admins (is_admin in witme_users) -- used for the
// user-management screen itself, which isn't a grantable section.
const GROUPS = [
  {
    label: "Inicio",
    section: null,
    pages: [
      { href: "index.html", label: "Resumen ejecutivo" },
    ],
  },
  {
    label: "Facturación",
    section: "facturacion",
    pages: [
      { href: "facturado.html", label: "Facturado (Holded)" },
      { href: "panama.html", label: "Facturado (Panamá)" },
      { href: "revision.html", label: "Revisión de clientes" },
      { href: "matriz.html", label: "Matriz de clientes" },
      { href: "impagados.html", label: "Impagados" },
    ],
  },
  {
    label: "Objetivos",
    section: "objetivos",
    pages: [
      { href: "objetivos.html", label: "Objetivos" },
      { href: "resultados.html", label: "Resultados" },
      { href: "comparativa.html", label: "Objetivo vs Real" },
    ],
  },
  {
    label: "Viajes",
    section: "viajes",
    pages: [
      { href: "viajes.html", label: "Viajes" },
    ],
  },
  {
    label: "RRHH",
    section: "rrhh",
    pages: [
      { href: "nominas.html", label: "Nóminas" },
    ],
  },
  {
    label: "Estado",
    section: "estado",
    pages: [
      { href: "estado.html", label: "Estado de los datos" },
    ],
  },
  {
    label: "Admin",
    section: "admin",
    pages: [
      { href: "usuarios.html", label: "Usuarios y permisos" },
    ],
  },
];

function currentPage() {
  const path = window.location.pathname;
  return path.substring(path.lastIndexOf("/") + 1) || "index.html";
}

function visibleGroups(access) {
  return GROUPS.filter(g => {
    if (g.section === null) return true;
    if (g.section === "admin") return access.isAdmin;
    return hasSection(access, g.section);
  });
}

function renderPageMenu(groups) {
  const bar = document.getElementById("pageMenuBar");
  if (!bar) return;

  const here = currentPage();

  // A group with a single page renders as a plain link (no dropdown needed).
  bar.innerHTML = groups.map((g, i) => {
    const hasActive = g.pages.some(p => p.href === here);
    if (g.pages.length === 1) {
      return `<a class="page-menu-btn${hasActive ? " current" : ""}" href="${g.pages[0].href}">${g.label}</a>`;
    }
    const links = g.pages.map(p =>
      `<a class="page-link${p.href === here ? " active" : ""}" href="${p.href}">${p.label}</a>`
    ).join("");
    return `
      <div class="page-menu-group">
        <button class="page-menu-btn${hasActive ? " current" : ""}" id="pageMenuBtn${i}" type="button" aria-haspopup="true" aria-expanded="false">${g.label} ▾</button>
        <nav class="page-menu-panel" id="pageMenuPanel${i}" hidden>${links}</nav>
      </div>`;
  }).join("");

  const entries = groups
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => g.pages.length > 1)
    .map(({ i }) => ({
      btn: document.getElementById(`pageMenuBtn${i}`),
      panel: document.getElementById(`pageMenuPanel${i}`),
    }));

  const closeAll = (except) => {
    entries.forEach(({ btn, panel }) => {
      if (panel === except) return;
      panel.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    });
  };

  entries.forEach(({ btn, panel }) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasHidden = panel.hidden;
      closeAll();
      if (wasHidden) {
        panel.hidden = false;
        btn.setAttribute("aria-expanded", "true");
      }
    });
  });
  document.addEventListener("click", (e) => {
    const insideAny = entries.some(({ btn, panel }) => panel.contains(e.target) || e.target === btn);
    if (!insideAny) closeAll();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAll();
  });
}

async function initPageMenu() {
  if (!document.getElementById("pageMenuBar")) return;
  const access = await getMyAccess();
  renderPageMenu(visibleGroups(access));
}

function boot() {
  initPageMenu();
  // A magic-link redirect resolves the session asynchronously after the
  // page has already loaded -- rebuild the nav once that settles so it
  // isn't stuck showing nothing (or the wrong thing) for a first-time login.
  supabase.auth.onAuthStateChange(() => initPageMenu());
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
