import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import {
  canManageSetup,
  listRatePlans,
  createRatePlanWithDerivation,
  updateRatePlanDerivation,
  deleteRatePlan,
  getUserPropertyId,
} from "@/lib/database";
import { DERIVE_METHODS, eligibleMasters } from "@/lib/ratePlanPricing";

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
  if (requested) return requested;
  if (session.property_id) return session.property_id;
  return getUserPropertyId(session.userId).catch(() => null);
}

/** Reject a derivation that is incomplete, self-referential or cyclic. */
function validateDerivation(body, existingPlans, planId) {
  if (!body.derive_from_id) return null;

  if (body.is_master) {
    return "A master plan cannot itself be derived from another plan.";
  }
  if (!DERIVE_METHODS.includes(body.derive_method)) {
    return `derive_method must be one of: ${DERIVE_METHODS.join(", ")}`;
  }
  const value = Number(body.derive_value);
  if (!Number.isFinite(value)) {
    return "derive_value must be a number";
  }
  if (body.derive_method === "multiplier" && value <= 0) {
    return "A multiplier must be greater than zero";
  }
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
  const invalid = validateDerivation({ ...body, property_id: propertyId }, existing, null);
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
  const invalid = validateDerivation({ ...body, property_id: propertyId }, existing, id);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
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
