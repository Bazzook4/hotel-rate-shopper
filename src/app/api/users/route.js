import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { isAnyAdmin, isSuperAdmin } from "@/lib/permissions";
import {
  createUser,
  findUserByEmail,
  setUserModules,
  listUsersForActor,
  getUserPropertyId,
} from "@/lib/database";
import { hashPassword } from "@/lib/password";

/**
 * List users. A SuperAdmin sees everyone; a PropertyAdmin sees only the
 * users attached to their own property.
 */
export async function GET(request) {
  const session = await getSessionFromRequest(request);
  if (!session || !isAnyAdmin(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let propertyId = null;

    if (!isSuperAdmin(session)) {
      propertyId =
        session.property_id ||
        (await getUserPropertyId(session.userId).catch(() => null));

      if (!propertyId) {
        // A property admin with no property linked can see nobody.
        return NextResponse.json({ users: [], scope: "property" });
      }
    } else {
      // A SuperAdmin may narrow the list to one property.
      propertyId = request.nextUrl.searchParams.get("propertyId") || null;
    }

    const users = await listUsersForActor({ propertyId });
    return NextResponse.json({
      users,
      scope: propertyId ? "property" : "all",
      propertyId,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  const session = await getSessionFromRequest(request);
  if (!session || !isAnyAdmin(session)) {
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
  const modules = Array.isArray(body?.modules) ? body.modules : [];

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    return NextResponse.json({ error: "A user with that email already exists" }, { status: 409 });
  }

  const passwordHash = hashPassword(password);
  const user = await createUser({ email, passwordHash, role, status, propertyIds });

  // Set module permissions
  if (modules.length > 0) {
    try {
      await setUserModules(user.id, modules);
    } catch (err) {
      console.error('Failed to set user modules:', err);
      // Continue anyway - user is created, just without module permissions
    }
  }

  return NextResponse.json({ user });
}
