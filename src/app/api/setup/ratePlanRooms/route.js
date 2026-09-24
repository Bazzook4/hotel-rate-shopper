import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import {
  canManageSetup,
  listRatePlanRooms,
  saveRatePlanRooms,
  getUserPropertyId,
} from "@/lib/database";

/**
 * The property this request may act on, or null.
 *
 * A super admin may name any property; everyone else is pinned to their own,
 * whatever they ask for.
 */
async function resolveProperty(session, requested) {
  const own =
    session.property_id ||
    (await getUserPropertyId(session.userId).catch(() => null));

  if (isSuperAdmin(session)) return requested || own;
  return !requested || requested === own ? own : null;
}

export async function GET(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const propertyId = await resolveProperty(
    session,
    req.nextUrl.searchParams.get("propertyId")
  );
  if (!propertyId) {
    return NextResponse.json(
      { error: "No property selected, or not yours to view." },
      { status: 400 }
    );
  }

  try {
    const assignments = await listRatePlanRooms(propertyId);
    return NextResponse.json({ assignments });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** Replace one rate plan's room assignments. */
export async function PUT(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // canManageSetup reads the user record, since the flag that lets a
  // non-admin manage setup is not carried in the session.
  if (!(await canManageSetup(session.userId))) {
    return NextResponse.json(
      { error: "You do not have permission to manage property setup." },
      { status: 403 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const propertyId = await resolveProperty(session, body.propertyId);
  if (!propertyId) {
    return NextResponse.json(
      { error: "You can only change rate plans for your own property." },
      { status: 403 }
    );
  }

  const ratePlanId = body.ratePlanId;
  if (!ratePlanId) {
    return NextResponse.json({ error: "ratePlanId is required" }, { status: 400 });
  }

  const rooms = Array.isArray(body.rooms) ? body.rooms : [];

  for (const r of rooms) {
    if (!r.room_type_id) {
      return NextResponse.json(
        { error: "Every assigned room needs a room_type_id" },
        { status: 400 }
      );
    }
    for (const [field, label] of [
      ["full_rate", "Full rate"],
      ["extra_adult_rate", "Extra adult rate"],
      ["extra_child_rate", "Extra child rate"],
    ]) {
      const v = r[field];
      if (v === null || v === undefined || v === "") continue;
      if (!Number.isFinite(Number(v)) || Number(v) < 0) {
        return NextResponse.json(
          { error: `${label} must be zero or more` },
          { status: 400 }
        );
      }
    }
    const occ = r.included_occupancy;
    if (occ !== null && occ !== undefined && occ !== "") {
      if (!Number.isInteger(Number(occ)) || Number(occ) < 1) {
        return NextResponse.json(
          { error: "Included occupancy must be a whole number of at least 1" },
          { status: 400 }
        );
      }
    }
  }

  try {
    const saved = await saveRatePlanRooms(propertyId, ratePlanId, rooms);
    return NextResponse.json({ assigned: saved.length });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
