-- WhatsApp Cloud API: the business number's own inbox, sales auto-replies
-- and the daily report to hotels.
--
-- wa_contacts   one row per phone that has written in or been written to.
--               property_id links a hotel's contact; opted_in sends it the
--               daily report; bot_paused hands the chat to a person;
--               last_inbound_at opens the 24-hour free-reply window;
--               seen_at is how far the inbox has been read.
-- wa_messages   every message in and out, with its delivery status.
-- wa_leads      a sales enquiry worked through by the auto-reply, one open
--               lead per phone at a time; misses counts replies in a row the
--               bot could not understand.
--
-- Written only by the server (service key); no policies, so the public API
-- can neither read nor write them.
--
-- Safe to run more than once.

create table if not exists wa_contacts (
  id bigint generated always as identity primary key,
  phone text unique not null,
  name text,
  property_id uuid references properties(id) on delete set null,
  opted_in boolean not null default false,
  bot_paused boolean not null default false,
  last_inbound_at timestamptz,
  last_message_at timestamptz,
  seen_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists wa_contacts_latest on wa_contacts (last_message_at desc nulls last);

create table if not exists wa_messages (
  id bigint generated always as identity primary key,
  wa_message_id text unique,
  phone text not null,
  direction text not null,
  type text,
  body text,
  payload jsonb,
  status text,
  error text,
  sent_by text,
  created_at timestamptz not null default now()
);

create index if not exists wa_messages_phone on wa_messages (phone, created_at desc);

create table if not exists wa_leads (
  id bigint generated always as identity primary key,
  phone text not null,
  interest text,
  hotel_name text,
  city text,
  rooms int,
  source_page text,
  step text not null default 'start',
  misses int not null default 0,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wa_leads_phone on wa_leads (phone, created_at desc);

alter table wa_contacts enable row level security;
alter table wa_messages enable row level security;
alter table wa_leads enable row level security;

notify pgrst, 'reload schema';
