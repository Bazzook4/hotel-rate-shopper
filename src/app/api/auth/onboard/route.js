import { NextResponse } from "next/server";
import { createUser, findUserByEmail, getSupabaseAdmin } from "@/lib/database";
import { hashPassword } from "@/lib/password";
import { setSessionCookie } from "@/lib/session";
import { ROLES } from "@/lib/permissions";
import { claimInvite, completeInvite, findOpenInvite, releaseInvite } from "@/lib/onboarding";

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Paid-lookup features a self-onboarded hotel does not get until we switch them on. */
const ONBOARDED_DISABLED_MODULES = ["parity", "compshopper"];

const GONE ={ error: "This onboarding link has expired or has already been used." };

/** Whether a link is still good, and the hotel name it was issued for. */
export async function GET(request) {
  const token = request.nextUrl.searchParams.get("token");
  const invite = await findOpenInvite(token).catch(() => null);
  if (!invite) return NextResponse.json(GONE, { status: 410 });
  return NextResponse.json({ propertyName: invite.property_name });
}

/**
 * Sign up through an onboarding link: create the property, create its
 * PropertyAdmin with the email and password given, and sign them in.
 */
export async function POST(request) {
  const body = await request.json().catch(() => null);
  const token = body?.token || "";
  const propertyName = body?.propertyName?.trim() || "";
  const email = body?.email?.trim().toLowerCase() || "";
  const password = body?.password ?? "";

  if (!propertyName) {
    return NextResponse.json({ error: "Hotel name is required" }, { status: 400 });
  }
  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      { status: 400 }
    );
  }

  // Checked before claiming, so a typo'd existing address does not burn the
  // link. The unique constraint on users.email still catches a race.
  if (await findUserByEmail(email)) {
    return NextResponse.json(
      { error: "An account with that email already exists. Sign in instead." },
      { status: 409 }
    );
  }

  const invite = await claimInvite(token).catch(() => null);
  if (!invite) return NextResponse.json(GONE, { status: 410 });

  const supabase = getSupabaseAdmin();
  let property = null;

  try {
    const { data, error } = await supabase
      .from("properties")
      .insert({ name: propertyName, email, disabled_modules: ONBOARDED_DISABLED_MODULES })
      .select()
      .single();
    if (error) throw new Error(`Failed to create property: ${error.message}`);
    property = data;

    const user = await createUser({
      email,
      passwordHash: hashPassword(password),
      role: ROLES.PROPERTY_ADMIN,
      status: "Active",
      propertyIds: [property.id],
    });

    await completeInvite(invite.id, { userId: user.id, propertyId: property.id });

    const response = NextResponse.json({
      user: { id: user.id, email: user.email, propertyId: property.id, propertyName: property.name },
    });
    // No module grants means every page the role allows, same as a user
    // created from the admin screen without any ticked.
    await setSessionCookie(response, {
      userId: user.id,
      email: user.email,
      role: user.role,
      property_id: property.id,
      modules: [],
    });
    return response;
  } catch (err) {
    console.error("Onboarding failed:", err);
    // Leave nothing half-made behind, and let the hotel try the link again.
    if (property) await supabase.from("properties").delete().eq("id", property.id);
    await releaseInvite(invite.id);
    return NextResponse.json(
      { error: "Could not create your account. Please try again." },
      { status: 500 }
    );
  }
}
