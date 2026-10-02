-- Workflow rules: stop sell on chosen channels when a night fills up
--
-- A rule watches one room type, or the whole hotel, night by night:
--   "when Deluxe has 5 or more sold, stop selling it on Agoda"
-- It is checked every time availability changes -- a booking, a
-- cancellation, an OTA booking adopted, a room taken out of order -- and once
-- a day for rules that only look a few days ahead.
--
-- A rule acts through daily_channel_restrictions (migration 036). Each row a
-- rule closes carries set_by_rule_id, so the rule reopens only what it closed
-- itself:
--   set_by_rule_id set           closed by that rule; reopened (stop_sell
--                                back to NULL) when the condition no longer
--                                holds, the rule is switched off or deleted
--   set_by_rule_id NULL, value   set by a person in the Channel Manager; no
--                                rule ever changes it. Setting a channel to
--                                "Open" by hand keeps it open against a rule.
--
-- metric:
--   sold       rooms sold that night         condition: sold >= threshold
--   left       rooms still free to sell       condition: left <= threshold
--   occupancy  sold / rooms in the hotel, %   condition: % >= threshold
-- room_type_id NULL means the whole hotel: totals across every room type,
-- and the stop sell applies to every room type.
-- rate_plan_ids NULL means every rate plan sold in the room.
-- within_days NULL means every future night; 7 means tonight and the six
-- nights after it.
--
-- Also lets the activity log record what a rule did (kind 'workflow').
--
-- Safe to run more than once. Needs 036_channel_stop_sell.sql first.

CREATE TABLE IF NOT EXISTS workflow_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  room_type_id UUID REFERENCES room_types(id) ON DELETE CASCADE,
  metric TEXT NOT NULL CHECK (metric IN ('sold', 'left', 'occupancy')),
  threshold NUMERIC NOT NULL CHECK (threshold >= 0),
  action TEXT NOT NULL DEFAULT 'stop_sell' CHECK (action IN ('stop_sell')),
  channels TEXT[] NOT NULL,
  rate_plan_ids UUID[],
  within_days INTEGER CHECK (within_days IS NULL OR within_days BETWEEN 1 AND 365),
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_rules_property
  ON workflow_rules(property_id);

ALTER TABLE workflow_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role only on workflow_rules" ON workflow_rules;
CREATE POLICY "Service role only on workflow_rules" ON workflow_rules
  FOR ALL TO service_role USING (true);

-- Which rule closed a channel. The app reopens a rule's closures before it
-- deletes the rule; SET NULL is only a backstop.
ALTER TABLE daily_channel_restrictions
  ADD COLUMN IF NOT EXISTS set_by_rule_id UUID REFERENCES workflow_rules(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_daily_channel_restrictions_rule
  ON daily_channel_restrictions(set_by_rule_id)
  WHERE set_by_rule_id IS NOT NULL;

-- The activity log gains a 'workflow' kind.
ALTER TABLE sync_logs DROP CONSTRAINT IF EXISTS sync_logs_kind_check;
ALTER TABLE sync_logs ADD CONSTRAINT sync_logs_kind_check
  CHECK (kind IN ('rates', 'inventory', 'restrictions', 'multiplier', 'reservation', 'workflow'));
