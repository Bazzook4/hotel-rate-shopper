"use client";


import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import DateToolbar, { ToolbarField } from "./DateToolbar";
import EventMarker, { useEventsByDate } from "./EventMarker";
import { gridOwnRateAt, roomRateResolver } from "@/lib/ratePlanPricing";
import { CHANNEL_LABELS } from "@/lib/channels";
import { usePageState } from "./usePageState";



// Each OTA's own brand colour, so these stay fixed rather than following
// the theme palette.

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function buildDates(start, days) {
  const out = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    out.push(isoDate(d));
  }
  return out;
}

/**
 * Combine two stay limits where null means "no limit set".
 *
 * A null side loses to a set value, so merging an unrestricted plan with a
 * restricted one keeps the restriction rather than discarding it.
 */
function maxOf(a, b) {
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a;
  return Math.max(a, b);
}

/**
 * Whether a plan's name already carries its meal-plan code, as "CP" or
 * "CP Breakfast" does. Such a plan needs no separate code chip beside it.
 */
function planNameSays(plan) {
  if (!plan.name || !plan.label) return !plan.label;
  const escaped = plan.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\W)${escaped}(\\W|$)`, "i").test(plan.name);
}

/** What the grid can show across the dates, for every plan at once. */
const VIEWS = [
  { id: "rates", label: "Rates" },
  { id: "min_stay", label: "Min nights" },
  { id: "max_stay", label: "Max nights" },
  { id: "stop_sell", label: "Stop sell" },
];

function minOf(a, b) {
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a;
  return Math.min(a, b);
}

/**
 * Group rate rows into one update per date, in the shape the push route
 * translates.
 *
 * The room comes from the row itself rather than from the plan, so a rate
 * priced in one room is never sent against another.
 */
function ratesToUpdates(rows) {
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
 * Restriction pushes for a set of cells, grouped by the channels each goes to.
 *
 * Aiosell takes restrictions per rate plan in a room (its rate restriction
 * push) and names the channels they apply to, so closing one plan leaves the
 * room's other plans selling. A cell's all-channels values go to every
 * channel, except that a channel with its own stop sell is sent that stop
 * sell instead, in a push of its own -- sending it the all-channels value
 * too would undo its closure.
 *
 * A field with nothing stored for the date follows the room rate's own
 * setting from Rate Plan Setup, as the grid shows it, so a min-nights edit
 * never reopens a plan that was closed there.
 *
 * cells: [{ rate_plan_id, room_type_id, stay_date, stop_sell, min_stay,
 * max_stay, channels: { <slug>: true | false } }]; channels: the slugs of
 * every connected channel. Returns [{ toChannels, updates }], toChannels
 * null when no channel list is known and the server is to name them all.
 */
function restrictionPushes(cells, rooms, channels) {
  const setup = {};
  for (const room of rooms || []) {
    for (const plan of room.plans || []) {
      setup[`${plan.id}|${room.id}`] = plan.restrictions || {};
    }
  }

  const buckets = new Map();
  const add = (toChannels, cell, stopSell, minStay, maxStay) => {
    const key = toChannels ? toChannels.join(",") : "*";
    if (!buckets.has(key)) buckets.set(key, { toChannels, byDate: {} });
    (buckets.get(key).byDate[cell.stay_date] ||= []).push({
      roomCode: cell.room_type_id,
      rateplanCode: cell.rate_plan_id,
      restrictions: {
        stopSell,
        minimumStay: minStay,
        maximumStay: maxStay,
        closeOnArrival: false,
        closeOnDeparture: false,
        minimumStayArrival: null,
        maximumStayArrival: null,
        exactStayArrival: null,
        minimumAdvanceReservation: null,
        maximumAdvanceReservation: null,
      },
    });
  };

  for (const cell of cells) {
    if (!cell.room_type_id) continue;
    const own = setup[`${cell.rate_plan_id}|${cell.room_type_id}`] || {};
    const stopSell = Boolean(cell.stop_sell ?? own.stopSell);
    const minStay = cell.min_stay ?? own.minStay ?? null;
    const maxStay = cell.max_stay ?? own.maxStay ?? null;
    const overrides = cell.channels || {};

    if (!channels.length) {
      if (Object.keys(overrides).length) {
        throw new Error(
          "The connected channels have not loaded, so a channel's own stop sell cannot be sent. Reload and publish again."
        );
      }
      add(null, cell, stopSell, minStay, maxStay);
      continue;
    }

    const closed = [];
    const open = [];
    for (const c of channels) ((overrides[c] ?? stopSell) ? closed : open).push(c);
    if (closed.length) add(closed, cell, true, minStay, maxStay);
    if (open.length) add(open, cell, false, minStay, maxStay);
  }

  return [...buckets.values()].map(({ toChannels, byDate }) => ({
    toChannels,
    updates: Object.entries(byDate).map(([date, rates]) => ({
      startDate: date,
      endDate: date,
      rates,
    })),
  }));
}

/**
 * The restriction cells to push for a set of keys "<plan>|<room>|<date>":
 * the stored row with any edit patched over it, and each channel's own stop
 * sell, edits winning and a null edit clearing the stored one.
 */
function restrictionCells(keys, { stored, edits, storedChannels, channelEdits }) {
  return [...new Set(keys)].map((key) => {
    const [rate_plan_id, room_type_id, stay_date] = key.split("|");
    const base = stored[key] || {};
    const patch = edits[key] || {};
    const channels = { ...(storedChannels[key] || {}) };
    for (const [c, v] of Object.entries(channelEdits[key] || {})) {
      if (v === null) delete channels[c];
      else channels[c] = v;
    }
    return {
      rate_plan_id,
      room_type_id,
      stay_date,
      stop_sell: "stop_sell" in patch ? patch.stop_sell : base.stopSell ?? null,
      min_stay: "min_stay" in patch ? patch.min_stay : base.minStay ?? null,
      max_stay: "max_stay" in patch ? patch.max_stay : base.maxStay ?? null,
      channels,
    };
  });
}

/** Send restriction cells, one push per channel group. */
async function sendRestrictions(cells, rooms, channels, propertyId) {
  let last = null;
  for (const { toChannels, updates } of restrictionPushes(cells, rooms, channels)) {
    if (!updates.length) continue;
    const res = await fetch("/api/cm/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "restrictions",
        updates,
        toChannels: toChannels || undefined,
        propertyId: propertyId || undefined,
      }),
    });
    last = await res.json();
    if (!res.ok) throw new Error(last?.error || "Restriction push failed");
  }
  return last;
}

/**
 * Prices any cell on any date the way the server does, over the grid's own
 * per-date values: an unsaved edit, else the stored rate, else the room
 * rate's standing rate. A derived room rate follows its source on the same
 * date, so typing a master's Friday moves every plan derived from it on
 * Friday before anything is saved. Null for a grid from before the server
 * sent its pricing setup.
 */
function cellPricer(grid, edits) {
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
 * Worked-out cells whose rate the edits change, as rows to push.
 *
 * A derived rate is never typed or stored -- it is worked out from its source
 * -- and neither is a rate beyond base adults that nobody typed, which is the
 * base rate plus the extra-adult charge. The channel only knows what it is
 * sent, so when a typed rate changes, every rate worked out from it on that
 * date goes out with it.
 */
function derivedRowsFor(grid, edits) {
  const after = cellPricer(grid, edits);
  const before = cellPricer(grid, {});
  if (!after) return [];
  const dates = new Set(Object.keys(edits).map((k) => k.split("|")[3]));
  const out = [];
  for (const room of grid.rooms || []) {
    for (const plan of room.plans || []) {
      for (const occ of plan.occupancies || []) {
        for (const stay_date of dates) {
          // A typed cell is already a row of its own.
          if (`${plan.id}|${room.id}|${occ.occupancy}|${stay_date}` in edits) continue;
          const rate = after.rate(plan.id, room.id, occ.occupancy, stay_date);
          if (rate === null) continue;
          if (rate === before.rate(plan.id, room.id, occ.occupancy, stay_date)) continue;
          out.push({
            rate_plan_id: plan.id,
            room_type_id: room.id,
            occupancy: occ.occupancy,
            stay_date,
            rate: Math.round(rate * 100) / 100,
          });
        }
      }
    }
  }
  return out;
}

/** Weekdays in the order a hotelier reads them, as getUTCDay numbers. */
const WEEKDAYS = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [0, "Sun"],
];

/** Every date from `from` to `to` that falls on one of `weekdays`. */
function rangeDates(from, to, weekdays) {
  const out = [];
  for (
    let d = new Date(`${from}T00:00:00Z`);
    isoDate(d) <= to && out.length < 400;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    if (weekdays.includes(d.getUTCDay())) out.push(isoDate(d));
  }
  return out;
}

/** The longest range a bulk update covers, so one slip cannot fill years. */
const BULK_MAX_DAYS = 366;

/**
 * The edits a bulk update makes, in the same shape as typing them into the
 * grid: rate edits keyed "<plan>|<room>|<adults>|<date>" and restriction
 * patches keyed "<plan>|<room>|<date>".
 *
 * Only cells that can be typed are filled. A derived room rate, or an adult
 * count worked out from the single, follows its source on each date, so
 * setting the source is what moves it -- exactly as in the grid. A blank
 * value means "leave as it is".
 *
 * With channels picked, stop sell is filled for those channels alone, keyed
 * like a restriction with { <slug>: true | false | null } -- null putting the
 * channel back on the all-channels value. Nights always apply to every
 * channel.
 */
function bulkFill(rooms, b) {
  const out = { rates: {}, restrictions: {}, channelStops: {} };
  const dates = rangeDates(b.from, b.to, b.weekdays);
  const perChannel = b.channels.length > 0 && b.stopSell !== "";
  const restriction = {};
  if (b.minStay !== "") restriction.min_stay = Number(b.minStay);
  if (b.maxStay !== "") restriction.max_stay = Number(b.maxStay);
  if (b.stopSell !== "" && !perChannel) restriction.stop_sell = b.stopSell === "close";
  const restricts = Object.keys(restriction).length > 0;
  const channelStop = perChannel
    ? Object.fromEntries(
        b.channels.map((c) => [c, b.stopSell === "follow" ? null : b.stopSell === "close"])
      )
    : null;

  for (const room of rooms || []) {
    if (b.rooms.length && !b.rooms.includes(room.id)) continue;
    for (const plan of room.plans || []) {
      if (b.plans.length && !b.plans.includes(plan.id)) continue;
      for (const date of dates) {
        if (restricts) out.restrictions[`${plan.id}|${room.id}|${date}`] = restriction;
        if (channelStop) out.channelStops[`${plan.id}|${room.id}|${date}`] = channelStop;
        if (plan.derived) continue;
        for (const occ of plan.occupancies || []) {
          if (occ.fromSingle) continue;
          const v = b.rates[occ.occupancy];
          if (v === undefined || v === "") continue;
          out.rates[`${plan.id}|${room.id}|${occ.occupancy}|${date}`] = String(v);
        }
      }
    }
  }
  return out;
}

function emptyBulk(from, to) {
  return {
    from,
    to,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    rooms: [],
    plans: [],
    rates: {},
    minStay: "",
    maxStay: "",
    stopSell: "",
    // Channel slugs the stop sell is for; empty means every channel.
    channels: [],
  };
}

function formatDay(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return {
    dow: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toUpperCase(),
    day: d.getUTCDate(),
    mon: d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase(),
    weekend: [5, 6].includes(d.getUTCDay()),
  };
}

// How long the grid load may take before the page gives up and offers a
// retry, rather than spinning for as long as the request stays open.
const GRID_TIMEOUT_MS = 30000;

export default function ChannelManager({ session }) {
  // The property chosen in the header. Every call names it, since the server
  // otherwise falls back to the property the login was issued for -- which
  // left a super admin's switch with no effect here. The page is remounted
  // on a switch (see page.js), so no edit carries over to another hotel.
  const propertyId = session?.propertyId || "";
  const scope = propertyId ? `propertyId=${encodeURIComponent(propertyId)}` : "";
  const [property, setProperty] = useState(null);
  const [grid, setGrid] = useState(null);
  const [source, setSource] = useState(null);
  const [error, setError] = useState("");
  // Two weeks or a month, the same windows as the tape chart.
  const [days, setDays] = usePageState("rates.days", 14);
  const [anchor, setAnchor] = usePageState("rates.anchor", () => isoDate(new Date()));
  const [expanded, setExpanded] = useState({});
  const [filter, setFilter] = usePageState("rates.filter", "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  // Bumped when a multiplier update is rejected, to remount the input so it
  // snaps back to the value actually live on the channel.
  const [revert, setRevert] = useState(0);
  // Rate plans whose channel breakdown is open, keyed by "<planId>|<roomId>".
  const [openChannels, setOpenChannels] = useState({});
  // Edited rates, keyed "<rateplanId>|<date>". Unedited cells fall back to
  // the stored value, so only changes are held here.
  const [rates, setRates] = useState({});
  // Edited restrictions, keyed "<rateplanId>|<date>". Each value is a partial
  // patch -- only the fields actually touched -- merged over the stored row
  // when rendering and when saving.
  const [restrictions, setRestrictions] = useState({});
  // Edited stop sell for single channels, keyed "<plan>|<room>|<date>" then
  // by channel slug: true closed, false open, null back to all channels.
  const [channelStops, setChannelStops] = useState({});
  // Which metric the grid is showing -- rates, min or max nights, or stop
  // sell -- for every rate plan at once. It was once chosen per plan, but a
  // desk setting min nights sets them across the plans, and a grid mixing
  // rates in one row with nights in the next read as one set of numbers.
  // Swapping the cells in place keeps one line per rate plan.
  const [view, setView] = usePageState("rates.view", "rates");
  // Resync: resend what is already stored, without editing anything. Open
  // state, the range it covers, what to send, and which rooms/plans to
  // include. An empty room or plan set means every one of them.
  const [resyncOpen, setResyncOpen] = useState(false);
  const [resyncFrom, setResyncFrom] = useState(() => isoDate(new Date()));
  const [resyncTo, setResyncTo] = useState(() => isoDate(new Date()));
  const [resyncWhat, setResyncWhat] = useState({
    rates: true,
    restrictions: true,
    availability: true,
  });
  const [resyncRooms, setResyncRooms] = useState([]);
  const [resyncPlans, setResyncPlans] = useState([]);
  const [resyncBusy, setResyncBusy] = useState(false);
  // Bulk update: set a rate or restriction across a range of dates at once.
  // It fills the same edits as typing into the cells, so nothing leaves
  // until Publish.
  const [bulkOpen, setBulkOpen] = useState(false);
  // Set by "Apply & publish": publish once the filled edits are in state.
  const [publishAfterFill, setPublishAfterFill] = useState(false);
  const [bulk, setBulk] = useState(() => emptyBulk(isoDate(new Date()), isoDate(new Date())));
  const [bulkBusy, setBulkBusy] = useState(false);
  // Stored rates and restrictions for bulk-edited dates outside the window
  // on screen. Publish merges a restriction patch over what is stored, and
  // prices derived rates from stored ones, so it needs these for dates the
  // grid has not loaded -- without them a min-nights change off screen would
  // clear that date's stop sell.
  const [rangeStored, setRangeStored] = useState({
    dailyRates: {},
    dailyRestrictions: {},
    channelStopSell: {},
  });

  const dirtyRates = Object.keys(rates).length;
  // Re-priced on every keystroke, so derived rows follow the master live.
  const pricer = useMemo(() => cellPricer(grid, rates), [grid, rates]);
  const dirtyRestrictions = new Set([
    ...Object.keys(restrictions),
    ...Object.keys(channelStops),
  ]).size;
  const dirty = dirtyRates + dirtyRestrictions;

  const dates = useMemo(
    () => buildDates(new Date(`${anchor}T00:00:00Z`), days),
    [anchor, days]
  );
  const eventsByDate = useEventsByDate(propertyId, dates[0], dates[dates.length - 1]);

  // How many loads are in flight. The property and the grid load separately,
  // so one finishing must not clear the spinner while the other is still out.
  const [inFlight, setInFlight] = useState(0);
  const loading = inFlight > 0;
  // Whether the grid has arrived at least once; until then the page shows a
  // spinner, and afterwards it never goes back to one.
  const [gridLoaded, setGridLoaded] = useState(false);

  const track = useCallback(async (task) => {
    setInFlight((n) => n + 1);
    setError("");
    try {
      await task();
    } catch (err) {
      setError(err.message);
    } finally {
      setInFlight((n) => n - 1);
    }
  }, []);

  /**
   * The connected channels and their multipliers.
   *
   * Loaded once rather than with the grid: it is a live call to Aiosell, so
   * repeating it on every date change and every publish made each of those
   * wait on the partner's API for an answer that had not changed.
   */
  const loadProperty = useCallback(
    () =>
      track(async () => {
        const chRes = await fetch(`/api/cm/property${scope ? `?${scope}` : ""}`);
        const json = await chRes.json();
        if (!chRes.ok) throw new Error(json?.error || `Request failed (${chRes.status})`);
        setProperty(json.property);
        setSource(json.source);
      }),
    [scope, track]
  );

  /** The grid for the dates on screen, from this property's own setup. */
  const load = useCallback(
    () =>
      track(async () => {
        let gridRes;
        try {
          gridRes = await fetch(
            `/api/cm/grid?start=${dates[0]}&end=${dates[dates.length - 1]}${scope ? `&${scope}` : ""}`,
            { signal: AbortSignal.timeout(GRID_TIMEOUT_MS) }
          );
        } catch (err) {
          if (err.name === "TimeoutError") {
            throw new Error("The rate grid took too long to load. Try again.");
          }
          throw err;
        }
        const gridJson = gridRes.ok ? await gridRes.json() : null;
        setGrid(gridJson);
        setGridLoaded(true);
        // New rooms open expanded; rooms already on screen keep whatever the
        // user left them as, rather than all springing open after a publish.
        setExpanded((prev) => {
          const next = { ...prev };
          for (const r of gridJson?.rooms || []) if (!(r.id in next)) next[r.id] = true;
          return next;
        });
      }),
    [dates, scope, track]
  );

  useEffect(() => {
    loadProperty();
  }, [loadProperty]);

  useEffect(() => {
    load();
  }, [load]);

  // Channels that carry rates. The multiplier applies to one of these across
  // the whole property, so each rate plan row shows the same set.
  const rateChannels = useMemo(() => {
    const seen = new Map();
    for (const c of property?.connected_channels || []) {
      if (c.operation === "rates" && !seen.has(c.partner_id)) {
        seen.set(c.partner_id, c);
      }
    }
    return [...seen.values()];
  }, [property]);

  const rooms = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = grid?.rooms || [];
    if (!q) return list;
    return list
      .map((r) => {
        if (r.name.toLowerCase().includes(q)) return r;
        const plans = r.plans.filter((p) =>
          `${p.name} ${p.label}`.toLowerCase().includes(q)
        );
        return plans.length ? { ...r, plans } : null;
      })
      .filter(Boolean);
  }, [grid, filter]);


  // Roughly how many rate rows a resync would send: every mapped
  // room/plan/occupancy across the range, since dates without a stored row
  // now fall back to the rack rate. Shown before sending so the size of the
  // push is never a surprise.
  const resyncEstimate = useMemo(() => {
    if (!resyncOpen || !resyncWhat.rates) return 0;
    let days = 0;
    for (
      let d = new Date(`${resyncFrom}T00:00:00Z`);
      isoDate(d) <= resyncTo && days < 400;
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      days += 1;
    }
    let cells = 0;
    for (const room of grid?.rooms || []) {
      if (resyncRooms.length && !resyncRooms.includes(room.id)) continue;
      for (const plan of room.plans || []) {
        if (resyncPlans.length && !resyncPlans.includes(plan.id)) continue;
        cells += (plan.occupancies || []).length;
      }
    }
    return days * cells;
  }, [
    resyncOpen,
    resyncWhat.rates,
    resyncFrom,
    resyncTo,
    grid,
    resyncRooms,
    resyncPlans,
  ]);

  // Every distinct rate plan across the rooms, for the resync picker. A plan
  // sold on several rooms is listed once.
  const allPlans = useMemo(() => {
    const seen = new Map();
    for (const room of grid?.rooms || []) {
      for (const p of room.plans || []) {
        if (!seen.has(p.id)) seen.set(p.id, { id: p.id, label: p.label || p.name });
      }
    }
    return [...seen.values()];
  }, [grid]);

  // The loaded grid with the stored rows fetched for a bulk update merged
  // underneath, the window's own (fresher) rows winning.
  const fullGrid = useMemo(
    () =>
      grid && {
        ...grid,
        dailyRates: { ...rangeStored.dailyRates, ...(grid.dailyRates || {}) },
        dailyRestrictions: {
          ...rangeStored.dailyRestrictions,
          ...(grid.dailyRestrictions || {}),
        },
        channelStopSell: {
          ...rangeStored.channelStopSell,
          ...(grid.channelStopSell || {}),
        },
      },
    [grid, rangeStored]
  );

  // Each cell's channel-only stop sell as it will stand after Publish: what
  // is stored, with edits over it and a null edit removing the override.
  const channelStopView = useMemo(() => {
    const out = { ...(grid?.channelStopSell || {}) };
    for (const [key, byChannel] of Object.entries(channelStops)) {
      const next = { ...(out[key] || {}) };
      for (const [c, v] of Object.entries(byChannel)) {
        if (v === null) delete next[c];
        else next[c] = v;
      }
      out[key] = next;
    }
    return out;
  }, [grid, channelStops]);

  // The adult counts that can be typed for the rooms and plans picked, so
  // the bulk panel asks only for rates it will actually use.
  const bulkOccupancies = useMemo(() => {
    const seen = new Set();
    for (const room of grid?.rooms || []) {
      if (bulk.rooms.length && !bulk.rooms.includes(room.id)) continue;
      for (const plan of room.plans || []) {
        if (plan.derived) continue;
        if (bulk.plans.length && !bulk.plans.includes(plan.id)) continue;
        for (const occ of plan.occupancies || []) {
          if (!occ.fromSingle) seen.add(occ.occupancy);
        }
      }
    }
    return [...seen].sort((a, b) => a - b);
  }, [grid, bulk.rooms, bulk.plans]);

  // What the bulk update would fill, shown before it is applied.
  const bulkPreview = useMemo(() => {
    if (!bulkOpen || bulk.from > bulk.to) return null;
    const fill = bulkFill(grid?.rooms, {
      ...bulk,
      rates: Object.fromEntries(
        Object.entries(bulk.rates).filter(([occ]) => bulkOccupancies.includes(Number(occ)))
      ),
    });
    return {
      fill,
      rates: Object.keys(fill.rates).length,
      restrictions: new Set([
        ...Object.keys(fill.restrictions),
        ...Object.keys(fill.channelStops),
      ]).size,
    };
  }, [bulkOpen, bulk, grid, bulkOccupancies]);

  /**
   * Set a channel's markup.
   *
   * Aiosell holds one multiplier per channel for the whole property, so this
   * is edited from a rate plan row for convenience but applies to every plan.
   * The rows say as much, rather than implying a per-plan setting.
   */
  async function applyMultiplier(channel, value) {
    const multiplier = Number(value);
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      setNotice("A multiplier must be a number above zero.");
      setRevert((n) => n + 1);
      return;
    }

    setBusy(true);
    setNotice("");
    try {
      const res = await fetch("/api/cm/multiplier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ multiplier, channels: [channel], propertyId: propertyId || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not set the multiplier");

      // Reflect it locally rather than reloading the whole grid.
      setProperty((prev) =>
        prev
          ? {
              ...prev,
              connected_channels: (prev.connected_channels || []).map((c) =>
                c.operation === "rates" && c.partner_id === channel
                  ? { ...c, rate_multiplier: multiplier }
                  : c
              ),
            }
          : prev
      );
      setNotice(
        json.message ||
          `${CHANNEL_LABELS[channel] || channel} set to ${multiplier}x on every rate plan.`
      );
    } catch (err) {
      // Snap the input back to what is actually live on the channel.
      setRevert((n) => n + 1);
      setNotice(`${CHANNEL_LABELS[channel] || channel}: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Publish: store the edits, then send them on to the channel manager.
   *
   * Saving first means a failed push still leaves the work recorded, so a
   * connection problem never costs the edits.
   */
  async function publish() {
    if (!grid?.rooms?.length) return;

    // Derived cells cannot be typed into, so every edit is a manual rate.
    const rows = Object.entries(rates).map(([key, value]) => {
      const [rate_plan_id, room_type_id, occupancy, stay_date] = key.split("|");
      return {
        rate_plan_id,
        room_type_id,
        occupancy: Number(occupancy),
        stay_date,
        rate: value,
      };
    });

    // A restriction patch holds only the fields touched, so it is merged over
    // whatever is already stored for that date before being sent.
    const storedRestrictions = fullGrid?.dailyRestrictions || {};
    const restrictionRows = Object.entries(restrictions).map(([key, patch]) => {
      const [rate_plan_id, room_type_id, stay_date] = key.split("|");
      const base = storedRestrictions[key] || {};
      const merged = {
        stop_sell: base.stopSell ?? null,
        min_stay: base.minStay ?? null,
        max_stay: base.maxStay ?? null,
        ...patch,
      };
      return { rate_plan_id, room_type_id, stay_date, ...merged };
    });

    // Stop sell on single channels, one row per channel edited.
    const channelRows = Object.entries(channelStops).flatMap(([key, byChannel]) => {
      const [rate_plan_id, room_type_id, stay_date] = key.split("|");
      return Object.entries(byChannel).map(([channel, stop_sell]) => ({
        rate_plan_id,
        room_type_id,
        stay_date,
        channel,
        stop_sell,
      }));
    });

    // What goes to the channels: every cell touched, with its channels' own
    // stop sell, worked out before the reload replaces what is stored.
    const cells = restrictionCells(
      [...Object.keys(restrictions), ...Object.keys(channelStops)],
      {
        stored: storedRestrictions,
        edits: restrictions,
        storedChannels: fullGrid?.channelStopSell || {},
        channelEdits: channelStops,
      }
    );

    if (rows.length === 0 && restrictionRows.length === 0 && channelRows.length === 0) {
      setNotice("No changes to publish.");
      return;
    }

    setBusy(true);
    setNotice("");

    try {
      if (rows.length > 0) {
        const saveRes = await fetch("/api/cm/rates", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rates: rows, propertyId: propertyId || undefined }),
        });
        const saveJson = await saveRes.json();
        if (!saveRes.ok) throw new Error(saveJson?.error || "Could not save rates");
      }

      if (restrictionRows.length > 0 || channelRows.length > 0) {
        const res = await fetch("/api/cm/restrictions", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            restrictions: restrictionRows,
            channelRestrictions: channelRows,
            propertyId: propertyId || undefined,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Could not save restrictions");
      }

      // Saved, so the edits are safe from here on.
      setRates({});
      setRestrictions({});
      setChannelStops({});

      // What the edits moved in plans derived from them goes out too, since
      // those rates are worked out here and the channel has no other way to
      // learn them. Computed before the reload replaces the stored rates.
      const derivedRows = derivedRowsFor(fullGrid, rates);
      setRangeStored({ dailyRates: {}, dailyRestrictions: {}, channelStopSell: {} });
      const updates = ratesToUpdates([...rows, ...derivedRows]);

      let pushJson = null;
      if (updates.length > 0) {
        const pushRes = await fetch("/api/cm/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "rates", updates, propertyId: propertyId || undefined }),
        });
        pushJson = await pushRes.json();

        if (!pushRes.ok) {
          // The rates are stored; only the send failed.
          await load();
          throw new Error(
            `${pushJson?.error || "Push failed"} Your changes are saved and can be published again.`
          );
        }
      }

      let restrictionJson = null;
      if (cells.length > 0) {
        try {
          restrictionJson = await sendRestrictions(
            cells,
            fullGrid?.rooms,
            rateChannels.map((c) => c.partner_id),
            propertyId
          );
        } catch (err) {
          await load();
          throw new Error(
            `${err.message} Your changes are saved and can be published again.`
          );
        }
      }

      await load();
      const parts = [];
      if (rows.length > 0) {
        parts.push(`${rows.length} rate${rows.length === 1 ? "" : "s"}`);
      }
      if (derivedRows.length > 0) {
        parts.push(`${derivedRows.length} rate${derivedRows.length === 1 ? "" : "s"} worked out from them`);
      }
      if (cells.length > 0) {
        parts.push(`${cells.length} restriction${cells.length === 1 ? "" : "s"}`);
      }
      setNotice(
        pushJson?.message ||
          restrictionJson?.message ||
          `Published ${parts.join(" and ")}.`
      );
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Fill the grid's edits from the bulk panel. Nothing is saved or sent:
   * the edits wait for Publish like typed ones, so derived rates and the
   * per-room restriction merge go out exactly as they would from the cells.
   */
  useEffect(() => {
    if (!publishAfterFill) return;
    setPublishAfterFill(false);
    publish();
    // publish is redefined each render; this runs on the render after the fill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishAfterFill]);

  async function applyBulk({ andPublish = false } = {}) {
    if (bulk.from > bulk.to) {
      setNotice("The start date is after the end date.");
      return;
    }
    const span =
      (new Date(`${bulk.to}T00:00:00Z`) - new Date(`${bulk.from}T00:00:00Z`)) / 86400000 + 1;
    if (span > BULK_MAX_DAYS) {
      setNotice(`A bulk update covers at most ${BULK_MAX_DAYS} days.`);
      return;
    }
    const rateValues = bulkOccupancies.map((o) => bulk.rates[o]).filter((v) => v !== undefined && v !== "");
    if (rateValues.some((v) => !(Number(v) > 0))) {
      setNotice("A rate must be a number above zero.");
      return;
    }
    for (const [field, label] of [["minStay", "Min nights"], ["maxStay", "Max nights"]]) {
      const v = bulk[field];
      if (v !== "" && !(Number.isInteger(Number(v)) && Number(v) >= 1)) {
        setNotice(`${label} must be a whole number of at least 1.`);
        return;
      }
    }
    if (bulk.minStay !== "" && bulk.maxStay !== "" && Number(bulk.minStay) > Number(bulk.maxStay)) {
      setNotice("Min nights is more than max nights.");
      return;
    }
    if (!bulkPreview || bulkPreview.rates + bulkPreview.restrictions === 0) {
      setNotice("Nothing to fill: enter a rate or restriction, and check the days, rooms and plans.");
      return;
    }

    setBulkBusy(true);
    setNotice("");
    try {
      // The range can reach past the window on screen, so what is stored
      // there is fetched for Publish to merge over.
      const res = await fetch(
        `/api/cm/grid?start=${bulk.from}&end=${bulk.to}${scope ? `&${scope}` : ""}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not read stored rates");
      setRangeStored((prev) => ({
        dailyRates: { ...prev.dailyRates, ...(json.dailyRates || {}) },
        dailyRestrictions: { ...prev.dailyRestrictions, ...(json.dailyRestrictions || {}) },
        channelStopSell: { ...prev.channelStopSell, ...(json.channelStopSell || {}) },
      }));

      const { fill } = bulkPreview;
      setRates((prev) => ({ ...prev, ...fill.rates }));
      setRestrictions((prev) => {
        const next = { ...prev };
        for (const [key, patch] of Object.entries(fill.restrictions)) {
          next[key] = { ...next[key], ...patch };
        }
        return next;
      });
      setChannelStops((prev) => {
        const next = { ...prev };
        for (const [key, patch] of Object.entries(fill.channelStops)) {
          next[key] = { ...next[key], ...patch };
        }
        return next;
      });

      // Show what was filled: jump to the range, and to the one metric set
      // if only one was.
      if (!dates.includes(bulk.from)) setAnchor(bulk.from);
      const set = [
        bulkPreview.rates > 0 && "rates",
        bulk.minStay !== "" && "min_stay",
        bulk.maxStay !== "" && "max_stay",
        bulk.stopSell !== "" && "stop_sell",
      ].filter(Boolean);
      if (set.length === 1) setView(set[0]);

      setBulkOpen(false);
      const parts = [];
      if (bulkPreview.rates) parts.push(`${bulkPreview.rates} rate${bulkPreview.rates === 1 ? "" : "s"}`);
      if (bulkPreview.restrictions) {
        parts.push(
          `${bulkPreview.restrictions} restriction${bulkPreview.restrictions === 1 ? "" : "s"}`
        );
      }
      if (andPublish) {
        // Publish reads the edits from state, so it waits for the render
        // that carries the fill (see the effect below).
        setPublishAfterFill(true);
      } else {
        setNotice(
          `Filled ${parts.join(" and ")} for ${bulk.from} → ${bulk.to}. Nothing is sent until you Publish.`
        );
      }
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBulkBusy(false);
    }
  }

  /**
   * Resend what is already stored for a date range, changing nothing.
   *
   * This is for when the channel manager and this system have drifted apart
   * -- a rejected push, or a mapping fixed after the fact -- so it reads the
   * stored rows back and sends them again exactly as Publish would.
   *
   * Rates are sent for every date in the range, not only the dates with a
   * stored row: a date never explicitly priced falls back to the plan's rack
   * rate for that room and adult count, which is what the grid shows for it.
   * Restrictions have no such fallback, so only stored ones are sent.
   */
  async function resync() {
    if (resyncFrom > resyncTo) {
      setNotice("The start date is after the end date.");
      return;
    }
    if (!resyncWhat.rates && !resyncWhat.restrictions && !resyncWhat.availability) {
      setNotice("Pick rates, restrictions or availability.");
      return;
    }

    setResyncBusy(true);
    setNotice("");

    try {
      // The range can reach outside the window on screen, so the rows are
      // fetched for it rather than read from the loaded grid.
      const res = await fetch(
        `/api/cm/grid?start=${resyncFrom}&end=${resyncTo}${scope ? `&${scope}` : ""}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not read stored rates");

      // Every date in the range, since a resync now sends a rate for dates
      // that have no stored row of their own.
      const resyncDates = [];
      for (
        let d = new Date(`${resyncFrom}T00:00:00Z`);
        isoDate(d) <= resyncTo;
        d.setUTCDate(d.getUTCDate() + 1)
      ) {
        resyncDates.push(isoDate(d));
      }

      // An empty selection means everything, so a resync with no boxes
      // ticked still does the obvious thing.
      const roomWanted = (id) =>
        resyncRooms.length === 0 || resyncRooms.includes(id);
      const planWanted = (id) =>
        resyncPlans.length === 0 || resyncPlans.includes(id);

      // Walk the grid itself rather than the stored rows, so a date that was
      // never explicitly priced still sends the rate the grid shows for it:
      // the plan's rack rate, resolved for that room and adult count. The
      // fallback order matches what a cell displays, so what goes out is
      // what is on screen.
      const rateRows = [];
      if (resyncWhat.rates) {
        const storedRates = json.dailyRates || {};
        // Stored values only -- a resync sends what is saved, not edits.
        const stored = cellPricer(json, {});
        for (const room of json.rooms || []) {
          if (!roomWanted(room.id)) continue;
          for (const plan of room.plans || []) {
            if (!planWanted(plan.id)) continue;
            for (const occ of plan.occupancies || []) {
              for (const stay_date of resyncDates) {
                const key = `${plan.id}|${room.id}|${occ.occupancy}|${stay_date}`;
                const rate = stored
                  ? stored.rate(plan.id, room.id, occ.occupancy, stay_date)
                  : storedRates[key]?.rate ?? occ.resolvedRate ?? plan.resolvedRate ?? null;
                // A plan with no rate anywhere in the chain has nothing to
                // send; pushing a null would blank it on the channel.
                if (rate === null || rate === undefined || rate === "") continue;
                rateRows.push({
                  rate_plan_id: plan.id,
                  room_type_id: room.id,
                  occupancy: occ.occupancy,
                  stay_date,
                  rate,
                });
              }
            }
          }
        }
      }

      // Stored restrictions only, with each channel's own stop sell.
      const restrictionRows = resyncWhat.restrictions
        ? restrictionCells(
            [
              ...Object.keys(json.dailyRestrictions || {}),
              ...Object.keys(json.channelStopSell || {}),
            ].filter((key) => {
              const [rate_plan_id, room_type_id] = key.split("|");
              return room_type_id && roomWanted(room_type_id) && planWanted(rate_plan_id);
            }),
            {
              stored: json.dailyRestrictions || {},
              edits: {},
              storedChannels: json.channelStopSell || {},
              channelEdits: {},
            }
          )
        : [];

      if (
        rateRows.length === 0 &&
        restrictionRows.length === 0 &&
        !resyncWhat.availability
      ) {
        setNotice("Nothing to resend for those dates and selection.");
        return;
      }

      const sent = [];

      // Availability is not read from this grid: the PMS works out what is
      // free for each night and sends that, so only the range and rooms go.
      if (resyncWhat.availability) {
        const invRes = await fetch("/api/cm/inventory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            start: resyncFrom,
            end: resyncTo,
            roomTypeIds: resyncRooms.length ? resyncRooms : null,
            propertyId: propertyId || undefined,
          }),
        });
        const invJson = await invRes.json();
        const inv = invJson?.inventory;
        if (!invRes.ok || inv?.status === "failed") {
          throw new Error(inv?.message || invJson?.error || "Availability resync failed");
        }
        if (inv?.status === "sent") sent.push("availability");
        else if (inv?.message) sent.push(`no availability (${inv.message})`);
      }

      if (rateRows.length > 0) {
        const updates = ratesToUpdates(rateRows);
        const pushRes = await fetch("/api/cm/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "rates", updates, propertyId: propertyId || undefined }),
        });
        const pushJson = await pushRes.json();
        if (!pushRes.ok) throw new Error(pushJson?.error || "Rate resync failed");
        sent.push(`${rateRows.length} rate${rateRows.length === 1 ? "" : "s"}`);
      }

      if (restrictionRows.length > 0) {
        await sendRestrictions(
          restrictionRows,
          json.rooms,
          rateChannels.map((c) => c.partner_id),
          propertyId
        );
        sent.push(
          `${restrictionRows.length} restriction${
            restrictionRows.length === 1 ? "" : "s"
          }`
        );
      }

      setResyncOpen(false);
      await load();
      setNotice(
        `Resent ${sent.join(" and ")} for ${resyncFrom} → ${resyncTo}. Nothing was changed.`
      );
    } catch (err) {
      setNotice(err.message);
    } finally {
      setResyncBusy(false);
    }
  }

  // Only the first load replaces the page with a spinner. After that a reload
  // -- a new date range, a publish -- leaves the grid up, dimmed, so the page
  // keeps its scroll and nothing appears to start over.
  if (!gridLoaded && !error) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center space-y-3">
          <div className="inline-block h-7 w-7 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" />
          <p className="sub">Loading channels…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-4">
        <p className="text-sm text-[var(--danger)]">{error}</p>
        <button
          type="button"
          onClick={() => {
            loadProperty();
            load();
          }}
          className="mt-3 btn btn-secondary text-xs"
        >
          Retry
        </button>
      </div>
    );
  }

  const currency = property?.currency === "INR" ? "₹" : "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] muted">
            Hotel Operations / Distribution
          </p>
          <h2 className="h1">Rates &amp; Inventory</h2>
          <p className="sub">
            Rooms left and prices for every channel. Each channel&apos;s markup applies to
            all your rooms.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {source === "mock" && (
            <span className="chip chip-warn">
              Aiosell not connected
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              // Default the range to the window on screen, which is almost
              // always what needs resending.
              setResyncFrom(dates[0]);
              setResyncTo(dates[dates.length - 1]);
              setResyncOpen((o) => !o);
              setBulkOpen(false);
            }}
            disabled={busy || resyncBusy}
            className="btn btn-secondary"
          >
            Resync
          </button>
          <button
            type="button"
            onClick={() => {
              // Starts on the window on screen, keeping the rooms and plans
              // picked last time, with every value blank.
              setBulk((b) => ({
                ...emptyBulk(dates[0], dates[dates.length - 1]),
                rooms: b.rooms,
                plans: b.plans,
              }));
              setBulkOpen((o) => !o);
              setResyncOpen(false);
            }}
            disabled={busy || bulkBusy || !grid?.rooms?.length}
            className="btn btn-secondary"
          >
            Bulk update
          </button>
          <button
            type="button"
            onClick={publish}
            disabled={busy || !dirty}
            className="btn btn-primary"
          >
            {busy
              ? "Publishing…"
              : dirty
              ? `Publish ${dirty} change${dirty === 1 ? "" : "s"}`
              : "Publish"}
          </button>
        </div>
      </div>

      {notice && (
        <div className="card px-4 py-2 sub">
          {notice}
        </div>
      )}

      {/* Resync: resend stored rates and restrictions, changing nothing. */}
      {resyncOpen && (
        <div className="card card-pad space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">Resync to Aiosell</h3>
            <p className="mt-1 text-xs muted">
              Resends the rates this grid shows for these dates, including
              dates priced only by the plan&rsquo;s rack rate, and the rooms
              free on each night as the PMS counts them. Nothing is changed
              here — use it when the channel manager has drifted out of step.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs muted">From</span>
              <input
                type="date"
                value={resyncFrom}
                onChange={(e) => setResyncFrom(e.target.value)}
                className="input"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs muted">To</span>
              <input
                type="date"
                value={resyncTo}
                onChange={(e) => setResyncTo(e.target.value)}
                className="input"
              />
            </label>

            <div className="flex flex-col gap-1">
              <span className="text-xs muted">Send</span>
              <div className="flex items-center gap-4 py-1.5">
                {[
                  ["rates", "Rates"],
                  ["restrictions", "Restrictions"],
                  ["availability", "Availability"],
                ].map(([k, label]) => (
                  <label key={k} className="flex items-center gap-1.5 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={resyncWhat[k]}
                      onChange={(e) =>
                        setResyncWhat((p) => ({ ...p, [k]: e.target.checked }))
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <RoomPlanPicker
            rooms={grid?.rooms || []}
            plans={allPlans}
            pickedRooms={resyncRooms}
            pickedPlans={resyncPlans}
            onRooms={setResyncRooms}
            onPlans={setResyncPlans}
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={resync}
              disabled={resyncBusy || busy}
              className="btn btn-primary"
            >
              {resyncBusy ? "Resending…" : "Resend"}
            </button>
            <button
              type="button"
              onClick={() => setResyncOpen(false)}
              disabled={resyncBusy}
              className="btn btn-secondary"
            >
              Cancel
            </button>
            {resyncEstimate > 0 && (
              <span className="text-xs muted">
                about {resyncEstimate.toLocaleString()} rate
                {resyncEstimate === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Bulk update: one value across a range of dates, filled into the
          grid's edits for Publish. */}
      {bulkOpen && (
        <div className="card card-pad space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">Bulk update</h3>
            <p className="mt-1 text-xs muted">
              Sets a rate or restriction on every date in the range at once.
              Blank fields are left as they are. The changes appear in the grid
              for you to check — nothing is sent until you Publish. Derived
              rates follow their source, as they do in the cells.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs muted">From</span>
              <input
                type="date"
                value={bulk.from}
                onChange={(e) => setBulk((b) => ({ ...b, from: e.target.value }))}
                className="input"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs muted">To</span>
              <input
                type="date"
                value={bulk.to}
                onChange={(e) => setBulk((b) => ({ ...b, to: e.target.value }))}
                className="input"
              />
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-xs muted">Days</span>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-1.5">
                {WEEKDAYS.map(([n, label]) => (
                  <label key={n} className="flex items-center gap-1 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={bulk.weekdays.includes(n)}
                      onChange={(e) =>
                        setBulk((b) => ({
                          ...b,
                          weekdays: e.target.checked
                            ? [...b.weekdays, n]
                            : b.weekdays.filter((x) => x !== n),
                        }))
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <RoomPlanPicker
            rooms={grid?.rooms || []}
            plans={allPlans}
            pickedRooms={bulk.rooms}
            pickedPlans={bulk.plans}
            onRooms={(fn) => setBulk((b) => ({ ...b, rooms: typeof fn === "function" ? fn(b.rooms) : fn }))}
            onPlans={(fn) => setBulk((b) => ({ ...b, plans: typeof fn === "function" ? fn(b.plans) : fn }))}
          />

          <div className="flex flex-wrap items-end gap-4">
            {bulkOccupancies.map((occ) => (
              <label key={occ} className="flex flex-col gap-1">
                <span className="text-xs muted">
                  Rate · {occ} adult{occ === 1 ? "" : "s"}
                </span>
                <input
                  type="number"
                  min="0"
                  value={bulk.rates[occ] ?? ""}
                  onChange={(e) =>
                    setBulk((b) => ({ ...b, rates: { ...b.rates, [occ]: e.target.value } }))
                  }
                  placeholder="Keep"
                  className="input w-28"
                />
              </label>
            ))}
            <label className="flex flex-col gap-1">
              <span className="text-xs muted">Min nights</span>
              <input
                type="number"
                min="1"
                step="1"
                value={bulk.minStay}
                onChange={(e) => setBulk((b) => ({ ...b, minStay: e.target.value }))}
                placeholder="Keep"
                className="input w-24"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs muted">Max nights</span>
              <input
                type="number"
                min="1"
                step="1"
                value={bulk.maxStay}
                onChange={(e) => setBulk((b) => ({ ...b, maxStay: e.target.value }))}
                placeholder="Keep"
                className="input w-24"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs muted">Stop sell</span>
              <select
                value={bulk.stopSell}
                onChange={(e) => setBulk((b) => ({ ...b, stopSell: e.target.value }))}
                className="input"
              >
                <option value="">Keep</option>
                <option value="close">Close</option>
                <option value="open">Open</option>
                {bulk.channels.length > 0 && (
                  <option value="follow">Same as all channels</option>
                )}
              </select>
            </label>
          </div>

          {/* Stop sell can be for a few channels only; nights always apply
              to every channel. */}
          {rateChannels.length > 0 && (
            <div>
              <p className="text-xs muted">
                Stop sell on{" "}
                {bulk.channels.length === 0 && <span className="faint">(all channels)</span>}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
                {rateChannels.map((c) => (
                  <label key={c.partner_id} className="flex items-center gap-1.5 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={bulk.channels.includes(c.partner_id)}
                      onChange={(e) =>
                        setBulk((b) => {
                          const channels = e.target.checked
                            ? [...b.channels, c.partner_id]
                            : b.channels.filter((x) => x !== c.partner_id);
                          // "Same as all channels" only means something for
                          // a channel picked out.
                          const stopSell =
                            channels.length === 0 && b.stopSell === "follow" ? "" : b.stopSell;
                          return { ...b, channels, stopSell };
                        })
                      }
                    />
                    {CHANNEL_LABELS[c.partner_id] || c.partner_id}
                  </label>
                ))}
              </div>
              {bulk.channels.length > 0 && (
                <p className="mt-1.5 text-xs muted">
                  Closes or opens the picked channels only; the others keep
                  selling as they are. Min and max nights still apply to every
                  channel.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => applyBulk({ andPublish: true })}
              disabled={bulkBusy || busy}
              className="btn btn-primary"
            >
              {bulkBusy ? "Filling…" : "Apply & publish"}
            </button>
            <button
              type="button"
              onClick={() => applyBulk()}
              disabled={bulkBusy || busy}
              className="btn btn-secondary"
              title="Fill the grid so you can check it, then Publish"
            >
              Apply to grid only
            </button>
            <button
              type="button"
              onClick={() => setBulkOpen(false)}
              disabled={bulkBusy}
              className="btn btn-secondary"
            >
              Cancel
            </button>
            {bulkPreview && bulkPreview.rates + bulkPreview.restrictions > 0 && (
              <span className="text-xs muted">
                fills{" "}
                {[
                  bulkPreview.rates > 0 &&
                    `${bulkPreview.rates.toLocaleString()} rate${bulkPreview.rates === 1 ? "" : "s"}`,
                  bulkPreview.restrictions > 0 &&
                    `${bulkPreview.restrictions.toLocaleString()} restriction${
                      bulkPreview.restrictions === 1 ? "" : "s"
                    }`,
                ]
                  .filter(Boolean)
                  .join(" and ")}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Date window controls */}
      <DateToolbar
        value={anchor}
        onChange={setAnchor}
        step={days}
        windows={[14, 30]}
        windowDays={days}
        onWindowChange={setDays}
        actions={
          <div className="seg" role="group" aria-label="What the grid shows">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                className={view === v.id ? "seg-on" : ""}
                aria-pressed={view === v.id}
                onClick={() => setView(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
        }
        onClearAll={filter ? () => setFilter("") : undefined}
        filters={
          <ToolbarField label="Room types & rate plans" htmlFor="cm-filter" width={240} hideLabel>
            <input
              id="cm-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search room type or plan…"
              className="input"
            />
          </ToolbarField>
        }
      />

      {grid && grid.rooms.length === 0 && (
        <div className="card card-pad text-center">
          <p className="sub">No room types set up yet.</p>
          <p className="mt-1 text-xs muted">
            Add room types under Setup → Rooms and plans under Rate Plan Setup, then
            give each its channel manager code under Integrations.
          </p>
        </div>
      )}

      {grid && grid.unmappedRooms > 0 && (
        <div className="card card-pad" style={{ borderColor: "var(--warn)" }}>
          <p className="text-sm" style={{ color: "var(--warn)" }}>
            {grid.unmappedRooms} room type
            {grid.unmappedRooms === 1 ? " is" : "s are"} not mapped to partner
            codes. Rates for those cannot be pushed until they are set under
            Integrations.
          </p>
        </div>
      )}

      {/* Grid — every cell is ruled, so a rate can be read across a row and
          down a date without losing its place. Weekends are tinted, since
          they are what a revenue manager scans for. */}
      <div
        className="overflow-x-auto card"
        style={{ padding: 0, opacity: loading ? 0.6 : 1, transition: "opacity 0.15s" }}
      >
        <table
          className="cm-rate-grid min-w-full text-sm"
          style={{ borderCollapse: "separate", borderSpacing: 0 }}
        >
          <thead>
            <tr>
              <th
                className="cm-name-col sticky left-0 z-20 px-2 py-2.5 text-left text-xs uppercase tracking-wide muted md:px-4"
                style={{
                  background: "var(--surface-2)",
                  borderBottom: "1px solid var(--border-strong)",
                  borderRight: "1px solid var(--border-strong)",
                }}
              >
                Room type &amp; rate plan
              </th>
              {dates.map((d) => {
                const f = formatDay(d);
                const todayIso = isoDate(new Date());
                return (
                  <th
                    key={d}
                    className="cm-date-col px-3 py-2 text-center text-[11px] font-medium"
                    style={{
                      background: f.weekend
                        ? "var(--warn-soft)"
                        : "var(--surface-2)",
                      borderBottom: "1px solid var(--border-strong)",
                      borderRight: "1px solid var(--border)",
                      color: f.weekend ? "var(--warn)" : "var(--text-muted)",
                    }}
                  >
                    <div
                      style={d === todayIso ? { color: "var(--accent-text)", fontWeight: 600 } : undefined}
                    >
                      {d === todayIso ? "TODAY" : f.dow}
                    </div>
                    <div
                      className="text-base font-semibold"
                      style={{ color: f.weekend ? "var(--warn)" : "var(--text)" }}
                    >
                      {f.day}
                    </div>
                    <div className="text-[10px] faint">{f.mon}</div>
                    <EventMarker events={eventsByDate[d]} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rooms.map((room) => (
              <ExpandableRoom
                key={room.id}
                room={room}
                dates={dates}
                currency={currency}
                open={expanded[room.id]}
                onToggle={() =>
                  setExpanded((p) => ({ ...p, [room.id]: !p[room.id] }))
                }
                rates={rates}
                stored={grid?.dailyRates || {}}
                pricer={pricer}
                onRateChange={(key, value) =>
                  setRates((prev) => ({ ...prev, [key]: value }))
                }
                restrictions={restrictions}
                storedRestrictions={grid?.dailyRestrictions || {}}
                channelStops={channelStopView}
                editedChannelStops={channelStops}
                availability={grid?.availability || {}}
                view={view}
                onRestrictionChange={(key, field, value) =>
                  setRestrictions((prev) => ({
                    ...prev,
                    [key]: { ...prev[key], [field]: value },
                  }))
                }
                channels={rateChannels}
                openChannels={openChannels}
                onToggleChannels={(key) =>
                  setOpenChannels((p) => ({ ...p, [key]: !p[key] }))
                }
                onMultiplier={applyMultiplier}
                revert={revert}
                busy={busy}
              />
            ))}
            {rooms.length === 0 && (
              <tr>
                <td
                  colSpan={dates.length + 1}
                  className="px-4 py-8 text-center sub"
                >
                  No room types match “{filter}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Room-type and rate-plan checkboxes, shared by Resync and Bulk update.
 * Nothing ticked means every room and every plan, so the common case needs
 * no clicking.
 */
function RoomPlanPicker({ rooms, plans, pickedRooms, pickedPlans, onRooms, onPlans }) {
  const toggle = (set) => (id, on) =>
    set((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)));
  const columns = [
    ["Room types", rooms.map((r) => ({ id: r.id, label: r.name })), pickedRooms, toggle(onRooms)],
    ["Rate plans", plans, pickedPlans, toggle(onPlans)],
  ];
  return (
    <div className="space-y-2">
      <div className="grid gap-4 sm:grid-cols-2">
        {columns.map(([title, items, picked, onToggle]) => (
          <div key={title}>
            <p className="text-xs muted">
              {title} {picked.length === 0 && <span className="faint">(all)</span>}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
              {items.map((item) => (
                <label key={item.id} className="flex items-center gap-1.5 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={picked.includes(item.id)}
                    onChange={(e) => onToggle(item.id, e.target.checked)}
                  />
                  {item.label}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      {(pickedRooms.length > 0 || pickedPlans.length > 0) && (
        <button
          type="button"
          onClick={() => {
            onRooms([]);
            onPlans([]);
          }}
          className="text-xs muted hover:text-ink"
        >
          Clear selection
        </button>
      )}
    </div>
  );
}

function ExpandableRoom({
  pricer,
  room,
  dates,
  currency,
  open,
  onToggle,
  rates,
  stored,
  onRateChange,
  restrictions,
  storedRestrictions,
  availability,
  view,
  onRestrictionChange,
  channelStops,
  editedChannelStops,
  channels,
  openChannels,
  onToggleChannels,
  onMultiplier,
  revert,
  busy,
}) {
  return (
    <>
      <tr>
        <td
          className="sticky left-0 z-10 px-2 py-2.5 md:px-4"
          style={{
            background: "var(--surface-2)",
            borderBottom: "1px solid var(--border-strong)",
            borderRight: "1px solid var(--border-strong)",
          }}
        >
          {/* The partner code is only needed when checking a mapping, so it
              sits in the tooltip; the row says "not mapped" only when that
              is something the desk has to fix. */}
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-2 text-left"
            title={room.partnerCode ? `Partner code: ${room.partnerCode}` : "Not mapped to a partner code"}
          >
            <span className="muted">{open ? "▾" : "▸"}</span>
            <span>
              <span className="block font-medium text-ink">{room.name}</span>
              <span className="block text-xs muted">
                {room.count} rooms
                {!room.partnerCode && (
                  <span style={{ color: "var(--warn)" }}> · not mapped</span>
                )}
              </span>
            </span>
          </button>
        </td>
        {dates.map((d) => {
          // Rooms free that night, as the PMS counts them -- the number the
          // channels are sent. Falls back to the room count if it is missing.
          const a = availability[`${room.id}|${d}`];
          const full = a && a.free === 0;
          return (
            <td
              key={d}
              className="px-3 py-2.5 text-center"
              title={a ? `${a.sold} sold of ${a.capacity} · ${a.free} free` : undefined}
              style={{
                background: full ? "var(--warn-soft)" : "var(--surface-2)",
                borderBottom: "1px solid var(--border-strong)",
                borderRight: "1px solid var(--border)",
              }}
            >
              {a ? (
                <>
                  <span
                    className="block font-medium"
                    style={{ color: full ? "var(--warn)" : "var(--text)" }}
                  >
                    {a.free}
                  </span>
                  <span className="block text-xs faint">of {a.capacity}</span>
                </>
              ) : (
                <span className="muted">{room.count ?? "—"}</span>
              )}
            </td>
          );
        })}
      </tr>

      {open &&
        room.plans.map((plan) => {
          // Rates are priced per occupancy; a restriction applies to the whole
          // rate plan, so those views collapse to a single row.
          const rows =
            view === "rates" ? plan.occupancies : [plan.occupancies[0]];

          return (
            <Fragment key={plan.id}>
              {rows.map((occ, i) => (
                <tr key={`${plan.id}-${view}-${occ.occupancy}`}>
                  <td
                    className="sticky left-0 z-10 px-2 py-1.5 pl-4 md:px-4 md:pl-10"
                    style={{
                      background: "var(--surface)",
                      borderBottom: "1px solid var(--border)",
                      borderRight: "1px solid var(--border-strong)",
                    }}
                  >
                    {/* One line per row: the plan's name on its first row,
                        the occupancy at the right of every row. */}
                    <span className="flex items-center justify-between gap-2">
                    {i === 0 ? (
                      // Wraps on a phone, so the plan's name and channels
                      // stack in a narrow column rather than holding one
                      // long line that leaves no room for dates.
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 md:flex-nowrap">
                        {/* The meal-plan code is shown only when the name
                            does not already say it -- a plan called "CP"
                            otherwise read "CP CP". */}
                        {!planNameSays(plan) && (
                          <span className="chip chip-off font-mono">
                            {plan.label}
                          </span>
                        )}
                        <span className="text-sm text-ink">{plan.name || plan.label}</span>
                        {plan.restrictions.stopSell && (
                          <span className="chip chip-warn">Stop sell</span>
                        )}
                        {plan.derived && (
                          <span
                            className="cm-meta text-xs muted"
                            title="Worked out from this rate on each date; not typed here"
                          >
                            ↳ {plan.derived.from}
                            {plan.derived.rule ? ` · ${plan.derived.rule}` : ""}
                          </span>
                        )}

                        {channels.length > 0 && (
                          <button
                            type="button"
                            onClick={() => onToggleChannels(`${plan.id}|${room.id}`)}
                            aria-expanded={Boolean(
                              openChannels[`${plan.id}|${room.id}`]
                            )}
                            title="What each channel receives after its markup"
                            className="rounded px-1.5 py-0.5 text-xs muted hover:bg-[var(--surface-2)]"
                          >
                            {openChannels[`${plan.id}|${room.id}`] ? "▾" : "▸"}{" "}
                            {channels.length} channel
                            {channels.length === 1 ? "" : "s"}
                          </button>
                        )}
                      </span>
                    ) : (
                      <span />
                    )}
                    {view === "rates" && (
                      <span
                        className="shrink-0 whitespace-nowrap text-xs muted"
                        title={
                          occ.partnerCode
                            ? `Partner code: ${occ.partnerCode}`
                            : "Not mapped to a partner code"
                        }
                        style={occ.partnerCode ? undefined : { color: "var(--warn)" }}
                      >
                        {occ.occupancy} adult{occ.occupancy === 1 ? "" : "s"}
                        {!occ.partnerCode && " !"}
                        {occ.fromSingle && !plan.derived && (
                          <span className="cm-meta block text-[10px] faint">
                            = {occ.fromSingle}
                          </span>
                        )}
                      </span>
                    )}
                    </span>
                    {view !== "rates" && (
                      <span className="cm-meta block text-xs muted">
                        Applies to the whole rate plan
                      </span>
                    )}
                  </td>

                  {view === "rates"
                    ? dates.map((d) => {
                        const key = `${plan.id}|${room.id}|${occ.occupancy}|${d}`;
                        // An unsaved edit wins, then the stored rate for that
                        // date, and only then the plan's resolved base price.
                        const savedRate = stored[key];
                        const priced = pricer?.rate(plan.id, room.id, occ.occupancy, d);
                        const value =
                          rates[key] ??
                          savedRate?.rate ??
                          (priced == null ? null : Math.round(priced)) ??
                          occ.resolvedRate ??
                          plan.resolvedRate ??
                          "";
                        const edited = rates[key] !== undefined;
                        const unpushed = savedRate && !savedRate.pushed;
                        // A derived room rate is worked out from its source
                        // on this date, as in SiteMinder: shown, not typed.
                        if ((plan.derived || occ.fromSingle) && pricer) {
                          const r = pricer.rate(plan.id, room.id, occ.occupancy, d);
                          return (
                            <td
                              key={d}
                              className="px-1.5 py-1.5"
                              style={{
                                background: formatDay(d).weekend ? "var(--warn-soft)" : undefined,
                                borderBottom: "1px solid var(--border)",
                                borderRight: "1px solid var(--border)",
                              }}
                            >
                              <div
                                className="w-full rounded px-1.5 py-1 text-right text-sm tabular-nums"
                                style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}
                                title={
                                  plan.derived
                                    ? `Derived from ${plan.derived.from}${plan.derived.rule ? ` · ${plan.derived.rule}` : ""}. Change it there, or in Rate Plan Setup.`
                                    : `Worked out as ${occ.fromSingle}. Change the 1-adult rate, or the rule in Rate Plan Setup.`
                                }
                              >
                                {r === null ? "—" : Math.round(r)}
                              </div>
                            </td>
                          );
                        }
                        return (
                          <td
                            key={d}
                            className="px-1.5 py-1.5"
                            style={{
                              background: formatDay(d).weekend
                                ? "var(--warn-soft)"
                                : undefined,
                              borderBottom: "1px solid var(--border)",
                              borderRight: "1px solid var(--border)",
                            }}
                          >
                            <input
                              type="number"
                              value={value}
                              onChange={(e) => onRateChange(key, e.target.value)}
                              className="w-full rounded border px-1.5 py-1 text-right text-sm"
                              style={{
                                background: "var(--surface)",
                                borderColor: !occ.partnerCode
                                  ? "var(--warn)"
                                  : edited
                                  ? "var(--accent)"
                                  : "var(--border)",
                                fontWeight: edited || unpushed ? 600 : 400,
                                color: "var(--text)",
                              }}
                              aria-label={`${plan.label} adult ${occ.occupancy} on ${d}`}
                            />
                          </td>
                        );
                      })
                    : dates.map((d) => (
                        <RestrictionCell
                          key={d}
                          plan={plan}
                          roomId={room.id}
                          date={d}
                          field={view}
                          edits={restrictions}
                          stored={storedRestrictions}
                          onChange={onRestrictionChange}
                          channelStops={channelStops}
                          editedChannelStops={editedChannelStops}
                        />
                      ))}
                </tr>
              ))}

              {view === "rates" &&
                openChannels[`${plan.id}|${room.id}`] &&
                channels.map((ch) => (
                  <ChannelRow
                    key={`${plan.id}-${room.id}-${ch.partner_id}`}
                    channel={ch}
                    plan={plan}
                    room={room}
                    dates={dates}
                    rates={rates}
                    stored={stored}
                    pricer={pricer}
                    revert={revert}
                    busy={busy}
                    onMultiplier={onMultiplier}
                  />
                ))}
            </Fragment>
          );
        })}
    </>
  );
}

/**
 * What one channel receives for a rate plan, after its markup.
 *
 * Aiosell applies the multiplier on top of whatever rate is pushed, so these
 * figures are calculated rather than stored, and they follow the rate above
 * as it is edited. The multiplier itself is property-wide: changing it here
 * changes it for every rate plan, which the row says outright.
 */
function ChannelRow({
  pricer,
  channel,
  plan,
  room,
  dates,
  rates,
  stored,
  revert,
  busy,
  onMultiplier,
}) {
  const mult = channel.rate_multiplier ?? 1;
  const pct = Math.round((mult - 1) * 100);

  // A channel is quoted at the rate plan's base occupancy, which is the
  // headline figure a guest sees on the OTA.
  const occ = plan.occupancies[plan.occupancies.length - 1] || plan.occupancies[0];

  return (
    <tr>
      <td
        className="sticky left-0 z-10 px-2 py-1 pl-6 md:px-4 md:pl-16"
        style={{
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
          borderRight: "1px solid var(--border-strong)",
        }}
      >
        <span className="flex items-center gap-2">
          <span className="text-xs text-ink">
            {CHANNEL_LABELS[channel.partner_id] || channel.partner_id}
          </span>
          <input
            type="number"
            step="0.01"
            min="0.01"
            // Keyed on the live value so a rejected update snaps back to what
            // is actually set on the channel.
            key={`${channel.partner_id}-${mult}-${revert}`}
            defaultValue={mult}
            disabled={busy}
            onBlur={(e) => {
              const next = Number(e.target.value);
              if (next !== mult) onMultiplier(channel.partner_id, next);
            }}
            title="Applies to this channel on every rate plan"
            className="w-16 rounded border px-1 py-0.5 text-right text-xs"
            style={{
              background: "var(--surface-2)",
              borderColor: "var(--border)",
              color: "var(--text)",
            }}
            aria-label={`${channel.partner_id} multiplier`}
          />
          <span
            className="text-[10px]"
            style={{ color: pct === 0 ? "var(--text-faint)" : "var(--accent-text)" }}
          >
            {pct > 0 ? "+" : ""}
            {pct}%
          </span>
        </span>
      </td>

      {dates.map((d) => {
        const key = `${plan.id}|${room.id}|${occ.occupancy}|${d}`;
        const base = pricer
          ? pricer.rate(plan.id, room.id, occ.occupancy, d)
          : rates[key] ?? stored[key]?.rate ?? occ.resolvedRate ?? plan.resolvedRate;
        const value = Number.isFinite(Number(base))
          ? Math.round(Number(base) * mult)
          : null;
        return (
          <td
            key={d}
            className="px-1.5 py-1 text-right text-xs"
            style={{
              background: formatDay(d).weekend ? "var(--warn-soft)" : undefined,
              borderBottom: "1px solid var(--border)",
              borderRight: "1px solid var(--border)",
              color: "var(--text-muted)",
            }}
          >
            {value === null ? "—" : value.toLocaleString("en-IN")}
          </td>
        );
      })}
    </tr>
  );
}

/**
 * Under a stop sell checkbox: the channels that differ from it on that date.
 * The checkbox is the all-channels value; a channel closed or opened on its
 * own (from Bulk update) is named here so the cell never reads as the whole
 * story.
 */
function ChannelStopNote({ byChannel, edited }) {
  const entries = Object.entries(byChannel || {});
  if (entries.length === 0) return null;
  const name = (c) => CHANNEL_LABELS[c] || c;
  const closed = entries.filter(([, v]) => v).map(([c]) => name(c));
  const open = entries.filter(([, v]) => !v).map(([c]) => name(c));
  const title = [
    closed.length && `Closed on ${closed.join(", ")}`,
    open.length && `Open on ${open.join(", ")}`,
  ]
    .filter(Boolean)
    .join("; ");
  // One channel is named ("✕ Agoda"); more are counted, the title listing them.
  const [[only, stop]] = entries;
  const short =
    entries.length === 1
      ? `${stop ? "✕" : "✓"} ${name(only).split(" ")[0]}`
      : `${entries.length} ch`;
  return (
    <span
      className="mt-0.5 block truncate text-[10px] leading-tight"
      style={{
        color: closed.length ? "var(--warn)" : "var(--text-muted)",
        fontWeight: edited ? 600 : 400,
      }}
      title={title}
    >
      {short}
    </span>
  );
}

/**
 * One date's cell for a restriction field on a rate plan.
 *
 * An empty cell means nothing is set for that date, so the rate plan's own
 * value from Property Setup still applies; that inherited value is shown as
 * the placeholder so it stays visible without being stored per date.
 */
function RestrictionCell({
  plan,
  roomId,
  date,
  field,
  edits,
  stored,
  onChange,
  channelStops = {},
  editedChannelStops = {},
}) {
  const key = `${plan.id}|${roomId}|${date}`;
  const patch = edits[key];
  const saved = stored[key];

  const savedValue = {
    stop_sell: saved?.stopSell,
    min_stay: saved?.minStay,
    max_stay: saved?.maxStay,
  }[field];

  const weekend = formatDay(date).weekend;
  const edited = patch?.[field] !== undefined;
  const value = edited ? patch[field] : savedValue ?? null;
  const pending = Boolean(saved && !saved.pushed);

  if (field === "stop_sell") {
    return (
      <td
        className="px-1.5 py-1.5 text-center"
        style={{
          background: weekend ? "var(--warn-soft)" : undefined,
          borderBottom: "1px solid var(--border)",
          borderRight: "1px solid var(--border)",
        }}
      >
        <input
          type="checkbox"
          // Nothing set for the date follows the room rate's own stop sell,
          // which is also what Publish sends for it.
          checked={Boolean(value ?? plan.restrictions?.stopSell)}
          onChange={(e) => onChange(key, field, e.target.checked)}
          className="h-4 w-4 cursor-pointer"
          style={{ accentColor: edited ? "var(--accent)" : undefined }}
          aria-label={`${plan.label} stop sell on ${date}, all channels`}
        />
        <ChannelStopNote
          byChannel={channelStops[key]}
          edited={Boolean(editedChannelStops[key])}
        />
      </td>
    );
  }

  const inherited =
    field === "min_stay"
      ? plan.restrictions?.minStay
      : plan.restrictions?.maxStay;

  return (
    <td
      style={{
        background: weekend ? "var(--warn-soft)" : undefined,
        borderBottom: "1px solid var(--border)",
        borderRight: "1px solid var(--border)",
      }}
      className="px-1.5 py-1.5"
    >
      <input
        type="number"
        min="1"
        step="1"
        value={value ?? ""}
        placeholder={inherited ?? "—"}
        onChange={(e) =>
          onChange(key, field, e.target.value === "" ? null : Number(e.target.value))
        }
        className="w-full rounded border px-1.5 py-1 text-right text-sm"
        style={{
          background: "var(--surface)",
          borderColor: edited ? "var(--accent)" : "var(--border)",
          fontWeight: edited || pending ? 600 : 400,
          color: "var(--text)",
        }}
        aria-label={`${plan.label} ${
          field === "min_stay" ? "minimum" : "maximum"
        } nights on ${date}`}
      />
    </td>
  );
}
