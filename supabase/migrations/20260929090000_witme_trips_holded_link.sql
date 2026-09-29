-- Links witme_trips/witme_trip_expenses to Holded's own "Proyectos" feature,
-- which Gisel already uses to tag one project per real trip/event and
-- assign purchase-invoice lines to it. The holded-trips-sync Edge Function
-- (cron, no AI) upserts identity/money fields from Holded by these keys;
-- everything else on these rows stays whatever the team enters by hand in
-- viajes.html, manual and Holded-sourced rows living side by side.

alter table public.witme_trips
  add column if not exists holded_project_id text;

create unique index if not exists witme_trips_holded_project_id_uniq
  on public.witme_trips(holded_project_id) where holded_project_id is not null;

alter table public.witme_trip_expenses
  add column if not exists holded_purchase_id text,
  add column if not exists holded_line_id text;

create unique index if not exists witme_trip_expenses_holded_uniq
  on public.witme_trip_expenses(holded_purchase_id, holded_line_id) where holded_purchase_id is not null;
