import { NextResponse, after } from "next/server";
import {
  adoptPartnerReservations,
  getIntegrationByWebhookToken,
  recordPartnerReservation,
  recordSyncLog,
} from "@/lib/database";
import { syncInventory } from "@/lib/inventorySync";

/**
 * Inbound reservations from a channel manager.
 *
 * This is the URL we hand to the partner. It is public by necessity -- the
 * partner calls it server-to-server with no session -- so the secret in the
 * path is what authenticates it, and it must be treated as a credential.
 *
 * Aiosell posts book, modify and cancel to the endpoint we supply.
 *
 * The raw booking is recorded first and acknowledged, so a fault further on
 * can never make the partner think the booking was lost. Then, after the
 * answer has gone, the booking is adopted into the PMS and the new
 * availability is pushed back out -- the channel that sold the room already
 * knows, but every other channel learns it from that push.
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
    // Aiosell spells these all in lower case.
    check_in: b.checkin || b.checkIn || b.check_in || b.arrival || null,
    check_out: b.checkout || b.checkOut || b.check_out || b.departure || null,
    // Aiosell sends the amount as an object with and without tax; the guest
    // pays the figure after tax.
    amount: Number(
      typeof b.amount === "object" && b.amount !== null
        ? b.amount.amountAfterTax ?? b.amount.amountBeforeTax ?? NaN
        : b.amount ?? b.totalAmount ?? b.total ?? NaN
    ),
    currency:
      (typeof b.amount === "object" && b.amount?.currency) || b.currency || null,
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

  // A switched-off connection takes nothing in, whatever its activities say.
  if (integration.enabled !== true || integration.reservations_in !== true) {
    // Logged, because a partner sending bookings we refuse is something the
    // hotel needs to see rather than discover from a missing reservation.
    await recordSyncLog({
      property_id: integration.property_id,
      integration_id: integration.id,
      kind: "reservation",
      direction: "in",
      status: "skipped",
      source: "aiosell",
      summary:
        integration.enabled !== true
          ? "Reservation refused: the connection is turned off"
          : "Reservation refused: reservations in is turned off",
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

  // A booking for another hotel's code is refused: the URL alone should not
  // be enough to put bookings into this one.
  const b = body?.booking || body?.reservation || body || {};
  const sentCode = body?.hotelCode || b.hotelCode || b.hotel_code || null;
  if (sentCode && integration.hotel_code && String(sentCode) !== String(integration.hotel_code)) {
    await recordSyncLog({
      property_id: integration.property_id,
      integration_id: integration.id,
      kind: "reservation",
      direction: "in",
      status: "failed",
      source: "aiosell",
      summary: `Reservation refused: it was for hotel code ${sentCode}, not this hotel's`,
    });
    return NextResponse.json({ error: "Hotel code does not match." }, { status: 409 });
  }

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

    // The log keeps what the desk needs to recognise the booking; the guest's
    // full details stay in the booking itself, not copied into the log.
    await recordSyncLog({
      ...logBase,
      status: summary.partner_booking_id ? "success" : "failed",
      request: { action, ...summary },
      ...(summary.partner_booking_id
        ? {}
        : { error: "The channel sent no booking number, so it could not be added. Enter it by hand." }),
    });

    if (summary.partner_booking_id) {
      after(() =>
        adoptAndPush(integration.property_id, integration.id, summary.partner_booking_id)
      );
    }

    // Partners generally expect a simple acknowledgement.
    return NextResponse.json({ success: true, message: "Reservation received" });
  } catch (err) {
    console.error("Failed to record inbound reservation", err);
    await recordSyncLog({
      ...logBase,
      status: "failed",
      error: err.message,
      request: { action, ...summary },
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * Fold one booking into the PMS and push what it changed.
 *
 * Failures are logged rather than thrown: the booking is already safe in the
 * raw log, and the Adopt button on the Reservations page picks it up again.
 */
async function adoptAndPush(propertyId, integrationId, bookingId) {
  try {
    // A booking and its change can arrive together and be adopted at once.
    // One of them then loses: its create hits the booking already made, or a
    // cancel finds nothing yet to cancel. Adopting again settles it, since
    // the newest message for the booking is what counts.
    let result;
    try {
      result = await adoptPartnerReservations(propertyId, { bookingIds: [bookingId] });
    } catch (err) {
      result = { reasons: [], warnings: [], touched: [] };
      console.error(`Adopting booking ${bookingId} failed, trying again`, err.message);
    }
    await new Promise((r) => setTimeout(r, 1500));
    const again = await adoptPartnerReservations(propertyId, { bookingIds: [bookingId] });
    result = {
      reasons: again.reasons,
      warnings: [...new Set([...(result.warnings || []), ...(again.warnings || [])])],
      touched: [...(result.touched || []), ...(again.touched || [])],
    };
    for (const warning of result.warnings) {
      await recordSyncLog({
        property_id: propertyId,
        integration_id: integrationId,
        kind: "reservation",
        direction: "in",
        status: "failed",
        source: "pms",
        summary: `Booking #${bookingId} needs a look`,
        error: warning,
      });
    }
    if (result.reasons.length) {
      await recordSyncLog({
        property_id: propertyId,
        integration_id: integrationId,
        kind: "reservation",
        direction: "in",
        status: "skipped",
        source: "pms",
        summary: `Booking #${bookingId} not adopted`,
        error: result.reasons.join("; "),
      });
    }
    if (result.touched.length) {
      await syncInventory(propertyId, result.touched, { actor: "OTA booking" });
    }
  } catch (err) {
    console.error(`Adopting booking ${bookingId} failed`, err);
    await recordSyncLog({
      property_id: propertyId,
      integration_id: integrationId,
      kind: "reservation",
      direction: "in",
      status: "failed",
      source: "pms",
      summary: `Booking #${bookingId} could not be adopted. Use Adopt on the Reservations page`,
      error: err.message,
    });
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
