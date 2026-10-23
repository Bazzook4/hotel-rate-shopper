-- Each hotel's own clock and money.
--
-- timezone: an IANA name ("Asia/Kolkata", "America/New_York"). Today, the
-- night audit's day, a payment's day and the time on a check-in are read on
-- this clock (src/lib/hotelTime.js). Asked at sign-up, changed in Property
-- Setup.
--
-- currency: an ISO 4217 code ("INR", "USD", "EUR"). New bookings are taken
-- in it and every price on screen is shown in it (src/lib/money.js). Filled
-- from the country at sign-up, changed in Property Setup.
--
-- Every hotel signed up before this is in India, so they start on India's
-- clock and rupees, which is what the app assumed until now.
alter table properties add column if not exists timezone text not null default 'Asia/Kolkata';
alter table properties add column if not exists currency text not null default 'INR';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'properties_currency_check') then
    alter table properties add constraint properties_currency_check check (currency ~ '^[A-Z]{3}$');
  end if;
end $$;

notify pgrst, 'reload schema';
