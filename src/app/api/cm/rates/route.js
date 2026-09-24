import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import { saveDailyRates, getUserPropertyId } from "@/lib/database";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Save edited rates so they survive a reload. */
export async function PUT(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const own =
    session.property_id ||
    (await getUserPropertyId(session.userId).catch(() => null));

  const propertyId = isSuperAdmin(session)
    ? body.propertyId || own
    : !body.propertyId || body.propertyId === own
    ? own
    : null;

  if (!propertyId) {
    return NextResponse.json(
      { error: "You can only change rates for your own property." },
      { status: 403 }
    );
  }

  // room_type_id rides along on each row; saveDailyRates treats a missing
  // one as "the plan's own room", which is what older rows mean.
  const rows = Array.isArray(body.rates) ? body.rates : [];
  if (rows.length === 0) {
    return NextResponse.json({ error: "No rates supplied" }, { status: 400 });
  }

  for (const r of rows) {
    if (!ISO_DATE.test(r.stay_date || "")) {
      return NextResponse.json(
        { error: `stay_date must be YYYY-MM-DD, got "${r.stay_date}"` },
        { status: 400 }
      );
    }
    const rate = Number(r.rate);
    if (!Number.isFinite(rate) || rate < 0) {
      return NextResponse.json(
        { error: "Every rate must be zero or more" },
        { status: 400 }
      );
    }
  }

  try {
    const saved = await saveDailyRates(propertyId, rows);
    return NextResponse.json({ saved: saved.length });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
