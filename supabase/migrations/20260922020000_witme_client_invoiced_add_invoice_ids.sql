-- Adds invoice_ids to witme_client_invoiced_monthly so the "Revisión de
-- clientes" pages (revision.html, matriz.html) can deep-link a client-month
-- cell straight to the underlying Holded invoice:
-- https://app.holded.com/sales/revenue#open:invoice-<id>
-- Populated for every existing row in 20260922000100_witme_client_invoiced_seed.sql
-- (that migration was rewritten to include invoice_ids in its upsert), and
-- kept current going forward by the weekly sync (Parte 4).

alter table public.witme_client_invoiced_monthly
  add column if not exists invoice_ids text[] not null default '{}'::text[];
