-- Witme financial dashboard: Holded purchases/costs (España only), mirrors
-- witme_invoiced_monthly. purchased_total = subtotal (net, no tax) summed
-- from /api/v2/purchases minus /api/v2/purchase-refunds, by month of the
-- purchase document's own `date` field (same "no invented FX" and "use the
-- document date" rules as invoiced_monthly). purchased_eur converts to EUR
-- via witme_holded_fx_rates.

create table if not exists public.witme_purchased_monthly (
  year integer not null,
  month integer not null check (month between 1 and 12),
  currency text not null,
  purchased_total numeric not null, -- net (subtotal), excludes tax/IVA
  purchased_eur numeric not null,
  purchase_count integer not null,
  primary key (year, month, currency)
);

alter table public.witme_purchased_monthly enable row level security;

create policy "witme team can read purchased_monthly" on public.witme_purchased_monthly
  for select to authenticated
  using ((auth.jwt() ->> 'email') in ('lukas@witme.es','lukas@lukasochoa.com','gferreyra@witme.es'));
