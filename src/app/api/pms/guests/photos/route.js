import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import { guestsReady } from "@/lib/database";
import {
  listGuestIdPhotos,
  addGuestIdPhoto,
  removeGuestIdPhoto,
  ID_PHOTO_TYPES,
  MAX_ID_PHOTO_BYTES,
} from "@/lib/guestIdPhotos";

/**
 * A guest's photo ID files.
 *
 * An ID is more sensitive than the rest of a guest record, so seeing one
 * needs the Guests page itself; being able to open a booking is not enough.
 */
const PAGES = ["guests"];
const NOT_READY = "The guest list is not switched on for this property yet.";

async function scope(req, propertyIdHint) {
  const { error, session } = await pmsGuard(req, PAGES);
  if (error) return { error };
  const propertyId = await resolvePropertyId(session, propertyIdHint);
  if (!propertyId) return { error: NextResponse.json({ error: "No property selected" }, { status: 400 }) };
  if (!(await guestsReady())) return { error: NextResponse.json({ error: NOT_READY }, { status: 409 }) };
  return { propertyId };
}

const notFound = () => NextResponse.json({ error: "Guest not found" }, { status: 404 });

export async function GET(req) {
  const params = req.nextUrl.searchParams;
  const { error, propertyId } = await scope(req, params.get("propertyId"));
  if (error) return error;
  const guestId = params.get("guestId");
  if (!guestId) return NextResponse.json({ error: "Guest id is required" }, { status: 400 });

  try {
    const photos = await listGuestIdPhotos(propertyId, guestId);
    return photos ? NextResponse.json({ photos }) : notFound();
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  let form;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Send the file as a form upload" }, { status: 400 });
  }
  const { error, propertyId } = await scope(req, form.get("property_id"));
  if (error) return error;

  const guestId = form.get("guest_id");
  const file = form.get("file");
  if (!guestId) return NextResponse.json({ error: "Guest id is required" }, { status: 400 });
  if (!file || typeof file === "string") return NextResponse.json({ error: "No file was sent" }, { status: 400 });
  if (!ID_PHOTO_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Upload a photo (JPG, PNG, WebP) or a PDF." }, { status: 400 });
  }
  if (file.size > MAX_ID_PHOTO_BYTES) {
    return NextResponse.json({ error: "That file is over 4 MB. Take a smaller photo or scan." }, { status: 400 });
  }

  try {
    const photos = await addGuestIdPhoto(propertyId, guestId, file);
    return photos ? NextResponse.json({ photos }) : notFound();
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  const params = req.nextUrl.searchParams;
  const { error, propertyId } = await scope(req, params.get("propertyId"));
  if (error) return error;
  const guestId = params.get("guestId");
  const path = params.get("path");
  if (!guestId || !path) return NextResponse.json({ error: "Guest and file are required" }, { status: 400 });

  try {
    const photos = await removeGuestIdPhoto(propertyId, guestId, path);
    return photos ? NextResponse.json({ photos }) : notFound();
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
