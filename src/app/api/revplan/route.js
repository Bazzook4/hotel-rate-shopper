import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import { sessionRights } from "@/lib/propertyScope";
import { isAnyAdmin } from "@/lib/permissions";
import { getRevenuePlan, saveRevenueGoals } from "@/lib/revenuePlan";

/**
 * The Revenue Planner: a year of monthly goals against what was achieved.
 * Goals are the owner's business, so this is for a hotel's admins only,
 * checked on the server from the stored role, not the sign-in cookie.
 */

async function admin(req, propertyId) {
  const { error, session } = await pmsGuard(req);
  if (error) return { error };
  const { user } = await sessionRights(session);
  if (!isAnyAdmin(user)) {
    return { error: NextResponse.json({ error: "Only a hotel admin can use the Revenue Planner." }, { status: 403 }) };
  }
  const id = await resolvePropertyId(session, propertyId);
  if (!id) return { error: NextResponse.json({ error: "No property selected" }, { status: 400 }) };
  return { propertyId: id };
}

export async function GET(req) {
  const params = req.nextUrl.searchParams;
  const ctx = await admin(req, params.get("propertyId"));
  if (ctx.error) return ctx.error;
  const year = Number(params.get("year"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "Choose a year" }, { status: 400 });
  }
  try {
    return NextResponse.json(await getRevenuePlan(ctx.propertyId, year));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const ctx = await admin(req, body?.propertyId);
  if (ctx.error) return ctx.error;
  if (!Array.isArray(body.goals) || body.goals.length === 0 || body.goals.length > 12) {
    return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  }
  try {
    await saveRevenueGoals(ctx.propertyId, body.goals);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
