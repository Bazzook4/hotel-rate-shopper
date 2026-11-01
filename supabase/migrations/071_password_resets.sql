-- Forgot password: one row per reset link emailed from the login page.
-- Only a hash of the link's secret is kept, so reading this table gives
-- nobody a working link. A link lasts an hour and works once.
--
-- Written only by the server (service key); no policies, so the public API
-- can neither read nor write it.
--
-- Safe to run more than once.

create table if not exists password_resets (
  id bigint generated always as identity primary key,
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_resets_user on password_resets (user_id, created_at desc);

alter table password_resets enable row level security;

notify pgrst, 'reload schema';
