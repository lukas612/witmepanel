-- Witme financial dashboard: Holded invoicing data (España only).
-- This tracks what was actually INVOICED (fecha de factura), a separate
-- concept from the "generado" P&L data in witme_pnl_monthly, which is
-- keyed to the month revenue/cost was generated, not billed. Aggregated
-- by (year, month, currency) — no FX conversion applied, since Holded
-- invoices span several currencies (clients billed in their own).
--
-- The Holded API personal access token is stored in Supabase Vault as the
-- secret "holded_api_key" (set manually, not via migration).

create table if not exists public.witme_invoiced_monthly (
  year integer not null,
  month integer not null check (month between 1 and 12),
  currency text not null,
  invoiced_total numeric not null, -- net sales (subtotal), excludes tax/IVA
  invoice_count integer not null,
  primary key (year, month, currency)
);

alter table public.witme_invoiced_monthly enable row level security;

create policy "witme team can read invoiced_monthly" on public.witme_invoiced_monthly
  for select to authenticated
  using ((auth.jwt() ->> 'email') in ('lukas@witme.es','lukas@lukasochoa.com','gferreyra@witme.es'));
