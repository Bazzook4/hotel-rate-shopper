import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import {
  createUser,
  findUserByEmail,
  setUserModules,
  setUserCanManageSetup,
  listUsersForActor,
  listUsersForProperty,
  updateUserAccount,
  getUserById,
  getUserPropertyId,
} from "@/lib/database";
import {
  ROLES,
  isAnyAdmin,
  isSuperAdmin,
  canAdministerUser,
  assignableRoles,
  isPropertyScopedUser,
} from "@/lib/permissions";
import { hashPassword } from "@/lib/password";
import { ALL_MODULE_IDS, propertyCeiling } from "@/lib/rights";
import { SETUP_PAGES, normaliseGrants } from "@/app/dashboard/modules";

const ownProperty = async (session) =>
  session.property_id || (await getUserPropertyId(session.userId).catch(() => null));

/**
 * The pages `session` may hand out at `propertyId`. A super admin may give
 * anything; a property admin only what the property's admins hold between
 * them, so nothing they grant can go past what a super admin gave.
 */
async function grantableFor(session, propertyId) {
  if (isSuperAdmin(session)) return ALL_MODULE_IDS;
  return (await propertyCeiling(propertyId)) || [];
}

/** The refusal for pages outside what `session` may grant, or null. */
function beyondGrantable(modules, grantable) {
  const over = modules.filter((id) => !grantable.includes(id));
  if (!over.length) return null;
  return NextResponse.json(
    { error: `You cannot give access to: ${over.join(", ")}.` },
    { status: 403 }
  );
}

/**
 * Save a user's pages. For a PropertyUser, holding any setup page is what
 * lets them change setup, so the API's setup flag follows the grid.
 */
async function saveRights(userId, role, modules) {
  await setUserModules(userId, modules);
  if (role === ROLES.PROPERTY_USER) {
    await setUserCanManageSetup(userId, modules.some((id) => SETUP_PAGES.has(id)));
  }
}

/**
 * List users. With a property, its users with their rights, plus the cap on
 * its PropertyUsers and what the caller may grant there. A PropertyAdmin is
 * always given their own property.
 */
export async function GET(request) {
  const session = await getSessionFromRequest(request);
  if (!session || !isAnyAdmin(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const propertyId = isSuperAdmin(session)
      ? request.nextUrl.searchParams.get("propertyId") || null
      : await ownProperty(session);

    if (!propertyId) {
      if (!isSuperAdmin(session)) return NextResponse.json({ users: [], scope: "property" });
      const users = await listUsersForActor({});
      return NextResponse.json({ users, scope: "all" });
    }

    const [users, ceiling, grantable] = await Promise.all([
      listUsersForProperty(propertyId),
      propertyCeiling(propertyId),
      grantableFor(session, propertyId),
    ]);
    return NextResponse.json({
      users: users.map((u) => ({ ...u, modules: normaliseGrants(u.modules) })),
      scope: "property",
      propertyId,
      ceiling,
      grantable,
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
  const role = body?.role || ROLES.PROPERTY_USER;
  const status = body?.status || "Active";
  const propertyId = body?.propertyId || null;
  const modules = normaliseGrants(Array.isArray(body?.modules) ? body.modules : []);

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  // A property admin must not be able to create a role above their own.
  const allowedRoles = assignableRoles(session).map((r) => r.value);
  if (!allowedRoles.includes(role)) {
    return NextResponse.json({ error: `You cannot assign the role ${role}.` }, { status: 403 });
  }

  // Nor attach a user to a property other than their own.
  if (!isSuperAdmin(session) && propertyId !== (await ownProperty(session))) {
    return NextResponse.json(
      { error: "You can only add users to your own property." },
      { status: 403 }
    );
  }

  const refused = beyondGrantable(modules, await grantableFor(session, propertyId));
  if (refused) return refused;

  if (await findUserByEmail(email)) {
    return NextResponse.json({ error: "A user with that email already exists" }, { status: 409 });
  }

  const user = await createUser({
    email,
    passwordHash: hashPassword(password),
    role,
    status,
    propertyIds: propertyId ? [propertyId] : [],
  });

  try {
    await saveRights(user.id, role, modules);
  } catch (err) {
    return NextResponse.json(
      { error: `User created, but their access could not be saved: ${err.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ user });
}

/** Update a user's role, status, property link and pages. */
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

  // A super admin is not a property's staff and is never edited through the
  // property user list, regardless of who is asking.
  if (!isPropertyScopedUser(target)) {
    return NextResponse.json(
      { error: "Super admins are managed separately and cannot be changed here." },
      { status: 403 }
    );
  }

  const actorProperty = await ownProperty(session);
  const targetProperty = await getUserPropertyId(target.id).catch(() => null);

  if (!canAdministerUser(session, { ...target, property_id: targetProperty }, actorProperty)) {
    return NextResponse.json({ error: "You cannot modify this user." }, { status: 403 });
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

  const modules = Array.isArray(body.modules) ? normaliseGrants(body.modules) : null;
  if (modules) {
    const propertyId = body.propertyId !== undefined ? body.propertyId : targetProperty;
    const refused = beyondGrantable(modules, await grantableFor(session, propertyId));
    if (refused) return refused;
  }

  try {
    const user = await updateUserAccount(body.id, {
      role: body.role,
      status: body.status,
      propertyId: body.propertyId,
    });
    if (modules) await saveRights(body.id, user.role, modules);
    return NextResponse.json({ user });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
