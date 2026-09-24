-- Promote admin@admin.com to SuperAdmin.
--
-- Migration 005 converted role 'Admin' -> 'SuperAdmin', but an account
-- created with a different role (or created after 005 ran) keeps that role.
-- This sets it explicitly and is safe to run more than once.

-- The CHECK constraint from 005 must exist before 'SuperAdmin' can be stored.
-- Running 005 first is required; this is a no-op guard in case it did not.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('SuperAdmin', 'PropertyAdmin', 'PropertyUser'));

UPDATE users
SET role = 'SuperAdmin',
    can_manage_setup = true,
    updated_at = NOW()
WHERE lower(email) = 'admin@admin.com';

-- Give the account every dashboard module.
INSERT INTO user_modules (user_id, module_id, enabled)
SELECT u.id, m.module_id, true
FROM users u
CROSS JOIN (VALUES ('cm'), ('compshopper'), ('parity'), ('location'),
                   ('pricing'), ('setup')) AS m(module_id)
WHERE lower(u.email) = 'admin@admin.com'
ON CONFLICT (user_id, module_id) DO NOTHING;
