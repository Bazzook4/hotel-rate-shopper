import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import {
  canManageSetup,
  listRooms,
  createRoom,
  createRoomRange,
  updateRoom,
  deleteRoom,
  reorderRooms,
} from "@/lib/database";
import { syncInventoryForward } from "@/lib/inventorySync";

/**
 * The physical rooms a property owns.
 *
 * Reading is front-desk work -- you cannot assign a room without seeing the
 * list -- but creating and deleting rooms changes the property's setup, so
 * writes require the setup permission while the GET does not.
 */

async function requireSetup(req) {
  const { error, session } = await pmsGuard(req);
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
  const { error, session } = await pmsGuard(req);
  if (error) return error;

  const propertyId = await resolvePropertyId(
    session,
    req.nextUrl.searchParams.get("propertyId")
  );
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }

  try {
    return NextResponse.json({ rooms: await listRooms(propertyId) });
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
          { error: "That range is over 500 rooms — split it into smaller ranges." },
          { status: 400 }
        );
      }

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
    const before = (await listRooms(propertyId)).find((r) => r.id === id);
    await deleteRoom(propertyId, id);
    const inventory = await pushCapacity(propertyId, [before?.room_type_id], session);
    return NextResponse.json({ success: true, inventory });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
