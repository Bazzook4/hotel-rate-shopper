-- WhatsApp plans: a hotel picked in Admin > Usage gets one WhatsApp each
-- morning for a set number of days, sent by the 8 AM cron
-- (/api/whatsapp/daily-report), then the plan ends by itself.
--
-- kind: daily_report  the morning report (daily_report_v2)
--       reminder      setup_reminder_v2 while rooms are not set up, else
--                     day3_checkin_v2 while no booking is coming in; the
--                     plan stops early once the hotel is using the app
-- days: how many mornings to send
-- sent: mornings that reached the hotel; last_sent_on is claimed before
--       sending, so one morning never sends twice
-- fails: failed mornings in a row; three end the plan
-- stopped_at / stop_reason: ended by hand, by finishing its days, or
--                     because the hotel no longer needs a reminder
--
-- One live plan per hotel. Written only by the server (service key); no
-- policies, so the public API can neither read nor write it.
--
-- Safe to run more than once.

create table if not exists wa_schedules (
  id bigint generated always as identity primary key,
  property_id uuid not null references properties(id) on delete cascade,
  kind text not null check (kind in ('daily_report', 'reminder')),
  days int not null check (days between 1 and 90),
  sent int not null default 0,
  last_sent_on date,
  last_error text,
  fails int not null default 0,
  stopped_at timestamptz,
  stop_reason text,
  created_by text,
  created_at timestamptz not null default now()
);

create unique index if not exists wa_schedules_one_live on wa_schedules (property_id) where stopped_at is null;
create index if not exists wa_schedules_property on wa_schedules (property_id, created_at desc);

alter table wa_schedules add column if not exists fails int not null default 0;

alter table wa_schedules enable row level security;

notify pgrst, 'reload schema';
