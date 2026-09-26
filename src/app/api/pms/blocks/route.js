import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import {
  createRoomBlock,
  updateRoomBlock,
  deleteRoomBlock,
  getRoomBlock,
  findRoomClash,
  getSupabaseAdmin,
} from "@/lib/database";
import { syncInventory, blockSpan } from "@/lib/inventorySync";

/**
 * Taking a room out of order for some nights, and putting it back.
 *
 * A block is front-desk work like a booking -- the desk is usually the first
 * to hear that 204's AC has died -- so it needs only a session, not Setup
 * rights. Every change pushes the room type's new free count to the channel
 * manager, since a room out of order is a room the OTAs must stop selling.
 */

function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validate(body) {
  if (!body.room_id) return "Choose a room.";
  if (!isDate(body.start_date)) return "Give the first night out of order.";
  if (!isDate(body.end_date)) return "Give the date the room is back in service.";
  if (body.end_date <= body.start_date) {
    return "The room must be out of order for at least one night.";
  }
  return null;
}

/** The room, checked to belong to the property the caller is working in. */
async function roomOfProperty(roomId, propertyId) {
  const { data } = await getSupabaseAdmin()
    .from("rooms")
    .select("id, property_id")
    .eq("id", roomId)
    .maybeSingle();
  return data && data.property_id === propertyId ? data : null;
}

async function readBody(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function POST(req) {
  const { error, session } = await pmsGuard(req);
  if (error) return error;

  const body = await readBody(req);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const propertyId = await resolvePropertyId(session, body.property_id);
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }

  const invalid = validate(body);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  try {
    if (!(await roomOfProperty(body.room_id, propertyId))) {
      return NextResponse.json({ error: "That room could not be found." }, { status: 404 });
    }

    // A guest already in the room has to be moved first; blocking over them
    // would leave a booking in a room the chart says nobody can use.
    const clash = await findRoomClash(body.room_id, body.start_date, body.end_date);
    if (clash) return NextResponse.json({ error: clash.message }, { status: 409 });

    const block = await createRoomBlock({
      ...body,
      property_id: propertyId,
      created_by: session.userId,
    });

    const inventory = await syncInventory(propertyId, [blockSpan(block)], { session });
    return NextResponse.json({ block, inventory });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req) {
  const { error, session } = await pmsGuard(req);
  if (error) return error;

  const body = await readBody(req);
  if (!body?.id) return NextResponse.json({ error: "Block id is required" }, { status: 400 });

  const propertyId = await resolvePropertyId(session, body.property_id);
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }

  try {
    const before = await getRoomBlock(body.id).catch(() => null);
    if (!before || before.property_id !== propertyId) {
      return NextResponse.json({ error: "Block not found" }, { status: 404 });
    }

    const next = {
      room_id: body.room_id || before.room_id,
      start_date: body.start_date || before.start_date,
      end_date: body.end_date || before.end_date,
      reason: "reason" in body ? body.reason : before.reason,
    };
    const invalid = validate(next);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    if (next.room_id !== before.room_id && !(await roomOfProperty(next.room_id, propertyId))) {
      return NextResponse.json({ error: "That room could not be found." }, { status: 404 });
    }

    const clash = await findRoomClash(next.room_id, next.start_date, next.end_date, {
      ignoreBlockId: before.id,
    });
    if (clash) return NextResponse.json({ error: clash.message }, { status: 409 });

    const block = await updateRoomBlock(before.id, next);

    // The nights given back as well as the nights now taken.
    const inventory = await syncInventory(propertyId, [blockSpan(before), blockSpan(block)], {
      session,
    });
    return NextResponse.json({ block, inventory });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  const { error, session } = await pmsGuard(req);
  if (error) return error;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Block id is required" }, { status: 400 });

  try {
    const before = await getRoomBlock(id).catch(() => null);
    const propertyId = before
      ? await resolvePropertyId(
          session,
          req.nextUrl.searchParams.get("propertyId") || before.property_id
        )
      : null;
    if (!before || !propertyId || before.property_id !== propertyId) {
      return NextResponse.json({ error: "Block not found" }, { status: 404 });
    }

    await deleteRoomBlock(id);

    // Back in service means back on sale.
    const inventory = await syncInventory(propertyId, [blockSpan(before)], { session });
    return NextResponse.json({ success: true, inventory });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
