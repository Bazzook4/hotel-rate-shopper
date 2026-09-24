-- Per-activity connection flags
--
-- A connection is not all-or-nothing. Each property enables rate out,
-- inventory out and reservation in separately. Direction is from our point
-- of view: rates and inventory go out to the partner, reservations come in.
--
-- Added after 007 shipped, so it is a migration of its own rather than an
-- edit to that file.

ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS supports_rates_out BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS supports_inventory_out BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS supports_reservations_in BOOLEAN DEFAULT true;

ALTER TABLE property_integrations
  ADD COLUMN IF NOT EXISTS rates_out BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS inventory_out BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS reservations_in BOOLEAN DEFAULT false;

-- In case the seed in 007 did not run.
INSERT INTO partners (slug, name, base_url, enabled)
VALUES ('aiosell', 'Aiosell', 'https://live.aiosell.com/api/v2/cm', false)
ON CONFLICT (slug) DO NOTHING;
