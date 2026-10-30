import { NextResponse } from "next/server";
import { SETUP_READ_PAGES, pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import {
  canManageSetup,
  listRooms,
  listRoomTypes,
  listTakenRoomIds,
  createRoom,
  createRoomRange,
  updateRoom,
  deleteRoom,
  reorderRooms,
} from "@/lib/database";
import { syncInventoryForward } from "@/lib/inventorySync";
import { AUTO_NUMBER_MAX_ROOMS, planAutoNumbering } from "@/lib/roomNumbering";
import { capProblem, newRoomsInRange, roomCap } from "@/lib/roomCap";

/**
 * The physical rooms a property owns.
 *
 * Reading is front-desk work -- you cannot assign a room without seeing the
 * list -- but creating and deleting rooms changes the property's setup, so
 * writes require the setup permission while the GET does not.
 */

async function requireSetup(req) {
  // The page's own right, as well as the setup permission: a super admin
  // unticking rooms closes its changes here too, not only the menu.
  const { error, session } = await pmsGuard(req, ["rooms"]);
  if (error) return { error };

  if (!(await canManageSetup(session.userId))) {
    return {
      error: NextResponse.json(
        { error: "You do not have permission to manage rooms." },
        { status: 403 }
      ),
    };
  }
  return { session };
}

/**
 * Push the new availability of room types whose room count just changed.
 *
 * Once a room type has numbered rooms, those rooms are its capacity, so
 * adding one, taking one out of order or deleting one changes what every
 * future night can sell.
 */
function pushCapacity(propertyId, roomTypeIds, session) {
  const ids = [...new Set(roomTypeIds.filter(Boolean))];
  if (ids.length === 0) return null;
  return syncInventoryForward(propertyId, ids, { session });
}

export async function GET(req) {
  const { error, session } = await pmsGuard(req, SETUP_READ_PAGES);
  if (error) return error;

  const propertyId = await resolvePropertyId(
    session,
    req.nextUrl.searchParams.get("propertyId")
  );
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }

  try {
    const rooms = await listRooms(propertyId);

    // Given a stay's dates, each room also says whether it is free for them,
    // so the desk picking a room is only offered the ones it can have.
    const params = req.nextUrl.searchParams;
    const checkIn = params.get("checkIn");
    const checkOut = params.get("checkOut");
    if (checkIn && checkOut) {
      const taken = new Set(
        await listTakenRoomIds(propertyId, checkIn, checkOut, {
          ignoreReservationId: params.get("ignoreReservationId"),
        })
      );
      return NextResponse.json({
        // A room housekeeping marked out of order is not offered either.
        rooms: rooms.map((room) => ({
          ...room,
          taken: taken.has(room.id) || room.housekeeping === "out_of_order",
        })),
      });
    }

    return NextResponse.json({ rooms });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  const { error, session } = await requireSetup(req);
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
  // Every room type at once, numbered by the scheme in roomNumbering.js. The
  // plan is worked out again here, not taken from the client, so the size
  // limit cannot be stepped around.
  if (body.auto) {
    try {
      const [roomTypes, current] = await Promise.all([
        listRoomTypes(propertyId),
        listRooms(propertyId),
      ]);
      const { total, allowed, plan, skipped } = planAutoNumbering(roomTypes, current);
      if (!allowed) {
        return NextResponse.json(
          {
            error: `Auto-numbering is only for properties under ${AUTO_NUMBER_MAX_ROOMS} rooms; this one has ${total}. Add a range per room type instead.`,
          },
          { status: 400 }
        );
      }
      const adding = plan.reduce((sum, s) => sum + (s.to - s.from + 1), 0);
      const tooMany = capProblem(await roomCap(propertyId), current.length, current.length + adding);
      if (tooMany) return NextResponse.json({ error: tooMany }, { status: 400 });

      let created = 0;
      for (const step of plan) {
        const rooms = await createRoomRange({ property_id: propertyId, ...step });
        created += rooms.length;
      }
      const inventory = await pushCapacity(
        propertyId,
        plan.map((s) => s.room_type_id),
        session
      );
      return NextResponse.json({ created, skipped, inventory });
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  if (!body.room_type_id) {
    return NextResponse.json({ error: "Choose a room type" }, { status: 400 });
  }

  try {
    // A range numbers many doors at once, which is the only sane way to set
    // up a property with a few hundred rooms.
    if (body.range) {
      const { from, to, prefix, floor } = body.range;
      if (!Number.isFinite(Number(from)) || !Number.isFinite(Number(to))) {
        return NextResponse.json(
          { error: "Give a first and last room number." },
          { status: 400 }
        );
      }
      if (Number(to) < Number(from)) {
        return NextResponse.json(
          { error: "The last room number must not be below the first." },
          { status: 400 }
        );
      }
      if (Number(to) - Number(from) > 500) {
        return NextResponse.json(
          { error: "That range is over 500 rooms. Split it into smaller ranges." },
          { status: 400 }
        );
      }
      const current = await listRooms(propertyId);
      const adding = newRoomsInRange(current, { from, to, prefix: prefix || "" });
      const tooMany = capProblem(await roomCap(propertyId), current.length, current.length + adding);
      if (tooMany) return NextResponse.json({ error: tooMany }, { status: 400 });

      const rooms = await createRoomRange({
        property_id: propertyId,
        room_type_id: body.room_type_id,
        from,
        to,
        prefix: prefix || "",
        floor: floor || null,
      });
      const inventory = await pushCapacity(propertyId, [body.room_type_id], session);
      return NextResponse.json({ rooms, created: rooms.length, inventory });
    }

    if (!body.room_number?.trim()) {
      return NextResponse.json({ error: "Room number is required" }, { status: 400 });
    }
    const count = (await listRooms(propertyId)).length;
    const tooMany = capProblem(await roomCap(propertyId), count, count + 1);
    if (tooMany) return NextResponse.json({ error: tooMany }, { status: 400 });

    const room = await createRoom({
      property_id: propertyId,
      room_type_id: body.room_type_id,
      room_number: body.room_number.trim(),
      floor: body.floor?.trim() || null,
      notes: body.notes?.trim() || null,
    });
    const inventory = await pushCapacity(propertyId, [body.room_type_id], session);
    return NextResponse.json({ room, inventory });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * Edit one room's setup, or save the whole order.
 *
 * `{ order: [ids] }` rewrites every room's position; anything else is an edit
 * to the room named by `id`. Housekeeping status is not settable here -- it is
 * front-office work and goes through /api/pms/housekeeping.
 */
export async function PATCH(req) {
  const { error, session } = await requireSetup(req);
  if (error) return error;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const propertyId = await resolvePropertyId(session, body?.property_id);
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }

  try {
    if (Array.isArray(body.order)) {
      return NextResponse.json({ rooms: await reorderRooms(propertyId, body.order) });
    }

    const { id, ...updates } = body;
    if (!id) {
      return NextResponse.json({ error: "Room id is required" }, { status: 400 });
    }
    if (updates.room_number !== undefined) {
      updates.room_number = String(updates.room_number).trim();
      if (!updates.room_number) {
        return NextResponse.json({ error: "Room number is required" }, { status: 400 });
      }
    }
    if (updates.floor !== undefined) {
      updates.floor = String(updates.floor ?? "").trim() || null;
    }
    // Only a change of type or of in-order status alters what can be sold.
    const capacityChanges = "room_type_id" in updates || "is_active" in updates;
    const before = capacityChanges
      ? (await listRooms(propertyId)).find((r) => r.id === id)
      : null;

    const room = await updateRoom(propertyId, id, updates);

    const inventory = capacityChanges
      ? await pushCapacity(propertyId, [before?.room_type_id, room?.room_type_id], session)
      : null;
    return NextResponse.json({ room, inventory });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  const { error, session } = await requireSetup(req);
  if (error) return error;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Room id is required" }, { status: 400 });
  }
  const propertyId = await resolvePropertyId(
    session,
    req.nextUrl.searchParams.get("propertyId")
  );
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }

  try {
    const all = await listRooms(propertyId);
    const before = all.find((r) => r.id === id);
    // With its last numbered room gone, a room type would fall back to the
    // count it was set up with and go back on sale. Switching the room off
    // keeps it closed; deleting the room type removes it for good.
    if (before && !all.some((r) => r.id !== id && r.room_type_id === before.room_type_id)) {
      return NextResponse.json(
        {
          error: `Room ${before.room_number} is the last ${before.room_types?.room_type_name || "room"} room. Untick Active to close it, or delete the room type.`,
        },
        { status: 409 }
      );
    }
    await deleteRoom(propertyId, id);
    const inventory = await pushCapacity(propertyId, [before?.room_type_id], session);
    return NextResponse.json({ success: true, inventory });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
