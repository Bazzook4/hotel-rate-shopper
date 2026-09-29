import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import { normaliseTz } from "@/lib/financeReports";

/**
 * The questions every finance report route asks before it reads anything:
 * who is asking, for which property, over which dates, on which clock.
 *
 * Reading the property's own folios is front-office work, so these take the
 * PMS guard rather than the setup permission, as booking performance does.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function fail(message, status = 400) {
  return { error: NextResponse.json({ error: message }, { status }) };
}

async function base(req) {
  const { error, session } = await pmsGuard(req);
  if (error) return { error };
  const params = req.nextUrl.searchParams;
  const propertyId = await resolvePropertyId(session, params.get("propertyId"));
  if (!propertyId) return fail("No property selected");
  return { params, propertyId, tz: normaliseTz(params.get("tz")) };
}

/** A start and end date, both inclusive, at most `maxDays` apart. */
export async function periodRequest(req, maxDays) {
  const ctx = await base(req);
  if (ctx.error) return ctx;
  const start = ctx.params.get("start");
  const end = ctx.params.get("end");
  if (!ISO.test(start || "") || !ISO.test(end || "")) return fail("Choose a start and end date");
  if (end < start) return fail("The end date is before the start date");
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 + 1;
  if (days > maxDays) return fail(`Choose a period of at most ${maxDays} days`);
  return { ...ctx, start, end };
}

/** One business date. */
export async function dayRequest(req) {
  const ctx = await base(req);
  if (ctx.error) return ctx;
  const date = ctx.params.get("date");
  if (!ISO.test(date || "")) return fail("Choose a date");
  return { ...ctx, date };
}
