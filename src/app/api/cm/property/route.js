import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { resolveChannelManager } from "@/lib/cmResolver";
import { moduleDeniedResponse } from "@/lib/propertyScope";

export async function GET(req) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await moduleDeniedResponse(session, "cm");
  if (denied) return denied;

  const propertyId = req.nextUrl.searchParams.get("propertyId") || undefined;
  const { client, ready, forbidden } = await resolveChannelManager(session, { propertyId });
  if (forbidden) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!ready) {
    // No fixture: an unconfigured connection reports what it needs rather
    // than showing data that is not this property's.
    return NextResponse.json({
      property: null,
      source: "unconfigured",
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
