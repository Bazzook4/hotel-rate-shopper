-- Online check-in: a link the desk sends a guest before arrival, where they
-- fill in their details and upload a photo of their ID, so check-in at the
-- desk is a matter of checking rather than typing.
--
-- One row per booking. The token is the link; it is kept as it is (not only
-- hashed) because the desk copies and re-sends the same link. Switching a
-- link off deletes the row and whatever was filled in through it, since a
-- link is switched off when it went to the wrong person.
--
-- `details` is what the guest sent, as they sent it:
--   { "guests": [{ "full_name": "...", "phone": "...", "id_type": "aadhaar",
--                  "id_number": "...", "nationality": "IN", "address": "...",
--                  "files": [{ "path": "...", "name": "...", "type": "image/jpeg",
--                              "size": 182044, "uploaded_at": "..." }] }],
--     "arrival_time": "15:00", "requests": "...", "consent_at": "..." }
-- The ID files sit in the private guest-ids bucket under
-- <property id>/checkin/<row id>/ until the desk accepts them, when they move
-- to the guest's own folder (migration 051). Rows never accepted are deleted
-- with their files a day after the stay ends, by the daily job.
create table if not exists reservation_checkins (
  id             uuid        primary key default gen_random_uuid(),
  property_id    uuid        not null references properties(id) on delete cascade,
  reservation_id uuid        not null unique references reservations(id) on delete cascade,
  token          text        not null unique,
  details        jsonb       not null default '{}'::jsonb,
  opened_at      timestamptz,
  submitted_at   timestamptz,
  accepted_at    timestamptz,
  accepted_by    uuid        references users(id) on delete set null,
  created_by     uuid        references users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists reservation_checkins_property_idx on reservation_checkins (property_id);

alter table reservation_checkins enable row level security;
drop policy if exists "Service role only on reservation_checkins" on reservation_checkins;
create policy "Service role only on reservation_checkins" on reservation_checkins for all using (true);

-- What the hotel asks for: on or off, ID from every adult or the booker only,
-- whether a photo of the ID and an address are required, and passport and
-- visa details from foreign guests (for Form C). Empty means the defaults.
alter table properties add column if not exists checkin_prefs jsonb not null default '{}'::jsonb;

-- A foreign guest's passport and visa details, for Form C:
--   { "date_of_birth": "1990-04-02", "passport_expiry": "...", "visa_number": "...",
--     "visa_expiry": "...", "arrived_from": "...", "next_destination": "..." }
alter table guests add column if not exists travel_details jsonb;
