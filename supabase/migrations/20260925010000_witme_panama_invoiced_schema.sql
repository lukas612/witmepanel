-- Real invoicing data for the Panama entity, pulled from the EBI-PAC portal
-- (Panama's authorized e-invoicing provider). Unlike witme_invoiced_monthly
-- (Spain, via Holded's REST API with a durable token), EBI-PAC's Web
-- Service has no list/query-by-date method (confirmed with their support
-- and by reading the integration manual) -- only single-document ops
-- (Enviar, EstadoDocumento, DescargaXML/PDF...). The only way to list
-- invoices is the human web portal (factura.ebi-pac.com/invoices), which
-- authenticates purely by Laravel session cookie behind a CAPTCHA-gated
-- login -- no durable API token exists. So this table is filled by a
-- manual pull (see scripts/ebipac_pull_panama.js), not a daily cron.

create table public.witme_panama_invoiced_monthly (
  year integer not null,
  month integer not null check (month >= 1 and month <= 12),
  currency text not null default 'USD',
  invoiced_total numeric not null,
  invoice_count integer not null default 0,
  credit_count integer not null default 0,
  last_pulled_at timestamptz not null default now(),
  primary key (year, month, currency)
);

alter table public.witme_panama_invoiced_monthly enable row level security;

create policy "witme team can read panama invoiced" on public.witme_panama_invoiced_monthly
  for select to authenticated
  using ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es', 'freddy@witme.es']));

-- First real pull (25 sep 2026): 9 invoices - 2 credit notes = $61,167.23,
-- Sept 2026 being the first month the Panama entity used EBI-PAC.
insert into public.witme_panama_invoiced_monthly (year, month, currency, invoiced_total, invoice_count, credit_count, last_pulled_at)
values (2026, 9, 'USD', 61167.23, 9, 2, now());

insert into public.witme_data_sources (key, label, order_index, covers_until_year, covers_until_month, target_note, last_updated_at, updated_by)
values ('facturado_panama', 'Facturado (EBI-PAC Panamá)', 7, 2026, 9, 'Manual: sin token de API estable (login del portal con CAPTCHA) -- re-pull a mano cuando haga falta con scripts/ebipac_pull_panama.js.', now(), 'lukas@witme.es');
