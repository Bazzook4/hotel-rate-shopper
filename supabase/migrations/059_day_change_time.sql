-- When a hotel's business day changes over: its night audit time.
--
-- Until then the desk is still working the day before -- a walk-in at 1am
-- is tonight's stay and a payment at 1am is on that day's audit. "Today" on
-- every screen, the night audit and the money reports change at this time
-- (src/lib/hotelTime.js). Set in Property Setup, from midnight to 6 AM.
alter table properties add column if not exists day_change_time time not null default '02:30';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'properties_day_change_time_check') then
    alter table properties add constraint properties_day_change_time_check
      check (day_change_time <= '06:00');
  end if;
end $$;

notify pgrst, 'reload schema';
