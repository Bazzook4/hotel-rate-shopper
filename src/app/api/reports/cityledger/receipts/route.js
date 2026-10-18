import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import { normaliseTz } from "@/lib/financeReports";
import { recordReceipt, applyCompanyCredit, voidReceipt } from "@/lib/cityLedger";
import { WalletError } from "@/lib/wallets";

/**
 * Money received from a company or agent, which goes into its wallet.
 *
 *   POST   add it to the wallet and pay bills (chosen, or oldest first)
 *   PATCH  { company_id, action: "apply" }  spend the wallet on bills
 *          { id, action: "void", reason }  void money recorded in error
 *
 * A mistake in what was sent is the desk's to fix, so those answer 400; a
 * database failure answers 500.
 */

const failure = (err) =>
  NextResponse.json({ error: err.message }, { status: err instanceof WalletError ? 400 : 500 });

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
  try {
    if (action === "apply") {
      if (!ctx.body.company_id) return NextResponse.json({ error: "Choose the company" }, { status: 400 });
      const result = await applyCompanyCredit(
        ctx.propertyId,
        ctx.body.company_id,
        { allocations: ctx.body.allocations ?? null, tz: ctx.tz },
        ctx.session.userId
      );
      return NextResponse.json(result);
    }
    if (action === "void") {
      if (!id) return NextResponse.json({ error: "Which payment?" }, { status: 400 });
      const result = await voidReceipt(ctx.propertyId, id, ctx.body.reason, ctx.session.userId);
      return NextResponse.json({ success: true, ...result });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return failure(err);
  }
}
