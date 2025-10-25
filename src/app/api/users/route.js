import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { createUser, findUserByEmail } from "@/lib/airtable";
import { hashPassword } from "@/lib/password";

export async function POST(request) {
  const session = await getSessionFromRequest(request);
  if (!session || session.role !== "Admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const email = body?.email?.trim()?.toLowerCase();
  const password = body?.password ?? "";
  const role = body?.role || "PropertyUser";
  const status = body?.status || "Active";
  const propertyIds = Array.isArray(body?.propertyIds)
    ? body.propertyIds.filter(Boolean)
    : body?.propertyId
    ? [body.propertyId]
    : [];

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    return NextResponse.json({ error: "A user with that email already exists" }, { status: 409 });
  }

  const passwordHash = hashPassword(password);
  const user = await createUser({ email, passwordHash, role, status, propertyIds });

  return NextResponse.json({ user });
}
