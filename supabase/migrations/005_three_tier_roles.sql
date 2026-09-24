-- Three-tier role model
--
--   SuperAdmin    - software team. Full access, every property, may switch
--                   between them, creates properties and assigns admins.
--   PropertyAdmin - the admin of one property. Configures that property's
--                   setup and manages its PropertyUsers.
--   PropertyUser  - a normal user of one property. No setup, no user admin.
--
-- Existing 'Admin' users become SuperAdmin so nobody loses access; property
-- owners can then be moved to PropertyAdmin individually from the admin panel.

-- The CHECK constraint must be replaced before new values can be stored.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

UPDATE users SET role = 'SuperAdmin' WHERE role = 'Admin';

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('SuperAdmin', 'PropertyAdmin', 'PropertyUser'));

ALTER TABLE users ALTER COLUMN role SET DEFAULT 'PropertyUser';

-- can_manage_setup (migration 004) is now implied by the role, but is kept so
-- a specific PropertyUser can still be granted setup rights as an exception.
UPDATE users SET can_manage_setup = true WHERE role IN ('SuperAdmin', 'PropertyAdmin');

-- Grant the current dashboard's modules to both admin tiers.
INSERT INTO user_modules (user_id, module_id, enabled)
SELECT u.id, m.module_id, true
FROM users u
CROSS JOIN (VALUES ('cm'), ('compshopper'), ('parity'), ('location'),
                   ('pricing'), ('setup')) AS m(module_id)
WHERE u.role IN ('SuperAdmin', 'PropertyAdmin')
ON CONFLICT (user_id, module_id) DO NOTHING;
