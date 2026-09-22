-- Adds the unpaid client's billing-address country (from Holded's Contacts
-- API, bill_address.country / country_code) to witme_unpaid_invoices, so
-- impagados.html can offer a "por país" accumulated view alongside "por
-- cliente". Backfilled below for all rows in
-- 20260922030100_witme_unpaid_invoices_seed.sql (rewritten to include it),
-- and kept current going forward by the weekly sync (Parte 5).

alter table public.witme_unpaid_invoices
  add column if not exists contact_country text,
  add column if not exists contact_country_code text;
