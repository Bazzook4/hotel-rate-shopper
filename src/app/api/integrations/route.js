import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { isSuperAdmin, isAnyAdmin } from "@/lib/permissions";
import { randomBytes } from "crypto";
import {
  getPropertyIntegration,
  setWebhookToken,
  upsertPropertyIntegration,
  saveIntegrationCodeMap,
  getUserPropertyId,
  listRoomTypes,
  listRatePlans,
  listRatePlanRooms,
} from "@/lib/database";

/** The property this request is about, or null if the actor may not touch it. */
async function resolveProperty(session, requested) {
  const own =
    session.property_id ||
    (await getUserPropertyId(session.userId).catch(() => null));

  if (isSuperAdmin(session)) return requested || own;
  if (!requested || requested === own) return own;
  return null; // a property admin asked about someone else's property
}

export async function GET(req) {
  const session = await getSessionFromRequest(req);
  if (!session || !isAnyAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const propertyId = await resolveProperty(
    session,
    req.nextUrl.searchParams.get("propertyId")
  );
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }

  try {
    const found = await getPropertyIntegration(propertyId, "aiosell");
    const [roomTypes, ratePlans, assignments] = await Promise.all([
      listRoomTypes(propertyId).catch(() => []),
      listRatePlans(propertyId).catch(() => []),
      // Which rooms each plan is sold on. Additive, so a property with none
      // still maps codes by the older room_type_id rule.
      listRatePlanRooms(propertyId).catch(() => []),
    ]);

    // The partner's own credentials are never sent to the browser; the hotel
    // only needs to know whether the connection is ready to use.
    const partner = found?.partner
      ? {
          id: found.partner.id,
          slug: found.partner.slug,
          name: found.partner.name,
          enabled: found.partner.enabled,
          configured: Boolean(
            found.partner.api_username &&
              found.partner.api_password &&
              found.partner.partner_id
          ),
          supports_rates_out: found.partner.supports_rates_out !== false,
          supports_inventory_out: found.partner.supports_inventory_out !== false,
          supports_reservations_in: found.partner.supports_reservations_in !== false,
        }
      : null;

    // The URL a partner posts reservations to. Built from the request so it
    // is correct in every environment.
    const origin = req.nextUrl.origin;
    const token = found?.integration?.webhook_token || null;

    return NextResponse.json({
      partner,
      webhookUrl: token
        ? `${origin}/api/webhooks/reservations/${token}`
        : null,
      integration: found?.integration || null,
      codeMap: found?.codeMap || [],
      roomTypes,
      ratePlans,
      assignments,
      propertyId,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req) {
  const session = await getSessionFromRequest(req);
  if (!session || !isAnyAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const propertyId = await resolveProperty(session, body.propertyId);
  if (!propertyId) {
    return NextResponse.json(
      { error: "You can only configure your own property." },
      { status: 403 }
    );
  }

  const found = await getPropertyIntegration(propertyId, "aiosell").catch(() => null);
  if (!found?.partner) {
    return NextResponse.json({ error: "Aiosell is not available" }, { status: 404 });
  }

  try {
    const integration = await upsertPropertyIntegration({
      propertyId,
      partnerId: found.partner.id,
      hotelCode: body.hotelCode?.trim() || null,
      enabled: Boolean(body.enabled),
      ratesOut: Boolean(body.ratesOut),
      inventoryOut: Boolean(body.inventoryOut),
      reservationsIn: Boolean(body.reservationsIn),
    });

    if (Array.isArray(body.codeMap)) {
      await saveIntegrationCodeMap(integration.id, body.codeMap);
    }

    // Issue a webhook secret the first time reservations are switched on, or
    // when the caller asks for a new one.
    let webhookToken = integration.webhook_token;
    if ((body.reservationsIn && !webhookToken) || body.regenerateWebhook) {
      const fresh = randomBytes(24).toString("base64url");
      await setWebhookToken(integration.id, fresh);
      webhookToken = fresh;
    }

    return NextResponse.json({
      integration: { ...integration, webhook_token: webhookToken },
      webhookUrl: webhookToken
        ? `${req.nextUrl.origin}/api/webhooks/reservations/${webhookToken}`
        : null,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
