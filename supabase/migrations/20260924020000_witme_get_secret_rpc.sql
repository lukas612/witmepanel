-- Exposes a single Vault secret to callers with service_role (e.g. Edge
-- Functions using the service-role key), since vault.decrypted_secrets
-- itself is not reachable through the PostgREST API (the "vault" schema
-- isn't in its exposed-schema list). Used by holded-daily-sync to read
-- holded_api_key without needing a direct Postgres connection.

create or replace function public.witme_get_secret(secret_name text)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = secret_name;
  return v_secret;
end;
$$;

revoke all on function public.witme_get_secret(text) from public, anon, authenticated;
grant execute on function public.witme_get_secret(text) to service_role;
