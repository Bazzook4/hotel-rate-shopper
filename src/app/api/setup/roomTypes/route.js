import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import {
  canManageSetup,
  listRoomTypes,
  createRoomType,
  updateRoomType,
  deleteRoomType,
  getUserPropertyId,
} from "@/lib/database";

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
  if (requested) return requested;
  if (session.property_id) return session.property_id;
  return getUserPropertyId(session.userId).catch(() => null);
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
    return NextResponse.json({ roomTypes: await listRoomTypes(propertyId) });
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
    const roomType = await createRoomType({ ...body, property_id: propertyId });
    return NextResponse.json({ roomType });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req) {
  const { error } = await guard(req);
  if (error) return error;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id, ...updates } = body || {};
  if (!id) {
    return NextResponse.json({ error: "Room type id is required" }, { status: 400 });
  }

  try {
    return NextResponse.json({ roomType: await updateRoomType(id, updates) });
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
