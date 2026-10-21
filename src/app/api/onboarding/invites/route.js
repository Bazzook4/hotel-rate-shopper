import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { canManageProperties } from "@/lib/permissions";
import {
  SHARED_LINK_DEFAULTS,
  SHARED_LINK_MAX_DAYS,
  SHARED_LINK_MAX_USES,
  createOnboardingInvite,
  listSharedLinks,
  revokeInvite,
} from "@/lib/onboarding";
import { SIGNUP_MAX_PER_DAY, SIGNUP_MAX_PER_IP_PER_DAY } from "@/lib/rateLimit";

/**
 * Onboarding links. Signing up through one creates a property, so only
 * someone who may create properties may hand one out or see them.
 */
async function authorise(request) {
  const session = await getSessionFromRequest(request);
  return session && canManageProperties(session) ? session : null;
}

const UNAUTHORISED = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

const linkUrl = (request, token) => new URL(`/onboard?token=${token}`, request.url).toString();

/** A database error in words an admin can act on. */
function failure(err) {
  const missing = /max_uses|use_count|revoked_at|share_token|claim_onboarding_invite/.test(err.message);
  return NextResponse.json(
    { error: missing ? "Onboarding links need database update 052 to be run first." : err.message },
    { status: 500 }
  );
}

const clamp = (value, fallback, max) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : fallback;
};

/** The shareable links still open, with their links to copy again. */
export async function GET(request) {
  if (!(await authorise(request))) return UNAUTHORISED();
  try {
    const links = await listSharedLinks();
    return NextResponse.json({
      links: links.map(({ share_token, ...link }) => ({ ...link, url: linkUrl(request, share_token) })),
      caps: { perConnection: SIGNUP_MAX_PER_IP_PER_DAY, perDay: SIGNUP_MAX_PER_DAY },
    });
  } catch (err) {
    return failure(err);
  }
}

/**
 * Issue a link: one hotel by default, or `shared: true` for a link up to
 * `maxUses` hotels can sign up through over `days`.
 */
export async function POST(request) {
  const session = await authorise(request);
  if (!session) return UNAUTHORISED();

  const body = await request.json().catch(() => ({}));
  const shared = body?.shared === true;

  try {
    const invite = await createOnboardingInvite({
      propertyName: body?.propertyName,
      createdBy: session.userId,
      ...(shared && {
        maxUses: Math.max(2, clamp(body?.maxUses, SHARED_LINK_DEFAULTS.maxUses, SHARED_LINK_MAX_USES)),
        days: clamp(body?.days, SHARED_LINK_DEFAULTS.days, SHARED_LINK_MAX_DAYS),
      }),
    });
    return NextResponse.json(
      { url: linkUrl(request, invite.token), expiresAt: invite.expires_at, maxUses: invite.max_uses },
      { status: 201 }
    );
  } catch (err) {
    return failure(err);
  }
}

/** Switch a shareable link off. */
export async function DELETE(request) {
  if (!(await authorise(request))) return UNAUTHORISED();
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "No link given to switch off." }, { status: 400 });
  try {
    await revokeInvite(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return failure(err);
  }
}
