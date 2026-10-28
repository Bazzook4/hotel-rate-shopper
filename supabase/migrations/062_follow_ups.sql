-- Follow-ups: each WhatsApp message the super admin sends a hotel from
-- Admin > Follow up, asking whether they have questions or where they are
-- stuck. Kept with what the hotel had done by then (activity), so the next
-- message picks up from the last one, and with a note of what they said.
--
-- kind: questions | setup | first_booking | quiet (the message used)
-- activity: what the hotel had set up and done when the message was sent
--
-- Written only by the server (service key); no policies, so the public API
-- can neither read nor write it.
--
-- Safe to run more than once.

create table if not exists follow_ups (
  id bigint generated always as identity primary key,
  property_id uuid not null references properties(id) on delete cascade,
  kind text not null,
  message text not null,
  activity jsonb,
  note text,
  sent_by text,
  sent_at timestamptz not null default now()
);

create index if not exists follow_ups_property on follow_ups (property_id, sent_at desc);

alter table follow_ups enable row level security;

notify pgrst, 'reload schema';
