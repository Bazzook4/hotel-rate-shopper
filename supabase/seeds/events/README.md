# Event seeds

Shared events, one file per country and period: `<ISO country code>_<period>.sql`,
for example `IN_2026-2027.sql`. The events table itself is created by migration
`039_events.sql`; these files only add rows to it. They are not migrations, so no
number: run one whenever a new geography or year is ready.

Like migrations, they are pasted into the Supabase SQL editor by hand. Each file
is safe to run twice, because a row is skipped when a shared event with the same
name, start date and place already exists.

## Adding a geography

1. **Places (optional, but worth it for a country with many hotels).** Add an
   entry for the country to `src/lib/places.js`: its states or regions, the cities
   hotels are usually in, and the other names places go by (`Bombay` → `Mumbai`).
   This gives the profile form a state dropdown and stops two spellings of one
   town from missing each other. A country with no entry still works: state and
   city are typed freely and suggested from the shared events already there.
2. **Events.** Copy an existing seed file, change the country code in the
   `insert` and the `not exists` check, and replace the rows. Tag each event as
   narrowly as it really applies:
   - only the country for national holidays,
   - the state or city for regional festivals and city events,
   - `property_types` when only some kinds of hotel fill (long weekends and school
     holidays: leisure kinds; wedding seasons: `{wedding}`).
   Use the place names from `places.js` where the country has an entry.
3. **Check the dates** against an official source. Mark anything not yet
   announced as "Approximate" in its notes.

Events can also be added one at a time on the Events page by a super admin.

## Kept up to date

Each file covers a fixed period. Add the next year's file before the current one
runs out, or the calendar goes quiet and Dynamic Pricing loses the events signal.
