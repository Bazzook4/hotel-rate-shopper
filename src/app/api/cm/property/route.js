import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { getPropertyDetails, isConfigured, defaultHotelCode } from "@/lib/aiosell";
import { MOCK_PROPERTY } from "@/lib/mock/aiosellProperty";

export async function GET(req) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hotelCode = req.nextUrl.searchParams.get("hotelCode") || defaultHotelCode();

  if (!isConfigured()) {
    return NextResponse.json({ property: MOCK_PROPERTY, source: "mock" });
  }

  try {
    const property = await getPropertyDetails(hotelCode);
    return NextResponse.json({ property, source: "aiosell" });
  } catch (err) {
    console.error("Aiosell property_details failed", err);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
