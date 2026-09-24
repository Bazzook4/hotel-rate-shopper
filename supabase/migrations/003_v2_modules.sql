-- v2 module ids
--
-- v2 runs alongside v1 at /v2. v1 module ids ('ratetracker', 'history',
-- 'compare', 'location', 'disparity', 'pricing', 'users') are unchanged, so
-- existing grants keep working exactly as before.
--
-- New v2 module ids, stored in the same user_modules table:
--   'cm'           - Channel Manager (Aiosell)
--   'compshopper'  - Comp Rate Shopper (calendar view)
--   'parity'       - Rate Parity (v2 name for 'disparity')
--   'location'     - Search by Location (shared id with v1)
--   'pricing'      - Dynamic Pricing (shared id with v1)
--
-- No schema change is required: user_modules.module_id is free-form TEXT.
-- This migration only grants the new modules to existing Admin users so the
-- v2 dashboard is reachable immediately after deploy.

INSERT INTO user_modules (user_id, module_id, enabled)
SELECT u.id, m.module_id, true
FROM users u
CROSS JOIN (VALUES ('cm'), ('compshopper'), ('parity')) AS m(module_id)
WHERE u.role = 'Admin'
ON CONFLICT (user_id, module_id) DO NOTHING;
