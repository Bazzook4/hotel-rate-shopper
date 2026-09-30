import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import {
  canManageSetup,
  listRatePlans,
  createRatePlanWithDerivation,
  updateRatePlanDerivation,
  deleteRatePlan,
  getUserPropertyId,
  listRatePlanRooms,
  listRoomTypes,
} from "@/lib/database";
import { eligibleMasters, findDerivationLoop, ruleProblem } from "@/lib/ratePlanPricing";

async function guard(req) {
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
  return { session };
}

async function resolvePropertyId(session, requested) {
  const own =
    session.property_id ||
    (await getUserPropertyId(session.userId).catch(() => null));

  // Only a super admin may act on a property other than their own; anyone
  // else passing an id is ignored rather than trusted.
  if (isSuperAdmin(session)) return requested || own;
  if (requested && requested !== own) return null;
  return own;
}

/** Reject a derivation that is incomplete, self-referential or cyclic. */
function validateDerivation(body, existingPlans, planId) {
  if (!body.derive_from_id) return null;

  if (body.is_master) {
    return "A master plan cannot itself be derived from another plan.";
  }
  const problem = ruleProblem(body.derive_method, body.derive_value, body.derive_value_2);
  if (problem) return problem;
  if (planId && body.derive_from_id === planId) {
    return "A rate plan cannot derive from itself";
  }

  // Selecting a descendant as the master would create a cycle.
  const allowed = eligibleMasters(
    { id: planId, property_id: body.property_id },
    existingPlans
  ).map((p) => p.id);
  if (planId && !allowed.includes(body.derive_from_id)) {
    return "That plan cannot be used as a master (it would create a loop)";
  }

  return null;
}

function validateMinRate(body) {
  if (!("min_rate" in body) || body.min_rate === null || body.min_rate === "") return null;
  const v = Number(body.min_rate);
  return Number.isFinite(v) && v >= 0 ? null : "Minimum rate must be zero or more.";
}

/**
 * Whether saving this plan's derivation would close a loop through a room
 * rate that has been pointed elsewhere -- which eligibleMasters, looking at
 * plans alone, cannot see.
 */
async function loopsThroughRooms(propertyId, existing, planId, body) {
  if (!body.derive_from_id) return false;
  const [assignments, roomTypes] = await Promise.all([
    listRatePlanRooms(propertyId).catch(() => []),
    listRoomTypes(propertyId).catch(() => []),
  ]);
  const plans = existing.map((p) =>
    p.id === planId ? { ...p, derive_from_id: body.derive_from_id } : p
  );
  return Boolean(findDerivationLoop({ ratePlans: plans, assignments, roomTypes }));
}

export async function GET(req) {
  const { error, session } = await guard(req);
  if (error) return error;

  const propertyId = await resolvePropertyId(
    session,
    req.nextUrl.searchParams.get("propertyId")
  );
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }

  try {
    return NextResponse.json({ ratePlans: await listRatePlans(propertyId) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  const { error, session } = await guard(req);
  if (error) return error;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const propertyId = await resolvePropertyId(session, body.property_id);
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }
  if (!body.plan_name?.trim()) {
    return NextResponse.json({ error: "Plan name is required" }, { status: 400 });
  }

  const existing = await listRatePlans(propertyId).catch(() => []);
  const invalid =
    validateDerivation({ ...body, property_id: propertyId }, existing, null) ||
    validateMinRate(body);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }

  try {
    const ratePlan = await createRatePlanWithDerivation({
      ...body,
      property_id: propertyId,
    });
    return NextResponse.json({ ratePlan });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req) {
  const { error, session } = await guard(req);
  if (error) return error;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id } = body || {};
  if (!id) {
    return NextResponse.json({ error: "Rate plan id is required" }, { status: 400 });
  }

  const propertyId = await resolvePropertyId(session, body.property_id);
  const existing = propertyId ? await listRatePlans(propertyId).catch(() => []) : [];
  const invalid =
    validateDerivation({ ...body, property_id: propertyId }, existing, id) ||
    validateMinRate(body);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }
  if (propertyId && (await loopsThroughRooms(propertyId, existing, id, body))) {
    return NextResponse.json(
      {
        error:
          "That would make rates follow each other in a circle, through a room rate that derives from this plan. Change that room rate first.",
      },
      { status: 400 }
    );
  }

  try {
    return NextResponse.json({ ratePlan: await updateRatePlanDerivation(id, body) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  const { error } = await guard(req);
  if (error) return error;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Rate plan id is required" }, { status: 400 });
  }

  try {
    await deleteRatePlan(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
