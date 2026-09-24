import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { resolveChannelManager } from "@/lib/cmResolver";
import { MOCK_PROPERTY } from "@/lib/mock/aiosellProperty";

export async function GET(req) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const propertyId = req.nextUrl.searchParams.get("propertyId") || undefined;
  const { client, ready } = await resolveChannelManager(session, { propertyId });

  if (!ready) {
    return NextResponse.json({
      property: MOCK_PROPERTY,
      source: "mock",
      missing: client.missingFields(),
    });
  }

  try {
    const property = await client.getPropertyDetails();
    return NextResponse.json({ property, source: "aiosell" });
  } catch (err) {
    console.error("Aiosell property_details failed", err);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
