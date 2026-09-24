import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import { saveDailyRestrictions, getUserPropertyId } from "@/lib/database";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** undefined and null both mean "not set for this date"; 0 does not. */
function stayValue(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : NaN;
}

/** Save edited per-date restrictions so they survive a reload. */
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
      { error: "You can only change restrictions for your own property." },
      { status: 403 }
    );
  }

  // room_type_id rides along on each row, as it does for rates.
  const rows = Array.isArray(body.restrictions) ? body.restrictions : [];
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "No restrictions supplied" },
      { status: 400 }
    );
  }

  for (const r of rows) {
    if (!ISO_DATE.test(r.stay_date || "")) {
      return NextResponse.json(
        { error: `stay_date must be YYYY-MM-DD, got "${r.stay_date}"` },
        { status: 400 }
      );
    }
    if (!r.rate_plan_id) {
      return NextResponse.json(
        { error: "Every restriction needs a rate_plan_id" },
        { status: 400 }
      );
    }

    const min = stayValue(r.min_stay);
    const max = stayValue(r.max_stay);
    if (Number.isNaN(min) || Number.isNaN(max)) {
      return NextResponse.json(
        { error: "Minimum and maximum nights must be whole numbers above zero" },
        { status: 400 }
      );
    }
    if (min !== null && max !== null && min > max) {
      return NextResponse.json(
        {
          error: `Minimum nights (${min}) cannot exceed maximum nights (${max}) on ${r.stay_date}`,
        },
        { status: 400 }
      );
    }
  }

  try {
    const saved = await saveDailyRestrictions(propertyId, rows);
    return NextResponse.json({ saved: saved.length });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
