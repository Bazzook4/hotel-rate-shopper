import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import { normaliseTz } from "@/lib/financeReports";
import { recordReceipt, applyReceiptCredit, voidReceipt } from "@/lib/cityLedger";

/**
 * Money received from a company or agent.
 *
 *   POST   record a receipt and apply it to bills (chosen, or oldest first)
 *   PATCH  { id, action: "apply" }  apply what is left on a receipt
 *          { id, action: "void", reason }  void it and every payment it made
 *
 * A mistake in what was sent is the desk's to fix, so those answer 400; a
 * database failure answers 500.
 */

const failure = (err) =>
  NextResponse.json({ error: err.message }, { status: /^Failed to|could not be/.test(err.message) ? 500 : 400 });

async function context(req) {
  const { error, session } = await pmsGuard(req, ["cityledger"]);
  if (error) return { error };
  let body;
  try {
    body = await req.json();
  } catch {
    return { error: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) };
  }
  const propertyId = await resolvePropertyId(session, body.property_id);
  if (!propertyId) return { error: NextResponse.json({ error: "No property selected" }, { status: 400 }) };
  return { session, body, propertyId, tz: normaliseTz(body.tz) };
}

export async function POST(req) {
  const ctx = await context(req);
  if (ctx.error) return ctx.error;
  if (!ctx.body.company_id) return NextResponse.json({ error: "Choose the company" }, { status: 400 });
  try {
    const result = await recordReceipt(ctx.propertyId, { ...ctx.body, tz: ctx.tz }, ctx.session.userId);
    return NextResponse.json(result);
  } catch (err) {
    return failure(err);
  }
}

export async function PATCH(req) {
  const ctx = await context(req);
  if (ctx.error) return ctx.error;
  const { id, action } = ctx.body;
  if (!id) return NextResponse.json({ error: "Receipt id is required" }, { status: 400 });
  try {
    if (action === "apply") {
      const result = await applyReceiptCredit(
        ctx.propertyId,
        id,
        { allocations: ctx.body.allocations ?? null, tz: ctx.tz },
        ctx.session.userId
      );
      return NextResponse.json(result);
    }
    if (action === "void") {
      await voidReceipt(ctx.propertyId, id, ctx.body.reason, ctx.session.userId);
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return failure(err);
  }
}
