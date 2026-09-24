-- Tracks, per data source, when it was last refreshed and which months of
-- data it currently covers. This is a manual record (no "sync now" button
-- yet): whoever runs a real sync updates the row by hand (new migration or
-- direct update), and the panel just displays the current state. See
-- README "Registro de actualizaciones" for how to update it.

create table public.witme_data_sources (
  key text primary key,
  label text not null,
  order_index integer not null default 0,
  covers_until_year integer,
  covers_until_month integer check (covers_until_month is null or (covers_until_month >= 1 and covers_until_month <= 12)),
  target_note text,
  last_updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.witme_data_sources enable row level security;

create policy "witme team can read data sources" on public.witme_data_sources
  for select to authenticated
  using ((auth.jwt() ->> 'email') = any (array['lukas@witme.es', 'lukas@lukasochoa.com', 'gferreyra@witme.es', 'freddy@witme.es']));

insert into public.witme_data_sources (key, label, order_index, covers_until_year, covers_until_month, target_note, last_updated_at, updated_by) values
  ('facturado', 'Facturado (Holded)', 1, 2026, 9, null, '2026-09-17 06:16:00+00', 'lukas@witme.es'),
  ('comprado', 'Comprado (Holded)', 2, 2026, 9, null, '2026-09-17 06:25:00+00', 'lukas@witme.es'),
  ('revision_clientes', 'Revisión de clientes / Matriz (Holded)', 3, 2026, 9, null, '2026-09-22 14:53:00+00', 'lukas@witme.es'),
  ('impagados', 'Impagados (Holded)', 4, null, null, 'Foto del momento, no una serie mensual — se sustituye entera en cada sincronización.', '2026-09-22 17:02:00+00', 'lukas@witme.es'),
  ('objetivos', 'Objetivos', 5, 2026, 9, 'Objetivo: cargar octubre-diciembre 2026 cuando estén definidos.', '2026-09-22 20:10:00+00', 'lukas@witme.es'),
  ('resultados', 'Resultados', 6, 2026, 9, null, '2026-09-22 20:03:00+00', 'lukas@witme.es');
