import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId, WRITE_PAGES } from "@/lib/pmsGuard";
import {
  checkAvailability,
  findRoomClash,
  findDayUseInRoom,
  getReservation,
  getPropertyClock,
  getRoom,
  setRoomHousekeeping,
  setReservationStatus,
  listReservationPayments,
  listReservationInvoices,
  voidReservationPayment,
  planStayChange,
  applyStayChange,
  leftOnArrivalDay,
} from "@/lib/database";
import { syncInventory, staySpan } from "@/lib/inventorySync";
import { localToday } from "@/lib/financeReports";
import { holdsInventory } from "@/lib/dayUse";

/**
 * Moving a reservation through its lifecycle.
 *
 * Separate from the reservation route because a status change is not an edit
 * of the booking: it records something that happened at the desk, and the
 * transitions it allows are narrower than "set any field".
 */

const STATUSES = ["inquiry", "confirmed", "in_house", "checked_out", "cancelled", "no_show"];

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

/** "3 Nov 2026", for a message the desk reads. */
function readableDate(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** A status in the desk's words; `in_house` is shown as "checked in". */
function statusLabel(status) {
  return status === "in_house" ? "checked in" : status.replace("_", " ");
}

export async function POST(req) {
  const { error, session } = await pmsGuard(req, WRITE_PAGES.status);
  if (error) return error;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id, status, room_id, mark_clean } = body || {};
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

    // A room named by the browser must be this hotel's.
    if (room_id && !(await getRoom(propertyId, room_id))) {
      return NextResponse.json({ error: "That room could not be found." }, { status: 404 });
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
    // "Today" is the hotel's own, so a walk-in after midnight in India is not
    // refused for arriving on what is still yesterday in UTC.
    if (status === "in_house" && current.check_in > localToday(await getPropertyClock(propertyId))) {
      return NextResponse.json(
        {
          error: `This guest arrives on ${readableDate(current.check_in)}. To check in early, move the dates first.`,
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

    // A guest is not checked into a room housekeeping has not turned round,
    // unless the desk says it is ready: the check-in then marks it clean under
    // the desk's name, so Housekeeping sees who did. Only a fresh check-in is
    // held to this: undoing a check-out puts the guest back into the room
    // their own check-out just marked dirty.
    let cleanRoom = null;
    if (status === "in_house" && current.status === "confirmed") {
      const room = await getRoom(propertyId, room_id || current.room_id);
      if (room?.housekeeping === "dirty") {
        if (!mark_clean) {
          return NextResponse.json(
            { error: `Room ${room.room_number} is marked dirty. Mark it clean, or check in and mark it clean.` },
            { status: 409 }
          );
        }
        cleanRoom = room;
      }
    }

    // A day use's hours start now, so the room has to be empty now: not
    // still held by another day-use guest whose hours are running. Two day
    // uses can share a room on one date, one after the other -- not at once.
    if (status === "in_house" && current.stay_kind === "day_use") {
      const busy = await findDayUseInRoom(room_id || current.room_id, current.check_in, id);
      if (busy) {
        return NextResponse.json(
          {
            error: `${busy.guest_name} (${busy.reference}) is still checked in to that room on day use. Check them out first, or pick another room.`,
          },
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

    // Bringing back a cancelled or no-show booking takes its nights again,
    // and in the meantime they may have been sold. It is checked like a new
    // booking: the room type must have a room free every night, and a room
    // someone else now holds is let go so the desk can pick another.
    let releaseRoom = false;
    if (
      (current.status === "cancelled" || current.status === "no_show") &&
      holdsInventory(current, status)
    ) {
      if (current.room_type_id) {
        const check = await checkAvailability(
          propertyId,
          current.room_type_id,
          current.check_in,
          current.check_out,
          { ignoreReservationId: id }
        );
        if (!check.available) {
          return NextResponse.json(
            { error: `Cannot bring this booking back: ${check.reason}` },
            { status: 409 }
          );
        }
      }
      if (current.room_id && room_id === undefined) {
        const clash = await findRoomClash(current.room_id, current.check_in, current.check_out, {
          ignoreReservationId: id,
        });
        if (clash) releaseRoom = true;
      }
    }

    // Undoing a same-day check-out takes the nights back, and in the meantime
    // the room may have been sold again.
    if (
      current.status === "checked_out" &&
      status === "in_house" &&
      current.stay_kind !== "day_use" &&
      leftOnArrivalDay(current, await getPropertyClock(propertyId))
    ) {
      if (current.room_type_id) {
        const check = await checkAvailability(propertyId, current.room_type_id, current.check_in, current.check_out, {
          ignoreReservationId: id,
        });
        if (!check.available) {
          return NextResponse.json({ error: `Cannot undo the check-out: ${check.reason}` }, { status: 409 });
        }
      }
      const clash = current.room_id
        ? await findRoomClash(current.room_id, current.check_in, current.check_out, { ignoreReservationId: id })
        : null;
      if (clash) {
        return NextResponse.json({ error: `Cannot undo the check-out: ${clash.message}` }, { status: 409 });
      }
    }

    // A guest leaving before the booked last night hands the rest back: the
    // stay is cut to today so those nights go back on sale and the room can be
    // booked again. The bill keeps the full amount (the dropped nights become
    // a retention charge) unless the desk chose to bill the nights stayed.
    let shortened = false;
    let leftToday = false;
    if (status === "checked_out" && current.stay_kind !== "day_use") {
      const today = localToday(await getPropertyClock(propertyId));
      // Leaving on the day of arrival hands the whole stay back; nothing is
      // cut, the stay simply stops holding its nights (see leftOnArrivalDay).
      leftToday = today <= current.check_in;
      if (today > current.check_in && today < current.check_out) {
        const pricing = body.early_pricing === "adjust" ? "adjust" : "keep";
        const plan = await planStayChange(current, {
          check_in: current.check_in,
          check_out: today,
        });
        await applyStayChange(id, { check_out: today }, plan, pricing);
        shortened = true;
      }
    }

    // Deleting a booking made by mistake is a cancel that also voids its
    // payments, so the money stops counting on the cash-up. Voided, never
    // removed, as everywhere. A standing invoice is a tax document the desk
    // has to void itself, so the delete waits for that.
    let livePayments = [];
    if (status === "cancelled" && body.void_payments) {
      const [payments, invoices] = await Promise.all([
        listReservationPayments(id),
        listReservationInvoices(id),
      ]);
      if (invoices.some((i) => !i.voided_at)) {
        return NextResponse.json(
          { error: "This booking has an invoice. Void the invoice on the Invoices tab first, then delete." },
          { status: 409 }
        );
      }
      livePayments = payments.filter((p) => !p.voided_at);
    }

    const reservation = await setReservationStatus(id, status, {
      roomId: releaseRoom ? null : room_id !== undefined ? room_id : undefined,
    });
    // After the check-in is saved, so a failed one leaves the room as it was.
    if (cleanRoom) await setRoomHousekeeping(propertyId, [cleanRoom.id], "clean", session.userId);
    for (const p of livePayments) {
      await voidReservationPayment(p.id, "Booking deleted", session.userId);
    }

    // Cancelling or marking a no-show gives the nights back; reinstating one
    // takes them again. A check-in or check-out changes nothing on sale --
    // except a day use's check-out, which hands its room back for the night.
    let inventory = null;
    if (shortened || leftToday) {
      inventory = await syncInventory(propertyId, [staySpan(current)], { session });
    } else if (
      current.status === "checked_out" &&
      status === "in_house" &&
      current.stay_kind !== "day_use" &&
      leftOnArrivalDay(current, await getPropertyClock(propertyId))
    ) {
      // Undoing a same-day check-out takes the nights back.
      inventory = await syncInventory(propertyId, [staySpan(reservation)], { session });
    } else if (holdsInventory(current, current.status) !== holdsInventory(current, status)) {
      inventory = await syncInventory(propertyId, [staySpan(reservation)], { session });
    }

    const notice = releaseRoom
      ? "Booking is back, but its room was taken in the meantime. Pick a room for it."
      : null;
    return NextResponse.json({ reservation, inventory, notice });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
