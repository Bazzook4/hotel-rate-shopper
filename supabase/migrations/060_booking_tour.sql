-- The booking tour: a practice booking walked through step by step, offered
-- once to every new user on their first sign-in (BookingTour.jsx).
--
-- Null means the tour is still due. Everyone who already uses the app is
-- marked done now, so only users added from here on are offered it; anyone
-- can still start it from Explore.
alter table users add column if not exists tour_done_at timestamptz;

update users set tour_done_at = now() where tour_done_at is null;

notify pgrst, 'reload schema';
