-- Events: which occasion an event is, so a hotel sees each one once.
--
-- One occasion is often several rows, each for different hotels: Holi is an
-- Info only national holiday for every hotel, a Medium long weekend for
-- leisure hotels and a High festival week in Mathura. A hotel matching more
-- than one would see Holi two or three times. Rows of one occasion share
-- `occasion`, and the app shows a hotel only the strongest of them on any
-- night (oneEventPerOccasion in src/lib/eventTags.js).
--
-- NULL means the name is the occasion, so two rows both called "Diwali" are
-- already one without it. It is needed only where the names differ.
--
-- Safe to run more than once. Needs 039_events.sql first.

alter table events add column if not exists occasion text;
