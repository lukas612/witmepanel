-- Real (actual) monthly revenue/cost/profit by market and vertical, as
-- tracked weekly by the traffic team in their own results spreadsheet.
-- Unlike witme_pnl_monthly (full P&L, includes payroll and other fixed
-- costs) this is OPERATING profit only: revenue minus ad spend and the
-- marketing tools tied directly to that revenue (SMS, email...) -- no
-- payroll, no other overhead. Same market/vertical shape as
-- witme_targets_monthly (the objetivo) so the two can be compared, plus
-- a few markets/lines the targets sheet doesn't have yet (Colombia,
-- Brasil, Affiliate networks, and an "Otros" bucket for one-off lines
-- like a media placement or a tool's cost). vertical='' is the
-- market-total row; for a market whose source sheet only ever had a
-- single vertical (Brasil), that total row is this app's own sum of its
-- verticals, not a row that existed in the sheet.
--
-- pct_objetivo_profit/pct_objetivo_facturacion are copied straight from
-- the sheet (already computed there against that month's
-- witme_targets_monthly row) -- not recomputed here.

create table if not exists public.witme_results_monthly (
  year integer not null,
  month integer not null check (month between 1 and 12),
  market text not null,
  vertical text not null default '',
  responsable text,
  revenue numeric,
  cost numeric,
  cost_tools numeric,
  profit numeric,
  roi_pct numeric,
  revenue_campaigns numeric,
  revenue_monetization numeric,
  revenue_adsense numeric,
  roi_campaigns_pct numeric,
  pct_objetivo_profit numeric,
  pct_objetivo_facturacion numeric,
  primary key (year, month, market, vertical)
);

alter table public.witme_results_monthly enable row level security;

create policy "witme team can read results" on public.witme_results_monthly
  for select to authenticated
  using ((auth.jwt() ->> 'email') in ('lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es'));
