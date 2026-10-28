-- A discount on a booking, and a log of every change to it.
--
-- One discount per booking, as a percent or a fixed amount, given before tax
-- (off the room charge, tax worked out on what is left) or after tax (off
-- the final bill, tax unchanged). The folio works the money out on every
-- read, as it does the taxes; only the desk's choice is stored.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. The discount on the booking, as it stands
-- ---------------------------------------------------------------------------
alter table reservations add column if not exists discount_kind text
  check (discount_kind in ('percent', 'amount'));
alter table reservations add column if not exists discount_value numeric(12, 2);
alter table reservations add column if not exists discount_timing text
  check (discount_timing in ('before_tax', 'after_tax'));
alter table reservations add column if not exists discount_reason text;
alter table reservations add column if not exists discount_note text;

-- ---------------------------------------------------------------------------
-- 2. Every change to it
-- ---------------------------------------------------------------------------
-- One row each time a discount is given, changed or taken off, never edited
-- or deleted. The booking's reference and guest are copied in, so the row
-- still says whose stay it was if the booking is later deleted.
--
-- `amount` is the money off as it stood when the change was made; a later
-- change of rate or dates moves the folio, not this row.
create table if not exists reservation_discounts (
  id               uuid        primary key default gen_random_uuid(),
  property_id      uuid        not null references properties(id) on delete cascade,
  reservation_id   uuid        references reservations(id) on delete set null,
  reference        text,
  guest_name       text,
  -- The discount after the change; kind null when it was taken off.
  kind             text,
  value            numeric(12, 2),
  timing           text,
  amount           numeric(12, 2) not null default 0,
  -- What it was before the change.
  previous_kind    text,
  previous_value   numeric(12, 2),
  previous_timing  text,
  previous_amount  numeric(12, 2) not null default 0,
  reason           text,
  note             text,
  currency         text,
  changed_by       uuid        references users(id) on delete set null,
  changed_at       timestamptz not null default now()
);

create index if not exists reservation_discounts_property_idx on reservation_discounts (property_id, changed_at);
create index if not exists reservation_discounts_reservation_idx on reservation_discounts (reservation_id);

alter table reservation_discounts enable row level security;
drop policy if exists "Service role only on reservation_discounts" on reservation_discounts;
create policy "Service role only on reservation_discounts" on reservation_discounts for all using (true);

-- ---------------------------------------------------------------------------
-- 3. Who may give one
-- ---------------------------------------------------------------------------
-- "Give discounts" is a right of its own in User rights. Property admins who
-- take bookings get it now; they tick it for the staff they trust.
insert into user_modules (user_id, module_id, enabled)
select distinct um.user_id, 'discounts', true
from user_modules um
join users u on u.id = um.user_id
where um.module_id in ('calendar', 'reservations')
  and um.enabled is not false
  and u.role = 'PropertyAdmin'
on conflict (user_id, module_id) do nothing;

update app_settings
set value = value || '["discounts"]'::jsonb
where key = 'default_admin_modules'
  and not value ? 'discounts';

notify pgrst, 'reload schema';
