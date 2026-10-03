import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId, BOOKING_VIEW_PAGES } from "@/lib/pmsGuard";
import { findRoomClash, getReservation, getRoom, setReservationStatus } from "@/lib/database";
import { syncInventory, staySpan } from "@/lib/inventorySync";
import { todayUTC } from "@/lib/date";

/**
 * Moving a reservation through its lifecycle.
 *
 * Separate from the reservation route because a status change is not an edit
 * of the booking: it records something that happened at the desk, and the
 * transitions it allows are narrower than "set any field".
 */

const STATUSES = ["inquiry", "confirmed", "in_house", "checked_out", "cancelled", "no_show"];

/** The statuses that hold a room; moving between these and the rest changes what is free. */
const HOLDS_ROOM = new Set(["inquiry", "confirmed", "in_house", "checked_out"]);

/**
 * Which moves make sense from where.
 *
 * A guest cannot check out before checking in, and a stay that already ended
 * is not something to cancel. Refusing these in one place keeps the front
 * desk from recording a sequence of events that never happened.
 */
const ALLOWED = {
  // An inquiry is confirmed or dropped; the guest is not checked in on one.
  inquiry: ["confirmed", "cancelled"],
  confirmed: ["in_house", "cancelled", "no_show", "inquiry"],
  in_house: ["checked_out", "confirmed"],
  checked_out: ["in_house"],
  cancelled: ["confirmed"],
  no_show: ["confirmed"],
};

/** A status in the desk's words; `in_house` is shown as "checked in". */
function statusLabel(status) {
  return status === "in_house" ? "checked in" : status.replace("_", " ");
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

  const { id, status, room_id } = body || {};
  if (!id) {
    return NextResponse.json({ error: "Reservation id is required" }, { status: 400 });
  }
  if (!STATUSES.includes(status)) {
    return NextResponse.json({ error: "Unknown reservation status" }, { status: 400 });
  }

  try {
    // The desk's buttons do not name a property, so the booking's own stands
    // in -- resolvePropertyId still refuses it to anyone it does not belong to.
    const current = await getReservation(id).catch(() => null);
    const propertyId = current
      ? await resolvePropertyId(session, body.property_id || current.property_id)
      : null;
    if (!current || !propertyId || current.property_id !== propertyId) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }

    if (current.status === status) {
      return NextResponse.json({ reservation: current });
    }

    if (!ALLOWED[current.status]?.includes(status)) {
      return NextResponse.json(
        {
          error: `A ${statusLabel(current.status)} booking cannot move to ${statusLabel(status)}.`,
        },
        { status: 409 }
      );
    }

    // A guest cannot be checked in before the day they arrive. The desk
    // otherwise marks tomorrow's arrival in house today, which makes the
    // occupancy figures and the tape chart disagree with the building -- and
    // nothing downstream can tell that it was a mis-click rather than a stay
    // that really started early. A late arrival is a different matter and is
    // allowed: the guest is standing there, the date has simply passed.
    if (status === "in_house" && current.check_in > todayUTC()) {
      return NextResponse.json(
        {
          error: `This booking arrives on ${current.check_in}. Move the dates if the guest is arriving early.`,
        },
        { status: 409 }
      );
    }

    // Checking in without a room assigned leaves the guest nowhere, so the
    // desk is asked for one rather than silently checking them into nothing.
    if (status === "in_house" && !current.room_id && !room_id) {
      return NextResponse.json(
        { error: "Assign a room before checking this guest in." },
        { status: 409 }
      );
    }

    // A guest is not checked into a room housekeeping has not turned round.
    // Only a fresh check-in is held to this: undoing a check-out puts the
    // guest back into the room their own check-out just marked dirty.
    if (status === "in_house" && current.status === "confirmed") {
      const room = await getRoom(propertyId, room_id || current.room_id);
      if (room?.housekeeping === "dirty") {
        return NextResponse.json(
          { error: `Room ${room.room_number} is dirty. Mark it clean before checking this guest in.` },
          { status: 409 }
        );
      }
    }

    // A room named here is being assigned at the desk, and must be free for
    // the whole stay -- the same refusal a booking or a drag gets, so a guest
    // cannot be checked into a room someone else is in, or one out of order.
    if (room_id && room_id !== current.room_id) {
      const clash = await findRoomClash(room_id, current.check_in, current.check_out, {
        ignoreReservationId: id,
      });
      if (clash) {
        return NextResponse.json({ error: clash.message }, { status: 409 });
      }
    }

    const reservation = await setReservationStatus(id, status, {
      roomId: room_id !== undefined ? room_id : undefined,
    });

    // Cancelling or marking a no-show gives the nights back; reinstating one
    // takes them again. A check-in or check-out changes nothing on sale.
    let inventory = null;
    if (HOLDS_ROOM.has(current.status) !== HOLDS_ROOM.has(status)) {
      inventory = await syncInventory(propertyId, [staySpan(reservation)], { session });
    }

    return NextResponse.json({ reservation, inventory });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
