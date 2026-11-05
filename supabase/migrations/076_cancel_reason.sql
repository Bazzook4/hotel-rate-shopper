-- Why and when a booking was cancelled.
--
-- Cancelled bookings were already kept (status = 'cancelled'). This adds the
-- time and the reason, asked at the desk. Both are cleared if the booking is
-- brought back. Bookings cancelled before this have neither.
--
-- Safe to run more than once.

alter table reservations add column if not exists cancelled_at timestamptz;
alter table reservations add column if not exists cancel_reason text;

notify pgrst, 'reload schema';
