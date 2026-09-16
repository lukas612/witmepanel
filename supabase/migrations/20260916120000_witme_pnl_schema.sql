-- Witme financial dashboard: schema for monthly P&L data (España & Panamá)

create table if not exists public.witme_year_config (
  year integer primary key,
  has_split boolean not null default false,
  visible_months integer not null default 12
);

create table if not exists public.witme_pnl_monthly (
  year integer not null references public.witme_year_config(year) on delete cascade,
  month integer not null check (month between 1 and 12),
  region text not null check (region in ('total','espana','panama')),
  revenue numeric,
  cost numeric not null,
  revenue_usd numeric,
  is_real boolean not null default false,
  primary key (year, month, region)
);

create table if not exists public.witme_fx_rates (
  year integer not null,
  month integer not null check (month between 1 and 12),
  currency_pair text not null default 'USD_EUR',
  rate numeric not null,
  primary key (year, month, currency_pair)
);

alter table public.witme_year_config enable row level security;
alter table public.witme_pnl_monthly enable row level security;
alter table public.witme_fx_rates enable row level security;

-- Only the Witme team (allow-listed emails) can read this financial data.
-- To add someone, add their email to every "in (...)" list below (and
-- create their auth.users row — see README "Añadir un usuario").
create policy "witme team can read year_config" on public.witme_year_config
  for select to authenticated
  using ((auth.jwt() ->> 'email') in ('lukas@witme.es','lukas@lukasochoa.com'));

create policy "witme team can read pnl_monthly" on public.witme_pnl_monthly
  for select to authenticated
  using ((auth.jwt() ->> 'email') in ('lukas@witme.es','lukas@lukasochoa.com'));

create policy "witme team can read fx_rates" on public.witme_fx_rates
  for select to authenticated
  using ((auth.jwt() ->> 'email') in ('lukas@witme.es','lukas@lukasochoa.com'));
