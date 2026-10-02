/**
 * Workflow rules: stop sell on chosen channels when a night fills up.
 *
 * A rule reads "when Deluxe has 5 or more sold, stop selling it on Agoda".
 * Rules are checked whenever availability changes (inventorySync calls in
 * here after every push), when a rule is saved, and once a day, since a
 * rule that looks only a few days ahead gains a new night each morning.
 *
 * Each check works out, night by night, which (rate plan, room, channel)
 * the rules want closed, then compares that with daily_channel_restrictions:
 *
 *   wanted closed, nothing set        close it, marked as the rule's
 *   closed by a rule, still wanted    leave it
 *   closed by a rule, no longer       reopen it -- the channel goes back to
 *                                     following the all-channels value
 *   set by a person (open or closed)  never touched
 *
 * So a rule only ever reopens what a rule closed, and a channel someone set
 * to "Open" by hand stays open. When two rules want the same night closed,
 * closed wins and the older rule owns it; if that one lets go while the
 * other still wants it, ownership moves rather than the channel reopening.
 *
 * Nothing here throws to its caller. A booking that saved stays saved when
 * a rule could not run; the attempt is in the activity log.
 *
 * Server-side only.
 */

import { pushToChannelManager } from "@/lib/cmPush";
import {
  getAvailabilityGrid,
  getPropertyIntegration,
  listChannelRestrictions,
  listDailyRestrictions,
  listRatePlanRooms,
  listRatePlans,
  listWorkflowRules,
  recordSyncLog,
  saveChannelRestrictions,
} from "@/lib/database";
import { plansForRoom } from "@/lib/ratePlanPricing";
import { channelLabel } from "@/lib/channels";
import { todayUTC } from "@/lib/date";

/** How far ahead a full check reaches: the same year inventory sync covers. */
export const WORKFLOW_DAYS = 365;

export const METRICS = {
  sold: { label: "rooms sold", test: (value, t) => value >= t, word: "or more" },
  left: { label: "rooms left", test: (value, t) => value <= t, word: "or fewer" },
  occupancy: { label: "occupancy", test: (value, t) => value >= t, word: "or more" },
};

function addDaysISO(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** One night's figures for a rule's metric. */
function measure(metric, { sold, free, capacity }) {
  if (metric === "sold") return sold;
  if (metric === "left") return free;
  // As the Booking Performance report reckons it: sold over every room the
  // hotel has, out-of-order rooms not deducted.
  return capacity > 0 ? (sold / capacity) * 100 : 0;
}

/** "Deluxe: 5 or more rooms sold", for the log and the page. */
export function describeRule(rule, roomName = "Whole hotel") {
  const m = METRICS[rule.metric] || METRICS.sold;
  const amount = rule.metric === "occupancy" ? `${Number(rule.threshold)}%` : Number(rule.threshold);
  const channels = (rule.channels || []).map(channelLabel).join(", ");
  return `${roomName}: ${m.label} ${amount} ${m.word} → stop sell on ${channels}`;
}

const cellKey = (planId, roomId, date) => `${planId}|${roomId}|${date}`;

/**
 * Fold one channel's changes into Aiosell restriction updates: one entry per
 * room and plan, consecutive dates with the same values sent as one range.
 */
function toUpdates(entries) {
  const sorted = [...entries].sort((a, b) =>
    `${a.roomCode}|${a.rateplanCode}|${a.date}`.localeCompare(`${b.roomCode}|${b.rateplanCode}|${b.date}`)
  );
  const ranges = [];
  for (const e of sorted) {
    const sig = JSON.stringify(e.restrictions);
    const last = ranges[ranges.length - 1];
    if (
      last &&
      last.roomCode === e.roomCode &&
      last.rateplanCode === e.rateplanCode &&
      last.sig === sig &&
      addDaysISO(last.endDate, 1) === e.date
    ) {
      last.endDate = e.date;
    } else {
      ranges.push({ ...e, sig, startDate: e.date, endDate: e.date });
    }
  }
  return ranges.map((r) => ({
    startDate: r.startDate,
    endDate: r.endDate,
    rates: [{ roomCode: r.roomCode, rateplanCode: r.rateplanCode, restrictions: r.restrictions }],
  }));
}

/**
 * Check every rule of a property over a window of nights, and apply what
 * changed. With no window, today and the year after it.
 *
 * Returns `{ status, closed, reopened, message }`:
 *   none     no rules, or nothing to change
 *   applied  changes saved and sent (or the connection is not live)
 *   failed   saved, but the channel manager refused or could not be reached;
 *            or nothing could be saved
 */
export async function runWorkflows(propertyId, { from = null, to = null } = {}) {
  const today = todayUTC();
  const start = !from || from < today ? today : from;
  const end = to || addDaysISO(today, WORKFLOW_DAYS - 1);
  const none = { status: "none", closed: 0, reopened: 0, message: "" };
  if (!propertyId || start > end) return none;

  try {
    const [rules, existing] = await Promise.all([
      listWorkflowRules(propertyId),
      listChannelRestrictions(propertyId, start, end),
    ]);
    const active = rules.filter((r) => r.enabled);
    const owned = existing.filter((r) => r.set_by_rule_id);
    // No rule switched on and nothing a rule closed: nothing to look at.
    if (active.length === 0 && owned.length === 0) return none;

    const [grid, ratePlans, assignments, found] = await Promise.all([
      getAvailabilityGrid(propertyId, start, end),
      listRatePlans(propertyId),
      listRatePlanRooms(propertyId).catch(() => []),
      getPropertyIntegration(propertyId, "aiosell").catch(() => null),
    ]);

    // A plan with no partner code in a room is not sold through the channel
    // manager there, so a rule leaves it alone rather than blocking the push.
    // A property with no connection at all keeps every plan: the push then
    // runs as a dry run and logs what it would have sent.
    const sellable = found?.codeMap?.length
      ? new Set(
          found.codeMap
            .filter((row) => row.rate_plan_id && row.room_type_id && row.partner_rateplan_code)
            .map((row) => `${row.rate_plan_id}|${row.room_type_id}`)
        )
      : null;

    const plansIn = {};
    for (const rt of grid.roomTypes) {
      plansIn[rt.id] = plansForRoom(ratePlans, rt.id, assignments)
        .map((p) => p.id)
        .filter((id) => !sellable || sellable.has(`${id}|${rt.id}`));
    }

    // The hotel's totals per night, for whole-hotel rules.
    const hotel = {};
    for (const rt of grid.roomTypes) {
      for (const d of rt.days) {
        const h = (hotel[d.date] ||= { sold: 0, free: 0, capacity: 0 });
        h.sold += d.sold;
        h.free += d.free;
        h.capacity += rt.capacity;
      }
    }

    // What the rules want closed: "<plan>|<room>|<date>|<channel>" -> the
    // ids of every rule that wants it, oldest first.
    const wanted = new Map();
    for (const rule of active) {
      const last = rule.within_days ? addDaysISO(today, rule.within_days - 1) : end;
      const rooms = rule.room_type_id
        ? grid.roomTypes.filter((rt) => rt.id === rule.room_type_id)
        : grid.roomTypes;
      const onlyPlans = Array.isArray(rule.rate_plan_ids) && rule.rate_plan_ids.length
        ? new Set(rule.rate_plan_ids)
        : null;
      const test = (METRICS[rule.metric] || METRICS.sold).test;
      const threshold = Number(rule.threshold);

      for (const date of grid.dates) {
        if (date < start || date > end || date > last) continue;
        const figures = rule.room_type_id
          ? (() => {
              const rt = rooms[0];
              const d = rt?.days.find((x) => x.date === date);
              return d ? { sold: d.sold, free: d.free, capacity: rt.capacity } : null;
            })()
          : hotel[date];
        if (!figures || !test(measure(rule.metric, figures), threshold)) continue;

        for (const rt of rooms) {
          for (const planId of plansIn[rt.id] || []) {
            if (onlyPlans && !onlyPlans.has(planId)) continue;
            for (const channel of rule.channels || []) {
              const key = `${cellKey(planId, rt.id, date)}|${channel}`;
              if (!wanted.has(key)) wanted.set(key, []);
              wanted.get(key).push(rule.id);
            }
          }
        }
      }
    }

    const byKey = new Map(
      existing.map((r) => [`${cellKey(r.rate_plan_id, r.room_type_id, r.stay_date)}|${r.channel}`, r])
    );

    // close / reopen go to the channel; hand-over only changes the owner.
    const changes = [];
    for (const [key, ruleIds] of wanted) {
      const row = byKey.get(key);
      const [rate_plan_id, room_type_id, stay_date, channel] = key.split("|");
      const base = { rate_plan_id, room_type_id, stay_date, channel };
      if (!row || row.stop_sell === null || row.stop_sell === undefined) {
        changes.push({ ...base, stop_sell: true, set_by_rule_id: ruleIds[0], kind: "close", rule: ruleIds[0] });
      } else if (row.set_by_rule_id && !ruleIds.includes(row.set_by_rule_id)) {
        changes.push({ ...base, stop_sell: true, set_by_rule_id: ruleIds[0], kind: "handover", rule: ruleIds[0] });
      }
      // Anything else is already closed by a wanting rule, or a person's.
    }
    for (const row of owned) {
      const key = `${cellKey(row.rate_plan_id, row.room_type_id, row.stay_date)}|${row.channel}`;
      if (wanted.has(key)) continue;
      changes.push({
        rate_plan_id: row.rate_plan_id,
        room_type_id: row.room_type_id,
        stay_date: row.stay_date,
        channel: row.channel,
        stop_sell: null,
        set_by_rule_id: null,
        kind: "reopen",
        rule: row.set_by_rule_id,
      });
    }

    if (changes.length === 0) return none;

    // Saved before it is sent, so what the channels should show is on record
    // even when the send fails; the next check or a publish sends it again.
    await saveChannelRestrictions(propertyId, changes);

    // A plan unmapped since a rule closed it can only be reopened here; a
    // push naming it would be refused, and take the other changes with it.
    const sent = changes.filter(
      (c) => c.kind !== "handover" && (!sellable || sellable.has(`${c.rate_plan_id}|${c.room_type_id}`))
    );
    const push = await sendChanges(propertyId, sent, ratePlans, assignments);

    const closed = sent.filter((c) => c.kind === "close");
    const reopened = sent.filter((c) => c.kind === "reopen");
    await logByRule(propertyId, rules, grid, closed, reopened, push);

    const parts = [];
    if (closed.length) parts.push(`closed ${closed.length}`);
    if (reopened.length) parts.push(`reopened ${reopened.length}`);
    const what = parts.length ? `Workflow rules ${parts.join(" and ")} channel night${sent.length === 1 ? "" : "s"}.` : "";
    return {
      status: push.ok ? "applied" : "failed",
      closed: closed.length,
      reopened: reopened.length,
      message: push.ok ? what : `${what} Sending them failed: ${push.error}`.trim(),
    };
  } catch (err) {
    console.error("Workflow rules failed", err);
    await recordSyncLog({
      property_id: propertyId,
      kind: "workflow",
      status: "failed",
      source: "local",
      user_email: "Workflow",
      date_from: start,
      date_to: end,
      summary: "Workflow rules could not run",
      error: err.message,
    });
    return { status: "failed", closed: 0, reopened: 0, message: err.message };
  }
}

/**
 * Send changed cells, one push per channel. A restriction push carries the
 * whole restriction, so min/max nights go with it as the grid would send
 * them, and a reopened channel is sent the all-channels stop sell.
 */
async function sendChanges(propertyId, changes, ratePlans, assignments) {
  if (changes.length === 0) return { ok: true };

  const dates = changes.map((c) => c.stay_date).sort();
  const daily = await listDailyRestrictions(propertyId, dates[0], dates[dates.length - 1]);
  const dailyFor = {};
  for (const row of daily) dailyFor[cellKey(row.rate_plan_id, row.room_type_id || "", row.stay_date)] = row;

  const planById = Object.fromEntries(ratePlans.map((p) => [p.id, p]));
  const assignmentFor = {};
  for (const a of assignments) assignmentFor[`${a.rate_plan_id}|${a.room_type_id}`] = a;

  const byChannel = {};
  for (const c of changes) {
    const plan = planById[c.rate_plan_id] || {};
    const own = assignmentFor[`${c.rate_plan_id}|${c.room_type_id}`] || {};
    const day = dailyFor[cellKey(c.rate_plan_id, c.room_type_id, c.stay_date)] || {};
    const allChannels = Boolean(day.stop_sell ?? own.stop_sell ?? plan.stop_sell);
    (byChannel[c.channel] ||= []).push({
      date: c.stay_date,
      roomCode: c.room_type_id,
      rateplanCode: c.rate_plan_id,
      restrictions: {
        stopSell: c.stop_sell === null ? allChannels : true,
        minimumStay: day.min_stay ?? own.min_stay ?? plan.min_stay ?? null,
        maximumStay: day.max_stay ?? own.max_stay ?? plan.max_stay ?? null,
        closeOnArrival: false,
        closeOnDeparture: false,
        minimumStayArrival: null,
        maximumStayArrival: null,
        exactStayArrival: null,
        minimumAdvanceReservation: null,
        maximumAdvanceReservation: null,
      },
    });
  }

  const errors = [];
  for (const [channel, entries] of Object.entries(byChannel)) {
    const { status, body } = await pushToChannelManager({
      actor: "Workflow",
      kind: "restrictions",
      updates: toUpdates(entries),
      propertyId,
      toChannels: [channel],
    });
    if (status !== 200) errors.push(`${channelLabel(channel)}: ${body?.error || "not accepted"}`);
  }
  return errors.length ? { ok: false, error: errors.join("; ") } : { ok: true };
}

/** One activity-log row per rule that changed something. */
async function logByRule(propertyId, rules, grid, closed, reopened, push) {
  const ruleById = Object.fromEntries(rules.map((r) => [r.id, r]));
  const roomName = Object.fromEntries(grid.roomTypes.map((rt) => [rt.id, rt.name]));
  const ids = new Set([...closed, ...reopened].map((c) => c.rule).filter(Boolean));

  for (const id of ids) {
    const rule = ruleById[id];
    const mine = (list) => list.filter((c) => c.rule === id);
    const c = mine(closed);
    const o = mine(reopened);
    const dates = [...c, ...o].map((x) => x.stay_date).sort();
    const nights = (list) => new Set(list.map((x) => x.stay_date)).size;
    const channels = (list) => [...new Set(list.map((x) => channelLabel(x.channel)))].join(", ");
    const parts = [];
    if (c.length) parts.push(`closed ${channels(c)} on ${nights(c)} night${nights(c) === 1 ? "" : "s"}`);
    if (o.length) parts.push(`reopened ${channels(o)} on ${nights(o)} night${nights(o) === 1 ? "" : "s"}`);

    await recordSyncLog({
      property_id: propertyId,
      kind: "workflow",
      status: push.ok ? "success" : "failed",
      source: "local",
      user_email: "Workflow",
      date_from: dates[0],
      date_to: dates[dates.length - 1],
      entry_count: c.length + o.length,
      summary: `${rule?.name || "Deleted rule"}: ${parts.join("; ")}`,
      error: push.ok ? null : push.error,
      request: {
        rule_id: id,
        rule: rule ? describeRule(rule, rule.room_type_id ? roomName[rule.room_type_id] : undefined) : null,
        closed: c.map(({ rate_plan_id, room_type_id, stay_date, channel }) => ({ rate_plan_id, room_type_id, stay_date, channel })),
        reopened: o.map(({ rate_plan_id, room_type_id, stay_date, channel }) => ({ rate_plan_id, room_type_id, stay_date, channel })),
      },
    });
  }
}
