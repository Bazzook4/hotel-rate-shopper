-- Events: an "Info only" impact.
--
-- A public holiday shown to every hotel in a country cannot say which way it
-- moves demand -- a bank holiday fills a resort and empties a business hotel
-- -- so it is marked 'none': it shows on every date grid and moves no price.
-- The pricing engine reads it as a lift of 0, which its events signal already
-- treats as having nothing to say.
--
-- Safe to run more than once. Needs 039_events.sql first.

alter table events drop constraint if exists events_impact_check;
alter table events add constraint events_impact_check
  check (impact in ('none', 'low', 'medium', 'high'));
