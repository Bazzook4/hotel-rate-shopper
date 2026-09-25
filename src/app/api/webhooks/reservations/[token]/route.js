import { NextResponse } from "next/server";
import {
  getIntegrationByWebhookToken,
  recordPartnerReservation,
  recordSyncLog,
} from "@/lib/database";

/**
 * Inbound reservations from a channel manager.
 *
 * This is the URL we hand to the partner. It is public by necessity -- the
 * partner calls it server-to-server with no session -- so the secret in the
 * path is what authenticates it, and it must be treated as a credential.
 *
 * Aiosell posts book, modify and cancel to the endpoint we supply.
 */

const ACTIONS = { book: "book", modify: "modify", cancel: "cancel" };

function readAction(body) {
  const raw = String(
    body?.action || body?.type || body?.status || "book"
  ).toLowerCase();
  if (raw.includes("cancel")) return ACTIONS.cancel;
  if (raw.includes("modif") || raw.includes("amend")) return ACTIONS.modify;
  return ACTIONS.book;
}

/** Pull the common fields out, tolerating naming differences per provider. */
function summarise(body) {
  const b = body?.booking || body?.reservation || body || {};
  const guest = b.guest || b.customer || {};
  return {
    partner_booking_id:
      b.bookingId || b.booking_id || b.id || b.reservationId || null,
    channel: b.channel || b.source || b.ota || null,
    guest_name:
      guest.name ||
      [guest.firstName, guest.lastName].filter(Boolean).join(" ") ||
      b.guestName ||
      null,
    check_in: b.checkIn || b.check_in || b.arrival || null,
    check_out: b.checkOut || b.check_out || b.departure || null,
    amount: Number(b.amount ?? b.totalAmount ?? b.total ?? NaN),
    currency: b.currency || null,
  };
}

export async function POST(req, { params }) {
  const { token } = await params;

  const integration = await getIntegrationByWebhookToken(token).catch(() => null);
  if (!integration) {
    // Deliberately vague: this endpoint is public, so it should not confirm
    // whether a token exists.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (integration.reservations_in !== true) {
    // Logged, because a partner sending bookings we refuse is something the
    // hotel needs to see rather than discover from a missing reservation.
    await recordSyncLog({
      property_id: integration.property_id,
      integration_id: integration.id,
      kind: "reservation",
      direction: "in",
      status: "skipped",
      source: "aiosell",
      summary: "Reservation refused — reservations in is turned off",
    });
    return NextResponse.json(
      { error: "Reservations are not enabled for this property." },
      { status: 409 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const summary = summarise(body);
  const action = readAction(body);

  // What the log row says at a glance: the action, who it is for and when.
  const logLine = [
    action === "book" ? "Booking" : action === "cancel" ? "Cancellation" : "Modification",
    summary.partner_booking_id ? `#${summary.partner_booking_id}` : null,
    summary.guest_name,
    summary.channel ? `via ${summary.channel}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const logBase = {
    property_id: integration.property_id,
    integration_id: integration.id,
    kind: "reservation",
    direction: "in",
    source: "aiosell",
    date_from: summary.check_in || null,
    date_to: summary.check_out || null,
    entry_count: 1,
    summary: logLine,
  };

  try {
    await recordPartnerReservation({
      integration_id: integration.id,
      property_id: integration.property_id,
      action,
      partner_booking_id: summary.partner_booking_id,
      channel: summary.channel,
      guest_name: summary.guest_name,
      check_in: summary.check_in || null,
      check_out: summary.check_out || null,
      amount: Number.isFinite(summary.amount) ? summary.amount : null,
      currency: summary.currency,
      payload: body,
    });

    await recordSyncLog({ ...logBase, status: "success", request: body });

    // Partners generally expect a simple acknowledgement.
    return NextResponse.json({ success: true, message: "Reservation received" });
  } catch (err) {
    console.error("Failed to record inbound reservation", err);
    await recordSyncLog({
      ...logBase,
      status: "failed",
      error: err.message,
      request: body,
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** Some providers probe the URL before going live. */
export async function GET(req, { params }) {
  const { token } = await params;
  const integration = await getIntegrationByWebhookToken(token).catch(() => null);
  if (!integration) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
