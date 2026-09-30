import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { canManageProperties } from "@/lib/permissions";
import { createOnboardingInvite } from "@/lib/onboarding";

/**
 * Issue an onboarding link. Signing up through one creates a property, so
 * only someone who may create properties may hand one out.
 */
export async function POST(request) {
  const session = await getSessionFromRequest(request);
  if (!session || !canManageProperties(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));

  try {
    const invite = await createOnboardingInvite({
      propertyName: body?.propertyName,
      createdBy: session.userId,
    });
    const url = new URL(`/onboard?token=${invite.token}`, request.url).toString();
    return NextResponse.json({ url, expiresAt: invite.expires_at }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
