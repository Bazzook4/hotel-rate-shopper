import { createHash, randomBytes } from "crypto";
import { getSupabaseAdmin } from "@/lib/database";

/**
 * Onboarding links: a URL that lets a new hotel create its own property and
 * PropertyAdmin account, then lands it signed in.
 *
 * Two kinds. A one-hotel link is sent to a single hotel and works once. A
 * shareable link can be passed around and works for up to `max_uses`
 * hotels; the per-network and daily caps in rateLimit.js stop one person
 * using it up with made-up hotels.
 *
 * The link carries a random token; the table stores its hash, so the table
 * alone cannot be used to sign anyone up. A shareable link's token is kept
 * as well, so the admin can copy it again -- it is meant to be public.
 */

const INVITE_TTL_DAYS = 7;

export const SHARED_LINK_DEFAULTS = { maxUses: 25, days: 30 };
export const SHARED_LINK_MAX_USES = 200;
export const SHARED_LINK_MAX_DAYS = 90;

export function hashInviteToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createOnboardingInvite({
  propertyName = null,
  createdBy = null,
  maxUses = 1,
  days = INVITE_TTL_DAYS,
} = {}) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const shared = maxUses > 1;

  const { data, error } = await getSupabaseAdmin()
    .from("onboarding_invites")
    .insert({
      token_hash: hashInviteToken(token),
      // Every hotel on a shareable link types its own name.
      property_name: shared ? null : propertyName?.trim() || null,
      created_by: createdBy,
      expires_at: expiresAt.toISOString(),
      max_uses: maxUses,
      share_token: shared ? token : null,
    })
    .select("id, property_name, expires_at, max_uses")
    .single();

  if (error) throw new Error(`Failed to create onboarding link: ${error.message}`);
  return { ...data, token };
}

/** The invite behind a token, or null if it is unknown, full, off or expired. */
export async function findOpenInvite(token) {
  if (!token) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("onboarding_invites")
    .select("id, property_name, expires_at, max_uses")
    .eq("token_hash", hashInviteToken(token))
    .is("used_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) throw new Error(`Failed to read onboarding link: ${error.message}`);
  return data;
}

/**
 * Take one place on an invite. The database function is the single point
 * where two hotels racing for the last place are told apart: only one
 * update matches, and the other gets null back.
 */
export async function claimInvite(token) {
  const { data, error } = await getSupabaseAdmin().rpc("claim_onboarding_invite", {
    p_token_hash: hashInviteToken(token),
  });
  if (error) throw new Error(`Failed to claim onboarding link: ${error.message}`);
  return data?.[0] || null;
}

/** Give the place back, when signing up failed after claiming it. */
export async function releaseInvite(id) {
  await getSupabaseAdmin().rpc("release_onboarding_invite", { p_id: id });
}

/** Note who used a one-hotel link. A shareable link has many, so it keeps none. */
export async function completeInvite(invite, { userId, propertyId }) {
  if (invite.max_uses > 1) return;
  await getSupabaseAdmin()
    .from("onboarding_invites")
    .update({ used_by_user_id: userId, property_id: propertyId })
    .eq("id", invite.id);
}

/** Shareable links still worth showing: not switched off and not expired. */
export async function listSharedLinks() {
  const { data, error } = await getSupabaseAdmin()
    .from("onboarding_invites")
    .select("id, share_token, max_uses, use_count, expires_at, created_at")
    .gt("max_uses", 1)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to read onboarding links: ${error.message}`);
  return data || [];
}

/** Switch a link off. Hotels already signed up through it are untouched. */
export async function revokeInvite(id) {
  const { error } = await getSupabaseAdmin()
    .from("onboarding_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Failed to switch off onboarding link: ${error.message}`);
}
