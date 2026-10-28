import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { canManageSetup, listRoomTypes, listRatePlans, updateProperty } from "@/lib/database";
import { resolvePropertyId } from "@/lib/propertyScope";
import { roomCap, roomGap } from "@/lib/roomCap";

/**
 * The first step of the booking tour: what the hotel told us at sign-up,
 * laid out so they can check it, and whether every room they said they have
 * is set up.
 *
 * POST lowers the hotel's total to the rooms its room types add up to, for
 * a hotel that gave the wrong total. Only ever down: raising it still goes
 * through Online Hotelier support (lib/roomCap.js).
 */

async function scope(req, requested) {
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
  const propertyId = await resolvePropertyId(session, requested);
  if (!propertyId) {
    return { error: NextResponse.json({ error: "No property selected" }, { status: 400 }) };
  }
  return { propertyId };
}

async function check(propertyId) {
  const [roomTypes, plans, cap] = await Promise.all([
    listRoomTypes(propertyId),
    listRatePlans(propertyId),
    roomCap(propertyId),
  ]);
  return {
    ...roomGap(roomTypes, cap),
    roomTypes: roomTypes.map((rt) => ({
      id: rt.id,
      name: rt.room_type_name,
      rooms: Number(rt.number_of_rooms) || 0,
      price: Number(rt.base_price) || 0,
    })),
    plans: plans.map((p) => p.plan_name).filter(Boolean),
  };
}

export async function GET(req) {
  const { error, propertyId } = await scope(req, req.nextUrl.searchParams.get("propertyId"));
  if (error) return error;
  try {
    return NextResponse.json(await check(propertyId));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { error, propertyId } = await scope(req, body?.propertyId);
  if (error) return error;
  try {
    const now = await check(propertyId);
    if (!(now.missing > 0) || now.setUp < 1) {
      return NextResponse.json({ error: "There is nothing to lower: every room is set up." }, { status: 400 });
    }
    await updateProperty(propertyId, { total_rooms: now.setUp });
    return NextResponse.json(await check(propertyId));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
