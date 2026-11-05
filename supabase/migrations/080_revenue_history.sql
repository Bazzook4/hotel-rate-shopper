-- Revenue Planner: last year's figures typed in by hand, for a hotel that was
-- not on the system then. Same shape as revenue_goals. Only used for a month
-- the system has no bookings for; real bookings always win.
create table if not exists revenue_history (
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
create index if not exists revenue_history_property_idx on revenue_history (property_id, month);

notify pgrst, 'reload schema';
