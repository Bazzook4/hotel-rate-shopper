import { NextResponse } from "next/server";
import { pmsGuard } from "@/lib/pmsGuard";
import { getReservation, setReservationStatus } from "@/lib/database";
import { todayUTC } from "@/lib/date";

/**
 * Moving a reservation through its lifecycle.
 *
 * Separate from the reservation route because a status change is not an edit
 * of the booking: it records something that happened at the desk, and the
 * transitions it allows are narrower than "set any field".
 */

const STATUSES = ["confirmed", "in_house", "checked_out", "cancelled", "no_show"];

/**
 * Which moves make sense from where.
 *
 * A guest cannot check out before checking in, and a stay that already ended
 * is not something to cancel. Refusing these in one place keeps the front
 * desk from recording a sequence of events that never happened.
 */
const ALLOWED = {
  confirmed: ["in_house", "cancelled", "no_show"],
  in_house: ["checked_out", "confirmed"],
  checked_out: ["in_house"],
  cancelled: ["confirmed"],
  no_show: ["confirmed"],
};

export async function POST(req) {
  const { error } = await pmsGuard(req);
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
    const current = await getReservation(id);
    if (!current) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }

    if (current.status === status) {
      return NextResponse.json({ reservation: current });
    }

    if (!ALLOWED[current.status]?.includes(status)) {
      return NextResponse.json(
        {
          error: `A ${current.status.replace("_", " ")} booking cannot move to ${status.replace("_", " ")}.`,
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

    const reservation = await setReservationStatus(id, status, {
      roomId: room_id !== undefined ? room_id : undefined,
    });

    return NextResponse.json({ reservation });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
