import { NextResponse } from "next/server";
import { getInvoicingReport } from "@/lib/financeReports";
import { periodRequest } from "../params";

/**
 * The invoice register for a period with tax by rule and numbering gaps,
 * the balances still owed as of today, and the stays that checked out in the
 * period without an invoice that matches their bill.
 */

const MAX_DAYS = 400;

export async function GET(req) {
  const ctx = await periodRequest(req, MAX_DAYS);
  if (ctx.error) return ctx.error;

  try {
    return NextResponse.json(
      await getInvoicingReport(ctx.propertyId, { start: ctx.start, end: ctx.end, tz: ctx.tz })
    );
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
