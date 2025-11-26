import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { getPropertyById, listProperties } from "@/lib/database";

export async function GET(request) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role === "Admin") {
    const props = await listProperties();
    return NextResponse.json({ properties: props });
  }

  if (!session.property_id) {
    return NextResponse.json({ properties: [] });
  }

  const prop = await getPropertyById(session.property_id).catch(() => null);
  return NextResponse.json({ properties: prop ? [prop] : [] });
}
