import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import {
  listReservations,
  createReservation,
  updateReservation,
  deleteReservation,
  checkAvailability,
  acceptNightRates,
  getReservation,
  findRoomClash,
} from "@/lib/database";
import { syncInventory, staySpan } from "@/lib/inventorySync";

/** A date the database will accept, and that a person actually typed. */
function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * The checks a booking must pass before it reaches the database.
 *
 * Returned as a message rather than thrown, so the route answers with
 * something a receptionist can act on instead of a constraint violation.
 */
function validate(body) {
  if (!body.guest_name?.trim()) return "Guest name is required.";
  if (!body.room_type_id) return "Choose a room type.";
  if (!isDate(body.check_in)) return "Check-in date is required.";
  if (!isDate(body.check_out)) return "Check-out date is required.";
  if (body.check_out <= body.check_in) {
    return "Check-out must be at least one night after check-in.";
  }
  if (body.adults != null && Number(body.adults) < 1) {
    return "A booking needs at least one adult.";
  }
  if (body.total_amount != null && body.total_amount !== "" && Number(body.total_amount) < 0) {
    return "Amount cannot be negative.";
  }
  return null;
}

/** Only the fields a client may set; anything else is ignored rather than trusted. */
function bookingFields(body) {
  return {
    guest_name: body.guest_name?.trim(),
    guest_email: body.guest_email?.trim() || null,
    guest_phone: body.guest_phone?.trim() || null,
    guest_residency: body.guest_residency === "international" ? "international" : "domestic",
    room_type_id: body.room_type_id,
    room_id: body.room_id || null,
    rate_plan_id: body.rate_plan_id || null,
    check_in: body.check_in,
    check_out: body.check_out,
    adults: Number(body.adults ?? 2),
    children: Number(body.children ?? 0),
    source: body.source?.trim() || "direct",
    total_amount:
      body.total_amount === "" || body.total_amount == null
        ? null
        : Number(body.total_amount),
    currency: body.currency || "INR",
    notes: body.notes?.trim() || null,
  };
}

/**
 * Whether this booking is complimentary, and what that does to its fields.
 *
 * A complimentary stay costs nothing, whatever the form's total box says, so
 * its total is zeroed here rather than trusted from the client.
 *
 * `booking_type` is only written where the column is known to exist: on a
 * new booking only when it is complimentary (a standard one is the column's
 * default), and on an edit only when the stored row already carries it. That
 * keeps ordinary bookings working on a database migration 027 has not reached.
 */
function applyBookingType(fields, body, before = null) {
  const complimentary = body.booking_type === "complimentary";
  if (complimentary) {
    fields.booking_type = "complimentary";
    fields.total_amount = 0;
  } else if (before && "booking_type" in before) {
    fields.booking_type = "standard";
  }
  return complimentary;
}

/** A room already held for those nights, as a 409 the form can show. */
async function roomClashResponse(fields, ignoreReservationId = null) {
  if (!fields.room_id) return null;
  const clash = await findRoomClash(fields.room_id, fields.check_in, fields.check_out, {
    ignoreReservationId,
  });
  return clash ? NextResponse.json({ error: clash.message }, { status: 409 }) : null;
}

export async function GET(req) {
  const { error, session } = await pmsGuard(req);
  if (error) return error;

  const params = req.nextUrl.searchParams;
  const propertyId = await resolvePropertyId(session, params.get("propertyId"));
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }

  try {
    const reservations = await listReservations(propertyId, {
      status: params.get("status"),
      from: params.get("from"),
      to: params.get("to"),
      search: params.get("search"),
    });
    return NextResponse.json({ reservations });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  const { error, session } = await pmsGuard(req);
  if (error) return error;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const propertyId = await resolvePropertyId(session, body.property_id);
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }

  const invalid = validate(body);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  try {
    const fields = bookingFields(body);
    const complimentary = applyBookingType(fields, body);

    // A booking placed in a particular room -- from a cell on the tape chart,
    // say -- must find that room free, which the type-level count below
    // cannot tell. Overbooking a type is a choice; two guests in one room is
    // not, so this is refused outright.
    const roomTaken = await roomClashResponse(fields);
    if (roomTaken) return roomTaken;

    // Overbooking is a decision, not an accident: the check runs first and a
    // full date is refused unless the caller deliberately overrides it.
    if (!body.allow_overbook) {
      const availability = await checkAvailability(
        propertyId,
        body.room_type_id,
        body.check_in,
        body.check_out
      );
      if (!availability.available) {
        return NextResponse.json(
          { error: availability.reason, availability },
          { status: 409 }
        );
      }
    }

    // A quoted booking arrives with the price of each night, so the folio can
    // show a Saturday at the Saturday rate rather than an even average. A
    // complimentary one has no prices to keep: every night is nothing.
    const rates = complimentary
      ? null
      : acceptNightRates(body.night_rates, fields.check_in, fields.check_out, fields.total_amount);

    const reservation = await createReservation(
      {
        ...fields,
        property_id: propertyId,
        status: body.status || "confirmed",
        created_by: session.userId,
      },
      { rates }
    );

    // The rooms this booking took are no longer for sale anywhere else.
    const inventory = await syncInventory(propertyId, [staySpan(reservation)], { session });

    return NextResponse.json({ reservation, inventory });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req) {
  const { error, session } = await pmsGuard(req);
  if (error) return error;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id } = body || {};
  if (!id) {
    return NextResponse.json({ error: "Reservation id is required" }, { status: 400 });
  }

  const propertyId = await resolvePropertyId(session, body.property_id);
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }

  const invalid = validate(body);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  try {
    const before = await getReservation(id).catch(() => null);
    if (!before || before.property_id !== propertyId) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }

    const fields = bookingFields(body);
    const complimentary = applyBookingType(fields, body, before);

    // Only when the stay moved room or dates: an unrelated edit to a booking
    // should not be refused over a clash it did not create.
    const moved =
      fields.room_id !== before.room_id ||
      fields.check_in !== before.check_in ||
      fields.check_out !== before.check_out;
    if (moved) {
      const roomTaken = await roomClashResponse(fields, id);
      if (roomTaken) return roomTaken;
    }

    if (!body.allow_overbook) {
      // The stay checks its own dates without counting itself as competition
      // for the room it already holds.
      const availability = await checkAvailability(
        propertyId,
        body.room_type_id,
        body.check_in,
        body.check_out,
        { ignoreReservationId: id }
      );
      if (!availability.available) {
        return NextResponse.json(
          { error: availability.reason, availability },
          { status: 409 }
        );
      }
    }

    const rates = complimentary
      ? null
      : acceptNightRates(body.night_rates, fields.check_in, fields.check_out, fields.total_amount);

    const reservation = await updateReservation(id, fields, { rates });

    // Both the nights given up and the nights now held, so a stay moved to
    // next week reopens this week on the channels as well as closing next.
    const inventory = await syncInventory(
      propertyId,
      [staySpan(before), staySpan(reservation)],
      { session }
    );

    return NextResponse.json({ reservation, inventory });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  const { error, session } = await pmsGuard(req);
  if (error) return error;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Reservation id is required" }, { status: 400 });
  }

  try {
    const before = await getReservation(id).catch(() => null);
    const propertyId = before
      ? await resolvePropertyId(
          session,
          req.nextUrl.searchParams.get("propertyId") || before.property_id
        )
      : null;
    if (!before || !propertyId || before.property_id !== propertyId) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }

    await deleteReservation(id);

    // A deleted stay frees its nights, so they go back on sale.
    const inventory = await syncInventory(propertyId, [staySpan(before)], { session });

    return NextResponse.json({ success: true, inventory });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
