-- Canonical employee names, keyed by the payroll system's employee_code.
-- The source Excel truncates some names badly (so a per-upload name is
-- unreliable) -- correcting the name here applies to every past and future
-- upload at once, instead of fixing it line-by-line each month.
create table if not exists public.witme_payroll_employees (
  employee_code text primary key,
  display_name text not null,
  updated_at timestamptz not null default now()
);

alter table public.witme_payroll_employees enable row level security;

create policy "solo lukas gestiona nominas (employees)" on public.witme_payroll_employees
  for all to authenticated
  using ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com']))
  with check ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com']));
