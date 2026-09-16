-- Add gferreyra@witme.es to the Witme team allow-list.
drop policy if exists "witme team can read year_config" on public.witme_year_config;
create policy "witme team can read year_config" on public.witme_year_config
  for select to authenticated
  using ((auth.jwt() ->> 'email') in ('lukas@witme.es','lukas@lukasochoa.com','gferreyra@witme.es'));

drop policy if exists "witme team can read pnl_monthly" on public.witme_pnl_monthly;
create policy "witme team can read pnl_monthly" on public.witme_pnl_monthly
  for select to authenticated
  using ((auth.jwt() ->> 'email') in ('lukas@witme.es','lukas@lukasochoa.com','gferreyra@witme.es'));

drop policy if exists "witme team can read fx_rates" on public.witme_fx_rates;
create policy "witme team can read fx_rates" on public.witme_fx_rates
  for select to authenticated
  using ((auth.jwt() ->> 'email') in ('lukas@witme.es','lukas@lukasochoa.com','gferreyra@witme.es'));
