"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";


const CHANNEL_LABELS = {
  "booking.com": "Booking.com",
  gommt: "MakeMyTrip",
  agoda: "Agoda",
  airbnb: "Airbnb",
  google: "Google",
  expedia: "Expedia",
};

// Each OTA's own brand colour, so these stay fixed rather than following
// the theme palette.
const CHANNEL_DOTS = {
  "booking.com": "bg-[var(--accent)]",
  gommt: "bg-red-500",
  agoda: "bg-purple-500",
  airbnb: "bg-[var(--danger)]",
  google: "bg-emerald-500",
  expedia: "bg-amber-500",
};

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

  // Channels that carry rates — these are the ones a multiplier applies to.
  const rateChannels = useMemo(() => {
    const seen = new Map();
    for (const c of property?.connected_channels || []) {
      if (c.operation === "rates" && !seen.has(c.partner_id)) {
        seen.set(c.partner_id, c);
      }
    }
    return [...seen.values()];
  }, [property]);

  const connectedCount = useMemo(() => {
    return new Set((property?.connected_channels || []).map((c) => c.partner_id)).size;
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

  async function applyMultiplier(channel, value) {
    const multiplier = Number(value);
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      setNotice("Multiplier must be a positive number.");
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
      if (!res.ok) throw new Error(json?.error || "Multiplier update failed");
      setNotice(json.message || `${CHANNEL_LABELS[channel] || channel} set to ${multiplier}x`);
      setProperty((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          connected_channels: prev.connected_channels.map((c) =>
            c.operation === "rates" && c.partner_id === channel
              ? { ...c, rate_multiplier: multiplier }
              : c
          ),
        };
      });
    } catch (err) {
      setNotice(`${CHANNEL_LABELS[channel] || channel}: ${err.message}`);
      setRevert((n) => n + 1);
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

      // The room comes from the edited cell itself. Looking it up from the
      // plan would pick the first room offering it, so a rate edited in one
      // room was sent to another.
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

      const updates = Object.entries(byDate).map(([date, entries]) => ({
        startDate: date,
        endDate: date,
        rates: entries,
      }));

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

      // Aiosell takes restrictions per room type, not per rate plan, so plans
      // sharing a room on the same date collapse into one entry. Where two
      // plans on that room disagree, the stricter value is sent: a stop sell
      // anywhere closes the room, the longest minimum and the shortest
      // maximum win. Pushing them separately would mean the last one written
      // silently overwrote the others.
      const restrictionsByDate = {};
      for (const row of restrictionRows) {
        if (!row.room_type_id) continue;
        const byRoom = (restrictionsByDate[row.stay_date] ||= {});
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

      const restrictionUpdates = Object.entries(restrictionsByDate).map(
        ([date, byRoom]) => ({
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
        })
      );

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

  function shiftWindow(dir) {
    const d = new Date(`${anchor}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dir * days);
    setAnchor(isoDate(d));
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

      {/* Channel cards — multiplier is per channel, matching the Aiosell API */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="card card-pad">
          <p className="text-xs uppercase tracking-wide muted">All channels</p>
          <p className="mt-2 h1">{connectedCount}</p>
          <p className="text-xs muted">connected</p>
        </div>
        {rateChannels.map((c) => (
          <div
            key={c.partner_id}
            className="card card-pad"
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${CHANNEL_DOTS[c.partner_id] || "bg-slate-400"}`}
              />
              <p className="text-xs font-medium uppercase tracking-wide muted">
                {CHANNEL_LABELS[c.partner_id] || c.partner_id}
              </p>
            </div>
            <label className="mt-3 block label">
              Rate multiplier
              <input
                type="number"
                step="0.01"
                min="0.01"
                // Keyed on the live value so a rejected update snaps back to
                // what is actually set on the channel, rather than leaving the
                // input showing a multiplier that was never applied.
                key={`${c.partner_id}-${c.rate_multiplier ?? 1}-${revert}`}
                defaultValue={c.rate_multiplier ?? 1}
                disabled={busy}
                onBlur={(e) => {
                  const next = Number(e.target.value);
                  if (next !== (c.rate_multiplier ?? 1)) {
                    applyMultiplier(c.partner_id, next);
                  }
                }}
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 h2 outline-none focus:border-white/30"
              />
            </label>
            <p className="mt-1 text-[11px] faint">
              {((c.rate_multiplier ?? 1) - 1) * 100 >= 0 ? "+" : ""}
              {(((c.rate_multiplier ?? 1) - 1) * 100).toFixed(0)}% on pushed rates
            </p>
          </div>
        ))}
      </div>

      {/* Date window controls */}
      <div className="flex flex-wrap items-center gap-2 card p-3">
        <button
          type="button"
          onClick={() => shiftWindow(-1)}
          className="rounded-lg bg-[var(--surface-2)] px-2.5 py-1.5 text-sm text-ink hover:bg-[var(--accent-soft)]"
        >
          ‹
        </button>
        <span className="sub">
          {dates[0]} → {dates[dates.length - 1]}
        </span>
        <button
          type="button"
          onClick={() => shiftWindow(1)}
          className="rounded-lg bg-[var(--surface-2)] px-2.5 py-1.5 text-sm text-ink hover:bg-[var(--accent-soft)]"
        >
          ›
        </button>
        <div className="ml-2 flex overflow-hidden rounded-lg border border-[var(--border)]">
          {[15, 30].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setDays(n)}
              className={`px-3 py-1.5 text-xs ${
                days === n ? "bg-[var(--accent-soft)] text-ink" : "muted hover:bg-[var(--surface-2)]"
              }`}
            >
              {n} days
            </button>
          ))}
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter room type or plan…"
          className="ml-auto input w-56"
        />
      </div>

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

      {/* Grid */}
      <div className="overflow-x-auto card">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-[var(--surface)] px-4 py-3 text-left text-xs uppercase tracking-wide muted">
                Room type &amp; rate plan
              </th>
              {dates.map((d) => {
                const f = formatDay(d);
                return (
                  <th
                    key={d}
                    className={`px-3 py-2 text-center text-[11px] font-medium ${
                      f.weekend ? "text-[var(--warn)]" : "muted"
                    }`}
                  >
                    <div>{f.dow}</div>
                    <div className="text-base font-semibold text-ink">{f.day}</div>
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
  planView,
  onPlanViewChange,
  onRestrictionChange,
}) {
  return (
    <>
      <tr className="bg-[var(--surface-2)]">
        <td className="sticky left-0 z-10 bg-[var(--surface-2)] px-4 py-3">
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
        {dates.map((d) => (
          <td key={d} className="px-3 py-3 text-center muted">
            {room.count ?? "—"}
          </td>
        ))}
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
                  <td className="sticky left-0 z-10 bg-[var(--surface)] px-4 py-1.5 pl-10">
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
                          <td key={d} className="px-1.5 py-1.5">
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
            </Fragment>
          );
        })}
    </>
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

  const edited = patch?.[field] !== undefined;
  const value = edited ? patch[field] : savedValue ?? null;
  const pending = Boolean(saved && !saved.pushed);

  if (field === "stop_sell") {
    return (
      <td className="px-1.5 py-1.5 text-center">
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
    <td className="px-1.5 py-1.5">
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
