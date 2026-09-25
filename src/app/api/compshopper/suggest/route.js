import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { getPropertyById, listCompetitors } from "@/lib/database";
import { resolvePropertyId } from "@/lib/propertyScope";
import { rankSuggestions } from "@/lib/competitors";
import { addDays, formatDateISO } from "@/lib/date";

/**
 * Nearby hotels that could be competitors -- the Search by Location idea,
 * pointed at the property's own doorstep instead of a typed-in city.
 *
 * Rates are quoted for a night a fortnight out rather than tonight: tonight
 * is often sold out or distressed, and a suggestion list showing SOLD against
 * every hotel tells the hotelier nothing about who they compete with.
 */
const SAMPLE_LEAD_DAYS = 14;

export async function GET(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const propertyId = await resolvePropertyId(session, searchParams.get("propertyId"));
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected." }, { status: 403 });
  }

  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Rate shopping is not configured. Ask your administrator to add the rate data key." },
      { status: 503 }
    );
  }

  const property = await getPropertyById(propertyId);
  if (!property) {
    return NextResponse.json({ error: "Property not found." }, { status: 404 });
  }

  // Competitor Shopper rides on the identity Rate Parity already established,
  // so a property set up once is set up for both.
  const query = searchParams.get("q")?.trim() || property.google_place_query;
  if (!query) {
    return NextResponse.json(
      {
        error:
          "Tell us which hotel you are first: add your Google Business URL in Property Setup, then search for competitors.",
        needsSetup: true,
      },
      { status: 409 }
    );
  }

  // Searching around the property's own name puts Google's own notion of
  // "similar hotels nearby" to work, rather than a city name that could
  // return the other side of town.
  const where = [query, property.city].filter(Boolean).join(", ");
  const checkIn = formatDateISO(addDays(new Date(), SAMPLE_LEAD_DAYS));
  const checkOut = formatDateISO(addDays(new Date(), SAMPLE_LEAD_DAYS + 1));

  const serp = new URL("https://serpapi.com/search.json");
  serp.searchParams.set("engine", "google_hotels");
  serp.searchParams.set("q", `hotels near ${where}`);
  serp.searchParams.set("check_in_date", checkIn);
  serp.searchParams.set("check_out_date", checkOut);
  serp.searchParams.set("adults", "2");
  serp.searchParams.set("currency", "INR");
  serp.searchParams.set("gl", "in");
  serp.searchParams.set("hl", "en");
  serp.searchParams.set("api_key", apiKey);

  let json;
  try {
    const res = await fetch(serp, { cache: "no-store" });
    json = await res.json();
    if (!res.ok || json?.error) throw new Error(json?.error || `Google returned ${res.status}`);
  } catch (err) {
    console.error("Competitor suggestion search failed:", err.message);
    return NextResponse.json(
      { error: "Could not search for nearby hotels. Please try again." },
      { status: 502 }
    );
  }

  // Hotels already on the list are dropped rather than shown as addable.
  const existing = await listCompetitors(propertyId);
  const suggestions = rankSuggestions(json.properties, {
    self: {
      name: property.name,
      hotel_class: property.star_rating ? `${property.star_rating}-star hotel` : null,
    },
    excludeTokens: existing.map((c) => c.property_token),
  });

  return NextResponse.json({
    propertyId,
    searchedFor: where,
    suggestions: suggestions.slice(0, 20),
  });
}
