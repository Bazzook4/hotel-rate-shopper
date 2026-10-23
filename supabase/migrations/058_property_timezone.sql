-- Each hotel's own time zone, as an IANA name ("Asia/Kolkata",
-- "America/New_York"). Today, the night audit's day, a payment's day and
-- the time on a check-in are read on this clock (src/lib/hotelTime.js).
-- Asked at sign-up and changed in Property Setup.
--
-- Every hotel signed up before this is in India, so they start on India's
-- clock, which is what the app assumed until now.
alter table properties add column if not exists timezone text not null default 'Asia/Kolkata';

notify pgrst, 'reload schema';
