import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId, BOOKING_VIEW_PAGES } from "@/lib/pmsGuard";
import { listWalletPlans, saveWalletPlan, deleteWalletPlan, WalletError } from "@/lib/wallets";

/**
 * Wallet plans -- "pay 10,000, get 11,000". Anyone who can add money to a
 * wallet may read them; the pages that sell top-ups may change them.
 */
const EDIT_PAGES = ["guests", "companies", "cityledger"];
const READ_PAGES = [...new Set([...EDIT_PAGES, ...BOOKING_VIEW_PAGES])];

const failure = (err) =>
  NextResponse.json({ error: err.message }, { status: err instanceof WalletError ? 400 : 500 });

export async function GET(req) {
  const { error, session } = await pmsGuard(req, READ_PAGES);
  if (error) return error;
  const propertyId = await resolvePropertyId(session, req.nextUrl.searchParams.get("propertyId"));
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });
  try {
    return NextResponse.json({ plans: await listWalletPlans(propertyId) });
  } catch (err) {
    return failure(err);
  }
}

async function save(req) {
  const { error, session } = await pmsGuard(req, EDIT_PAGES);
  if (error) return error;
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const propertyId = await resolvePropertyId(session, body.property_id);
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });
  try {
    const { property_id, ...plan } = body;
    return NextResponse.json({ plan: await saveWalletPlan(propertyId, plan) });
  } catch (err) {
    return failure(err);
  }
}

export const POST = save;
export const PATCH = save;

export async function DELETE(req) {
  const { error, session } = await pmsGuard(req, EDIT_PAGES);
  if (error) return error;
  const params = req.nextUrl.searchParams;
  const propertyId = await resolvePropertyId(session, params.get("propertyId"));
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });
  if (!params.get("id")) return NextResponse.json({ error: "Which plan?" }, { status: 400 });
  try {
    await deleteWalletPlan(propertyId, params.get("id"));
    return NextResponse.json({ success: true });
  } catch (err) {
    return failure(err);
  }
}
