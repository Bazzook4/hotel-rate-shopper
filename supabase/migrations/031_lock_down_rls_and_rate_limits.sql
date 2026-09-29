-- Row-level security that actually says who, and a ledger for rate limits.
--
-- Most tables carry a policy written `for all using (true)` -- several of them
-- even named "Service role only". Without a `to` clause a policy applies to
-- every role, so each of those let anyone holding the anon key read and write
-- the table through Supabase's REST API: reservations, payments, guests. The
-- app itself only ever connects with the service role, which bypasses RLS
-- entirely, so narrowing these to service_role changes nothing for the app and
-- closes the table to everyone else.

do $$
declare
  p record;
begin
  for p in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and roles = '{public}'
      and qual = 'true'
  loop
    execute format('alter policy %I on public.%I to service_role', p.policyname, p.tablename);
  end loop;
end $$;

-- Three tables were created without RLS switched on at all, which is the same
-- hole with the door left open rather than unlocked.
alter table parity_channel_order enable row level security;
alter table reservation_groups   enable row level security;
alter table room_blocks          enable row level security;

drop policy if exists "Service role only on parity_channel_order" on parity_channel_order;
create policy "Service role only on parity_channel_order" on parity_channel_order
  for all to service_role using (true);

drop policy if exists "Service role only on reservation_groups" on reservation_groups;
create policy "Service role only on reservation_groups" on reservation_groups
  for all to service_role using (true);

drop policy if exists "Service role only on room_blocks" on room_blocks;
create policy "Service role only on room_blocks" on room_blocks
  for all to service_role using (true);

-- Rate limits. One row per counted event -- a failed sign-in, a paid page
-- fetch -- keyed by what is being limited (`login:email:...`,
-- `scrape:<property id>`). Counting rows in a window is all a limit needs, and
-- a table survives what an in-memory counter cannot: every serverless
-- instance on Vercel has its own memory, so a counter there limits nothing.
create table if not exists rate_limit_events (
  id         bigint generated always as identity primary key,
  key        text        not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_events_key_created_idx
  on rate_limit_events (key, created_at);

alter table rate_limit_events enable row level security;

drop policy if exists "Service role only on rate_limit_events" on rate_limit_events;
create policy "Service role only on rate_limit_events" on rate_limit_events
  for all to service_role using (true);
