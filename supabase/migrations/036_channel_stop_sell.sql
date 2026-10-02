-- Stop sell on one channel only
--
-- daily_restrictions closes a rate plan in a room on every channel at once.
-- A hotel also needs to close a plan on, say, Agoda alone -- a parity
-- complaint, a channel that oversold -- while Booking.com keeps selling.
-- Aiosell accepts that: its rate restriction push takes a toChannels list.
--
-- One row per (rate plan, room, date, channel). stop_sell overrides the
-- all-channels value in daily_restrictions for that channel only:
--   TRUE  closed on this channel, whatever the others do
--   FALSE open on this channel, even when closed everywhere else
--   NULL  no override; the channel follows the all-channels value
--
-- channel is Aiosell's slug ("agoda", "booking.com", "gommt", ...).
-- Only stop sell is per channel; minimum and maximum nights stay in
-- daily_restrictions and apply to every channel.
--
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS daily_channel_restrictions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  rate_plan_id UUID NOT NULL REFERENCES rate_plans(id) ON DELETE CASCADE,
  room_type_id UUID NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  stay_date DATE NOT NULL,
  channel TEXT NOT NULL,
  stop_sell BOOLEAN,
  pushed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (rate_plan_id, room_type_id, stay_date, channel)
);

CREATE INDEX IF NOT EXISTS idx_daily_channel_restrictions_lookup
  ON daily_channel_restrictions(property_id, stay_date);

ALTER TABLE daily_channel_restrictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role only on daily_channel_restrictions" ON daily_channel_restrictions;
CREATE POLICY "Service role only on daily_channel_restrictions" ON daily_channel_restrictions
  FOR ALL TO service_role USING (true);
