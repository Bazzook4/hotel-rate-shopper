import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId, BOOKING_PAGES } from "@/lib/pmsGuard";
import {
  getReservation,
  planStayChange,
  applyStayChange,
  getSupabaseAdmin,
  findRoomClash,
  checkAvailability,
  getRoom,
} from "@/lib/database";
import { holdsInventory } from "@/lib/dayUse";
import { syncInventory, staySpan } from "@/lib/inventorySync";

/**
 * Moving or resizing a stay by dragging it on the tape chart.
 *
 * Separate from the reservation edit because a drag asks a narrower question:
 * these dates, in that room. It checks the target room specifically rather
 * than the room type -- dropping a bar on room 204 must fail if 204 is taken,
 * even when three other rooms of the same type are free, which is not what
 * the type-level availability check answers. A room out of order for those
 * nights refuses the drop the same way.
 *
 * A resize changes what the stay costs, and that is the desk's decision, not
 * the chart's. So a drag that changes the number of nights is answered first
 * with `needsPricing` and the figures -- nothing is saved -- and the client
 * re-sends with `pricing: "adjust"` or `"keep"` once the desk has chosen. A
 * drag that keeps the length carries each night's rate across and saves at
 * once.
 */

function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function POST(req) {
  const { error, session } = await pmsGuard(req, BOOKING_PAGES);
  if (error) return error;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id, room_id, check_in, check_out } = body || {};
  if (!id) {
    return NextResponse.json({ error: "Reservation id is required" }, { status: 400 });
  }
  if (!isDate(check_in) || !isDate(check_out)) {
    return NextResponse.json({ error: "Both dates are required." }, { status: 400 });
  }
  if (check_out <= check_in) {
    return NextResponse.json(
      { error: "A stay must be at least one night." },
      { status: 400 }
    );
  }

  const propertyId = await resolvePropertyId(session, body.property_id);
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }

  try {
    const current = await getReservation(id);
    if (!current || current.property_id !== propertyId) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }

    // A day use is hours on one day, not a span of nights to drag; its date,
    // room and slot are changed in the booking itself.
    if (current.stay_kind === "day_use") {
      return NextResponse.json(
        { error: "Day-use bookings are changed from the booking, not by dragging." },
        { status: 409 }
      );
    }

    // A stay that has already ended should not slide around the chart on a
    // stray drag; correcting one is an edit, made deliberately in the modal.
    if (current.status === "checked_out") {
      return NextResponse.json(
        { error: "This guest has checked out. Edit the booking instead." },
        { status: 409 }
      );
    }

    // A room named by the browser must be this hotel's.
    if (room_id && !(await getRoom(propertyId, room_id))) {
      return NextResponse.json({ error: "That room could not be found." }, { status: 404 });
    }
    const targetRoom = room_id || current.room_id;

    if (targetRoom) {
      // Another stay, or the room being out of order, both refuse the drop.
      const clash = await findRoomClash(targetRoom, check_in, check_out, {
        ignoreReservationId: id,
      });
      if (clash) {
        return NextResponse.json({ error: clash.message }, { status: 409 });
      }
    }

    const updates = { check_in, check_out };

    // Dropping onto a different room re-types the booking to match it, since
    // the room is the more specific fact and a room of the wrong type would
    // otherwise leave the stay priced against a type it is not in.
    if (room_id && room_id !== current.room_id) {
      const { data: room, error: roomError } = await getSupabaseAdmin()
        .from("rooms")
        .select("id, room_type_id, is_active")
        .eq("id", room_id)
        .eq("property_id", propertyId)
        .single();

      if (roomError) {
        return NextResponse.json({ error: "That room could not be found." }, { status: 404 });
      }
      if (!room.is_active) {
        return NextResponse.json(
          { error: "That room is out of order." },
          { status: 409 }
        );
      }

      updates.room_id = room_id;
      updates.room_type_id = room.room_type_id;
    }

    // The room may be free while its type is full: bookings with no room yet
    // hold the type's rooms too. A drag that takes new nights, or moves the
    // stay to another type, is checked against the type like a booking is.
    const typeId = updates.room_type_id || current.room_type_id;
    const takesNew =
      typeId !== current.room_type_id ||
      check_in < current.check_in ||
      check_out > current.check_out;
    if (typeId && takesNew && holdsInventory(current, current.status)) {
      const check = await checkAvailability(propertyId, typeId, check_in, check_out, {
        ignoreReservationId: id,
      });
      if (!check.available) {
        return NextResponse.json({ error: check.reason }, { status: 409 });
      }
    }

    const plan = await planStayChange(current, {
      check_in,
      check_out,
      room_type_id: updates.room_type_id,
    });

    if (plan.lengthChanged && !["adjust", "keep"].includes(body.pricing)) {
      return NextResponse.json({ needsPricing: true, plan });
    }

    const reservation = await applyStayChange(id, updates, plan, body.pricing);

    // Dropped on another room of the same type for the same nights: nothing
    // the channels sell has changed, so the chart is not kept waiting on a push.
    const sameSale =
      reservation.room_type_id === current.room_type_id &&
      reservation.check_in === current.check_in &&
      reservation.check_out === current.check_out;

    // A drag can change the nights and the room type at once; the old span
    // is sent too, so whatever the stay let go of is reopened.
    const inventory = sameSale
      ? null
      : await syncInventory(propertyId, [staySpan(current), staySpan(reservation)], {
          session,
        });

    return NextResponse.json({ reservation, inventory });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
