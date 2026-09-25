-- Activity log for everything that crosses the channel-manager boundary
--
-- One row per attempt, whichever direction it went:
--
--   out  - a rate, inventory or restriction push we sent to the partner
--   in   - a reservation the partner posted to our webhook
--
-- Written even when the attempt failed, and even when the connection is not
-- live (source 'mock'), because "we tried and it did not go" is the thing a
-- hotelier actually needs to see. A log write must never break the operation
-- it describes, so every caller wraps this in a catch.
--
-- Reservations keep their own table (partner_reservations, 009): that row is
-- the booking, this row is the event. The log view reads both.

CREATE TABLE IF NOT EXISTS sync_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  integration_id UUID REFERENCES property_integrations(id) ON DELETE SET NULL,

  -- What happened. kind names the activity, direction says which way it went.
  kind TEXT NOT NULL CHECK (kind IN ('rates', 'inventory', 'restrictions', 'multiplier', 'reservation')),
  direction TEXT NOT NULL CHECK (direction IN ('out', 'in')),
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),

  -- 'aiosell' when it really went to the partner, 'mock' when the connection
  -- was not live, 'local' when we only saved on our side.
  source TEXT,

  -- Who triggered it. Null for inbound calls: the partner has no user here.
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  user_email TEXT,

  -- The shape of the change, for scanning the list without opening a row.
  date_from DATE,
  date_to DATE,
  entry_count INTEGER,
  summary TEXT,

  error TEXT,
  duration_ms INTEGER,

  -- Exactly what we sent and what came back, for settling a dispute with the
  -- partner. Trimmed by the writer so one push cannot store megabytes.
  request JSONB,
  response JSONB,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- The log is always read newest-first for one property, usually filtered by
-- kind, so the index leads with property and time.
CREATE INDEX IF NOT EXISTS idx_sync_logs_property
  ON sync_logs(property_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_logs_property_kind
  ON sync_logs(property_id, kind, created_at DESC);

ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role only on sync_logs" ON sync_logs;
CREATE POLICY "Service role only on sync_logs" ON sync_logs
  FOR ALL USING (true);
