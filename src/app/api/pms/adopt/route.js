import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import { adoptPartnerReservations, recordSyncLog } from "@/lib/database";

/**
 * Pull inbound OTA bookings into the PMS.
 *
 * The webhook records what the channel manager sent into `partner_reservations`
 * without interpreting it, so that a bad booking can never break the endpoint
 * the partner depends on. Turning those rows into reservations is this route's
 * job, and it is a button rather than an automatic step: an adopted booking
 * lands on a default room type that the front desk has to confirm, so it
 * should happen when someone is there to look at the result.
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

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
