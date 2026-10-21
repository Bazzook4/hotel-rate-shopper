-- Shareable onboarding links. Besides the one-hotel link from migration 032,
-- a super admin can issue a link many hotels may sign up through -- for a
-- website, a WhatsApp group, a trade fair -- capped at a number of hotels,
-- with an expiry, and switchable off at any time.
--
-- A one-hotel link is simply max_uses = 1. `used_at` now means "full": it is
-- set when the last allowed hotel signs up.
--
-- A shareable link is meant to be passed around, so its token is also kept
-- in `share_token` for the admin to copy again later. One-hotel links still
-- store only the hash.
alter table onboarding_invites add column if not exists max_uses    integer     not null default 1;
alter table onboarding_invites add column if not exists use_count   integer     not null default 0;
alter table onboarding_invites add column if not exists revoked_at  timestamptz;
alter table onboarding_invites add column if not exists share_token text;

update onboarding_invites set use_count = 1 where used_at is not null and use_count = 0;

-- Take one place on a link. Two hotels racing for the last place are told
-- apart here: the row lock lets only one update see use_count < max_uses.
create or replace function claim_onboarding_invite(p_token_hash text)
returns table (id uuid, property_name text, max_uses integer)
language sql as $$
  update onboarding_invites i
     set use_count = i.use_count + 1,
         used_at   = case when i.use_count + 1 >= i.max_uses then now() else i.used_at end
   where i.token_hash = p_token_hash
     and i.revoked_at is null
     and i.expires_at > now()
     and i.use_count < i.max_uses
  returning i.id, i.property_name, i.max_uses;
$$;

-- Give a place back, when signing up failed after claiming it.
create or replace function release_onboarding_invite(p_id uuid)
returns void
language sql as $$
  update onboarding_invites
     set use_count = greatest(use_count - 1, 0),
         used_at   = null
   where id = p_id;
$$;

revoke all on function claim_onboarding_invite(text) from public, anon, authenticated;
revoke all on function release_onboarding_invite(uuid) from public, anon, authenticated;
