import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { resolveChannelManager } from "@/lib/cmResolver";
import { getPropertyIntegration, getUserPropertyId } from "@/lib/database";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateUpdates(updates, key) {
  if (!Array.isArray(updates) || updates.length === 0) {
    return "updates must be a non-empty array";
  }
  for (const u of updates) {
    if (!ISO_DATE.test(u?.startDate) || !ISO_DATE.test(u?.endDate)) {
      return "each update needs startDate and endDate as YYYY-MM-DD";
    }
    if (u.startDate > u.endDate) {
      return `startDate ${u.startDate} is after endDate ${u.endDate}`;
    }
    if (!Array.isArray(u?.[key]) || u[key].length === 0) {
      return `each update needs a non-empty ${key} array`;
    }
  }
  return null;
}

export async function POST(req) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { kind, updates, toChannels, propertyId } = body || {};
  const key = kind === "rates" ? "rates" : "rooms";

  if (!["rates", "inventory", "restrictions"].includes(kind)) {
    return NextResponse.json(
      { error: "kind must be one of: rates, inventory, restrictions" },
      { status: 400 }
    );
  }

  const invalid = validateUpdates(updates, key);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }

  const cm = await resolveChannelManager(session, { propertyId });
  const { client, ready } = cm;

  // Our ids mean nothing to the partner, so every code is translated through
  // the property's mapping. A push with an unmapped code would be rejected,
  // so it is refused here with a message naming what is missing.
  const resolvedProperty =
    propertyId ||
    session.property_id ||
    (await getUserPropertyId(session.userId).catch(() => null));

  const found = resolvedProperty
    ? await getPropertyIntegration(resolvedProperty, "aiosell").catch(() => null)
    : null;

  const roomCodes = {};
  const planCodes = {};
  for (const row of found?.codeMap || []) {
    if (row.rate_plan_id) {
      planCodes[`${row.rate_plan_id}|${row.occupancy ?? 1}`] =
        row.partner_rateplan_code;
    } else if (row.room_type_id) {
      roomCodes[row.room_type_id] = row.partner_room_code;
    }
  }

  const missing = [];
  const translated = (updates || []).map((u) => {
    const entries = (u[key] || []).map((entry) => {
      const roomCode = roomCodes[entry.roomCode] || entry.roomCode;
      if (!roomCodes[entry.roomCode] && found) missing.push(entry.roomCode);

      if (key === "rooms") return { ...entry, roomCode };

      const planKey = `${entry.rateplanCode}|${entry.occupancy ?? 1}`;
      const rateplanCode = planCodes[planKey] || entry.rateplanCode;
      if (!planCodes[planKey] && found) missing.push(entry.rateplanCode);

      // occupancy is ours, not part of the partner payload.
      const { occupancy, ...rest } = entry;
      return { ...rest, roomCode, rateplanCode };
    });
    return { ...u, [key]: entries };
  });

  if (ready && missing.length > 0) {
    return NextResponse.json(
      {
        error:
          "Some room types or rate plans are not mapped to partner codes yet. Set them under Integrations before pushing.",
        missing: [...new Set(missing)],
      },
      { status: 409 }
    );
  }

  // Each activity is enabled separately, so a connection that only sends
  // rates must not be able to push inventory.
  if (ready && !cm.allows(kind)) {
    const label = kind === "rates" ? "Rates out" : "Inventory out";
    return NextResponse.json(
      { error: `${label} is turned off for this property's connection.` },
      { status: 409 }
    );
  }

  if (!ready) {
    const count = updates.reduce((n, u) => n + u[key].length, 0);
    return NextResponse.json({
      source: "mock",
      message: `Would push ${count} ${kind} entr${count === 1 ? "y" : "ies"}`,
    });
  }

  try {
    let result;
    if (kind === "rates") {
      result = await client.pushRates(translated);
    } else if (kind === "inventory") {
      result = await client.pushInventory(translated);
    } else {
      result = await client.pushInventoryRestrictions(translated, { toChannels });
    }
    return NextResponse.json({ source: "aiosell", result });
  } catch (err) {
    console.error(`Aiosell ${kind} push failed`, err);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
