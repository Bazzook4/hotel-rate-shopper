"use client";

import { useCallback, useEffect, useMemo, useState } from "react";


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
  const dirty = Object.keys(rates).length;

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
        fetch("/api/cm/grid"),
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
  }, []);

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

  async function pushAll() {
    if (!grid?.rooms?.length) return;
    setBusy(true);
    setNotice("");
    try {
      // Push each edited cell at its own date, so an edit to one day does
      // not overwrite the whole window.
      const byDate = {};
      for (const [key, value] of Object.entries(rates)) {
        const [planId, occupancy, date] = key.split("|");
        const room = (grid?.rooms || []).find((r) =>
          r.plans.some((p) => p.id === planId)
        );
        if (!room) continue;
        // Our own ids: the push route maps them to partner codes.
        (byDate[date] ||= []).push({
          roomCode: room.id,
          rateplanCode: planId,
          occupancy: Number(occupancy),
          rate: Number(value),
        });
      }

      const updates = Object.entries(byDate).map(([date, entries]) => ({
        startDate: date,
        endDate: date,
        rates: entries,
      }));

      if (updates.length === 0) {
        setNotice("No rate changes to push.");
        setBusy(false);
        return;
      }
      const res = await fetch("/api/cm/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "rates", updates }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Push failed");
      setNotice(json.message || `Pushed ${dirty} rate change${dirty === 1 ? "" : "s"}.`);
      setRates({});
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
            onClick={pushAll}
            disabled={busy}
            className="btn btn-primary"
          >
            {busy
              ? "Working…"
              : dirty
              ? `Push ${dirty} change${dirty === 1 ? "" : "s"}`
              : "Push All to Channels"}
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
                onRateChange={(key, value) =>
                  setRates((prev) => ({ ...prev, [key]: value }))
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
  onRateChange,
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
        room.plans.map((plan) =>
          plan.occupancies.map((occ, i) => (
            <tr key={`${plan.id}-${occ.occupancy}`}>
              <td className="sticky left-0 z-10 bg-[var(--surface)] px-4 py-1.5 pl-10">
                {i === 0 && (
                  <span className="flex items-center gap-2">
                    <span className="chip chip-off font-mono">{plan.label}</span>
                    <span className="text-sm text-ink">{plan.name}</span>
                    {plan.restrictions.stopSell && (
                      <span className="chip chip-warn">Stop sell</span>
                    )}
                  </span>
                )}
                <span className="block text-xs muted">
                  Adult {occ.occupancy}
                  {occ.partnerCode ? ` · ${occ.partnerCode}` : " · not mapped"}
                </span>
              </td>
              {dates.map((d) => {
                const key = `${plan.id}|${occ.occupancy}|${d}`;
                // An edited cell wins; otherwise the plan's resolved rate,
                // which follows its master when it is a derived plan.
                const value = rates[key] ?? plan.resolvedRate ?? "";
                return (
                  <td key={d} className="px-1.5 py-1.5">
                    <input
                      type="number"
                      value={value}
                      onChange={(e) => onRateChange(key, e.target.value)}
                      className="w-full rounded border px-1.5 py-1 text-right text-sm"
                      style={{
                        background: "var(--surface)",
                        borderColor: occ.partnerCode
                          ? "var(--border)"
                          : "var(--warn)",
                        color: "var(--text)",
                      }}
                      aria-label={`${plan.label} adult ${occ.occupancy} on ${d}`}
                    />
                  </td>
                );
              })}
            </tr>
          ))
        )}
    </>
  );
}
