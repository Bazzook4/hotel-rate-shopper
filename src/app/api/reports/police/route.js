import { NextResponse } from "next/server";
import { getGuestRegister } from "@/lib/guestRegister";
import { localToday, shiftDay } from "@/lib/financeReports";
import { periodRequest } from "../params";

/**
 * The police register: everyone who checked in over a few days, with their
 * ID, address and nationality, and what is still missing.
 */

// The register is handed in daily or weekly; a month is the most anyone
// prints at once.
const MAX_DAYS = 62;

export async function GET(req) {
  const ctx = await periodRequest(req, "policereport", MAX_DAYS);
  if (ctx.error) return ctx.error;

  try {
    const report = await getGuestRegister(ctx.propertyId, { start: ctx.start, end: ctx.end, tz: ctx.tz });
    // The Form C tab is shown only to hotels that get foreign guests: any
    // in these dates, or in the last 90 days.
    let foreignRecently = report.summary.foreign > 0;
    if (!foreignRecently) {
      const today = localToday(ctx.tz);
      const recent = await getGuestRegister(ctx.propertyId, { start: shiftDay(today, -90), end: today, tz: ctx.tz });
      foreignRecently = recent.summary.foreign > 0;
    }
    return NextResponse.json({ ...report, foreignRecently });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
