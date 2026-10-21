-- Promotes RRHH/Nóminas from a hardcoded Lukas-only carve-out into a normal
-- 5th section of the same per-person permission system as Facturación/
-- Objetivos/Viajes/Estado -- Lukas can now grant it to someone else from
-- usuarios.html, same as any other section (an is_admin account still
-- bypasses everything, nóminas included).
--
-- Unlike the original 4 sections (seeded with the team's pre-existing
-- access as a baseline), nobody is seeded with 'rrhh' here: it was never
-- granted to anyone but Lukas before, so it starts ungranted and Lukas
-- adds it explicitly for whoever should have it.

alter table public.witme_section_access drop constraint witme_section_access_section_key_check;
alter table public.witme_section_access add constraint witme_section_access_section_key_check
  check (section_key in ('facturacion', 'objetivos', 'viajes', 'estado', 'rrhh'));

alter policy "solo lukas gestiona nominas (runs)" on public.witme_payroll_runs
  using (witme_has_access('rrhh')) with check (witme_has_access('rrhh'));
alter policy "solo lukas gestiona nominas (lines)" on public.witme_payroll_lines
  using (witme_has_access('rrhh')) with check (witme_has_access('rrhh'));
alter policy "solo lukas gestiona nominas (employees)" on public.witme_payroll_employees
  using (witme_has_access('rrhh')) with check (witme_has_access('rrhh'));

alter policy "solo lukas sube archivos de nominas" on storage.objects
  with check (bucket_id = 'nominas' and witme_has_access('rrhh'));
alter policy "solo lukas lee archivos de nominas" on storage.objects
  using (bucket_id = 'nominas' and witme_has_access('rrhh'));
alter policy "solo lukas borra archivos de nominas" on storage.objects
  using (bucket_id = 'nominas' and witme_has_access('rrhh'));
