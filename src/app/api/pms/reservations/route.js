import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import {
  listReservations,
  createReservation,
  updateReservation,
  deleteReservation,
  checkAvailability,
  acceptNightRates,
} from "@/lib/database";

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
    // show a Saturday at the Saturday rate rather than an even average.
    const fields = bookingFields(body);
    const rates = acceptNightRates(
      body.night_rates,
      fields.check_in,
      fields.check_out,
      fields.total_amount
    );

    const reservation = await createReservation(
      {
        ...fields,
        property_id: propertyId,
        status: body.status || "confirmed",
        created_by: session.userId,
      },
      { rates }
    );

    return NextResponse.json({ reservation });
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

    const fields = bookingFields(body);
    const rates = acceptNightRates(
      body.night_rates,
      fields.check_in,
      fields.check_out,
      fields.total_amount
    );

    const reservation = await updateReservation(id, fields, { rates });
    return NextResponse.json({ reservation });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  const { error } = await pmsGuard(req);
  if (error) return error;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Reservation id is required" }, { status: 400 });
  }

  try {
    await deleteReservation(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
