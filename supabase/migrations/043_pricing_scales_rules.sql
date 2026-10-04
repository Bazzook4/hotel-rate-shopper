-- Dynamic pricing: the hotelier's own scales and rules.
--
-- scales: how each signal turns a reading into a move -- the occupancy by
-- days-out table, pace and pickup bands, the 90-day and last-year gap
-- followers, and the day-of-week moves. Null means the defaults in
-- src/lib/pricingScales.js, which are the numbers the engine used before.
--
-- adjustments: rules applied after the signals -- close to arrival, booking
-- far ahead, short gaps between bookings. Null means none.
--
-- weight_pace: the custom weight for the new pace signal (rooms on the
-- books now against the same point last year).
--
-- On recommendations, rule_pct is how much of the recommended rate came from
-- the rules, and carried_pct how much of the live rate already did. The next
-- run takes the carried amount out before applying the rules again, so
-- "-10% close to arrival" does not become -10% on every recalculation.

alter table pricing_strategy
  add column if not exists weight_pace numeric(6, 2) not null default 1.0,
  add column if not exists scales jsonb,
  add column if not exists adjustments jsonb;

alter table pricing_recommendations
  add column if not exists rule_pct numeric(7, 2) not null default 0,
  add column if not exists carried_pct numeric(7, 2) not null default 0;
