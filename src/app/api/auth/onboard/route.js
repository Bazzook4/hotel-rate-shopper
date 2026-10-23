import { NextResponse } from "next/server";
import {
  createRatePlanWithDerivation,
  createRoomType,
  createUser,
  findUserByEmail,
  getSupabaseAdmin,
  saveRatePlanRooms,
  setUserModules,
  syncRoomBasePrices,
} from "@/lib/database";
import { hashPassword } from "@/lib/password";
import { setSessionCookie } from "@/lib/session";
import { ROLES } from "@/lib/permissions";
import { getDefaultAdminModules } from "@/lib/rights";
import { claimInvite, completeInvite, findOpenInvite, releaseInvite } from "@/lib/onboarding";
import { savePropertyProfile, validateProfile } from "@/lib/events";
import { clientIp, recordSignup, signupBlockedBy } from "@/lib/rateLimit";
import { STARTER_PLANS, validateStarterSetup } from "@/lib/onboardSetup";

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Nobody fills in a hotel's name, place, email and password this fast.
const MIN_FILL_MS = 5000;
// Caps the rooms the hotel can set up (lib/roomCap.js).
const MAX_ROOMS = 1000;

const GONE = { error: "This onboarding link has expired, is full, or was switched off." };
const CAPPED = {
  ip: "Several hotels have already signed up from this internet connection today. Try again tomorrow, or ask us for a link of your own.",
  all: "We are full for today. Please try again tomorrow, or ask us for a link of your own.",
};

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
  const totalRooms = Number(body?.totalRooms);
  const contactName = body?.contactName?.trim().slice(0, 120) || "";
  const contactPhone = body?.contactPhone?.trim().slice(0, 30) || "";

  // Bot traps: a field people cannot see, and a form sent too soon after it
  // opened. Told nothing useful, so a script has nothing to tune against.
  const filledFor = Date.now() - Number(body?.startedAt || 0);
  if (body?.website || !(filledFor >= MIN_FILL_MS)) {
    return NextResponse.json(
      { error: "Could not create your account. Please try again." },
      { status: 400 }
    );
  }

  if (!propertyName) {
    return NextResponse.json({ error: "Hotel name is required" }, { status: 400 });
  }
  if (!Number.isInteger(totalRooms) || totalRooms < 1 || totalRooms > MAX_ROOMS) {
    return NextResponse.json(
      { error: `Total rooms must be a whole number from 1 to ${MAX_ROOMS}.` },
      { status: 400 }
    );
  }
  const starter = validateStarterSetup(
    { roomTypes: body?.roomTypes, planCodes: body?.planCodes },
    totalRooms
  );
  if (starter.error) {
    return NextResponse.json({ error: starter.error }, { status: 400 });
  }
  if (!contactName) {
    return NextResponse.json({ error: "Your name is required" }, { status: 400 });
  }
  if (contactPhone.replace(/\D/g, "").length < 10) {
    return NextResponse.json(
      { error: "Enter your mobile number, so we can reach you." },
      { status: 400 }
    );
  }
  const { profile, error: profileError } = validateProfile(body?.profile);
  if (profileError) {
    return NextResponse.json({ error: profileError }, { status: 400 });
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

  // A shareable link is capped per network address and per day; a one-hotel
  // link was sent to one hotel and needs no cap.
  const open = await findOpenInvite(token).catch(() => null);
  if (!open) return NextResponse.json(GONE, { status: 410 });
  const shared = open.max_uses > 1;
  const ip = clientIp(request);
  if (shared) {
    const blockedBy = await signupBlockedBy(ip).catch((err) => {
      console.error("Sign-up limit unavailable:", err.message);
      return "all";
    });
    if (blockedBy) return NextResponse.json({ error: CAPPED[blockedBy] }, { status: 429 });
  }

  const invite = await claimInvite(token).catch(() => null);
  if (!invite) return NextResponse.json(GONE, { status: 410 });

  const supabase = getSupabaseAdmin();
  let property = null;
  let user = null;

  try {
    const { data, error } = await supabase
      .from("properties")
      .insert({ name: propertyName, email, total_rooms: totalRooms })
      .select()
      .single();
    if (error) throw new Error(`Failed to create property: ${error.message}`);
    property = data;

    // The profile is what events are matched on. A failure here -- most
    // likely migration 039 not run yet -- must not cost the hotel its
    // account: it can be filled in later under Property Setup.
    await savePropertyProfile(property.id, profile).catch((err) =>
      console.error("Could not save the property profile at onboarding:", err)
    );
    // Who to call back. Saved apart for the same reason: before migration
    // 057 the columns are missing, and that must not cost the hotel its
    // account.
    {
      const { error: contactError } = await supabase
        .from("properties")
        .update({ contact_name: contactName, contact_phone: contactPhone })
        .eq("id", property.id);
      if (contactError) console.error("Could not save the contact at onboarding:", contactError.message);
    }

    // The hotel's rooms and plans, every room sold on every plan at the
    // price given for its base adults.
    const rooms = [];
    for (const r of starter.roomTypes) {
      rooms.push({
        ...r,
        room: await createRoomType({
          property_id: property.id,
          room_type_name: r.name,
          number_of_rooms: r.rooms,
          base_adults: r.baseAdults,
          max_adults: r.maxAdults,
        }),
      });
    }
    for (const code of starter.planCodes) {
      const plan = await createRatePlanWithDerivation({
        property_id: property.id,
        plan_name: STARTER_PLANS.find((p) => p.code === code).name,
        meal_plan: code,
      });
      await saveRatePlanRooms(
        property.id,
        plan.id,
        rooms.map(({ room, baseAdults, prices, extraAdult }) => ({
          room_type_id: room.id,
          base_adults: room.base_adults ?? baseAdults,
          adult_rates: { [room.base_adults ?? baseAdults]: prices[code] },
          extra_adult_rate: extraAdult,
        }))
      );
    }
    await syncRoomBasePrices(property.id).catch((err) =>
      console.error("Could not set room base prices at onboarding:", err)
    );

    user = await createUser({
      email,
      passwordHash: hashPassword(password),
      role: ROLES.PROPERTY_ADMIN,
      status: "Active",
      propertyIds: [property.id],
    });
    // The default a super admin keeps under Users. Their own users can then
    // be given any of these pages, and no others.
    const modules = await getDefaultAdminModules();
    await setUserModules(user.id, modules);

    await completeInvite(invite, { userId: user.id, propertyId: property.id });
    if (shared) await recordSignup(ip);

    const response = NextResponse.json({
      user: { id: user.id, email: user.email, propertyId: property.id, propertyName: property.name },
    });
    await setSessionCookie(response, {
      userId: user.id,
      email: user.email,
      role: user.role,
      property_id: property.id,
      modules,
    });
    return response;
  } catch (err) {
    console.error("Onboarding failed:", err);
    // Leave nothing half-made behind, and let the hotel try the link again.
    // Remove the user too: an account nobody meant to exist.
    if (user) {
      await supabase.from("user_modules").delete().eq("user_id", user.id);
      await supabase.from("user_properties").delete().eq("user_id", user.id);
      await supabase.from("users").delete().eq("id", user.id);
    }
    if (property) await supabase.from("properties").delete().eq("id", property.id);
    await releaseInvite(invite.id);
    return NextResponse.json(
      { error: "Could not create your account. Please try again." },
      { status: 500 }
    );
  }
}
