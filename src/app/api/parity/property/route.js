import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { isSuperAdmin, isAnyAdmin } from "@/lib/permissions";
import { getPropertyById, updateProperty, getUserPropertyId } from "@/lib/database";
import { deriveGoogleQuery } from "@/lib/parity";

/**
 * Which property this request is allowed to act on.
 *
 * A SuperAdmin may name one; everyone else is forced onto their own. Repeated
 * from the other routes rather than shared, because each route decides
 * differently whether a missing property is an error or an empty result.
 */
async function resolvePropertyId(session, requested) {
  if (isSuperAdmin(session)) {
    return requested || session.property_id || (await getUserPropertyId(session.userId).catch(() => null));
  }
  const own = session.property_id || (await getUserPropertyId(session.userId).catch(() => null));
  if (requested && requested !== own) return null;
  return own;
}

/** How the property is currently identified to Google. */
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

  const property = await getPropertyById(propertyId);
  if (!property) {
    return NextResponse.json({ error: "Property not found." }, { status: 404 });
  }

  return NextResponse.json({
    propertyId,
    name: property.name,
    googleBusinessUrl: property.google_business_url || null,
    googlePlaceQuery: property.google_place_query || null,
    configured: Boolean(property.google_place_query),
  });
}

/**
 * Point the property at its Google listing.
 *
 * The URL is validated and reduced to a search query here rather than at
 * refresh time, so a hotelier learns immediately that their link is unusable
 * instead of seeing an empty grid days later.
 */
export async function PUT(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAnyAdmin(session)) {
    return NextResponse.json(
      { error: "You do not have permission to change property settings." },
      { status: 403 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const propertyId = await resolvePropertyId(session, body?.propertyId);
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected." }, { status: 403 });
  }

  const url = typeof body?.googleBusinessUrl === "string" ? body.googleBusinessUrl.trim() : "";

  // Clearing the field is a legitimate action -- a hotelier who pasted the
  // wrong hotel needs a way back to "not set" -- so an empty string is not an
  // error, it just turns parity off again.
  if (!url) {
    await updateProperty(propertyId, {
      google_business_url: null,
      google_place_query: null,
    });
    return NextResponse.json({ googleBusinessUrl: null, googlePlaceQuery: null, configured: false });
  }

  const { query, error } = deriveGoogleQuery(url);
  if (!query) {
    return NextResponse.json({ error }, { status: 400 });
  }

  await updateProperty(propertyId, {
    google_business_url: url,
    google_place_query: query,
  });

  return NextResponse.json({
    googleBusinessUrl: url,
    googlePlaceQuery: query,
    configured: true,
  });
}
