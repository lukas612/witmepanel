-- "Viajes": trip expense tracking + client-revenue attribution, entered
-- directly in the panel by the team (Gisel / account managers) rather
-- than synced from a spreadsheet. Unlike every other table in this app,
-- these are writable from the browser (RLS "for all"), not just read-only.
--
-- witme_trip_clients does NOT store a revenue amount: it only records
-- which client is attributed to a trip and over which (year, month)
-- range. The actual € figure is always computed live from
-- witme_client_invoiced_monthly (invoiced_eur, already synced weekly
-- from Holded) so it can never go stale or double-enter a number that
-- lives elsewhere.

create table if not exists public.witme_trips (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  destination text,
  start_date date not null,
  end_date date,
  responsable text,
  status text not null default 'planeado' check (status in ('planeado', 'en_curso', 'cerrado')),
  notes text,
  created_at timestamptz not null default now(),
  created_by text
);

create table if not exists public.witme_trip_expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.witme_trips(id) on delete cascade,
  category text not null check (category in ('vuelo', 'alojamiento', 'dietas', 'transporte', 'evento', 'regalos', 'otros')),
  description text,
  amount_eur numeric not null,
  expense_date date,
  paid_by text,
  created_at timestamptz not null default now(),
  created_by text
);

create table if not exists public.witme_trip_clients (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.witme_trips(id) on delete cascade,
  contact_id text not null,
  contact_name text not null,
  attribution_start_year integer not null,
  attribution_start_month integer not null check (attribution_start_month between 1 and 12),
  attribution_end_year integer not null,
  attribution_end_month integer not null check (attribution_end_month between 1 and 12),
  notes text,
  created_at timestamptz not null default now(),
  created_by text,
  unique (trip_id, contact_id)
);

create index if not exists witme_trip_expenses_trip_id_idx on public.witme_trip_expenses(trip_id);
create index if not exists witme_trip_clients_trip_id_idx on public.witme_trip_clients(trip_id);

alter table public.witme_trips enable row level security;
alter table public.witme_trip_expenses enable row level security;
alter table public.witme_trip_clients enable row level security;

create policy "witme team can manage trips" on public.witme_trips
  for all to authenticated
  using ((auth.jwt() ->> 'email') in ('lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es'))
  with check ((auth.jwt() ->> 'email') in ('lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es'));

create policy "witme team can manage trip expenses" on public.witme_trip_expenses
  for all to authenticated
  using ((auth.jwt() ->> 'email') in ('lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es'))
  with check ((auth.jwt() ->> 'email') in ('lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es'));

create policy "witme team can manage trip clients" on public.witme_trip_clients
  for all to authenticated
  using ((auth.jwt() ->> 'email') in ('lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es'))
  with check ((auth.jwt() ->> 'email') in ('lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es'));
