/**
 * Availability flows out of the PMS.
 *
 * The PMS is where rooms are actually sold -- at the desk, and by adopting
 * what the OTAs sell -- so it is the only place that knows how many are left.
 * Whenever a change moves that number, the new count for each affected night
 * is sent to the channel manager, which hands it on to every connected OTA.
 *
 * What is sent is the absolute number free, never a "one fewer": an absolute
 * count is right no matter how many earlier pushes were lost, so a failure
 * heals on the next change to the same nights, or on a resync.
 *
 * Nothing here throws. A booking that saved must stay saved when the channel
 * manager is unreachable; the caller is told, and the attempt is in the log.
 *
 * Server-side only.
 */

import { pushToChannelManager } from "@/lib/cmPush";
import {
  getAvailabilityGrid,
  getPropertyIntegration,
  nightsBetween,
} from "@/lib/database";
import { todayUTC } from "@/lib/date";

/** How far ahead a capacity change or a full resync reaches. */
export const FORWARD_DAYS = 365;

function addDaysISO(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The nights a stay holds, in the shape syncInventory takes.
 *
 * Takes a reservation as the database returns it. Null for anything that
 * holds no nights, so callers can pass a missing "before" without checking.
 */
export function staySpan(reservation) {
  if (!reservation?.room_type_id || !reservation.check_in || !reservation.check_out) {
    return null;
  }
  return {
    roomTypeId: reservation.room_type_id,
    from: reservation.check_in,
    // The check-out day is not a night of the stay.
    to: addDaysISO(reservation.check_out, -1),
  };
}

/**
 * The nights an out-of-order block takes off sale, in the same shape.
 *
 * A block on an inactive room changes nothing: that room was never counted
 * as for sale, so there is nothing to push.
 */
export function blockSpan(block) {
  if (!block?.room_type_id || !block.start_date || !block.end_date) return null;
  if (block.room_is_active === false) return null;
  return {
    roomTypeId: block.room_type_id,
    from: block.start_date,
    to: addDaysISO(block.end_date, -1),
  };
}

/**
 * Consecutive dates with the same count, folded into one range each.
 *
 * The partner expands a range server-side, so a quiet fortnight goes as one
 * entry rather than fourteen.
 */
function toRanges(days) {
  const ranges = [];
  for (const day of days) {
    const last = ranges[ranges.length - 1];
    if (last && last.available === day.free && addDaysISO(last.endDate, 1) === day.date) {
      last.endDate = day.date;
    } else {
      ranges.push({ startDate: day.date, endDate: day.date, available: day.free });
    }
  }
  return ranges;
}

/**
 * Push the current availability for the nights some changes touched.
 *
 * `spans` is a list of `{ roomTypeId, from, to }` (both dates are nights, and
 * both are included). An edit passes the stay as it was and as it is now, so
 * the nights it gave up are reopened as well as the new ones closed.
 *
 * Returns `{ status, message }`, where status is one of:
 *   sent     the channel manager accepted it
 *   mock     worked out, but the connection is not live, so nothing went
 *   skipped  nothing to send -- past dates only, no mapped room, or the
 *            connection does not carry inventory
 *   failed   the channel manager refused it or could not be reached
 */
export async function syncInventory(propertyId, spans, { session = null, actor = null } = {}) {
  try {
    const today = todayUTC();
    const wanted = new Map(); // roomTypeId -> Set of nights
    for (const span of spans || []) {
      if (!span?.roomTypeId || !span.from || !span.to) continue;
      // Nights already gone cannot be sold, and the partner rejects them.
      const from = span.from < today ? today : span.from;
      if (from > span.to) continue;
      const nights = wanted.get(span.roomTypeId) || new Set();
      for (const night of nightsBetween(from, addDaysISO(span.to, 1))) nights.add(night);
      wanted.set(span.roomTypeId, nights);
    }

    if (wanted.size === 0) {
      return { status: "skipped", message: "No future nights changed." };
    }

    // A room type with no partner code is not sold through the channel
    // manager, so it is left out rather than blocking the rooms that are.
    const found = await getPropertyIntegration(propertyId, "aiosell").catch(() => null);
    const mapped = new Set(
      (found?.codeMap || [])
        .filter((row) => !row.rate_plan_id && row.room_type_id && row.partner_room_code)
        .map((row) => row.room_type_id)
    );
    const roomTypeIds = [...wanted.keys()].filter((id) => mapped.has(id));

    if (roomTypeIds.length === 0) {
      return {
        status: "skipped",
        message: "This room type is not mapped to the channel manager, so nothing was sent.",
      };
    }

    let first = null;
    let last = null;
    for (const id of roomTypeIds) {
      for (const night of wanted.get(id)) {
        if (!first || night < first) first = night;
        if (!last || night > last) last = night;
      }
    }

    const grid = await getAvailabilityGrid(propertyId, first, last, { roomTypeIds });

    const updates = [];
    for (const rt of grid.roomTypes) {
      const nights = wanted.get(rt.id);
      const days = rt.days.filter((d) => nights.has(d.date));
      for (const range of toRanges(days)) {
        updates.push({
          startDate: range.startDate,
          endDate: range.endDate,
          rooms: [{ roomCode: rt.id, available: range.available }],
        });
      }
    }

    if (updates.length === 0) {
      return { status: "skipped", message: "No future nights changed." };
    }

    const { status, body } = await pushToChannelManager({
      session,
      actor,
      kind: "inventory",
      updates,
      propertyId,
    });

    if (status === 200 && body.source === "aiosell") {
      return { status: "sent", message: "Availability sent to the channel manager." };
    }
    if (status === 200) {
      return { status: "mock", message: "Channel manager not connected — availability was not sent." };
    }
    // Inventory out switched off is a choice the property made, not a fault.
    if (status === 409 && /turned off/.test(body.error || "")) {
      return { status: "skipped", message: body.error };
    }
    return { status: "failed", message: body.error || "The channel manager did not accept the update." };
  } catch (err) {
    console.error("Inventory sync failed", err);
    return { status: "failed", message: err.message };
  }
}

/**
 * Push availability for whole room types, from today forward.
 *
 * For changes that alter capacity rather than a stay -- a room added, taken
 * out of order or removed, a room type's count edited -- and for the resync
 * button. With no room types given, every room type of the property.
 */
export async function syncInventoryForward(
  propertyId,
  roomTypeIds,
  { session = null, actor = null, from = null, to = null } = {}
) {
  const start = from || todayUTC();
  const end = to || addDaysISO(start, FORWARD_DAYS - 1);

  let ids = roomTypeIds;
  if (!Array.isArray(ids) || ids.length === 0) {
    const found = await getPropertyIntegration(propertyId, "aiosell").catch(() => null);
    ids = [
      ...new Set(
        (found?.codeMap || [])
          .filter((row) => !row.rate_plan_id && row.room_type_id)
          .map((row) => row.room_type_id)
      ),
    ];
  }

  return syncInventory(
    propertyId,
    ids.map((roomTypeId) => ({ roomTypeId, from: start, to: end })),
    { session, actor }
  );
}
