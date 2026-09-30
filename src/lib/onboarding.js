import { createHash, randomBytes } from "crypto";
import { getSupabaseAdmin } from "@/lib/database";

/**
 * Onboarding links: a single-use URL that lets a new hotel create its own
 * property and PropertyAdmin account, then lands it signed in.
 *
 * The link carries a random token; the table stores only its hash, so the
 * table alone cannot be used to sign anyone up.
 */

const INVITE_TTL_DAYS = 7;

export function hashInviteToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createOnboardingInvite({ propertyName = null, createdBy = null } = {}) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  const { data, error } = await getSupabaseAdmin()
    .from("onboarding_invites")
    .insert({
      token_hash: hashInviteToken(token),
      property_name: propertyName?.trim() || null,
      created_by: createdBy,
      expires_at: expiresAt.toISOString(),
    })
    .select("id, property_name, expires_at")
    .single();

  if (error) throw new Error(`Failed to create onboarding link: ${error.message}`);
  return { ...data, token };
}

/** The invite behind a token, or null if it is unknown, used or expired. */
export async function findOpenInvite(token) {
  if (!token) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("onboarding_invites")
    .select("id, property_name, expires_at")
    .eq("token_hash", hashInviteToken(token))
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) throw new Error(`Failed to read onboarding link: ${error.message}`);
  return data;
}

/**
 * Mark an invite used. The `used_at is null` filter makes this the single
 * point where two people racing on the same link are told apart: only one
 * update matches, and the other gets null back.
 */
export async function claimInvite(token) {
  const { data, error } = await getSupabaseAdmin()
    .from("onboarding_invites")
    .update({ used_at: new Date().toISOString() })
    .eq("token_hash", hashInviteToken(token))
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id, property_name")
    .maybeSingle();

  if (error) throw new Error(`Failed to claim onboarding link: ${error.message}`);
  return data;
}

/** Put a claimed invite back, when signing up failed after claiming it. */
export async function releaseInvite(id) {
  await getSupabaseAdmin().from("onboarding_invites").update({ used_at: null }).eq("id", id);
}

export async function completeInvite(id, { userId, propertyId }) {
  await getSupabaseAdmin()
    .from("onboarding_invites")
    .update({ used_by_user_id: userId, property_id: propertyId })
    .eq("id", id);
}
