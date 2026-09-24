import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import {
  createUser,
  findUserByEmail,
  setUserModules,
  listUsersForActor,
  listUsersForProperty,
  updateUserAccount,
  getUserById,
  getUserPropertyId,
} from "@/lib/database";
import {
  isAnyAdmin,
  isSuperAdmin,
  canAdministerUser,
  assignableRoles,
} from "@/lib/permissions";
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

    // The per-property view also carries each user's module grants.
    const users = propertyId
      ? await listUsersForProperty(propertyId)
      : await listUsersForActor({ propertyId });
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

  // A property admin must not be able to create a role above their own.
  const allowedRoles = assignableRoles(session).map((r) => r.value);
  if (!allowedRoles.includes(role)) {
    return NextResponse.json(
      { error: `You cannot assign the role ${role}.` },
      { status: 403 }
    );
  }

  // Nor attach a user to a property other than their own.
  if (!isSuperAdmin(session)) {
    const own =
      session.property_id ||
      (await getUserPropertyId(session.userId).catch(() => null));
    if (propertyIds.some((id) => id !== own)) {
      return NextResponse.json(
        { error: "You can only add users to your own property." },
        { status: 403 }
      );
    }
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

/** Update a user's role, status, property link and module access. */
export async function PATCH(request) {
  const session = await getSessionFromRequest(request);
  if (!session || !isAnyAdmin(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.id) {
    return NextResponse.json({ error: "User id is required" }, { status: 400 });
  }

  const target = await getUserById(body.id).catch(() => null);
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const actorProperty =
    session.property_id ||
    (await getUserPropertyId(session.userId).catch(() => null));

  if (!canAdministerUser(session, target, actorProperty)) {
    return NextResponse.json(
      { error: "You cannot modify this user." },
      { status: 403 }
    );
  }

  // Nobody may grant a role above what they can assign.
  if (body.role !== undefined) {
    const allowed = assignableRoles(session).map((r) => r.value);
    if (!allowed.includes(body.role)) {
      return NextResponse.json(
        { error: `You cannot assign the role ${body.role}.` },
        { status: 403 }
      );
    }
  }

  // Changing which property a user belongs to is a SuperAdmin action.
  if (body.propertyId !== undefined && !isSuperAdmin(session)) {
    return NextResponse.json(
      { error: "Only a super admin can move a user between properties." },
      { status: 403 }
    );
  }

  if (body.status !== undefined && !["Active", "Suspended", "Inactive"].includes(body.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  try {
    const user = await updateUserAccount(body.id, {
      role: body.role,
      status: body.status,
      propertyId: body.propertyId,
    });

    if (Array.isArray(body.modules)) {
      await setUserModules(body.id, body.modules);
    }

    return NextResponse.json({ user });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
