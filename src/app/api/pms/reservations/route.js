import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId, BOOKING_VIEW_PAGES } from "@/lib/pmsGuard";
import {
  listReservations,
  createReservation,
  updateReservation,
  deleteReservation,
  checkAvailability,
  acceptNightRates,
  getReservation,
  findDayUseSlotClash,
  findRoomClash,
  reservationsHaveCountry,
  linkGuestForBooking,
  companiesReady,
  getCompany,
  listRatePlans,
} from "@/lib/database";
import { toCountryCode } from "@/lib/countries";
import { syncInventory, staySpan } from "@/lib/inventorySync";
import { dayUseWindow, isDayUsePlan, validDayUseHours, validDayUseStart } from "@/lib/dayUse";

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
  if (body.stay_kind === "day_use") {
    // Its hours come from the plan, or the form when there is none; checked
    // once the plan is known.
  } else if (!isDate(body.check_out)) {
    return "Check-out date is required.";
  } else if (body.check_out <= body.check_in) {
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
 * Whether this is a day use, and what that does to its fields.
 *
 * The rate plan decides: a booking on a day-use plan is a day use of that
 * plan's hours, and one on an overnight plan is not, whatever the form sent.
 * With no plan the form's choice stands, its price typed by hand. A day use
 * leaves on the day it arrives, whatever the form's check-out box held.
 *
 * Like `booking_type`, the columns are only written where they are known to
 * exist -- on a new booking only for a day use, on an edit only when the
 * stored row carries them -- so overnight bookings keep working on a database
 * migration 048 has not reached. Returns a message when the plan and the
 * stay disagree in a way the desk must fix.
 */
async function applyStayKind(fields, body, propertyId, before = null) {
  let dayUse = body.stay_kind === "day_use";
  let hours = validDayUseHours(body.day_use_hours);
  if (fields.rate_plan_id) {
    const plans = await listRatePlans(propertyId).catch(() => []);
    const plan = plans.find((p) => p.id === fields.rate_plan_id);
    if (plan) {
      dayUse = isDayUsePlan(plan);
      if (dayUse) hours = Number(plan.day_use_hours);
    }
  }
  if (dayUse && !hours) {
    return "Pick a day-use plan for this room type. Add one in Rate Plan Setup if there is none.";
  }
  if (!dayUse && body.stay_kind === "day_use") {
    return "That rate plan sells nights. Pick a day-use plan for a day use.";
  }

  if (dayUse) {
    // A booked time, so the room can take another day use before or after.
    // An edit that leaves the time alone keeps the one stored.
    const rawStart = body.day_use_start ?? before?.day_use_start ?? null;
    const start = validDayUseStart(rawStart, hours);
    if (!start) {
      return rawStart
        ? `A ${hours}-hour day use starting then would run past midnight. Pick an earlier time.`
        : "Pick a start time for the day use.";
    }
    fields.stay_kind = "day_use";
    fields.day_use_hours = hours;
    fields.day_use_start = start;
    fields.check_out = fields.check_in;
  } else if (before && "stay_kind" in before) {
    fields.stay_kind = "overnight";
    fields.day_use_hours = null;
    if ("day_use_start" in before) fields.day_use_start = null;
  }
  return null;
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

/**
 * The guest's country, as a code, when there is one and the column exists.
 *
 * Left off entirely before migration 028 rather than failing the booking --
 * the desk loses a report field for a day, not a reservation. An edit that
 * clears the box stores null.
 */
async function applyGuestCountry(fields, body) {
  if (!("guest_country" in body)) return;
  if (!(await reservationsHaveCountry())) return;
  fields.guest_country = toCountryCode(body.guest_country);
}

/**
 * Put the booking on a guest record: the one the desk picked, or one matched
 * on phone or email, or a new one. `guest_id` is only sent by the form; when
 * it is absent an edit keeps the guest the booking already had.
 *
 * A guest that cannot be linked never costs the desk the booking -- the
 * booking is saved unlinked and the reason logged.
 */
async function applyGuest(fields, body, propertyId, before = null) {
  const chosen = "guest_id" in body ? body.guest_id || null : before?.guest_id || null;
  try {
    const guestId = await linkGuestForBooking(propertyId, fields, chosen);
    if (guestId) fields.guest_id = guestId;
    else if (before?.guest_id && "guest_id" in body) fields.guest_id = null;
  } catch (err) {
    console.error("Could not link the booking to a guest:", err.message);
  }
}

/**
 * The company or agent on the booking, who the invoice is addressed to, and
 * the agent's commission.
 *
 * Commission is copied from the agent when the booking is made, or when it
 * moves to a different agent, and otherwise left as it was -- a later change
 * to the agent's terms must not rewrite what an old booking owes them.
 *
 * Only written once migration 046 has run, and only when the form sent a
 * company field, so older callers and an un-migrated database are untouched.
 * Returns a message when the company named is not this property's.
 */
async function applyCompany(fields, body, propertyId, before = null) {
  if (!("company_id" in body)) return null;
  if (!(await companiesReady())) return null;

  const companyId = body.company_id || null;
  if (!companyId) {
    fields.company_id = null;
    fields.bill_to = "guest";
    fields.commission_percent = null;
    return null;
  }

  const company = await getCompany(propertyId, companyId);
  if (!company) return "That company or agent is not on this property's list.";

  fields.company_id = company.id;
  fields.bill_to = body.bill_to === "company" ? "company" : "guest";
  if (!before || before.company_id !== company.id) {
    fields.commission_percent =
      company.kind === "travel_agent" && company.commission_percent != null
        ? Number(company.commission_percent)
        : null;
  }
  return null;
}

/** A room already held for those nights, as a 409 the form can show. */
async function roomClashResponse(fields, ignoreReservationId = null) {
  if (!fields.room_id) return null;
  const clash =
    (await findRoomClash(fields.room_id, fields.check_in, fields.check_out, {
      ignoreReservationId,
    })) ||
    (fields.stay_kind === "day_use"
      ? await findDayUseSlotClash(
          fields.room_id,
          fields.check_in,
          dayUseWindow(fields),
          ignoreReservationId
        )
      : null);
  return clash ? NextResponse.json({ error: clash.message }, { status: 409 }) : null;
}

export async function GET(req) {
  const { error, session } = await pmsGuard(req, BOOKING_VIEW_PAGES);
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
      arrivingOn: isDate(params.get("arrivingOn")) ? params.get("arrivingOn") : null,
      leavingOn: isDate(params.get("leavingOn")) ? params.get("leavingOn") : null,
      search: params.get("search"),
    });
    return NextResponse.json({ reservations });
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

  const propertyId = await resolvePropertyId(session, body.property_id);
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }

  const invalid = validate(body);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  try {
    const fields = bookingFields(body);
    const badStay = await applyStayKind(fields, body, propertyId);
    if (badStay) return NextResponse.json({ error: badStay }, { status: 400 });
    const dayUse = fields.stay_kind === "day_use";
    const complimentary = applyBookingType(fields, body);
    await applyGuestCountry(fields, body);
    const badCompany = await applyCompany(fields, body, propertyId);
    if (badCompany) return NextResponse.json({ error: badCompany }, { status: 400 });

    // A booking placed in a particular room -- from a cell on the tape chart,
    // say -- must find that room free, which the type-level count below
    // cannot tell. Overbooking a type is a choice; two guests in one room is
    // not, so this is refused outright.
    const roomTaken = await roomClashResponse(fields);
    if (roomTaken) return roomTaken;

    // Overbooking is a decision, not an accident: the check runs first and a
    // full date is refused unless the caller deliberately overrides it. A day
    // use takes a room for its date, so it is checked on that date.
    if (!body.allow_overbook) {
      const availability = await checkAvailability(
        propertyId,
        fields.room_type_id,
        fields.check_in,
        fields.check_out
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
    const rates = complimentary || dayUse
      ? null
      : acceptNightRates(body.night_rates, fields.check_in, fields.check_out, fields.total_amount);

    await applyGuest(fields, body, propertyId);

    const reservation = await createReservation(
      {
        ...fields,
        property_id: propertyId,
        // A new booking starts as confirmed or, if the guest has only asked,
        // as an inquiry -- which holds the room all the same.
        status: body.status === "inquiry" ? "inquiry" : "confirmed",
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
  const { error, session } = await pmsGuard(req, BOOKING_VIEW_PAGES);
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
    const badStay = await applyStayKind(fields, body, propertyId, before);
    if (badStay) return NextResponse.json({ error: badStay }, { status: 400 });
    const dayUse = fields.stay_kind === "day_use";
    const complimentary = applyBookingType(fields, body, before);
    await applyGuestCountry(fields, body);
    const badCompany = await applyCompany(fields, body, propertyId, before);
    if (badCompany) return NextResponse.json({ error: badCompany }, { status: 400 });

    // Only when the stay moved room or dates: an unrelated edit to a booking
    // should not be refused over a clash it did not create.
    const moved =
      fields.room_id !== before.room_id ||
      fields.check_in !== before.check_in ||
      fields.check_out !== before.check_out ||
      // A day use moved to another time, or lengthened, can now meet another.
      (dayUse &&
        (fields.day_use_start !== String(before.day_use_start || "").slice(0, 5) ||
          fields.day_use_hours !== before.day_use_hours));
    if (moved) {
      const roomTaken = await roomClashResponse(fields, id);
      if (roomTaken) return roomTaken;
    }

    if (!body.allow_overbook) {
      // The stay checks its own dates without counting itself as competition
      // for the room it already holds.
      const availability = await checkAvailability(
        propertyId,
        fields.room_type_id,
        fields.check_in,
        fields.check_out,
        { ignoreReservationId: id }
      );
      if (!availability.available) {
        return NextResponse.json(
          { error: availability.reason, availability },
          { status: 409 }
        );
      }
    }

    const rates = complimentary || dayUse
      ? null
      : acceptNightRates(body.night_rates, fields.check_in, fields.check_out, fields.total_amount);

    await applyGuest(fields, body, propertyId, before);

    const reservation = await updateReservation(id, fields, { rates });

    // The channels sell room types, not rooms: an edit that keeps the type and
    // the dates -- assigning a room, fixing a phone number -- changes nothing
    // on sale, and waiting on a push for it only kept the desk waiting.
    const sameSale =
      reservation.room_type_id === before.room_type_id &&
      reservation.check_in === before.check_in &&
      reservation.check_out === before.check_out;

    // Both the nights given up and the nights now held, so a stay moved to
    // next week reopens this week on the channels as well as closing next.
    const inventory = sameSale
      ? null
      : await syncInventory(propertyId, [staySpan(before), staySpan(reservation)], {
          session,
        });

    return NextResponse.json({ reservation, inventory });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  const { error, session } = await pmsGuard(req, BOOKING_VIEW_PAGES);
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
