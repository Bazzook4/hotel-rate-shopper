-- The booking tour: a practice booking walked through step by step, offered
-- once to every new user (BookingTour.jsx).
--
-- tour_done_at null means the tour is still due. Everyone who already uses
-- the app is marked done now, so only users added from here on are offered
-- it; anyone can still start it from Explore.
--
-- tour_autostart is set for the person who signs a hotel up: the tour opens
-- by itself for them, straight after sign-up. Staff added later are only
-- offered it on Today, since they may be signing in mid-shift.
alter table users add column if not exists tour_done_at timestamptz;
alter table users add column if not exists tour_autostart boolean not null default false;

update users set tour_done_at = now() where tour_done_at is null;

notify pgrst, 'reload schema';
