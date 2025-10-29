import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { getUserById, getPropertyById } from "@/lib/airtable";

export async function GET(request) {
  const session = await getSessionFromRequest(request);
  if (!session?.userId) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const user = await getUserById(session.userId).catch(() => null);
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const propertyId = session.propertyId || (Array.isArray(user.Properties) ? user.Properties[0] : null);
  const property = propertyId ? await getPropertyById(propertyId).catch(() => null) : null;

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.Email,
      role: user.Role || null,
      status: user.Status || null,
      propertyId,
      propertyName: property?.Name || null,
      propertyLocation: property?.Location || null,
    },
  });
}
