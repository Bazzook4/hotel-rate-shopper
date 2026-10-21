/**
 * Rates as the Channel Manager grid works them out, and sending them.
 *
 * Shared by the grid's Resync and the new-plan wizard in Rate Plan Setup, so
 * a plan sent from setup goes out exactly as a resync of the grid would send
 * it: every date, the stored rate where there is one, else the room rate's
 * standing rate, resolved for each room and adult count.
 */

import { gridOwnRateAt, roomRateResolver } from "./ratePlanPricing";

export function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

/** Every date from `from` to `to`, both included. */
export function datesBetween(from, to) {
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`); isoDate(d) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(isoDate(d));
  }
  return out;
}

/**
 * Group rate rows into one update per date, in the shape the push route
 * translates.
 *
 * The room comes from the row itself rather than from the plan, so a rate
 * priced in one room is never sent against another.
 */
export function ratesToUpdates(rows) {
  const byDate = {};
  for (const row of rows) {
    if (!row.room_type_id) continue;
    (byDate[row.stay_date] ||= []).push({
      roomCode: row.room_type_id,
      rateplanCode: row.rate_plan_id,
      occupancy: row.occupancy,
      rate: Number(row.rate),
    });
  }
  return Object.entries(byDate).map(([date, entries]) => ({
    startDate: date,
    endDate: date,
    rates: entries,
  }));
}

/**
 * Prices any cell on any date the way the server does, over the grid's own
 * per-date values: an unsaved edit, else the stored rate, else the room
 * rate's standing rate. A derived room rate follows its source on the same
 * date, so typing a master's Friday moves every plan derived from it on
 * Friday before anything is saved. Null for a grid from before the server
 * sent its pricing setup.
 */
export function cellPricer(grid, edits) {
  const p = grid?.pricing;
  if (!p) return null;
  const stored = grid.dailyRates || {};
  return roomRateResolver({
    ...p,
    ownRateAt: gridOwnRateAt(p.assignments, p.roomTypes),
    dailyAt: (planId, roomId, occupancy, date) => {
      const k = `${planId}|${roomId}|${occupancy}|${date}`;
      const v = edits?.[k] ?? stored[k]?.rate;
      return v === "" || v === null || v === undefined ? null : v;
    },
  });
}

/**
 * The rate rows a grid response holds for `dates`: walking the grid itself
 * rather than the stored rows, so a date that was never explicitly priced
 * still sends the rate the grid shows for it. `roomWanted` and `planWanted`
 * narrow it.
 */
export function storedRateRows(grid, dates, { roomWanted = () => true, planWanted = () => true } = {}) {
  const storedRates = grid.dailyRates || {};
  // Stored values only -- what is saved, not edits.
  const stored = cellPricer(grid, {});
  const rows = [];
  for (const room of grid.rooms || []) {
    if (!roomWanted(room.id)) continue;
    for (const plan of room.plans || []) {
      if (!planWanted(plan.id)) continue;
      for (const occ of plan.occupancies || []) {
        for (const stay_date of dates) {
          const key = `${plan.id}|${room.id}|${occ.occupancy}|${stay_date}`;
          const rate = stored
            ? stored.rate(plan.id, room.id, occ.occupancy, stay_date)
            : storedRates[key]?.rate ?? occ.resolvedRate ?? plan.resolvedRate ?? null;
          // A plan with no rate anywhere in the chain has nothing to send;
          // pushing a null would blank it on the channel.
          if (rate === null || rate === undefined || rate === "") continue;
          rows.push({ rate_plan_id: plan.id, room_type_id: room.id, occupancy: occ.occupancy, stay_date, rate });
        }
      }
    }
  }
  return rows;
}

/**
 * Send one rate plan's rates from `from` to `to` to the channels. Returns
 * how many rates went; throws with the server's message on a failure.
 */
export async function sendPlanRates({ planId, from, to, propertyId }) {
  const scope = propertyId ? `&propertyId=${encodeURIComponent(propertyId)}` : "";
  const res = await fetch(`/api/cm/grid?start=${from}&end=${to}${scope}`);
  const grid = await res.json();
  if (!res.ok) throw new Error(grid?.error || "Could not read the plan's rates");

  const rows = storedRateRows(grid, datesBetween(from, to), { planWanted: (id) => id === planId });
  if (rows.length === 0) return 0;

  const push = await fetch("/api/cm/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "rates", updates: ratesToUpdates(rows), propertyId: propertyId || undefined }),
  });
  const json = await push.json();
  if (!push.ok) throw new Error(json?.error || "Sending rates failed");
  return rows.length;
}
