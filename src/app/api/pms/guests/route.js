import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId, BOOKING_VIEW_PAGES } from "@/lib/pmsGuard";
import {
  guestsReady,
  listGuests,
  getGuest,
  listGuestReservations,
  findGuestMatch,
  createGuest,
  updateGuest,
  deleteGuest,
  guestPhoneKey,
} from "@/lib/database";
import { walletBalances } from "@/lib/wallets";

/** Each guest's wallet balance, where they have a wallet. */
async function withWallets(propertyId, guests) {
  const balances = await walletBalances(propertyId, "guest", guests.map((g) => g.id)).catch(() => new Map());
  return guests.map((g) => ({ ...g, wallet: balances.get(g.id)?.balance ?? 0 }));
}

/**
 * The guest database.
 *
 * Looking a guest up is part of taking a booking, so anyone who can open a
 * booking may search. Changing or deleting a guest record is the Guests
 * page's own work.
 */
const LOOKUP_PAGES = ["guests", ...BOOKING_VIEW_PAGES];
const EDIT_PAGES = ["guests"];

const NOT_READY = "The guest list is not switched on for this property yet.";

/** Checks a guest record must pass, as a message the desk can act on. */
function validate(body, { creating }) {
  if (creating || "full_name" in body) {
    if (!String(body.full_name || "").trim()) return "Guest name is required.";
  }
  if (body.email && !/^\S+@\S+\.\S+$/.test(String(body.email).trim())) {
    return "That email address does not look right.";
  }
  return null;
}

/** Another guest with this phone or email, as a 409 naming them. */
async function duplicateResponse(propertyId, body, ignoreId = null) {
  if (body.allow_duplicate) return null;
  if (!("phone" in body) && !("email" in body)) return null;
  const match = await findGuestMatch(propertyId, body, { ignoreId });
  if (!match) return null;
  const samePhone = match.phone_key && match.phone_key === guestPhoneKey(body.phone);
  return NextResponse.json(
    {
      error: `${match.full_name} already has this ${samePhone ? "phone number" : "email"}.`,
      duplicate: match,
    },
    { status: 409 }
  );
}

export async function GET(req) {
  const { error, session } = await pmsGuard(req, LOOKUP_PAGES);
  if (error) return error;

  const params = req.nextUrl.searchParams;
  const propertyId = await resolvePropertyId(session, params.get("propertyId"));
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }

  // Before the table exists the lookup simply finds nobody, so the booking
  // form keeps working exactly as it did.
  if (!(await guestsReady())) {
    return NextResponse.json({ guests: [], notReady: true });
  }

  try {
    const id = params.get("id");
    if (id) {
      const guest = await getGuest(propertyId, id);
      if (!guest) return NextResponse.json({ error: "Guest not found" }, { status: 404 });
      const reservations = await listGuestReservations(propertyId, id);
      const [withWallet] = await withWallets(propertyId, [guest]);
      return NextResponse.json({ guest: withWallet, reservations });
    }

    const limit = Math.min(Math.max(Number(params.get("limit")) || 200, 1), 500);
    const guests = await listGuests(propertyId, { search: params.get("search"), limit });
    return NextResponse.json({ guests: await withWallets(propertyId, guests) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

async function readBody(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function POST(req) {
  const { error, session } = await pmsGuard(req, EDIT_PAGES);
  if (error) return error;

  const body = await readBody(req);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const propertyId = await resolvePropertyId(session, body.property_id);
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }
  if (!(await guestsReady())) return NextResponse.json({ error: NOT_READY }, { status: 409 });

  const invalid = validate(body, { creating: true });
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  try {
    const duplicate = await duplicateResponse(propertyId, body);
    if (duplicate) return duplicate;
    const guest = await createGuest(propertyId, body);
    return NextResponse.json({ guest });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req) {
  const { error, session } = await pmsGuard(req, EDIT_PAGES);
  if (error) return error;

  const body = await readBody(req);
  if (!body?.id) return NextResponse.json({ error: "Guest id is required" }, { status: 400 });

  const propertyId = await resolvePropertyId(session, body.property_id);
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }
  if (!(await guestsReady())) return NextResponse.json({ error: NOT_READY }, { status: 409 });

  const invalid = validate(body, { creating: false });
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  try {
    const existing = await getGuest(propertyId, body.id);
    if (!existing) return NextResponse.json({ error: "Guest not found" }, { status: 404 });

    const duplicate = await duplicateResponse(propertyId, body, body.id);
    if (duplicate) return duplicate;

    const { id, property_id, allow_duplicate, ...changes } = body;
    const guest = await updateGuest(propertyId, id, changes);
    return NextResponse.json({ guest });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  const { error, session } = await pmsGuard(req, EDIT_PAGES);
  if (error) return error;

  const params = req.nextUrl.searchParams;
  const id = params.get("id");
  if (!id) return NextResponse.json({ error: "Guest id is required" }, { status: 400 });

  const propertyId = await resolvePropertyId(session, params.get("propertyId"));
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }
  if (!(await guestsReady())) return NextResponse.json({ error: NOT_READY }, { status: 409 });

  try {
    const existing = await getGuest(propertyId, id);
    if (!existing) return NextResponse.json({ error: "Guest not found" }, { status: 404 });
    await deleteGuest(propertyId, id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
