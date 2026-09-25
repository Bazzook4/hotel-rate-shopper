import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import {
  canManageSetup,
  listPropertyExtras,
  savePropertyExtra,
  getSupabaseAdmin,
} from "@/lib/database";

/**
 * The property's menu of extras and inclusions.
 *
 * This is the list the folio's Inclusions tab offers. Reading it is ordinary
 * front-desk work -- you cannot add breakfast to a stay without seeing what
 * the hotel sells -- but changing what the hotel offers is setup, so writes
 * need the setup permission.
 */

async function requireSetup(req) {
  const { error, session } = await pmsGuard(req);
  if (error) return { error };

  if (!(await canManageSetup(session.userId))) {
    return {
      error: NextResponse.json(
        { error: "You do not have permission to change this list." },
        { status: 403 }
      ),
    };
  }
  return { session };
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
    return NextResponse.json({ extras: await listPropertyExtras(propertyId) });
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

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Give the item a name." }, { status: 400 });
  }
  if (body.unit_price != null && Number(body.unit_price) < 0) {
    return NextResponse.json({ error: "Price cannot be negative." }, { status: 400 });
  }

  try {
    const extra = await savePropertyExtra({
      ...(body.id ? { id: body.id } : {}),
      property_id: propertyId,
      name: body.name.trim(),
      unit_price: Number(body.unit_price) || 0,
      charge_type: body.charge_type === "per_night" ? "per_night" : "once",
      kind: body.kind === "inclusion" ? "inclusion" : "extra",
      is_active: body.is_active !== false,
    });
    return NextResponse.json({ extra });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  const { error } = await requireSetup(req);
  if (error) return error;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Item id is required" }, { status: 400 });
  }

  try {
    // Retired rather than deleted: folio lines reference this row for
    // reporting, and removing it would blank that link on every past stay.
    // The list only offers active items, so retiring takes it out of use.
    const { error: dbError } = await getSupabaseAdmin()
      .from("property_extras")
      .update({ is_active: false })
      .eq("id", id);

    if (dbError) throw new Error(dbError.message);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
