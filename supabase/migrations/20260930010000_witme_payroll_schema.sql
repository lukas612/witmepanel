-- Nóminas (payroll): runs (one per month/bonus upload) + per-employee lines.
-- Access restricted to Lukas only (lukas@witme.es, lukas@lukasochoa.com) — unlike
-- every other witme_* table, this data (salaries, DNI, IRPF) must not be visible
-- to the rest of the team (Gisel, Freddy, etc.) who otherwise use this panel.

create table if not exists public.witme_payroll_runs (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  month int not null check (month between 1 and 12),
  run_type text not null default 'nomina' check (run_type in ('nomina', 'bonus')),
  period_label text,
  xlsx_path text,
  pdf_path text,
  notes text,
  uploaded_at timestamptz not null default now(),
  uploaded_by text,
  unique (year, month, run_type)
);

create table if not exists public.witme_payroll_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.witme_payroll_runs(id) on delete cascade,
  employee_code text not null,
  employee_name text not null,
  category text,
  fecha_alta date,
  sueldo_base numeric,
  incentivos numeric,
  a_cuenta_convenio numeric,
  mejora_voluntaria numeric,
  ticket_restaurante numeric,
  transporte_flexible numeric,
  acc_ajuste numeric,
  ppe numeric,
  total_devengos numeric,
  dto_comunes numeric,
  dto_accidente numeric,
  retencion_irpf numeric,
  total_retencion numeric,
  total_liquido numeric,
  coste_ss_empresa numeric,
  coste_he_empresa numeric,
  coste_acc_empresa numeric,
  total_coste numeric,
  base_unica numeric,
  base_accidentes numeric,
  seguro_social_total numeric,
  raw_concepts jsonb not null default '{}'::jsonb,
  unique (run_id, employee_code)
);

alter table public.witme_payroll_runs enable row level security;
alter table public.witme_payroll_lines enable row level security;

create policy "solo lukas gestiona nominas (runs)" on public.witme_payroll_runs
  for all to authenticated
  using ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com']))
  with check ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com']));

create policy "solo lukas gestiona nominas (lines)" on public.witme_payroll_lines
  for all to authenticated
  using ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com']))
  with check ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com']));

-- Private storage bucket for the source xlsx/pdf files, same Lukas-only restriction.
insert into storage.buckets (id, name, public)
values ('nominas', 'nominas', false)
on conflict (id) do nothing;

create policy "solo lukas sube archivos de nominas" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'nominas' and (auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com']));

create policy "solo lukas lee archivos de nominas" on storage.objects
  for select to authenticated
  using (bucket_id = 'nominas' and (auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com']));

create policy "solo lukas borra archivos de nominas" on storage.objects
  for delete to authenticated
  using (bucket_id = 'nominas' and (auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com']));
