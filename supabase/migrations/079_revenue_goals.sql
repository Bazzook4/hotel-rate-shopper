-- Revenue Planner: what the hotel aims for in a month.
--
-- One row per hotel and month. The goal is occupancy, one overall average
-- rate (ADR) and the room revenue they add up to. segments holds the mix:
-- a list of { key, share, adr } where share is the percent of room nights
-- from that kind of business and adr is that business's own rate (empty =
-- the overall rate). Room nights, RevPAR and what was achieved are never
-- stored; they are worked out when the page is read.
create table if not exists revenue_goals (
  id            uuid        primary key default gen_random_uuid(),
  property_id   uuid        not null references properties(id) on delete cascade,
  month         date        not null,
  occupancy_pct numeric(5, 2) check (occupancy_pct >= 0 and occupancy_pct <= 100),
  adr           numeric(12, 2) check (adr >= 0),
  revenue       numeric(14, 2) check (revenue >= 0),
  segments      jsonb       not null default '[]'::jsonb,
  updated_at    timestamptz not null default now(),
  unique (property_id, month)
);
create index if not exists revenue_goals_property_idx on revenue_goals (property_id, month);

notify pgrst, 'reload schema';
