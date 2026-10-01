import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId, BOOKING_VIEW_PAGES } from "@/lib/pmsGuard";
import {
  getReservation,
  getSupabaseAdmin,
  getReservationFolio,
  saveReservationGuest,
  deleteReservationGuest,
  addReservationExtra,
  deleteReservationExtra,
  addReservationPayment,
  voidReservationPayment,
  createReservationInvoice,
  voidReservationInvoice,
  setNightRate,
} from "@/lib/database";

/**
 * Everything hanging off one reservation: guests, nights, extras, payments,
 * invoices.
 *
 * One route rather than four, because the booking modal opens all of them at
 * once and closing four round trips into one is the difference between the
 * modal appearing filled and appearing to load in pieces. Writes name what
 * they are acting on in `kind`, and always answer with the whole folio so the
 * modal's totals cannot drift from the rows it is showing.
 */

async function folioResponse(reservationId) {
  return NextResponse.json(await getReservationFolio(reservationId));
}

/** A 404 or 403 unless the reservation is at a property this session may act on. */
async function reservationDenied(session, reservationId) {
  const reservation = await getReservation(reservationId).catch(() => null);
  if (!reservation) {
    return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
  }
  if (!(await resolvePropertyId(session, reservation.property_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

const FOLIO_TABLES = {
  guest: "reservation_guests",
  extra: "reservation_extras",
  payment: "reservation_payments",
  invoice: "reservation_invoices",
};

/** Whether a folio row really hangs off this reservation, not another hotel's. */
async function rowBelongs(kind, id, reservationId) {
  const { data } = await getSupabaseAdmin()
    .from(FOLIO_TABLES[kind])
    .select("reservation_id")
    .eq("id", id)
    .maybeSingle();
  return data?.reservation_id === reservationId;
}

export async function GET(req) {
  const { error, session } = await pmsGuard(req, BOOKING_VIEW_PAGES);
  if (error) return error;

  const reservationId = req.nextUrl.searchParams.get("reservationId");
  if (!reservationId) {
    return NextResponse.json({ error: "Reservation id is required" }, { status: 400 });
  }
  const denied = await reservationDenied(session, reservationId);
  if (denied) return denied;

  try {
    return await folioResponse(reservationId);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  const { error, session } = await pmsGuard(req, BOOKING_VIEW_PAGES);
  if (error) return error;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { kind, reservationId } = body || {};
  if (!reservationId) {
    return NextResponse.json({ error: "Reservation id is required" }, { status: 400 });
  }
  const denied = await reservationDenied(session, reservationId);
  if (denied) return denied;

  try {
    switch (kind) {
      case "guest": {
        if (!body.guest?.first_name?.trim()) {
          return NextResponse.json({ error: "First name is required." }, { status: 400 });
        }
        await saveReservationGuest(reservationId, body.guest);
        break;
      }

      case "extra": {
        const line = body.line || {};
        if (!line.extra_id && !line.name?.trim()) {
          return NextResponse.json(
            { error: "Choose an item or give the line a name." },
            { status: 400 }
          );
        }
        if (line.quantity != null && Number(line.quantity) <= 0) {
          return NextResponse.json(
            { error: "Quantity must be more than zero." },
            { status: 400 }
          );
        }
        await addReservationExtra(reservationId, line);
        break;
      }

      case "payment": {
        const amount = Number(body.payment?.amount);
        if (!Number.isFinite(amount) || amount === 0) {
          return NextResponse.json(
            { error: "Enter an amount. Use a negative figure for a refund." },
            { status: 400 }
          );
        }
        await addReservationPayment(reservationId, body.payment, session.userId);
        break;
      }

      case "night": {
        const rate = Number(body.rate);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.stay_date || "")) {
          return NextResponse.json({ error: "Which night?" }, { status: 400 });
        }
        if (body.rate === "" || !Number.isFinite(rate) || rate < 0) {
          return NextResponse.json(
            { error: "Enter what the night costs — zero or more." },
            { status: 400 }
          );
        }
        await setNightRate(reservationId, body.stay_date, rate);
        break;
      }

      case "invoice": {
        await createReservationInvoice(reservationId, session.userId);
        break;
      }

      default:
        return NextResponse.json({ error: "Unknown folio action" }, { status: 400 });
    }

    return await folioResponse(reservationId);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  const { error, session } = await pmsGuard(req, BOOKING_VIEW_PAGES);
  if (error) return error;

  const params = req.nextUrl.searchParams;
  const kind = params.get("kind");
  const id = params.get("id");
  const reservationId = params.get("reservationId");

  if (!id || !reservationId) {
    return NextResponse.json(
      { error: "Both an id and a reservation id are required" },
      { status: 400 }
    );
  }
  if (!FOLIO_TABLES[kind]) {
    return NextResponse.json({ error: "Unknown folio action" }, { status: 400 });
  }
  const denied = await reservationDenied(session, reservationId);
  if (denied) return denied;
  if (!(await rowBelongs(kind, id, reservationId))) {
    return NextResponse.json({ error: "That line is not on this reservation" }, { status: 404 });
  }

  try {
    switch (kind) {
      case "guest":
        await deleteReservationGuest(id);
        break;
      case "extra":
        await deleteReservationExtra(id);
        break;
      case "payment":
        // Voided, never removed -- the cash-up has to be able to see it.
        await voidReservationPayment(id, params.get("reason"), session.userId);
        break;
      case "invoice":
        // Voided, never removed -- see the helper for why.
        await voidReservationInvoice(id, params.get("reason"));
        break;
      default:
        return NextResponse.json({ error: "Unknown folio action" }, { status: 400 });
    }

    return await folioResponse(reservationId);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
