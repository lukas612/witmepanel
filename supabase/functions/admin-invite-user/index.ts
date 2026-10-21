// Invites a new teammate into Supabase Auth so they can sign in with the
// panel's magic-link flow (which uses shouldCreateUser: false -- a person
// who doesn't already exist in auth.users can never get a link that way).
// Creating an auth user needs the service-role key, which the browser can
// never hold, so that one step lives here; everything else (the
// witme_users / witme_section_access rows) is written directly by the
// admin page's own client, since RLS already lets Lukas write those.
//
// Caller must be one of Lukas's own accounts (checked from their Supabase
// session JWT) -- same ALLOWED_EMAILS pattern as ebipac-panama-sync, but
// narrower: this is the two admin emails only, not the whole team.
//
// POST body: { email: string, redirectTo?: string }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_EMAILS = ["lukas@witme.es", "lukas@lukasochoa.com"];
const DEFAULT_REDIRECT = "https://lukas612.github.io/witmepanel/index.html";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

function callerEmail(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.email ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const callerEmailValue = callerEmail(req);
    if (!callerEmailValue || !ALLOWED_EMAILS.includes(callerEmailValue)) {
      return new Response(JSON.stringify({ error: "No autorizado." }), { status: 403, headers: { "content-type": "application/json", ...CORS_HEADERS } });
    }

    const body = await req.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const redirectTo = typeof body?.redirectTo === "string" && body.redirectTo ? body.redirectTo : DEFAULT_REDIRECT;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ error: "Email no válido." }), { status: 400, headers: { "content-type": "application/json", ...CORS_HEADERS } });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });

    if (inviteErr) {
      // Already-registered is not a failure for this flow: the caller just
      // wants "this person can sign in with these permissions", and if the
      // auth user already exists that part is already satisfied.
      const alreadyExists = /already.*registered|already.*exist/i.test(inviteErr.message || "");
      if (!alreadyExists) {
        return new Response(JSON.stringify({ error: inviteErr.message }), { status: 400, headers: { "content-type": "application/json", ...CORS_HEADERS } });
      }
      return new Response(JSON.stringify({ ok: true, alreadyExisted: true }), { headers: { "content-type": "application/json", ...CORS_HEADERS } });
    }

    return new Response(JSON.stringify({ ok: true, alreadyExisted: false }), { headers: { "content-type": "application/json", ...CORS_HEADERS } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500, headers: { "content-type": "application/json", ...CORS_HEADERS } });
  }
});
