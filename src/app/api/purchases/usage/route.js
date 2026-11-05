import { NextResponse } from "next/server";
import { getUsage } from "@/lib/purchases";
import { periodRequest } from "../../reports/params";

/** Purchases used, bought and spent over a period. Same right as Cash & Expenses. */
export async function GET(req) {
  const ctx = await periodRequest(req, "cashbook", 400);
  if (ctx.error) return ctx.error;
  try {
    return NextResponse.json(await getUsage(ctx.propertyId, { start: ctx.start, end: ctx.end, tz: ctx.tz }));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
