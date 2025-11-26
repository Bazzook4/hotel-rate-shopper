-- Initial Schema Migration for Hotel Rate Shopper
-- This replaces the Airtable structure with PostgreSQL tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'PropertyUser' CHECK (role IN ('Admin', 'PropertyUser')),
  status TEXT DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive', 'Pending')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);

-- ============================================
-- PROPERTIES TABLE
-- ============================================
CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  state TEXT,
  country TEXT,
  postal_code TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  description TEXT,
  amenities TEXT[], -- Array of amenities
  star_rating INTEGER CHECK (star_rating >= 1 AND star_rating <= 5),
  total_rooms INTEGER,
  check_in_time TIME,
  check_out_time TIME,
  -- Dynamic Pricing fields
  pricing_enabled BOOLEAN DEFAULT FALSE,
  base_pricing_mode TEXT, -- 'flat', 'occupancy', 'per_adult'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_properties_name ON properties(name);
CREATE INDEX idx_properties_city ON properties(city);

-- ============================================
-- USER-PROPERTY RELATIONSHIP
-- ============================================
CREATE TABLE user_properties (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, property_id)
);

-- ============================================
-- COMPSETS TABLE
-- ============================================
CREATE TABLE compsets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  competitor_hotels JSONB, -- Store competitor hotel data as JSON
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_compsets_property ON compsets(property_id);

-- ============================================
-- SNAPSHOTS TABLE
-- ============================================
CREATE TABLE snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  compset_id UUID REFERENCES compsets(id) ON DELETE CASCADE,
  source TEXT DEFAULT 'hotel_search',
  search_query TEXT,
  payload JSONB,
  request_params JSONB,
  saved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  saved_by_email TEXT,
  snapshot_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_snapshots_compset ON snapshots(compset_id);
CREATE INDEX idx_snapshots_source ON snapshots(source);
CREATE INDEX idx_snapshots_date ON snapshots(snapshot_date DESC);
CREATE INDEX idx_snapshots_saved_by ON snapshots(saved_by_email);

-- ============================================
-- ROOM TYPES TABLE
-- ============================================
CREATE TABLE room_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_type_id TEXT UNIQUE NOT NULL,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  room_type_name TEXT NOT NULL,
  base_price NUMERIC(10, 2) NOT NULL,
  number_of_rooms INTEGER NOT NULL,
  max_adults INTEGER,
  description TEXT,
  amenities TEXT[], -- Array of amenities
  occupancy_pricing JSONB, -- Store occupancy-based pricing as JSON
  rank INTEGER, -- For ordering/sorting
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_room_types_property ON room_types(property_id);
CREATE INDEX idx_room_types_room_type_id ON room_types(room_type_id);
CREATE INDEX idx_room_types_rank ON room_types(property_id, rank);

-- ============================================
-- RATE PLANS TABLE
-- ============================================
CREATE TABLE rate_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rate_plan_id TEXT UNIQUE NOT NULL,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  plan_name TEXT NOT NULL,
  pricing_type TEXT DEFAULT 'multiplier' CHECK (pricing_type IN ('multiplier', 'flat')),
  multiplier NUMERIC(10, 4), -- For multiplier-based pricing
  cost_per_adult NUMERIC(10, 2), -- For flat meal cost per adult
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_rate_plans_property ON rate_plans(property_id);
CREATE INDEX idx_rate_plans_rate_plan_id ON rate_plans(rate_plan_id);

-- ============================================
-- PRICING FACTORS TABLE
-- ============================================
CREATE TABLE pricing_factors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  factor_id TEXT UNIQUE NOT NULL,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  demand_factor NUMERIC(10, 4) DEFAULT 1.0,
  seasonal_factor NUMERIC(10, 4) DEFAULT 1.0,
  competitor_factor NUMERIC(10, 4) DEFAULT 1.0,
  weekend_multiplier NUMERIC(10, 4) DEFAULT 1.0,
  weekday_multipliers JSONB, -- Store day-specific multipliers
  extra_adult_rate NUMERIC(10, 2),
  extra_child_rate NUMERIC(10, 2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(property_id) -- One pricing factor per property
);

CREATE INDEX idx_pricing_factors_property ON pricing_factors(property_id);
CREATE INDEX idx_pricing_factors_factor_id ON pricing_factors(factor_id);

-- ============================================
-- PRICING SNAPSHOTS TABLE
-- ============================================
CREATE TABLE pricing_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  snapshot_id TEXT UNIQUE NOT NULL,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  snapshot_data JSONB NOT NULL, -- Store entire pricing snapshot as JSON
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_pricing_snapshots_property ON pricing_snapshots(property_id);
CREATE INDEX idx_pricing_snapshots_created ON pricing_snapshots(created_at DESC);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add updated_at triggers to tables
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_properties_updated_at BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_compsets_updated_at BEFORE UPDATE ON compsets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_room_types_updated_at BEFORE UPDATE ON room_types
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rate_plans_updated_at BEFORE UPDATE ON rate_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pricing_factors_updated_at BEFORE UPDATE ON pricing_factors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- SEED DATA: Create default admin user
-- ============================================
-- Password: admin@1234
-- Hash generated using scrypt (same as your app)
INSERT INTO users (email, password_hash, role, status)
VALUES (
  'admin@admin.com',
  'scrypt:ShzCbT50JJcTkn6uHMXutw==:u2BQIou2zKxYOolXwkdy5+8jbKUT/7r5YiSsCKhlLLFQSkkhPrDu6GasRb1dX1DWgtM3S9iHscPgLcyi+Nt4mQ==',
  'Admin',
  'Active'
);

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================
-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE compsets ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_snapshots ENABLE ROW LEVEL SECURITY;

-- For now, allow service role to access everything
-- You can add more granular policies later
CREATE POLICY "Service role can do everything on users" ON users
  FOR ALL USING (true);

CREATE POLICY "Service role can do everything on properties" ON properties
  FOR ALL USING (true);

CREATE POLICY "Service role can do everything on user_properties" ON user_properties
  FOR ALL USING (true);

CREATE POLICY "Service role can do everything on compsets" ON compsets
  FOR ALL USING (true);

CREATE POLICY "Service role can do everything on snapshots" ON snapshots
  FOR ALL USING (true);

CREATE POLICY "Service role can do everything on room_types" ON room_types
  FOR ALL USING (true);

CREATE POLICY "Service role can do everything on rate_plans" ON rate_plans
  FOR ALL USING (true);

CREATE POLICY "Service role can do everything on pricing_factors" ON pricing_factors
  FOR ALL USING (true);

CREATE POLICY "Service role can do everything on pricing_snapshots" ON pricing_snapshots
  FOR ALL USING (true);
