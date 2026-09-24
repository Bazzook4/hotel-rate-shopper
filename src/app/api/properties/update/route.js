import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { isSuperAdmin, isAnyAdmin } from "@/lib/permissions";
import { updateProperty, getUserPropertyId } from "@/lib/database";

/** Columns a property admin may change. */
const EDITABLE = [
  "name",
  "address",
  "city",
  "state",
  "country",
  "postal_code",
  "phone",
  "email",
  "website",
  "description",
  "star_rating",
  "total_rooms",
  "check_in_time",
  "check_out_time",
];

export async function PATCH(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAnyAdmin(session)) {
    return NextResponse.json(
      { error: "You do not have permission to edit properties." },
      { status: 403 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id, ...rest } = body || {};
  if (!id) {
    return NextResponse.json({ error: "Property id is required" }, { status: 400 });
  }

  // A PropertyAdmin may only edit their own property; a SuperAdmin any.
  if (!isSuperAdmin(session)) {
    const own = session.property_id || (await getUserPropertyId(session.userId).catch(() => null));
    if (!own || own !== id) {
      return NextResponse.json(
        { error: "You can only edit your own property." },
        { status: 403 }
      );
    }
  }

  const updates = {};
  for (const key of EDITABLE) {
    if (key in rest) updates[key] = rest[key];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No editable fields supplied" }, { status: 400 });
  }

  if (!updates.name?.trim() && "name" in updates) {
    return NextResponse.json({ error: "Property name cannot be empty" }, { status: 400 });
  }

  if ("star_rating" in updates && updates.star_rating !== null) {
    const stars = Number(updates.star_rating);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return NextResponse.json(
        { error: "Star rating must be a whole number from 1 to 5" },
        { status: 400 }
      );
    }
    updates.star_rating = stars;
  }

  if ("total_rooms" in updates && updates.total_rooms !== null) {
    const rooms = Number(updates.total_rooms);
    if (!Number.isInteger(rooms) || rooms < 0) {
      return NextResponse.json(
        { error: "Total rooms must be zero or more" },
        { status: 400 }
      );
    }
    updates.total_rooms = rooms;
  }

  updates.updated_at = new Date().toISOString();

  try {
    const property = await updateProperty(id, updates);
    return NextResponse.json({ property });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
