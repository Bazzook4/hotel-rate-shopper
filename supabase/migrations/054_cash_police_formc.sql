-- Three things a small hotel is asked for and was keeping on paper: the
-- police register of everyone who checked in, Form C for every foreign
-- guest, and a cash book showing where the drawer's cash went.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Who each named guest on a booking is
-- ---------------------------------------------------------------------------
-- The police register lists every adult who checked in with their ID, so a
-- named guest on a booking now carries their own nationality, ID and
-- address, as the desk saw them for this stay. `guest_id` points at their
-- guest record when there is one (online check-in links it), so a returning
-- guest's details can fill in what the desk did not retype.
alter table reservation_guests add column if not exists guest_id uuid references guests(id) on delete set null;
alter table reservation_guests add column if not exists nationality text;
alter table reservation_guests add column if not exists id_type text;
alter table reservation_guests add column if not exists id_number text;
alter table reservation_guests add column if not exists address text;
alter table reservation_guests add column if not exists date_of_birth date;

-- ---------------------------------------------------------------------------
-- 2. Form C
-- ---------------------------------------------------------------------------
-- One row per foreign guest per stay. Form C itself is filed on the FRRO
-- website within 24 hours of arrival; this is the hotel's copy of what was
-- filed and when, so it can show an inspector, and see what is still due.
--
-- `person_key` is the named guest's reservation_guests id, or 'booker' for a
-- booking with no named guests, whose guest is the booking's own.
--
-- `details` holds the form's fields as the desk filled them:
--   { "date_of_birth": "1990-04-02", "passport_number": "...",
--     "passport_issue_place": "...", "passport_issue_date": "...", "passport_expiry": "...",
--     "visa_number": "...", "visa_type": "...", "visa_issue_place": "...",
--     "visa_issue_date": "...", "visa_expiry": "...", "arrived_in_india": "...",
--     "arrived_from": "...", "next_destination": "...", "purpose": "tourism",
--     "address_abroad": "..." }
create table if not exists form_c_records (
  id             uuid        primary key default gen_random_uuid(),
  property_id    uuid        not null references properties(id) on delete cascade,
  reservation_id uuid        not null references reservations(id) on delete cascade,
  person_key     text        not null,
  details        jsonb       not null default '{}'::jsonb,
  -- The application number the FRRO site gives once the form is submitted.
  frro_reference text,
  submitted_at   timestamptz,
  submitted_by   uuid        references users(id) on delete set null,
  updated_by     uuid        references users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (reservation_id, person_key)
);

create index if not exists form_c_records_property_idx on form_c_records (property_id);

alter table form_c_records enable row level security;
drop policy if exists "Service role only on form_c_records" on form_c_records;
create policy "Service role only on form_c_records" on form_c_records for all using (true);

-- ---------------------------------------------------------------------------
-- 3. Cash book
-- ---------------------------------------------------------------------------
-- Money the hotel paid or moved that is not a guest's payment: expenses
-- (tagged, so the owner sees what the money went on), cash put into the
-- drawer, cash banked, cash handed to the owner. Guests' payments are not
-- copied here; the cash book reads them from the folios.
--
-- Like payments, an entry is voided, never deleted or edited: a cash book
-- whose lines can quietly change is no check on the cash.
create table if not exists cash_entries (
  id           uuid        primary key default gen_random_uuid(),
  property_id  uuid        not null references properties(id) on delete cascade,
  kind         text        not null default 'expense'
    check (kind in ('expense', 'cash_in', 'to_bank', 'to_owner')),
  entry_date   date        not null,
  amount       numeric(12, 2) not null check (amount > 0),
  -- Only cash entries move the drawer; an expense paid by UPI is still an
  -- expense, but no cash left the desk for it.
  method       text        not null default 'cash'
    check (method in ('cash', 'upi', 'card', 'bank_transfer', 'other')),
  tag          text,
  paid_to      text,
  bill_number  text,
  notes        text,
  recorded_by  uuid        references users(id) on delete set null,
  created_at   timestamptz not null default now(),
  voided_at    timestamptz,
  void_reason  text,
  voided_by    uuid        references users(id) on delete set null
);

create index if not exists cash_entries_property_date_idx on cash_entries (property_id, entry_date);
create index if not exists cash_entries_property_created_idx on cash_entries (property_id, created_at);

alter table cash_entries enable row level security;
drop policy if exists "Service role only on cash_entries" on cash_entries;
create policy "Service role only on cash_entries" on cash_entries for all using (true);

-- The cash counted in the drawer at a moment (a shift change, the end of
-- the day), beside what the books said should be there. Each count is the
-- starting point for the next, so a shortage shows on the shift it
-- happened in. `expected` is frozen when counted: later voids must not
-- rewrite what the drawer was checked against.
create table if not exists cash_counts (
  id           uuid        primary key default gen_random_uuid(),
  property_id  uuid        not null references properties(id) on delete cascade,
  counted_at   timestamptz not null default now(),
  counted      numeric(12, 2) not null check (counted >= 0),
  expected     numeric(12, 2),
  notes        text,
  counted_by   uuid        references users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists cash_counts_property_idx on cash_counts (property_id, counted_at);

alter table cash_counts enable row level security;
drop policy if exists "Service role only on cash_counts" on cash_counts;
create policy "Service role only on cash_counts" on cash_counts for all using (true);

-- ---------------------------------------------------------------------------
-- 4. Who gets the new pages
-- ---------------------------------------------------------------------------
-- The cash book goes to whoever reconciles payments; the police register
-- and Form C to whoever checks guests in.
insert into user_modules (user_id, module_id, enabled)
select distinct um.user_id, 'cashbook', true
from user_modules um
where um.module_id in ('payments', 'nightaudit')
  and um.enabled is not false
on conflict (user_id, module_id) do nothing;

insert into user_modules (user_id, module_id, enabled)
select distinct um.user_id, p.page, true
from user_modules um
cross join (values ('policereport'), ('formc')) as p(page)
where um.module_id in ('reservations', 'calendar')
  and um.enabled is not false
on conflict (user_id, module_id) do nothing;

update app_settings
set value = value || '["cashbook"]'::jsonb
where key = 'default_admin_modules'
  and not value ? 'cashbook';

update app_settings
set value = value || '["policereport"]'::jsonb
where key = 'default_admin_modules'
  and not value ? 'policereport';

update app_settings
set value = value || '["formc"]'::jsonb
where key = 'default_admin_modules'
  and not value ? 'formc';

notify pgrst, 'reload schema';
