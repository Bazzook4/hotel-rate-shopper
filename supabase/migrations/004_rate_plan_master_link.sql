-- Rate plan master linking + setup administrator flag
--
-- Derived pricing is computed here, not in Aiosell. Aiosell only transports
-- the resulting rates and inventory to channels.

-- ============================================
-- RATE PLAN MASTER LINKING
-- ============================================
-- A plan is either a master (is_master = true, derive_from_id IS NULL) or is
-- derived from exactly one master. Derived plans compute their rate from the
-- master's rate using one of:
--   'offset'     -> master_rate + derive_value      (e.g. +500 for breakfast)
--   'multiplier' -> master_rate * derive_value      (e.g. x0.90 non-refundable)
--   'percent'    -> master_rate * (1 + value/100)   (e.g. +25%)
ALTER TABLE rate_plans
  ADD COLUMN IF NOT EXISTS is_master BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS derive_from_id UUID REFERENCES rate_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS derive_method TEXT
    CHECK (derive_method IN ('offset', 'multiplier', 'percent')),
  ADD COLUMN IF NOT EXISTS derive_value NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS room_type_id UUID REFERENCES room_types(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_rate_plans_derive_from ON rate_plans(derive_from_id);
CREATE INDEX IF NOT EXISTS idx_rate_plans_room_type ON rate_plans(room_type_id);

-- A master cannot itself derive from another plan.
ALTER TABLE rate_plans
  DROP CONSTRAINT IF EXISTS rate_plans_master_not_derived;
ALTER TABLE rate_plans
  ADD CONSTRAINT rate_plans_master_not_derived
  CHECK (NOT (is_master = true AND derive_from_id IS NOT NULL));

-- A derived plan needs both a method and a value.
ALTER TABLE rate_plans
  DROP CONSTRAINT IF EXISTS rate_plans_derive_complete;
ALTER TABLE rate_plans
  ADD CONSTRAINT rate_plans_derive_complete
  CHECK (
    derive_from_id IS NULL
    OR (derive_method IS NOT NULL AND derive_value IS NOT NULL)
  );

-- A plan cannot derive from itself.
ALTER TABLE rate_plans
  DROP CONSTRAINT IF EXISTS rate_plans_no_self_derive;
ALTER TABLE rate_plans
  ADD CONSTRAINT rate_plans_no_self_derive
  CHECK (derive_from_id IS NULL OR derive_from_id <> id);

-- ============================================
-- SETUP ADMINISTRATOR
-- ============================================
-- Only users with can_manage_setup may create or edit room types and rate
-- plans. This is separate from the global 'Admin' role: a global Admin grants
-- it, but a PropertyUser can hold it for their own property.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS can_manage_setup BOOLEAN DEFAULT false;

-- Existing global Admins keep the access they already had.
UPDATE users SET can_manage_setup = true WHERE role = 'Admin';

-- Grant the new Property Setup module to global Admins.
INSERT INTO user_modules (user_id, module_id, enabled)
SELECT u.id, 'setup', true
FROM users u
WHERE u.role = 'Admin'
ON CONFLICT (user_id, module_id) DO NOTHING;
