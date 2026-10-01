import { NextResponse } from "next/server";
import { getPaymentsReport } from "@/lib/financeReports";
import { periodRequest } from "../params";

/**
 * Payments taken over a period: collected and refunded by method, by day and
 * by who recorded them, every payment listed, and the ones voided set apart.
 */

// A year against itself is the longest period anyone reconciles; past that
// the list is too long to read.
const MAX_DAYS = 400;

export async function GET(req) {
  const ctx = await periodRequest(req, "payments", MAX_DAYS);
  if (ctx.error) return ctx.error;

  try {
    return NextResponse.json(
      await getPaymentsReport(ctx.propertyId, { start: ctx.start, end: ctx.end, tz: ctx.tz })
    );
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
