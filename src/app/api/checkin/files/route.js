import { NextResponse } from "next/server";
import { recordCheckinUse } from "@/lib/rateLimit";
import { addGuestFile, closedReason, removeGuestFile } from "@/lib/onlineCheckin";
import { ID_PHOTO_TYPES, MAX_ID_PHOTO_BYTES } from "@/lib/guestIdPhotos";
import { openLink } from "../openLink";

/**
 * ID files a guest uploads on their check-in link. The page is told each
 * file's name only; the file itself is never served back through the link.
 */

async function openForChange(req, token) {
  const { found, ip, response } = await openLink(req, token);
  if (response) return { response };
  if (!found.prefs.enabled || closedReason(found.row, found.reservation, found.property.timezone)) {
    return {
      response: NextResponse.json(
        { error: "Your details can no longer be changed online. Please speak to the front desk." },
        { status: 409 }
      ),
    };
  }
  await recordCheckinUse(ip);
  return { found };
}

export async function POST(req) {
  let form;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Send the file as a form upload" }, { status: 400 });
  }
  const { found, response } = await openForChange(req, form.get("token"));
  if (response) return response;

  const file = form.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "No file was sent" }, { status: 400 });
  if (!ID_PHOTO_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Upload a photo (JPG, PNG, WebP) or a PDF." }, { status: 400 });
  }
  if (file.size > MAX_ID_PHOTO_BYTES) {
    return NextResponse.json({ error: "That file is over 4 MB. Take a smaller photo or scan." }, { status: 400 });
  }

  try {
    const result = await addGuestFile(found, Number(form.get("index")), file);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result);
  } catch (err) {
    console.error("Online check-in file failed:", err.message);
    return NextResponse.json({ error: "That did not work. Please try again." }, { status: 500 });
  }
}

export async function DELETE(req) {
  const params = req.nextUrl.searchParams;
  const { found, response } = await openForChange(req, params.get("token"));
  if (response) return response;

  try {
    const result = await removeGuestFile(found, params.get("id") || "");
    if (result.error) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json(result);
  } catch (err) {
    console.error("Online check-in file failed:", err.message);
    return NextResponse.json({ error: "That did not work. Please try again." }, { status: 500 });
  }
}
