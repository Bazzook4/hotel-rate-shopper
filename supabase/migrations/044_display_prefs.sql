-- Per-property display choices: how the hotel wants its screens to look.
--
-- display_prefs.demand: occupancy colours on the Calendar and Rates &
-- Inventory date headers -- on or off, which grids, where each level starts
-- and its colour. Null (or a missing key) means the defaults in
-- src/lib/demandColours.js, which are switched off.
--
-- One JSON column so later display choices need no migration of their own.

alter table properties
  add column if not exists display_prefs jsonb;
