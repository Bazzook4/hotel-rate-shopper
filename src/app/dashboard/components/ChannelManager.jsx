"use client";

/**
 * Aiosell's channel slugs are not what a hotelier calls them.
 */
const CHANNEL_LABELS = {
  gommt: "MakeMyTrip / Goibibo",
  agoda: "Agoda",
  airbnb: "Airbnb",
  google: "Google",
  "booking.com": "Booking.com",
  expedia: "Expedia",
};


import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import DateToolbar, { ToolbarField } from "./DateToolbar";



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
 * Group restriction rows into one update per date.
 *
 * Aiosell takes restrictions per room type, not per rate plan, so plans
 * sharing a room on the same date collapse into one entry. Where two plans
 * on that room disagree, the stricter value is sent: a stop sell anywhere
 * closes the room, the longest minimum and the shortest maximum win.
 * Pushing them separately would mean the last one written silently
 * overwrote the others.
 */
function restrictionsToUpdates(rows) {
  const byDate = {};
  for (const row of rows) {
    if (!row.room_type_id) continue;
    const byRoom = (byDate[row.stay_date] ||= {});
    const prev = byRoom[row.room_type_id];
    byRoom[row.room_type_id] = prev
      ? {
          stopSell: Boolean(prev.stopSell || row.stop_sell),
          minStay: maxOf(prev.minStay, row.min_stay),
          maxStay: minOf(prev.maxStay, row.max_stay),
        }
      : {
          stopSell: Boolean(row.stop_sell),
          minStay: row.min_stay ?? null,
          maxStay: row.max_stay ?? null,
        };
  }

  return Object.entries(byDate).map(([date, byRoom]) => ({
    startDate: date,
    endDate: date,
    rooms: Object.entries(byRoom).map(([roomCode, r]) => ({
      roomCode,
      restrictions: {
        stopSell: r.stopSell,
        minimumStay: r.minStay,
        maximumStay: r.maxStay,
        closeOnArrival: false,
        closeOnDeparture: false,
        minimumStayArrival: null,
        maximumStayArrival: null,
        exactStayArrival: null,
        minimumAdvanceReservation: null,
        maximumAdvanceReservation: null,
      },
    })),
  }));
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

export default function ChannelManager() {
  const [property, setProperty] = useState(null);
  const [grid, setGrid] = useState(null);
  const [source, setSource] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [days, setDays] = useState(15);
  const [anchor, setAnchor] = useState(() => isoDate(new Date()));
  const [expanded, setExpanded] = useState({});
  const [filter, setFilter] = useState("");
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
  // Which metric each rate plan's row is showing, keyed by plan id. Rows
  // default to rates; picking another metric swaps the cells in place rather
  // than adding rows, so the grid keeps one line per rate plan.
  const [planView, setPlanView] = useState({});
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

  const dirtyRates = Object.keys(rates).length;
  const dirtyRestrictions = Object.keys(restrictions).length;
  const dirty = dirtyRates + dirtyRestrictions;

  const dates = useMemo(
    () => buildDates(new Date(`${anchor}T00:00:00Z`), days),
    [anchor, days]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [chRes, gridRes] = await Promise.all([
        fetch("/api/cm/property"),
        fetch(`/api/cm/grid?start=${dates[0]}&end=${dates[dates.length - 1]}`),
      ]);
      const json = await chRes.json();
      if (!chRes.ok) throw new Error(json?.error || `Request failed (${chRes.status})`);
      setProperty(json.property);
      setSource(json.source);

      // The grid comes from this property's own setup, not from the partner.
      const gridJson = gridRes.ok ? await gridRes.json() : null;
      setGrid(gridJson);
      setExpanded(
        Object.fromEntries((gridJson?.rooms || []).map((r) => [r.id, true]))
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [dates]);

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
        body: JSON.stringify({ multiplier, channels: [channel] }),
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
    const storedRestrictions = grid?.dailyRestrictions || {};
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

    if (rows.length === 0 && restrictionRows.length === 0) {
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
          body: JSON.stringify({ rates: rows }),
        });
        const saveJson = await saveRes.json();
        if (!saveRes.ok) throw new Error(saveJson?.error || "Could not save rates");
      }

      if (restrictionRows.length > 0) {
        const res = await fetch("/api/cm/restrictions", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ restrictions: restrictionRows }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Could not save restrictions");
      }

      // Saved, so the edits are safe from here on.
      setRates({});
      setRestrictions({});

      const updates = ratesToUpdates(rows);

      let pushJson = null;
      if (updates.length > 0) {
        const pushRes = await fetch("/api/cm/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "rates", updates }),
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

      const restrictionUpdates = restrictionsToUpdates(restrictionRows);

      let restrictionJson = null;
      if (restrictionUpdates.length > 0) {
        const res = await fetch("/api/cm/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "restrictions",
            updates: restrictionUpdates,
          }),
        });
        restrictionJson = await res.json();

        if (!res.ok) {
          await load();
          throw new Error(
            `${restrictionJson?.error || "Restriction push failed"} Your changes are saved and can be published again.`
          );
        }
      }

      await load();
      const parts = [];
      if (rows.length > 0) {
        parts.push(`${rows.length} rate${rows.length === 1 ? "" : "s"}`);
      }
      if (restrictionRows.length > 0) {
        parts.push(
          `${restrictionRows.length} restriction${
            restrictionRows.length === 1 ? "" : "s"
          }`
        );
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
        `/api/cm/grid?start=${resyncFrom}&end=${resyncTo}`
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
        for (const room of json.rooms || []) {
          if (!roomWanted(room.id)) continue;
          for (const plan of room.plans || []) {
            if (!planWanted(plan.id)) continue;
            for (const occ of plan.occupancies || []) {
              for (const stay_date of resyncDates) {
                const key = `${plan.id}|${room.id}|${occ.occupancy}|${stay_date}`;
                const rate =
                  storedRates[key]?.rate ??
                  occ.resolvedRate ??
                  plan.resolvedRate ??
                  null;
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

      const restrictionRows = [];
      if (resyncWhat.restrictions) {
        for (const [key, value] of Object.entries(
          json.dailyRestrictions || {}
        )) {
          const [rate_plan_id, room_type_id, stay_date] = key.split("|");
          if (!room_type_id) continue;
          if (!roomWanted(room_type_id) || !planWanted(rate_plan_id)) continue;
          restrictionRows.push({
            rate_plan_id,
            room_type_id,
            stay_date,
            stop_sell: value.stopSell ?? null,
            min_stay: value.minStay ?? null,
            max_stay: value.maxStay ?? null,
          });
        }
      }

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
          body: JSON.stringify({ kind: "rates", updates }),
        });
        const pushJson = await pushRes.json();
        if (!pushRes.ok) throw new Error(pushJson?.error || "Rate resync failed");
        sent.push(`${rateRows.length} rate${rateRows.length === 1 ? "" : "s"}`);
      }

      if (restrictionRows.length > 0) {
        const updates = restrictionsToUpdates(restrictionRows);
        const pushRes = await fetch("/api/cm/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "restrictions", updates }),
        });
        const pushJson = await pushRes.json();
        if (!pushRes.ok) {
          throw new Error(pushJson?.error || "Restriction resync failed");
        }
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

  if (loading) {
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
          onClick={load}
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
          <h2 className="h1">Channel Manager</h2>
          <p className="sub">
            Inventory is shared per room type. Rate multipliers apply per channel,
            property-wide.
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
            }}
            disabled={busy || resyncBusy}
            className="btn btn-secondary"
          >
            Resync
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

          {/* Nothing ticked means every room and every plan, so the common
              case needs no clicking. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs muted">
                Room types{" "}
                {resyncRooms.length === 0 && <span className="faint">(all)</span>}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
                {(grid?.rooms || []).map((r) => (
                  <label key={r.id} className="flex items-center gap-1.5 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={resyncRooms.includes(r.id)}
                      onChange={(e) =>
                        setResyncRooms((prev) =>
                          e.target.checked
                            ? [...prev, r.id]
                            : prev.filter((x) => x !== r.id)
                        )
                      }
                    />
                    {r.name}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs muted">
                Rate plans{" "}
                {resyncPlans.length === 0 && <span className="faint">(all)</span>}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
                {allPlans.map((p) => (
                  <label key={p.id} className="flex items-center gap-1.5 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={resyncPlans.includes(p.id)}
                      onChange={(e) =>
                        setResyncPlans((prev) =>
                          e.target.checked
                            ? [...prev, p.id]
                            : prev.filter((x) => x !== p.id)
                        )
                      }
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>
          </div>

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
            {(resyncRooms.length > 0 || resyncPlans.length > 0) && (
              <button
                type="button"
                onClick={() => {
                  setResyncRooms([]);
                  setResyncPlans([]);
                }}
                disabled={resyncBusy}
                className="text-xs muted hover:text-ink"
              >
                Clear selection
              </button>
            )}
          </div>
        </div>
      )}

      {/* Date window controls */}
      <DateToolbar
        value={anchor}
        onChange={setAnchor}
        step={days}
        windows={[15, 30]}
        windowDays={days}
        onWindowChange={setDays}
        onClearAll={filter ? () => setFilter("") : undefined}
        filters={
          <ToolbarField label="Room types & rate plans" htmlFor="cm-filter" width={280}>
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
            Add room types and rate plans under Property Setup, then map them
            to partner codes under Integrations.
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
      <div className="overflow-x-auto card" style={{ padding: 0 }}>
        <table
          className="min-w-full text-sm"
          style={{ borderCollapse: "separate", borderSpacing: 0 }}
        >
          <thead>
            <tr>
              <th
                className="sticky left-0 z-20 px-4 py-2.5 text-left text-xs uppercase tracking-wide muted"
                style={{
                  background: "var(--surface-2)",
                  borderBottom: "1px solid var(--border-strong)",
                  borderRight: "1px solid var(--border-strong)",
                  minWidth: 260,
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
                    className="px-3 py-2 text-center text-[11px] font-medium"
                    style={{
                      background: f.weekend
                        ? "var(--warn-soft)"
                        : "var(--surface-2)",
                      borderBottom: "1px solid var(--border-strong)",
                      borderRight: "1px solid var(--border)",
                      color: f.weekend ? "var(--warn)" : "var(--text-muted)",
                      minWidth: 74,
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
                onRateChange={(key, value) =>
                  setRates((prev) => ({ ...prev, [key]: value }))
                }
                restrictions={restrictions}
                storedRestrictions={grid?.dailyRestrictions || {}}
                availability={grid?.availability || {}}
                planView={planView}
                onPlanViewChange={(planId, view) =>
                  setPlanView((p) => ({ ...p, [planId]: view }))
                }
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

function ExpandableRoom({
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
  planView,
  onPlanViewChange,
  onRestrictionChange,
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
          className="sticky left-0 z-10 px-4 py-2.5"
          style={{
            background: "var(--surface-2)",
            borderBottom: "1px solid var(--border-strong)",
            borderRight: "1px solid var(--border-strong)",
          }}
        >
          <button type="button" onClick={onToggle} className="flex items-center gap-2 text-left">
            <span className="muted">{open ? "▾" : "▸"}</span>
            <span>
              <span className="block font-medium text-ink">{room.name}</span>
              <span className="block text-xs muted">
                {room.plans.length} rate plan{room.plans.length === 1 ? "" : "s"} ·{" "}
                {room.count} rooms
                {room.partnerCode ? ` · ${room.partnerCode}` : " · not mapped"}
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
          const view = planView[plan.id] || "rates";
          // Rates are priced per occupancy; a restriction applies to the whole
          // rate plan, so those views collapse to a single row.
          const rows =
            view === "rates" ? plan.occupancies : [plan.occupancies[0]];

          return (
            <Fragment key={plan.id}>
              {rows.map((occ, i) => (
                <tr key={`${plan.id}-${view}-${occ.occupancy}`}>
                  <td
                    className="sticky left-0 z-10 px-4 py-1.5 pl-10"
                    style={{
                      background: "var(--surface)",
                      borderBottom: "1px solid var(--border)",
                      borderRight: "1px solid var(--border-strong)",
                    }}
                  >
                    {i === 0 && (
                      <span className="flex items-center gap-2">
                        <span className="chip chip-off font-mono">
                          {plan.label}
                        </span>
                        <span className="text-sm text-ink">{plan.name}</span>
                        {plan.restrictions.stopSell && (
                          <span className="chip chip-warn">Stop sell</span>
                        )}
                        <select
                          value={view}
                          onChange={(e) =>
                            onPlanViewChange(plan.id, e.target.value)
                          }
                          title="Choose what this row shows across the dates"
                          className="rounded border px-1.5 py-0.5 text-xs uppercase tracking-wide"
                          style={{
                            background: "var(--surface-2)",
                            borderColor:
                              view === "rates"
                                ? "var(--border)"
                                : "var(--accent)",
                            color: "var(--text)",
                          }}
                          aria-label={`What to show for ${plan.name}`}
                        >
                          <option value="rates">Rates</option>
                          <option value="min_stay">Min nights</option>
                          <option value="max_stay">Max nights</option>
                          <option value="stop_sell">Stop sell</option>
                        </select>

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
                    )}
                    {view === "rates" ? (
                      <span className="block text-xs muted">
                        Adult {occ.occupancy}
                        {occ.partnerCode
                          ? ` · ${occ.partnerCode}`
                          : " · not mapped"}
                      </span>
                    ) : (
                      <span className="block text-xs muted">
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
                        const value =
                          rates[key] ??
                          savedRate?.rate ??
                          occ.resolvedRate ??
                          plan.resolvedRate ??
                          "";
                        const edited = rates[key] !== undefined;
                        const unpushed = savedRate && !savedRate.pushed;
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
        className="sticky left-0 z-10 px-4 py-1 pl-16"
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
        const base =
          rates[key] ?? stored[key]?.rate ?? occ.resolvedRate ?? plan.resolvedRate;
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
 * One date's cell for a restriction field on a rate plan.
 *
 * An empty cell means nothing is set for that date, so the rate plan's own
 * value from Property Setup still applies; that inherited value is shown as
 * the placeholder so it stays visible without being stored per date.
 */
function RestrictionCell({ plan, roomId, date, field, edits, stored, onChange }) {
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
          checked={Boolean(value)}
          onChange={(e) => onChange(key, field, e.target.checked)}
          className="h-4 w-4 cursor-pointer"
          style={{ accentColor: edited ? "var(--accent)" : undefined }}
          aria-label={`${plan.label} stop sell on ${date}`}
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
