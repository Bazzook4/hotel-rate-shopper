import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/serverSession";
import { canManageSetup } from "@/lib/database";
import { resolvePropertyId } from "@/lib/pmsGuard";
import { NEEDS_MIGRATION, getHotelBrand, removeHotelLogo, saveHotelLogo, saveHotelName } from "@/lib/hotelBrand";

/**
 * The hotel's name and logo as guests see them.
 *
 * Anyone signed in may read their own hotel's; only someone who may change
 * setup may change them. PUT saves the name, POST uploads a logo (form data,
 * field "file"), DELETE takes the logo off.
 */

const failed = (err) =>
  NextResponse.json({ error: err.message }, { status: err.message === NEEDS_MIGRATION ? 409 : 400 });

/** The property a change is for, or the response that refuses it. */
async function forChange(req, requested) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!(await canManageSetup(session.userId))) {
    return {
      response: NextResponse.json({ error: "You do not have permission to change property setup." }, { status: 403 }),
    };
  }
  const propertyId = await resolvePropertyId(session, requested);
  if (!propertyId) return { response: NextResponse.json({ error: "No property selected" }, { status: 400 }) };
  return { propertyId };
}

export async function GET(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const propertyId = await resolvePropertyId(session, req.nextUrl.searchParams.get("propertyId"));
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });

  try {
    const brand = await getHotelBrand(propertyId);
    if (!brand) return NextResponse.json({ error: "Property not found" }, { status: 404 });
    return NextResponse.json(brand);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const { propertyId, response } = await forChange(req, body.propertyId);
  if (response) return response;

  try {
    return NextResponse.json({ name: await saveHotelName(propertyId, body.name) });
  } catch (err) {
    return failed(err);
  }
}

export async function POST(req) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "Choose a picture to upload." }, { status: 400 });
  const { propertyId, response } = await forChange(req, form.get("propertyId") || null);
  if (response) return response;

  try {
    return NextResponse.json({ logoUrl: await saveHotelLogo(propertyId, file) });
  } catch (err) {
    return failed(err);
  }
}

export async function DELETE(req) {
  const { propertyId, response } = await forChange(req, req.nextUrl.searchParams.get("propertyId"));
  if (response) return response;

  try {
    await removeHotelLogo(propertyId);
    return NextResponse.json({ logoUrl: null });
  } catch (err) {
    return failed(err);
  }
}
