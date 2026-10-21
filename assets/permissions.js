import { supabase } from "./auth.js";

const SECTION_KEYS = ["facturacion", "objetivos", "viajes", "estado"];

let cached = null; // { isAdmin, sections: Set<string> } | null

// Resolves once per page load, after a session exists. Reads only the
// caller's own rows in witme_users/witme_section_access (that's all RLS
// allows a non-admin to see), so this never leaks anyone else's grants.
export async function getMyAccess() {
  if (cached) return cached;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { cached = { isAdmin: false, sections: new Set() }; return cached; }

  const [{ data: userRow }, { data: accessRows }] = await Promise.all([
    supabase.from("witme_users").select("is_admin").eq("email", session.user.email).maybeSingle(),
    supabase.from("witme_section_access").select("section_key").eq("email", session.user.email),
  ]);

  cached = {
    isAdmin: !!userRow?.is_admin,
    sections: new Set((accessRows || []).map(r => r.section_key)),
  };
  return cached;
}

export function hasSection(access, section) {
  return access.isAdmin || access.sections.has(section);
}

export { SECTION_KEYS };
