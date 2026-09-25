-- What each competitor was actually selling, for the day view.
--
-- Split from 019 because that migration had already been applied: a migration
-- that has run is a record of what happened, so a later change gets its own
-- file rather than editing history.
--
-- Both columns are nullable and default safely, so existing rows stay valid:
-- Google names the room only on its featured listings, and the cheapest quote
-- is often the hotel's own direct rate, which carries no room name at all.
ALTER TABLE competitor_rates
  ADD COLUMN IF NOT EXISTS room_name TEXT,
  ADD COLUMN IF NOT EXISTS free_cancellation BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN competitor_rates.room_name IS
  'Room being sold at the cheapest quote, where Google named one. May describe a slightly dearer row than the stored rate.';
COMMENT ON COLUMN competitor_rates.free_cancellation IS
  'Whether the cheapest quote was refundable, as reported by the channel.';
