import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import {
  canManageSetup,
  canManageUsers,
  canSwitchProperties,
  isSuperAdmin,
} from "@/lib/permissions";
import { getUserById, getPropertyById } from "@/lib/database";
import { effectiveModules } from "@/lib/rights";

export async function GET(request) {
  const session = await getSessionFromRequest(request);
  if (!session?.userId) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const propertyId = session.property_id || null;

  // Every page waits on this route before it renders, so the lookups run
  // together rather than one after another: they only need the decoded
  // session.
  const [user, property] = await Promise.all([
    getUserById(session.userId).catch(() => null),
    propertyId ? getPropertyById(propertyId).catch(() => null) : null,
  ]);

  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  // Worked out fresh rather than taken from the cookie, which holds the
  // rights from sign-in for a week: a page taken away must go now.
  const modules = await effectiveModules(user, propertyId).catch(() => []);

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
