-- Who made the booking, when that is not the guest who stays: a parent
-- booking for a child, a PA for their manager, an agent's staff.
--
-- The guest_* columns stay the guest: the name on lists and the tape chart,
-- the guest record the booking is linked to, and the person on the police
-- register. The booker is kept here only, for calling back about the
-- booking, and is never put on the guest list. All three blank means the
-- guest booked for themselves.
alter table reservations add column if not exists booker_name  text;
alter table reservations add column if not exists booker_phone text;
alter table reservations add column if not exists booker_email text;

notify pgrst, 'reload schema';
