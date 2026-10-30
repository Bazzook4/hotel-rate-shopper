import { NextResponse } from "next/server";
import { moduleDeniedResponse } from "@/lib/propertyScope";
import { DISCOUNT_RIGHT } from "@/lib/discounts";
import { pmsGuard, resolvePropertyId, BOOKING_VIEW_PAGES } from "@/lib/pmsGuard";
import {
  walletHistory,
  topUpWallet,
  adjustWallet,
  voidWalletTransaction,
  payFromWallet,
  WalletError,
} from "@/lib/wallets";
import { getSupabaseAdmin } from "@/lib/database";

/**
 * Wallets of guests, companies and travel agents.
 *
 *   GET    ?type=guest|company&id=   balance and history
 *   POST   { action: "topup" | "adjust", type, id, ... }
 *          { action: "pay", reservationId, type, id, amount }   pay a bill
 *   PATCH  { action: "void", id, reason }                       void a top-up
 *
 * Paying a bill from a wallet is desk work, so any booking page may do it.
 * Adding money is the work of the page that owns the wallet: Guests for a
 * guest's, City Ledger or Companies & agents for a company's.
 */

const OWNER_PAGES = {
  guest: ["guests"],
  company: ["cityledger", "companies"],
};
const READ_PAGES = [...new Set(["guests", "companies", "cityledger", ...BOOKING_VIEW_PAGES])];

const failure = (err) =>
  NextResponse.json({ error: err.message }, { status: err instanceof WalletError ? 400 : 500 });

const ownerOf = (body) =>
  body?.type === "company" || body?.type === "guest" ? { type: body.type, id: body.id } : null;

async function readBody(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function GET(req) {
  const { error, session } = await pmsGuard(req, READ_PAGES);
  if (error) return error;
  const params = req.nextUrl.searchParams;
  const propertyId = await resolvePropertyId(session, params.get("propertyId"));
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });
  const owner = ownerOf({ type: params.get("type"), id: params.get("id") });
  if (!owner?.id) return NextResponse.json({ error: "Whose wallet?" }, { status: 400 });
  try {
    return NextResponse.json(await walletHistory(propertyId, owner));
  } catch (err) {
    return failure(err);
  }
}

export async function POST(req) {
  const body = await readBody(req);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const owner = ownerOf(body);
  if (!owner?.id) return NextResponse.json({ error: "Whose wallet?" }, { status: 400 });

  const pages = body.action === "pay" ? BOOKING_VIEW_PAGES : OWNER_PAGES[owner.type];
  const { error, session } = await pmsGuard(req, pages);
  if (error) return error;
  const propertyId = await resolvePropertyId(session, body.property_id);
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });

  // Credit with no money behind it is a discount: an adjustment that adds
  // credit, or a hand-typed top-up crediting more than was paid. Either
  // needs the right to give discounts. A plan's bonus was set by an admin.
  const freeCredit =
    (body.action === "adjust" && Number(body.credit) > 0) ||
    (body.action === "topup" &&
      !body.plan_id &&
      body.credit !== "" &&
      body.credit != null &&
      Number(body.credit) > Number(body.cash_amount));
  if (freeCredit && (await moduleDeniedResponse(session, DISCOUNT_RIGHT))) {
    return NextResponse.json(
      { error: "Credit more than the money paid is a discount. You do not have the right to give discounts. Ask your admin." },
      { status: 403 }
    );
  }

  try {
    if (body.action === "topup") {
      const { transaction } = await topUpWallet(propertyId, owner, body, session.userId);
      return NextResponse.json({ transaction });
    }
    if (body.action === "adjust") {
      const transaction = await adjustWallet(propertyId, owner, body, session.userId);
      return NextResponse.json({ transaction });
    }
    if (body.action === "pay") {
      if (!body.reservationId) return NextResponse.json({ error: "Which booking?" }, { status: 400 });
      const payment = await payFromWallet(propertyId, body.reservationId, owner, body.amount, session.userId, {
        billGuestId: body.billGuestId || null,
      });
      return NextResponse.json({ payment });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return failure(err);
  }
}

export async function PATCH(req) {
  const body = await readBody(req);
  if (!body?.id || body.action !== "void") {
    return NextResponse.json({ error: "Which wallet entry, and what to do?" }, { status: 400 });
  }

  // The page allowed to void depends on whose wallet the entry is in.
  const { data: tx } = await getSupabaseAdmin()
    .from("wallet_transactions")
    .select("guest_id, company_id")
    .eq("id", body.id)
    .maybeSingle();
  if (!tx) return NextResponse.json({ error: "That wallet entry was not found." }, { status: 404 });

  const { error, session } = await pmsGuard(req, OWNER_PAGES[tx.company_id ? "company" : "guest"]);
  if (error) return error;
  const propertyId = await resolvePropertyId(session, body.property_id);
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });

  try {
    const result = await voidWalletTransaction(propertyId, body.id, body.reason, session.userId);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return failure(err);
  }
}
