import { NextResponse } from "next/server";
import { getNightAudit } from "@/lib/financeReports";
import { dayRequest } from "../params";

/**
 * The night audit for one business date: movement, rooms, revenue posted,
 * money collected, and the exceptions to clear before the day is closed.
 */
export async function GET(req) {
  const ctx = await dayRequest(req);
  if (ctx.error) return ctx.error;

  try {
    return NextResponse.json(await getNightAudit(ctx.propertyId, { date: ctx.date, tz: ctx.tz }));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
