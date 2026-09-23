-- Grants freddy@witme.es the same access as the rest of the witme team
-- (lukas@witme.es, lukas@lukasochoa.com, gferreyra@witme.es) by adding
-- her/his email to every "witme team" RLS policy's allowlist.

alter policy "witme team can read alert reviews" on public.witme_client_alert_reviews
  using ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es', 'freddy@witme.es']));

alter policy "witme team can write alert reviews" on public.witme_client_alert_reviews
  using ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es', 'freddy@witme.es']))
  with check ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es', 'freddy@witme.es']));

alter policy "witme team can read client_invoiced_monthly" on public.witme_client_invoiced_monthly
  using ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es', 'freddy@witme.es']));

alter policy "witme team can read fx_rates" on public.witme_fx_rates
  using ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es', 'freddy@witme.es']));

alter policy "witme team can read holded_fx_rates" on public.witme_holded_fx_rates
  using ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es', 'freddy@witme.es']));

alter policy "witme team can read invoiced_monthly" on public.witme_invoiced_monthly
  using ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es', 'freddy@witme.es']));

alter policy "witme team can read pnl_monthly" on public.witme_pnl_monthly
  using ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es', 'freddy@witme.es']));

alter policy "witme team can read purchased_monthly" on public.witme_purchased_monthly
  using ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es', 'freddy@witme.es']));

alter policy "witme team can read results" on public.witme_results_monthly
  using ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es', 'freddy@witme.es']));

alter policy "witme team can read targets" on public.witme_targets_monthly
  using ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es', 'freddy@witme.es']));

alter policy "witme team can manage trip clients" on public.witme_trip_clients
  using ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es', 'freddy@witme.es']))
  with check ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es', 'freddy@witme.es']));

alter policy "witme team can manage trip expenses" on public.witme_trip_expenses
  using ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es', 'freddy@witme.es']))
  with check ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es', 'freddy@witme.es']));

alter policy "witme team can manage trips" on public.witme_trips
  using ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es', 'freddy@witme.es']))
  with check ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es', 'freddy@witme.es']));

alter policy "witme team can read unpaid invoices" on public.witme_unpaid_invoices
  using ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es', 'freddy@witme.es']));

alter policy "witme team can read year_config" on public.witme_year_config
  using ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es', 'freddy@witme.es']));
