-- Distinguishes a trip's client-attribution rows: a brand new client won
-- during/because of the trip ('nuevo') vs. a visit to an existing client
-- ('antiguo'). Only 'antiguo' rows get a "vs. 3 meses previos" valoración
-- in the UI (comparing the attributed period's monthly average against
-- the 3 calendar months right before it, same formula as the
-- Revisión de clientes / Matriz deviation alerts) -- comparing a brand
-- new client against a "before" that doesn't exist wouldn't mean anything.

alter table public.witme_trip_clients
  add column if not exists client_type text not null default 'nuevo' check (client_type in ('nuevo', 'antiguo'));
