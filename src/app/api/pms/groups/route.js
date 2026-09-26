import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import {
  listRooms,
  findRoomClash,
  getAvailabilityGrid,
  quoteReservation,
  createReservationGroup,
  getReservationGroup,
  deleteReservationGroup,
  createReservation,
  acceptNightRates,
} from "@/lib/database";
import { syncInventory, staySpan } from "@/lib/inventorySync";

/**
 * Group bookings: several rooms taken together under one name.
 *
 * Each room becomes its own reservation, priced by the same quote a single
 * booking gets, so a group room is indistinguishable at the desk from any
 * other -- it checks in, pays and is invoiced on its own. The group record is
 * what ties them back to the party and whoever booked it.
 *
 * All or nothing: every room is checked before any is booked, and a failure
 * part-way removes what was made, so the desk never has to find and tidy up
 * half a wedding.
 */

function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validate(body) {
  if (!body.name?.trim()) return "Give the group a name.";
  if (!isDate(body.check_in)) return "Check-in date is required.";
  if (!isDate(body.check_out)) return "Check-out date is required.";
  if (body.check_out <= body.check_in) {
    return "Check-out must be at least one night after check-in.";
  }
  if (!Array.isArray(body.room_ids) || body.room_ids.length === 0) {
    return "Choose at least one room for the group.";
  }
  if (body.adults != null && Number(body.adults) < 1) {
    return "Each room needs at least one adult.";
  }
  return null;
}

export async function GET(req) {
  const { error, session } = await pmsGuard(req);
  if (error) return error;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Group id is required" }, { status: 400 });

  try {
    const group = await getReservationGroup(id);
    const propertyId = await resolvePropertyId(session, group.property_id);
    if (propertyId !== group.property_id) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }
    return NextResponse.json({ group });
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

  const { check_in, check_out } = body;
  const roomIds = [...new Set(body.room_ids)];

  try {
    const rooms = await listRooms(propertyId);
    const byId = Object.fromEntries(rooms.map((r) => [r.id, r]));

    const chosen = roomIds.map((id) => byId[id]);
    if (chosen.some((r) => !r)) {
      return NextResponse.json({ error: "One of those rooms could not be found." }, { status: 404 });
    }
    const inactive = chosen.find((r) => !r.is_active);
    if (inactive) {
      return NextResponse.json(
        { error: `Room ${inactive.room_number} is out of order.` },
        { status: 409 }
      );
    }

    // Every room free, checked before anything is booked. All the clashes
    // are named at once, so the desk swaps them out in one pass.
    const clashes = [];
    for (const room of chosen) {
      const clash = await findRoomClash(room.id, check_in, check_out);
      if (clash) clashes.push(`Room ${room.room_number}: ${clash.message}`);
    }
    if (clashes.length > 0) {
      return NextResponse.json({ error: clashes.join(" ") }, { status: 409 });
    }

    // Free rooms can still be spoken for by bookings not yet given a room, so
    // each type must have as many free as the group takes, every night.
    // Overridable, as a single booking's full date is.
    if (!body.allow_overbook) {
      const perType = {};
      for (const room of chosen) perType[room.room_type_id] = (perType[room.room_type_id] || 0) + 1;

      const lastNight = new Date(`${check_out}T00:00:00Z`);
      lastNight.setUTCDate(lastNight.getUTCDate() - 1);
      const grid = await getAvailabilityGrid(propertyId, check_in, lastNight.toISOString().slice(0, 10), {
        roomTypeIds: Object.keys(perType),
      });
      for (const rt of grid.roomTypes) {
        const short = rt.days.find((d) => d.free < perType[rt.id]);
        if (short) {
          return NextResponse.json(
            {
              error: `${rt.name} has only ${short.free} free on ${short.date}, and the group needs ${perType[rt.id]}.`,
              availability: { date: short.date },
            },
            { status: 409 }
          );
        }
      }
    }

    const group = await createReservationGroup({
      ...body,
      property_id: propertyId,
      created_by: session.userId,
    });

    const reservations = [];
    try {
      for (const room of chosen) {
        const quote = await quoteReservation({
          property_id: propertyId,
          room_type_id: room.room_type_id,
          rate_plan_id: body.rate_plan_id || null,
          check_in,
          check_out,
          adults: Number(body.adults) || 2,
          children: Number(body.children) || 0,
        });

        const reservation = await createReservation(
          {
            property_id: propertyId,
            group_id: group.id,
            guest_name: body.name.trim(),
            guest_phone: body.contact_phone?.trim() || null,
            guest_email: body.contact_email?.trim() || null,
            room_type_id: room.room_type_id,
            room_id: room.id,
            rate_plan_id: body.rate_plan_id || null,
            check_in,
            check_out,
            adults: Number(body.adults) || 2,
            children: Number(body.children) || 0,
            source: body.source?.trim() || "group",
            total_amount: quote.total,
            status: "confirmed",
            created_by: session.userId,
          },
          { rates: acceptNightRates(quote.nights, check_in, check_out, quote.total) }
        );
        reservations.push(reservation);
      }
    } catch (err) {
      await deleteReservationGroup(group.id).catch(() => {});
      throw err;
    }

    const inventory = await syncInventory(propertyId, reservations.map(staySpan), { session });

    return NextResponse.json({ group, reservations, inventory });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
