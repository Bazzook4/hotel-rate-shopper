import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import {
  canManageSetup,
  listRatePlanRooms,
  saveRatePlanRooms,
  upsertRatePlanRoom,
  deleteRatePlanRoom,
  listRatePlans,
  listRoomTypes,
  getUserPropertyId,
} from "@/lib/database";
import { findDerivationLoop, ruleProblem } from "@/lib/ratePlanPricing";

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

/**
 * The session and property for a change, or a response refusing it. Shared
 * by the single-room-rate calls below.
 */
async function authorise(req, requested) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!(await canManageSetup(session.userId))) {
    return {
      error: NextResponse.json(
        { error: "You do not have permission to manage property setup." },
        { status: 403 }
      ),
    };
  }
  const propertyId = await resolveProperty(session, requested);
  if (!propertyId) {
    return {
      error: NextResponse.json(
        { error: "You can only change rate plans for your own property." },
        { status: 403 }
      ),
    };
  }
  return { propertyId };
}

const bad = (error) => NextResponse.json({ error }, { status: 400 });

/** Whether a stored per-adult override map is well formed. */
function overridesProblem(overrides) {
  if (overrides === null || overrides === undefined) return "";
  if (typeof overrides !== "object" || Array.isArray(overrides)) {
    return "Per-adult overrides must be an object keyed by adult count.";
  }
  for (const [adults, o] of Object.entries(overrides)) {
    if (!Number.isInteger(Number(adults)) || Number(adults) < 1) {
      return "Per-adult overrides are keyed by an adult count of 1 or more.";
    }
    const problem = ruleProblem(o?.method, o?.value, o?.value2);
    if (problem) return `${adults} adult${adults === "1" ? "" : "s"}: ${problem}`;
  }
  return "";
}

/**
 * Create or update one room rate -- a rate plan sold in one room -- without
 * touching the plan's other rooms. Assigning a room from the setup list and
 * editing a room rate both come here.
 */
export async function PATCH(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body");
  }
  const { error, propertyId } = await authorise(req, body.propertyId);
  if (error) return error;

  const row = body.roomRate || {};
  if (!row.rate_plan_id || !row.room_type_id) {
    return bad("A room rate needs both a rate plan and a room type.");
  }

  const [ratePlans, roomTypes, assignments] = await Promise.all([
    listRatePlans(propertyId),
    listRoomTypes(propertyId),
    listRatePlanRooms(propertyId).catch(() => []),
  ]);
  // Ids from the body are only trusted once they are found on this property.
  if (!ratePlans.some((p) => p.id === row.rate_plan_id)) {
    return bad("That rate plan is not on this property.");
  }
  if (!roomTypes.some((r) => r.id === row.room_type_id)) {
    return bad("That room type is not on this property.");
  }

  for (const k of ["extra_adult_rate", "extra_child_rate", "min_rate"]) {
    const v = row[k];
    if (v !== null && v !== undefined && v !== "" && !(Number(v) >= 0)) {
      return bad("Rates must be zero or more.");
    }
  }
  for (const v of Object.values(row.adult_rates || {})) {
    if (v !== null && v !== "" && !(Number(v) >= 0)) return bad("Rates must be zero or more.");
  }
  const min = row.min_stay === "" || row.min_stay == null ? null : Number(row.min_stay);
  const max = row.max_stay === "" || row.max_stay == null ? null : Number(row.max_stay);
  if ((min !== null && !(Number.isInteger(min) && min >= 1)) ||
      (max !== null && !(Number.isInteger(max) && max >= 1))) {
    return bad("Stay limits are whole numbers of nights.");
  }
  if (min !== null && max !== null && min > max) {
    return bad(`A minimum of ${min} nights cannot sit above a maximum of ${max}.`);
  }

  if (row.rate_mode && !["manual", "derived"].includes(row.rate_mode)) {
    return bad("A room rate is priced manually, derived, or follows its plan.");
  }
  if (row.rate_mode === "derived") {
    if (!ratePlans.some((p) => p.id === row.derive_from_plan_id) ||
        !roomTypes.some((r) => r.id === row.derive_from_room_id)) {
      return bad("Choose the room rate to derive from.");
    }
    if (row.derive_from_plan_id === row.rate_plan_id && row.derive_from_room_id === row.room_type_id) {
      return bad("A room rate cannot derive from itself.");
    }
    const problem = ruleProblem(row.derive_method, row.derive_value, row.derive_value_2);
    if (problem) return bad(problem);
  }
  const oProblem = overridesProblem(row.adult_overrides);
  if (oProblem) return bad(oProblem);

  // Would this close a loop? Checked against the setup as it would stand.
  const proposed = [
    ...assignments.filter(
      (a) => !(a.rate_plan_id === row.rate_plan_id && a.room_type_id === row.room_type_id)
    ),
    { ...(assignments.find(
        (a) => a.rate_plan_id === row.rate_plan_id && a.room_type_id === row.room_type_id
      ) || {}), ...row },
  ];
  if (findDerivationLoop({ ratePlans, assignments: proposed, roomTypes })) {
    return bad(
      "That would make rates follow each other in a circle. Pick a room rate that does not already derive from this one."
    );
  }

  const room = roomTypes.find((r) => r.id === row.room_type_id);
  try {
    const saved = await upsertRatePlanRoom(propertyId, {
      ...row,
      base_adults: room?.base_adults,
    });
    return NextResponse.json({ roomRate: saved });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** Take one room off a rate plan. */
export async function DELETE(req) {
  const q = req.nextUrl.searchParams;
  const { error, propertyId } = await authorise(req, q.get("propertyId"));
  if (error) return error;

  const ratePlanId = q.get("ratePlanId");
  const roomTypeId = q.get("roomTypeId");
  if (!ratePlanId || !roomTypeId) return bad("ratePlanId and roomTypeId are required");

  try {
    await deleteRatePlanRoom(propertyId, ratePlanId, roomTypeId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
