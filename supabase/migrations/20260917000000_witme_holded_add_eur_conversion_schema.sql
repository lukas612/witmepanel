-- Add EUR-converted amounts to witme_invoiced_monthly, and a dedicated
-- fx-rate audit table for Holded (kept separate from witme_fx_rates, which
-- is the unrelated fixed Panamá revenue rate — reusing that table's key
-- would silently collide/overwrite a different number for the same
-- year+month+currency).

alter table public.witme_invoiced_monthly add column if not exists invoiced_eur numeric;

create table if not exists public.witme_holded_fx_rates (
  year integer not null,
  month integer not null check (month between 1 and 12),
  currency text not null,
  rate_eur numeric not null, -- EUR per 1 unit of currency
  source text not null,      -- 'ecb_frankfurter' or 'currency-api_mid_month'
  primary key (year, month, currency)
);

alter table public.witme_holded_fx_rates enable row level security;

create policy "witme team can read holded_fx_rates" on public.witme_holded_fx_rates
  for select to authenticated
  using ((auth.jwt() ->> 'email') in ('lukas@witme.es','lukas@lukasochoa.com','gferreyra@witme.es'));
