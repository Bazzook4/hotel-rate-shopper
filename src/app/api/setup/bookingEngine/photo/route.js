import { NextResponse } from "next/server";
import { listRoomTypes } from "@/lib/database";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import { BOOKING_NOT_READY, addRoomPhoto, changeRoomPhoto } from "@/lib/bookingEngine";
import { BOOKING_ENGINE_PAGES } from "@/lib/bookingEngineShared";

/**
 * A room type's photos on the booking page. POST uploads one (form data:
 * file, roomTypeId), PATCH makes one the cover, DELETE takes one off.
 * Each answers with the page's content as saved.
 */

async function forRoom(req, requested, roomTypeId) {
  const { error, session } = await pmsGuard(req, BOOKING_ENGINE_PAGES);
  if (error) return { response: error };
  const propertyId = await resolvePropertyId(session, requested);
  if (!propertyId) return { response: NextResponse.json({ error: "No property selected" }, { status: 400 }) };
  const types = await listRoomTypes(propertyId);
  if (!types.some((t) => t.id === roomTypeId)) {
    return { response: NextResponse.json({ error: "That room type is not this hotel's." }, { status: 404 }) };
  }
  return { propertyId };
}

const failed = (err) =>
  NextResponse.json({ error: err.message }, { status: err.message === BOOKING_NOT_READY ? 409 : 400 });

export async function POST(req) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "Choose a photo to upload." }, { status: 400 });
  const roomTypeId = String(form.get("roomTypeId") || "");
  const { propertyId, response } = await forRoom(req, form.get("propertyId") || null, roomTypeId);
  if (response) return response;
  try {
    return NextResponse.json(await addRoomPhoto(propertyId, roomTypeId, file));
  } catch (err) {
    return failed(err);
  }
}

export async function PATCH(req) {
  const body = await req.json().catch(() => null);
  if (!body?.url) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { propertyId, response } = await forRoom(req, body.propertyId, body.roomTypeId);
  if (response) return response;
  try {
    return NextResponse.json(await changeRoomPhoto(propertyId, body.roomTypeId, body.url, { makeCover: true }));
  } catch (err) {
    return failed(err);
  }
}

export async function DELETE(req) {
  const body = await req.json().catch(() => null);
  if (!body?.url) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { propertyId, response } = await forRoom(req, body.propertyId, body.roomTypeId);
  if (response) return response;
  try {
    return NextResponse.json(await changeRoomPhoto(propertyId, body.roomTypeId, body.url));
  } catch (err) {
    return failed(err);
  }
}
