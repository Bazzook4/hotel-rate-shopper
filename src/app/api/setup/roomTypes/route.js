import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import {
  canManageSetup,
  listRoomTypes,
  getRoomType,
  createRoomType,
  updateRoomType,
  deleteRoomType,
  getUserPropertyId,
  syncRoomBasePrices,
} from "@/lib/database";
import { syncInventoryForward } from "@/lib/inventorySync";
import { capProblem, roomCap } from "@/lib/roomCap";

/** Rooms declared across a property's room types, leaving one out. */
async function declaredRooms(propertyId, exceptId = null) {
  const types = await listRoomTypes(propertyId);
  return types
    .filter((rt) => rt.id !== exceptId)
    .reduce((sum, rt) => sum + (Number(rt.number_of_rooms) || 0), 0);
}

async function guard(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!(await canManageSetup(session.userId))) {
    return {
      error: NextResponse.json(
        { error: "You do not have permission to manage property setup." },
        { status: 403 }
      ),
    };
  }
  return { session };
}

async function resolvePropertyId(session, requested) {
  const own =
    session.property_id ||
    (await getUserPropertyId(session.userId).catch(() => null));

  // Only a super admin may act on a property other than their own; anyone
  // else passing an id is ignored rather than trusted.
  if (isSuperAdmin(session)) return requested || own;
  if (requested && requested !== own) return null;
  return own;
}

export async function GET(req) {
  const { error, session } = await guard(req);
  if (error) return error;

  const propertyId = await resolvePropertyId(
    session,
    req.nextUrl.searchParams.get("propertyId")
  );
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }

  try {
    const [roomTypes, cap] = await Promise.all([listRoomTypes(propertyId), roomCap(propertyId)]);
    return NextResponse.json({ roomTypes, roomCap: cap });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  const { error, session } = await guard(req);
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
  if (!body.room_type_name?.trim()) {
    return NextResponse.json({ error: "Room type name is required" }, { status: 400 });
  }
  if (!Number.isFinite(Number(body.number_of_rooms)) || Number(body.number_of_rooms) < 0) {
    return NextResponse.json(
      { error: "Number of rooms must be zero or more" },
      { status: 400 }
    );
  }

  try {
    const before = await declaredRooms(propertyId);
    const tooMany = capProblem(
      await roomCap(propertyId),
      before,
      before + Number(body.number_of_rooms)
    );
    if (tooMany) return NextResponse.json({ error: tooMany }, { status: 400 });

    const roomType = await createRoomType({ ...body, base_price: 0, property_id: propertyId });
    return NextResponse.json({ roomType });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req) {
  const { error, session } = await guard(req);
  if (error) return error;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Rooms are priced in Rate Plans, so a typed base price is not taken.
  const { id, base_price: _ignored, ...updates } = body || {};
  if (!id) {
    return NextResponse.json({ error: "Room type id is required" }, { status: 400 });
  }

  try {
    // The id alone names the room type, so check it is one of this user's.
    const current = await getRoomType(id);
    if (!current || !(await resolvePropertyId(session, current.property_id))) {
      return NextResponse.json({ error: "Room type not found" }, { status: 404 });
    }
    if ("number_of_rooms" in updates) {
      const others = await declaredRooms(current.property_id, id);
      const tooMany = capProblem(
        await roomCap(current.property_id),
        others + (Number(current.number_of_rooms) || 0),
        others + (Number(updates.number_of_rooms) || 0)
      );
      if (tooMany) return NextResponse.json({ error: tooMany }, { status: 400 });
    }

    const roomType = await updateRoomType(id, updates);
    // Base adults decide which adult count the base price is read at.
    if ("base_adults" in updates) {
      await syncRoomBasePrices(current.property_id).catch((err) =>
        console.error("Room base price sync failed:", err.message)
      );
    }

    // The count is the capacity of a room type with no numbered rooms, so
    // editing it changes what every future night can sell.
    const inventory =
      "number_of_rooms" in updates && roomType?.property_id
        ? await syncInventoryForward(roomType.property_id, [roomType.id], { session })
        : null;

    return NextResponse.json({ roomType, inventory });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  const { error } = await guard(req);
  if (error) return error;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Room type id is required" }, { status: 400 });
  }

  try {
    await deleteRoomType(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
