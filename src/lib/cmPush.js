/**
 * Sending updates to the connected channel manager.
 *
 * One path for every push, whoever starts it: the Channel Manager's Publish
 * and Resync go through /api/cm/push, and the PMS calls this directly when a
 * booking changes what is free. Keeping one path means the code translation,
 * the activity switches and the log row are the same however a push began --
 * the log cannot show a PMS push that skipped a check a manual one made.
 *
 * Server-side only: it reaches the partner with Basic auth credentials.
 */

import { resolveChannelManager } from "@/lib/cmResolver";
import {
  getPropertyIntegration,
  getUserPropertyId,
  recordSyncLog,
} from "@/lib/database";

/** The date span and entry count a set of updates covers, for the log. */
function describe(updates, key) {
  let from = null;
  let to = null;
  let count = 0;
  for (const u of updates || []) {
    if (!from || u.startDate < from) from = u.startDate;
    if (!to || u.endDate > to) to = u.endDate;
    count += (u[key] || []).length;
  }
  return { from, to, count };
}

/**
 * Translate and send one batch of updates.
 *
 * `updates` carry our own ids as roomCode / rateplanCode; they are swapped for
 * the partner's codes here. Returns `{ status, body }` -- the HTTP status and
 * JSON a route would answer with -- rather than throwing, so a caller that is
 * not a route can read the outcome the same way. `body.source` is "aiosell"
 * when it really went, "mock" when the connection is not live.
 *
 * `session` may be null for pushes nobody at a screen started, such as one
 * following an OTA booking; `actor` then names what did, for the log.
 */
export async function pushToChannelManager({
  session = null,
  actor = null,
  kind,
  updates,
  propertyId = null,
  toChannels = null,
}) {
  const key = kind === "rates" ? "rates" : "rooms";

  const cm = await resolveChannelManager(session, { propertyId });
  const { client, ready } = cm;

  // Our ids mean nothing to the partner, so every code is translated through
  // the property's mapping. A push with an unmapped code would be rejected,
  // so it is refused here with a message naming what is missing.
  const resolvedProperty =
    propertyId ||
    session?.property_id ||
    (session?.userId
      ? await getUserPropertyId(session.userId).catch(() => null)
      : null);

  const found = resolvedProperty
    ? await getPropertyIntegration(resolvedProperty, "aiosell").catch(() => null)
    : null;

  // A rate plan is mapped once per room type and occupancy, because the
  // partner treats each of those combinations as its own rate plan code.
  // Keying on the plan alone would let one room's code overwrite another's.
  const roomCodes = {};
  const planCodes = {};
  for (const row of found?.codeMap || []) {
    if (row.rate_plan_id) {
      planCodes[
        `${row.room_type_id ?? ""}|${row.rate_plan_id}|${row.occupancy ?? 1}`
      ] = row.partner_rateplan_code;
    } else if (row.room_type_id) {
      roomCodes[row.room_type_id] = row.partner_room_code;
    }
  }

  // The log describes the change in our own terms, so it stays readable even
  // after a partner code is remapped.
  const span = describe(updates, key);
  const logBase = {
    property_id: resolvedProperty || null,
    integration_id: found?.integration?.id || null,
    kind,
    direction: "out",
    user_id: session?.userId || null,
    user_email: session?.email || actor || null,
    date_from: span.from,
    date_to: span.to,
    entry_count: span.count,
  };

  const missing = [];
  const translated = (updates || []).map((u) => {
    const entries = (u[key] || []).map((entry) => {
      const roomCode = roomCodes[entry.roomCode] || entry.roomCode;
      if (!roomCodes[entry.roomCode] && found) missing.push(entry.roomCode);

      if (key === "rooms") return { ...entry, roomCode };

      const planKey = `${entry.roomCode}|${entry.rateplanCode}|${entry.occupancy ?? 1}`;
      const rateplanCode = planCodes[planKey] || entry.rateplanCode;
      if (!planCodes[planKey] && found) missing.push(entry.rateplanCode);

      // occupancy is ours, not part of the partner payload.
      const { occupancy, ...rest } = entry;
      return { ...rest, roomCode, rateplanCode };
    });
    return { ...u, [key]: entries };
  });

  if (ready && missing.length > 0) {
    await recordSyncLog({
      ...logBase,
      status: "failed",
      source: "local",
      summary: "Blocked: room types or rate plans are not mapped to partner codes",
      error: `Unmapped codes: ${[...new Set(missing)].join(", ")}`,
      request: { updates },
    });
    return {
      status: 409,
      body: {
        error:
          "Some room types or rate plans are not mapped to partner codes yet. Set them under Integrations before pushing.",
        missing: [...new Set(missing)],
      },
    };
  }

  // Each activity is enabled separately, so a connection that only sends
  // rates must not be able to push inventory.
  if (ready && !cm.allows(kind)) {
    const label = kind === "rates" ? "Rates out" : "Inventory out";
    await recordSyncLog({
      ...logBase,
      status: "skipped",
      source: "local",
      summary: `${label} is turned off for this property's connection`,
      request: { updates },
    });
    return {
      status: 409,
      body: { error: `${label} is turned off for this property's connection.` },
    };
  }

  if (!ready) {
    const count = span.count;
    const message = `Would push ${count} ${kind} entr${count === 1 ? "y" : "ies"}`;
    await recordSyncLog({
      ...logBase,
      status: "skipped",
      source: "mock",
      summary: `${message} — connection not live`,
      request: { updates },
    });
    return { status: 200, body: { source: "mock", message } };
  }

  const startedAt = Date.now();

  try {
    let result;
    if (kind === "rates") {
      result = await client.pushRates(translated);
    } else if (kind === "inventory") {
      result = await client.pushInventory(translated);
    } else {
      result = await client.pushInventoryRestrictions(translated, { toChannels });
    }

    await recordSyncLog({
      ...logBase,
      status: "success",
      source: "aiosell",
      summary: `Sent ${span.count} ${kind} entr${span.count === 1 ? "y" : "ies"} to Aiosell`,
      duration_ms: Date.now() - startedAt,
      // The translated payload is what actually went out; partner codes in it
      // are the point of the record.
      request: { updates: translated, toChannels: toChannels || null },
      response: result,
    });

    return { status: 200, body: { source: "aiosell", result } };
  } catch (err) {
    console.error(`Aiosell ${kind} push failed`, err);
    await recordSyncLog({
      ...logBase,
      status: "failed",
      source: "aiosell",
      summary: `Push of ${span.count} ${kind} entr${span.count === 1 ? "y" : "ies"} failed`,
      error: err.message,
      duration_ms: Date.now() - startedAt,
      request: { updates: translated, toChannels: toChannels || null },
    });
    return { status: 502, body: { error: err.message } };
  }
}
