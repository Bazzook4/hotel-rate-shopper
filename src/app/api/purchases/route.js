import { NextResponse } from "next/server";
import { getPropertyClock } from "@/lib/database";
import { addItem, addMove, archiveItem, getPurchases, voidMove } from "@/lib/purchases";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";

/**
 * Purchases: items bought and used up, what is in stock, and what needs
 * buying again. Lives under Cash & Expenses, so the same right opens it.
 */

const PAGE = "cashbook";

async function context(req, readBody) {
  const { error, session } = await pmsGuard(req, [PAGE]);
  if (error) return { error };
  let body = {};
  if (readBody) {
    try {
      body = await req.json();
    } catch {
      return { error: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) };
    }
  }
  const asked = readBody ? body?.propertyId : req.nextUrl.searchParams.get("propertyId");
  const propertyId = await resolvePropertyId(session, asked);
  if (!propertyId) return { error: NextResponse.json({ error: "No property selected" }, { status: 400 }) };
  return { session, body, propertyId, tz: await getPropertyClock(propertyId) };
}

export async function GET(req) {
  const ctx = await context(req, false);
  if (ctx.error) return ctx.error;
  try {
    return NextResponse.json(await getPurchases(ctx.propertyId, { tz: ctx.tz }));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** Add an item (`item`) or a purchase, count or use (`move`). */
export async function POST(req) {
  const ctx = await context(req, true);
  if (ctx.error) return ctx.error;
  const { body, propertyId, session, tz } = ctx;
  try {
    if (body.item) await addItem(propertyId, body.item, session.userId, tz);
    else await addMove(propertyId, body.move, session.userId, tz);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

/** Cancel a line (`voidMove`) or take an item off the list (`archive`). */
export async function PATCH(req) {
  const ctx = await context(req, true);
  if (ctx.error) return ctx.error;
  const { body, propertyId, session } = ctx;
  try {
    if (body.voidMove) await voidMove(propertyId, body.voidMove, session.userId);
    else if (body.archive) await archiveItem(propertyId, body.archive);
    else throw new Error("Nothing to change.");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
