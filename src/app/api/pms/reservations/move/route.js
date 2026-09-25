import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import { getReservation, updateReservation, getSupabaseAdmin } from "@/lib/database";

/**
 * Moving or resizing a stay by dragging it on the tape chart.
 *
 * Separate from the reservation edit because a drag asks a narrower question:
 * these dates, in that room. It checks the target room specifically rather
 * than the room type -- dropping a bar on room 204 must fail if 204 is taken,
 * even when three other rooms of the same type are free, which is not what
 * the type-level availability check answers.
 */

function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Whether a room is free for a span, ignoring the stay being moved.
 *
 * Two stays clash when one starts before the other ends and ends after the
 * other starts. The checkout day is deliberately not a clash: one guest
 * leaving on the 4th and the next arriving on the 4th share no night.
 */
async function roomIsFree(roomId, checkIn, checkOut, ignoreReservationId) {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("reservations")
    .select("id, reference, guest_name, check_in, check_out, status")
    .eq("room_id", roomId)
    .not("status", "in", "(cancelled,no_show)")
    .lt("check_in", checkOut)
    .gt("check_out", checkIn);

  if (error) throw new Error(`Failed to check the room: ${error.message}`);

  const clash = (data || []).find((r) => r.id !== ignoreReservationId);
  return clash || null;
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

    // A stay that has already ended should not slide around the chart on a
    // stray drag; correcting one is an edit, made deliberately in the modal.
    if (current.status === "checked_out") {
      return NextResponse.json(
        { error: "This guest has checked out — edit the booking instead." },
        { status: 409 }
      );
    }

    const targetRoom = room_id || current.room_id;

    if (targetRoom) {
      const clash = await roomIsFree(targetRoom, check_in, check_out, id);
      if (clash) {
        return NextResponse.json(
          {
            error: `That room is taken by ${clash.guest_name} (${clash.reference}) from ${clash.check_in} to ${clash.check_out}.`,
          },
          { status: 409 }
        );
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

    const reservation = await updateReservation(id, updates);
    return NextResponse.json({ reservation });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
