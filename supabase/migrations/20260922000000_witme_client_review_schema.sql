-- Witme financial dashboard: per-client monthly invoicing (España, Holded),
-- to power a review page that flags (1) clients who billed in recent months
-- but not in the current one, and (2) clients whose current-month amount
-- deviates sharply from their trailing 3-month average. Same "no invented
-- FX" rule as witme_invoiced_monthly: invoiced_eur = subtotal (net) minus
-- credit-notes, converted via witme_holded_fx_rates.

create table if not exists public.witme_client_invoiced_monthly (
  year integer not null,
  month integer not null check (month between 1 and 12),
  contact_id text not null,
  contact_name text not null,
  invoiced_eur numeric not null,
  invoice_count integer not null,
  primary key (year, month, contact_id)
);

alter table public.witme_client_invoiced_monthly enable row level security;

create policy "witme team can read client_invoiced_monthly" on public.witme_client_invoiced_monthly
  for select to authenticated
  using ((auth.jwt() ->> 'email') in ('lukas@witme.es','lukas@lukasochoa.com','gferreyra@witme.es'));

-- Marks an alert (missing client / atypical deviation) as reviewed by the
-- team. One row per (year, month, contact_id, alert_type); its mere
-- existence means "reviewed" (deleting it un-reviews it).
create table if not exists public.witme_client_alert_reviews (
  year integer not null,
  month integer not null check (month between 1 and 12),
  contact_id text not null,
  alert_type text not null check (alert_type in ('missing', 'deviation')),
  reviewed_by text,
  reviewed_at timestamptz not null default now(),
  primary key (year, month, contact_id, alert_type)
);

alter table public.witme_client_alert_reviews enable row level security;

create policy "witme team can read alert reviews" on public.witme_client_alert_reviews
  for select to authenticated
  using ((auth.jwt() ->> 'email') in ('lukas@witme.es','lukas@lukasochoa.com','gferreyra@witme.es'));

create policy "witme team can write alert reviews" on public.witme_client_alert_reviews
  for all to authenticated
  using ((auth.jwt() ->> 'email') in ('lukas@witme.es','lukas@lukasochoa.com','gferreyra@witme.es'))
  with check ((auth.jwt() ->> 'email') in ('lukas@witme.es','lukas@lukasochoa.com','gferreyra@witme.es'));
