-- Per-invoice snapshot of currently unpaid (pending/partial) Holded invoices,
-- España entity, for the "Impagados" page. Unlike witme_client_invoiced_monthly
-- (a monthly aggregate that only ever grows), this table is a live snapshot:
-- the weekly sync replaces its contents each run with whatever is currently
-- pending/partial in Holded, deleting rows for invoices that got paid.

create table if not exists public.witme_unpaid_invoices (
  invoice_id text primary key,
  document_number text not null,
  contact_id text not null,
  contact_name text not null,
  date date not null,
  due_date date,
  currency text not null,
  total numeric not null,             -- total WITH tax, in original currency (what's owed)
  payments_pending numeric not null,  -- amount still unpaid, in original currency
  pending_eur numeric not null,       -- payments_pending converted to EUR
  status text not null check (status in ('pending', 'partial')),
  updated_at timestamptz not null default now()
);

alter table public.witme_unpaid_invoices enable row level security;

create policy "witme team can read unpaid invoices" on public.witme_unpaid_invoices
  for select to authenticated
  using ((auth.jwt() ->> 'email') in ('lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es'));
