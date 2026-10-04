import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { toCountryCode } from "@/lib/countries";
import { knownPlaces } from "@/lib/events";

/**
 * Places shared events already name in a country, for the profile and event
 * forms to suggest. Only public events are read -- never another hotel's
 * profile or private events -- so any signed-in user may ask.
 */
export async function GET(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const country = toCountryCode(req.nextUrl.searchParams.get("country"));
  if (!country) return NextResponse.json({ states: [], cities: [] });

  try {
    return NextResponse.json(await knownPlaces(country));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
