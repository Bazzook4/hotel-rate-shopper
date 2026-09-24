-- Meal plan codes and per-plan restrictions
--
-- Rate plans are named by the industry's meal codes rather than free text:
--   EP  European Plan       room only
--   CP  Continental Plan    breakfast
--   MAP Modified American   breakfast + one meal
--   AP  American Plan       all meals
--
-- Each has a non-refundable counterpart (NR EP, NR CP, ...), which is the
-- same meal basis sold on stricter terms, so refundability is a flag rather
-- than a separate set of codes.

ALTER TABLE rate_plans
  ADD COLUMN IF NOT EXISTS meal_plan TEXT
    CHECK (meal_plan IN ('EP', 'CP', 'MAP', 'AP')),
  ADD COLUMN IF NOT EXISTS refundable BOOLEAN DEFAULT true;

-- Restrictions travel with the rate plan and are pushed alongside its rates.
ALTER TABLE rate_plans
  ADD COLUMN IF NOT EXISTS stop_sell BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS min_stay INTEGER,
  ADD COLUMN IF NOT EXISTS max_stay INTEGER,
  ADD COLUMN IF NOT EXISTS close_on_arrival BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS close_on_departure BOOLEAN DEFAULT false;

-- Infer the meal basis of existing plans from their names, leaving anything
-- unrecognised for someone to set by hand.
UPDATE rate_plans SET meal_plan = 'CP'
  WHERE meal_plan IS NULL AND (plan_name ILIKE '%breakfast%' OR plan_name ILIKE '%CP%');
UPDATE rate_plans SET meal_plan = 'AP'
  WHERE meal_plan IS NULL AND plan_name ILIKE '%all meal%';
UPDATE rate_plans SET meal_plan = 'MAP'
  WHERE meal_plan IS NULL AND (plan_name ILIKE '%half board%' OR plan_name ILIKE '%MAP%');
UPDATE rate_plans SET meal_plan = 'EP'
  WHERE meal_plan IS NULL AND (plan_name ILIKE '%room only%' OR plan_name ILIKE '%EP%');

UPDATE rate_plans SET refundable = false
  WHERE plan_name ILIKE '%non-ref%' OR plan_name ILIKE '%non ref%' OR plan_name ILIKE '%NR %';
