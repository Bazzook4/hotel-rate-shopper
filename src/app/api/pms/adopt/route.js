import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import { adoptPartnerReservations, recordSyncLog } from "@/lib/database";
import { syncInventory } from "@/lib/inventorySync";

/**
 * Pull inbound OTA bookings into the PMS -- the manual retry.
 *
 * The webhook adopts each booking as it arrives, after recording it raw, so
 * this button is for whatever that missed: a booking that arrived while the
 * adoption code was failing, or history from before it adopted on arrival.
 * Adoption is idempotent -- the newest row per booking decides -- so pressing
 * it with nothing outstanding changes nothing.
 */
export async function POST(req) {
  const { error, session } = await pmsGuard(req);
  if (error) return error;

  let body = {};
  try {
    body = await req.json();
  } catch {
    // No body is fine -- a super admin's property comes from the session.
  }

  const propertyId = await resolvePropertyId(session, body.property_id);
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }

  try {
    const result = await adoptPartnerReservations(propertyId);

    const summary = [
      result.created ? `${result.created} created` : null,
      result.updated ? `${result.updated} updated` : null,
      result.cancelled ? `${result.cancelled} cancelled` : null,
      result.skipped ? `${result.skipped} skipped` : null,
    ]
      .filter(Boolean)
      .join(", ");

    await recordSyncLog({
      property_id: propertyId,
      kind: "reservation",
      direction: "in",
      status: "success",
      source: "pms",
      entry_count: result.created + result.updated + result.cancelled,
      summary: `Adopted OTA bookings — ${summary || "nothing to adopt"}`,
    }).catch(() => {
      // The log is a record, not the work. A failed log line must not lose
      // reservations that were genuinely created.
    });

    // Whatever adoption changed has changed what is free.
    const inventory = result.touched.length
      ? await syncInventory(propertyId, result.touched, { session })
      : null;

    return NextResponse.json({ ...result, inventory });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
