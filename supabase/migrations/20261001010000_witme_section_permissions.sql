-- Per-person, per-main-menu access control. Replaces the single hardcoded
-- "witme team" email array (identical across every table) with a real
-- permissions table, so Lukas can grant/revoke each of the 4 gated
-- sections (facturacion/objetivos/viajes/estado) independently per person.
-- Nóminas is NOT part of this system -- it stays hardcoded to Lukas's own
-- two accounts, same as before, on purpose (extra-sensitive, never meant
-- to be toggleable from this admin screen).

create table if not exists public.witme_users (
  email text primary key,
  display_name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.witme_section_access (
  email text not null references public.witme_users(email) on delete cascade,
  section_key text not null check (section_key in ('facturacion', 'objetivos', 'viajes', 'estado')),
  primary key (email, section_key)
);

alter table public.witme_users enable row level security;
alter table public.witme_section_access enable row level security;

-- Managing users/permissions is restricted exactly like Nóminas: hardcoded
-- to Lukas's own accounts, never to the is_admin flag this table defines
-- itself (a self-referential check would let someone bootstrap their own
-- admin access by writing to this table in the first place).
create policy "solo lukas gestiona usuarios" on public.witme_users
  for all to authenticated
  using ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com']))
  with check ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com']));

create policy "un usuario puede leer su propia fila" on public.witme_users
  for select to authenticated
  using (email = auth.jwt() ->> 'email');

create policy "solo lukas gestiona permisos" on public.witme_section_access
  for all to authenticated
  using ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com']))
  with check ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com']));

create policy "un usuario puede leer sus propios permisos" on public.witme_section_access
  for select to authenticated
  using (email = auth.jwt() ->> 'email');

-- Used inside every gated table's own RLS policy below: true for admins,
-- or for someone explicitly granted that section. Not security definer --
-- the subquery only ever touches the caller's own row, which the two
-- "puede leer su propia fila/sus propios permisos" policies above already
-- allow, so ordinary invoker rights are enough.
create or replace function public.witme_has_access(sec text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.witme_users u where u.email = auth.jwt() ->> 'email' and u.is_admin
  ) or exists (
    select 1 from public.witme_section_access a where a.email = auth.jwt() ->> 'email' and a.section_key = sec
  );
$$;

-- True for anyone registered in the panel at all, regardless of which
-- sections they have -- for shared reference tables (fx rates, year
-- config) that every page may need as a side dependency.
create or replace function public.witme_is_registered()
returns boolean
language sql
stable
as $$
  select exists (select 1 from public.witme_users u where u.email = auth.jwt() ->> 'email');
$$;

-- Seed today's 4 real accounts, preserving their current (full) access as
-- the starting point -- Lukas can then narrow things from the new admin
-- screen. Lukas's two emails are admins (bypass every section check).
insert into public.witme_users (email, display_name, is_admin) values
  ('lukas@witme.es', 'Lukas', true),
  ('lukas@lukasochoa.com', 'Lukas', true),
  ('gferreyra@witme.es', 'Gisel', false),
  ('freddy@witme.es', 'Freddy', false)
on conflict (email) do nothing;

insert into public.witme_section_access (email, section_key)
select u.email, s.section_key
from (values ('gferreyra@witme.es'), ('freddy@witme.es')) as u(email)
cross join (values ('facturacion'), ('objetivos'), ('viajes'), ('estado')) as s(section_key)
on conflict do nothing;

-- Facturación
alter policy "witme team can read alert reviews" on public.witme_client_alert_reviews
  using (witme_has_access('facturacion'));
alter policy "witme team can write alert reviews" on public.witme_client_alert_reviews
  using (witme_has_access('facturacion')) with check (witme_has_access('facturacion'));
alter policy "witme team can read client_invoiced_monthly" on public.witme_client_invoiced_monthly
  using (witme_has_access('facturacion'));
alter policy "witme team can read invoiced_monthly" on public.witme_invoiced_monthly
  using (witme_has_access('facturacion'));
alter policy "witme team can read panama invoiced" on public.witme_panama_invoiced_monthly
  using (witme_has_access('facturacion'));
alter policy "witme team can read pnl_monthly" on public.witme_pnl_monthly
  using (witme_has_access('facturacion'));
alter policy "witme team can read purchased_monthly" on public.witme_purchased_monthly
  using (witme_has_access('facturacion'));
alter policy "witme team can read unpaid invoices" on public.witme_unpaid_invoices
  using (witme_has_access('facturacion'));

-- Objetivos
alter policy "witme team can read results" on public.witme_results_monthly
  using (witme_has_access('objetivos'));
alter policy "witme team can read targets" on public.witme_targets_monthly
  using (witme_has_access('objetivos'));

-- Viajes
alter policy "witme team can manage trip clients" on public.witme_trip_clients
  using (witme_has_access('viajes')) with check (witme_has_access('viajes'));
alter policy "witme team can manage trip expenses" on public.witme_trip_expenses
  using (witme_has_access('viajes')) with check (witme_has_access('viajes'));
alter policy "witme team can manage trips" on public.witme_trips
  using (witme_has_access('viajes')) with check (witme_has_access('viajes'));

-- Estado
alter policy "witme team can read data sources" on public.witme_data_sources
  using (witme_has_access('estado'));

-- Shared reference data (not section-specific): anyone registered at all.
alter policy "witme team can read fx_rates" on public.witme_fx_rates
  using (witme_is_registered());
alter policy "witme team can read holded_fx_rates" on public.witme_holded_fx_rates
  using (witme_is_registered());
alter policy "witme team can read year_config" on public.witme_year_config
  using (witme_is_registered());
