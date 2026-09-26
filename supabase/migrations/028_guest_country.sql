-- The guest's country, for reporting where business comes from.
--
-- Stored as an ISO 3166 two-letter code ("IN", "TH", "US") rather than a
-- name, because names arrive spelt every way -- "USA", "United States",
-- "US" -- and a report grouping by the raw text would split one market into
-- three. The application turns whatever it is given into the code.
--
-- Nullable: bookings taken before this existed have no country, and a desk
-- that does not know one should leave it empty rather than guess.
--
-- This is a separate fact from `guest_residency`, which decides tax. An
-- Indian citizen living in Dubai is from India for marketing and may be
-- international for tax; the desk sets both.

alter table reservations add column if not exists guest_country text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reservations_guest_country_format'
  ) then
    alter table reservations add constraint reservations_guest_country_format
      check (guest_country is null or guest_country ~ '^[A-Z]{2}$');
  end if;
end $$;
