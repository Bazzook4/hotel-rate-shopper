import { NextResponse } from "next/server";
import { findUserByEmail, getPropertyById, getUserPropertyId, getUserModules } from "@/lib/database";
import { verifyPassword } from "@/lib/password";
import { setSessionCookie } from "@/lib/session";
import { clearLoginFailures, clientIp, loginAllowed, recordLoginFailure } from "@/lib/rateLimit";

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password ?? "";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  // Checked before the password, so a locked-out guesser learns nothing more
  // from further attempts -- including whether the password was right.
  const ip = clientIp(request);
  if (!(await loginAllowed(email, ip))) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Wait 15 minutes and try again." },
      { status: 429 }
    );
  }

  const user = await findUserByEmail(email);
  if (!user) {
    await recordLoginFailure(email, ip);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (user.status && user.status !== "Active") {
    return NextResponse.json({ error: "Account is not active" }, { status: 401 });
  }

  const storedHash = user.password_hash || "";
  const valid = verifyPassword(password, storedHash);
  if (!valid) {
    await recordLoginFailure(email, ip);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  await clearLoginFailures(email);

  // Get user's linked property (if any)
  const propertyId = await getUserPropertyId(user.id);
  const property = propertyId ? await getPropertyById(propertyId).catch(() => null) : null;

  // Get user's module permissions
  const modules = await getUserModules(user.id).catch(() => []);

  const response = NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role || null,
      status: user.status || "Active",
      propertyId,
      propertyName: property?.name || null,
      modules,
    },
  });

  await setSessionCookie(response, {
    userId: user.id,
    email: user.email,
    role: user.role || null,
    property_id: propertyId,
    modules,
  });

  return response;
}
