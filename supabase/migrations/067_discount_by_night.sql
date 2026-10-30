-- Money off each night, for a website offer that comes off some nights only.
--
-- A "Saturdays 20% off" offer used to be spread over every night of the
-- stay, which could put a night in the wrong GST slab. Now the booking keeps
-- what came off each night, { "2026-12-05": 1600 }, and each night is taxed
-- on its own price. Empty for the desk's discounts and for offers that come
-- off every night alike; those stay the same share of every night.
--
-- Safe to run more than once.

alter table reservations add column if not exists discount_by_night jsonb;

notify pgrst, 'reload schema';
