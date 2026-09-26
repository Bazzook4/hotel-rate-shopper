import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import {
  canManageSetup,
  ensureServiceDefaults,
  listPropertyExtras,
  listServiceCategories,
  listPropertyTaxes,
  savePropertyExtra,
  saveServiceCategory,
  deleteServiceCategory,
  setServiceTaxes,
  getSupabaseAdmin,
} from "@/lib/database";

/**
 * Services, their categories, and the taxes each carries.
 *
 * Reading is front-desk work -- the folio offers these when adding a charge
 * -- but changing what the hotel sells, or how it is taxed, is setup, so
 * writes need the setup permission.
 *
 * Writes name what they act on in `kind`: a category, or a service (with its
 * tax ids, since a service and its taxes are set together).
 */

async function requireSetup(req) {
  const { error, session } = await pmsGuard(req);
  if (error) return { error };

  if (!(await canManageSetup(session.userId))) {
    return {
      error: NextResponse.json(
        { error: "You do not have permission to change services." },
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
    // The room service must exist for room nights to be taxable at all, so
    // opening the setup page is where a property first gets one.
    if (await canManageSetup(session.userId)) await ensureServiceDefaults(propertyId);

    const [categories, services, taxes] = await Promise.all([
      listServiceCategories(propertyId),
      listPropertyExtras(propertyId),
      listPropertyTaxes(propertyId, { includeInactive: true }),
    ]);
    return NextResponse.json({ categories, services, taxes });
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

  try {
    if (body.kind === "category") {
      if (!body.name?.trim()) {
        return NextResponse.json({ error: "Give the category a name." }, { status: 400 });
      }
      const category = await saveServiceCategory({
        ...(body.id ? { id: body.id } : {}),
        property_id: propertyId,
        name: body.name.trim(),
        sort_order: Number(body.sort_order) || 0,
      });
      return NextResponse.json({ category });
    }

    if (body.kind === "service") {
      if (!body.name?.trim()) {
        return NextResponse.json({ error: "Give the service a name." }, { status: 400 });
      }
      if (body.unit_price != null && Number(body.unit_price) < 0) {
        return NextResponse.json({ error: "Price cannot be negative." }, { status: 400 });
      }

      const row = {
        ...(body.id ? { id: body.id } : {}),
        property_id: propertyId,
        name: body.name.trim(),
        category_id: body.category_id || null,
        is_active: body.is_active !== false,
      };

      // The room service's price lives on each night of a stay and its kind
      // is fixed, so only its name, category and taxes are editable.
      if (!body.is_room) {
        row.unit_price = Number(body.unit_price) || 0;
        row.charge_type = body.charge_type === "per_night" ? "per_night" : "once";
        row.kind = body.kind_of === "inclusion" ? "inclusion" : "extra";
      }

      const service = await savePropertyExtra(row);
      if (Array.isArray(body.tax_ids)) await setServiceTaxes(service.id, body.tax_ids);
      return NextResponse.json({ service });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  const { error, session } = await requireSetup(req);
  if (error) return error;

  const params = req.nextUrl.searchParams;
  const id = params.get("id");
  if (!id) {
    return NextResponse.json({ error: "An id is required" }, { status: 400 });
  }

  const propertyId = await resolvePropertyId(session, params.get("propertyId"));
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }

  try {
    if (params.get("kind") === "category") {
      await deleteServiceCategory(id, propertyId);
      return NextResponse.json({ success: true });
    }

    // Services are retired rather than deleted: folio lines reference them
    // for their taxes and for reporting, and removing one would untax every
    // past stay that bought it. The room service cannot be retired at all.
    const { error: dbError } = await getSupabaseAdmin()
      .from("property_extras")
      .update({ is_active: false })
      .eq("id", id)
      .eq("property_id", propertyId)
      .eq("is_room", false);

    if (dbError) throw new Error(dbError.message);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
