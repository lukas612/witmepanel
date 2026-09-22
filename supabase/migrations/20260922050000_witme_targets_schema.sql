-- Monthly revenue/cost/profit/ROI targets ("objetivos") by market and
-- business vertical, from the team's 2026 goals spreadsheet. Powers
-- objetivos.html. vertical='' is the market-total row (no single owner);
-- named verticals (Deudas, Creditio, Instadinero, Moneya, Cdirecto) have a
-- responsable. From April onward the sheet also splits revenue into
-- revenue_campaigns (CPA/lead-gen) vs revenue_monetization (e.g. AdSense),
-- with its own roi_campaigns_pct — null for Jan-Mar, which don't split it.
--
-- NOTE: this "revenue" is NOT the same figure as witme_pnl_monthly's
-- España "generado" (roughly half of it for the same months) — likely a
-- narrower scope (named verticals only). Don't compare them directly
-- without checking with the team first.

create table if not exists public.witme_targets_monthly (
  year integer not null,
  month integer not null check (month between 1 and 12),
  market text not null,
  vertical text not null default '',
  responsable text,
  revenue numeric,
  cost numeric,
  profit numeric,
  roi_pct numeric,
  revenue_campaigns numeric,
  revenue_monetization numeric,
  roi_campaigns_pct numeric,
  primary key (year, month, market, vertical)
);

alter table public.witme_targets_monthly enable row level security;

create policy "witme team can read targets" on public.witme_targets_monthly
  for select to authenticated
  using ((auth.jwt() ->> 'email') in ('lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es'));
