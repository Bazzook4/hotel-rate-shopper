import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { getUserById, getPropertyById } from "@/lib/database";

export async function GET(request) {
  const session = await getSessionFromRequest(request);
  if (!session?.userId) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const user = await getUserById(session.userId).catch(() => null);
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const propertyId = session.propertyId || null;
  const property = propertyId ? await getPropertyById(propertyId).catch(() => null) : null;

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role || null,
      status: user.status || null,
      propertyId,
      propertyName: property?.name || null,
      propertyLocation: property?.city || null,
    },
  });
}
