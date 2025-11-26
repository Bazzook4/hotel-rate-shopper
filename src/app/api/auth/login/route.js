import { NextResponse } from "next/server";
import { findUserByEmail, getPropertyById, getUserPropertyId } from "@/lib/database";
import { verifyPassword } from "@/lib/password";
import { setSessionCookie } from "@/lib/session";

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password ?? "";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const user = await findUserByEmail(email);
  if (!user) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (user.status && user.status !== "Active") {
    return NextResponse.json({ error: "Account is not active" }, { status: 401 });
  }

  const storedHash = user.password_hash || "";
  const valid = verifyPassword(password, storedHash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // Get user's linked property (if any)
  const propertyId = await getUserPropertyId(user.id);
  const property = propertyId ? await getPropertyById(propertyId).catch(() => null) : null;

  const response = NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role || null,
      status: user.status || "Active",
      propertyId,
      propertyName: property?.name || null,
    },
  });

  await setSessionCookie(response, {
    userId: user.id,
    email: user.email,
    role: user.role || null,
    propertyId,
  });

  return response;
}
