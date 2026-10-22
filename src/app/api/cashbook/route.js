import { NextResponse } from "next/server";
import { addCashEntry, getCashBook, recordCount, voidCashEntry } from "@/lib/cashBook";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import { periodRequest } from "../reports/params";

/**
 * The cash book: cash in and out over a period, expenses by tag, the drawer
 * counts, and what the drawer should hold now.
 */

const PAGE = "cashbook";
const MAX_DAYS = 400;

export async function GET(req) {
  const ctx = await periodRequest(req, PAGE, MAX_DAYS);
  if (ctx.error) return ctx.error;

  try {
    return NextResponse.json(await getCashBook(ctx.propertyId, { start: ctx.start, end: ctx.end, tz: ctx.tz }));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

async function context(req) {
  const { error, session } = await pmsGuard(req, [PAGE]);
  if (error) return { error };
  let body;
  try {
    body = await req.json();
  } catch {
    return { error: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) };
  }
  const propertyId = await resolvePropertyId(session, body?.propertyId);
  if (!propertyId) return { error: NextResponse.json({ error: "No property selected" }, { status: 400 }) };
  return { session, body, propertyId };
}

/** Add an entry (`entry`) or record a drawer count (`count`). */
export async function POST(req) {
  const ctx = await context(req);
  if (ctx.error) return ctx.error;
  const { body, propertyId, session } = ctx;

  try {
    if (body.count) {
      return NextResponse.json(await recordCount(propertyId, body.count, session.userId));
    }
    await addCashEntry(propertyId, body.entry, session.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

/** Void an entry, with the reason. Entries are never edited or deleted. */
export async function PATCH(req) {
  const ctx = await context(req);
  if (ctx.error) return ctx.error;
  const { body, propertyId, session } = ctx;

  try {
    await voidCashEntry(propertyId, body.id, body.reason, session.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
