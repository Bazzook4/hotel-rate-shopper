import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import {
  canManageSetup,
  canManageUsers,
  canSwitchProperties,
  isSuperAdmin,
} from "@/lib/permissions";
import { getUserById, getPropertyById, getUserModules } from "@/lib/database";

export async function GET(request) {
  const session = await getSessionFromRequest(request);
  if (!session?.userId) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const propertyId = session.property_id || null;

  // Every page waits on this route before it renders, so the three lookups
  // run together rather than one after another: none of them needs another's
  // result, they only need the decoded session. The modules query is skipped
  // when the cookie already carries them, which is the usual case.
  const [user, property, fetchedModules] = await Promise.all([
    getUserById(session.userId).catch(() => null),
    propertyId ? getPropertyById(propertyId).catch(() => null) : null,
    session.modules?.length ? null : getUserModules(session.userId).catch(() => []),
  ]);

  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const modules = session.modules?.length ? session.modules : fetchedModules || [];

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role || null,
      canManageSetup: canManageSetup(user),
      canManageUsers: canManageUsers(user),
      canSwitchProperties: canSwitchProperties(user),
      isSuperAdmin: isSuperAdmin(user),
      status: user.status || null,
      propertyId,
      propertyName: property?.name || null,
      propertyLocation: property?.city || null,
      modules,
    },
  });
}
