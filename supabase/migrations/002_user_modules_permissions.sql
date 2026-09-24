-- User Modules Permissions Migration
-- Adds granular module-level access control for users

-- ============================================
-- USER_MODULES TABLE
-- ============================================
CREATE TABLE user_modules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, module_id)
);

CREATE INDEX idx_user_modules_user ON user_modules(user_id);
CREATE INDEX idx_user_modules_module ON user_modules(module_id);

-- Add updated_at trigger
CREATE TRIGGER update_user_modules_updated_at BEFORE UPDATE ON user_modules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE user_modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can do everything on user_modules" ON user_modules
  FOR ALL USING (true);

-- ============================================
-- MODULE DEFINITIONS (Reference)
-- ============================================
-- Available module IDs:
-- 'ratetracker'  - Single Search / Rate Tracker
-- 'history'      - Rate History
-- 'compare'      - Compare Hotels (CompSet Editor)
-- 'location'     - Search by Location
-- 'disparity'    - Disparity Checker
-- 'pricing'      - Dynamic Pricing
-- 'users'        - Manage Users (Admin only)
