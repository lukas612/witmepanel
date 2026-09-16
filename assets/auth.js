import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const loginView = document.getElementById("loginView");
const dashboardView = document.getElementById("dashboardView");
const loginForm = document.getElementById("loginForm");
const loginEmail = document.getElementById("loginEmail");
const loginMsg = document.getElementById("loginMsg");
const loginSubmit = document.getElementById("loginSubmit");
const logoutBtn = document.getElementById("logoutBtn");

function showLogin() {
  loginView.style.display = "flex";
  dashboardView.style.display = "none";
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = loginEmail.value.trim();
  loginSubmit.disabled = true;
  loginMsg.textContent = "Enviando enlace…";
  loginMsg.className = "login-msg";
  const redirectTo = window.location.href.split("#")[0].split("?")[0];
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: redirectTo }
  });
  loginSubmit.disabled = false;
  if (error) {
    loginMsg.textContent = "No se pudo enviar el enlace. Comprueba el correo o contacta al administrador.";
    loginMsg.className = "login-msg error";
  } else {
    loginMsg.textContent = "Revisa tu correo y haz clic en el enlace de acceso.";
    loginMsg.className = "login-msg ok";
  }
});

logoutBtn.addEventListener("click", async () => {
  await supabase.auth.signOut();
});

// Wires up the login/logout screens and calls onSignedIn() whenever a
// session is active (on load and after a fresh sign-in).
export async function initAuth(onSignedIn) {
  function handle(session) {
    if (session) {
      loginView.style.display = "none";
      dashboardView.style.display = "block";
      onSignedIn();
    } else {
      showLogin();
    }
  }
  supabase.auth.onAuthStateChange((_event, session) => handle(session));
  const { data: { session } } = await supabase.auth.getSession();
  handle(session);
}
