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

  const user = await getUserById(session.userId).catch(() => null);
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const propertyId = session.property_id || null;
  const property = propertyId ? await getPropertyById(propertyId).catch(() => null) : null;

  // Get modules from session or fetch from database
  let modules = session.modules || [];
  if (modules.length === 0) {
    modules = await getUserModules(user.id).catch(() => []);
  }

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
