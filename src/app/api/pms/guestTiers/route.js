import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId, BOOKING_VIEW_PAGES } from "@/lib/pmsGuard";
import { listGuestTiers, saveGuestTier, deleteGuestTier, WalletError } from "@/lib/wallets";

/**
 * Guest tiers -- the labels (Gold, Platinum, VIP…) the desk gives a guest,
 * shown as a badge wherever the guest is. Set by hand on the Guests page;
 * anyone who can open a booking may read them, to show the badge.
 */
const EDIT_PAGES = ["guests"];
const READ_PAGES = [...new Set(["guests", ...BOOKING_VIEW_PAGES])];

const failure = (err) =>
  NextResponse.json({ error: err.message }, { status: err instanceof WalletError ? 400 : 500 });

export async function GET(req) {
  const { error, session } = await pmsGuard(req, READ_PAGES);
  if (error) return error;
  const propertyId = await resolvePropertyId(session, req.nextUrl.searchParams.get("propertyId"));
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });
  try {
    return NextResponse.json({ tiers: await listGuestTiers(propertyId) });
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
    const { property_id, ...tier } = body;
    return NextResponse.json({ tier: await saveGuestTier(propertyId, tier) });
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
  if (!params.get("id")) return NextResponse.json({ error: "Which tier?" }, { status: 400 });
  try {
    await deleteGuestTier(propertyId, params.get("id"));
    return NextResponse.json({ success: true });
  } catch (err) {
    return failure(err);
  }
}
