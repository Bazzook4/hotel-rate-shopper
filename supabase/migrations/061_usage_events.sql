-- Usage events: what people do on a page once it is open, so the super
-- admin can see which pages work, which ones people leave straight away,
-- and whether Show me how, Help and Ctrl+K get used (Admin > Usage).
--
-- As anonymous as page_opens (migration 042): a row is the hotel, the page,
-- the role and job profile, and what happened. No user id, no session id
-- and nothing typed. A click keeps only the words on the button, with any
-- digits blanked, and a button inside a list or table row keeps only its
-- column (lib/track.js), so guest names and amounts never land here.
--
-- kind:
--   visit      a page left: value = seconds on it, clicks = clicks made
--   click      a button, tab or link pressed: target = its words
--   guide      Show me how opened
--   tour       a guide started: target = tour id
--   tour_done  a guide finished: target = tour id
--   tour_quit  a guide closed early: target = tour id, value = step reached
--   palette    Ctrl+K opened
--   palette_go a page or booking chosen from Ctrl+K
--
-- Written only by the server (service key); no policies, so the public API
-- can neither read nor write it.
--
-- Safe to run more than once.

create table if not exists usage_events (
  id bigint generated always as identity primary key,
  property_id uuid references properties(id) on delete cascade,
  page_id text,
  role text,
  profile text,
  kind text not null,
  target text,
  value integer,
  clicks integer,
  happened_on date not null default current_date
);

create index if not exists usage_events_day on usage_events (happened_on, kind);

alter table usage_events enable row level security;

notify pgrst, 'reload schema';
