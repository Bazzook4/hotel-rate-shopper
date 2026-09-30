-- Onboarding links. A super admin issues one; the hotel opens it, chooses the
-- email and password it will sign in with, and gets its own property and
-- PropertyAdmin account in the same step.
--
-- Only a hash of the token is stored, so someone reading this table cannot
-- use a live link. Each link works once: `used_at` is set atomically when it
-- is claimed.
create table if not exists onboarding_invites (
  id              uuid        primary key default gen_random_uuid(),
  token_hash      text        not null unique,
  property_name   text,
  created_by      uuid        references users(id) on delete set null,
  expires_at      timestamptz not null,
  used_at         timestamptz,
  used_by_user_id uuid        references users(id) on delete set null,
  property_id     uuid        references properties(id) on delete set null,
  created_at      timestamptz not null default now()
);

alter table onboarding_invites enable row level security;

drop policy if exists "Service role only on onboarding_invites" on onboarding_invites;
create policy "Service role only on onboarding_invites" on onboarding_invites
  for all to service_role using (true);
