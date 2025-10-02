import { NextResponse } from "next/server";
import { findUserByEmail, getPropertyById } from "@/lib/airtable";
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

  if (user.Status && user.Status !== "Active") {
    return NextResponse.json({ error: "Account is not active" }, { status: 401 });
  }

  const storedHash = user["Password Hash"] || user.password || "";
  const valid = verifyPassword(password, storedHash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const propertyId = Array.isArray(user.Properties) ? user.Properties[0] : null;
  const property = propertyId ? await getPropertyById(propertyId).catch(() => null) : null;

  const response = NextResponse.json({
    user: {
      id: user.id,
      email: user.Email,
      role: user.Role || null,
      status: user.Status || "Active",
      propertyId,
      propertyName: property?.Name || null,
    },
  });

  setSessionCookie(response, {
    userId: user.id,
    email: user.Email,
    role: user.Role || null,
    propertyId,
  });

  return response;
}
