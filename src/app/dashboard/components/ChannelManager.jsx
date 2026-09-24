"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { mockRate, mockInventory } from "@/lib/mock/aiosellProperty";

const CHANNEL_LABELS = {
  "booking.com": "Booking.com",
  gommt: "MakeMyTrip",
  agoda: "Agoda",
  airbnb: "Airbnb",
  google: "Google",
  expedia: "Expedia",
};

const CHANNEL_DOTS = {
  "booking.com": "bg-blue-500",
  gommt: "bg-red-500",
  agoda: "bg-purple-500",
  airbnb: "bg-rose-500",
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

  const dates = useMemo(
    () => buildDates(new Date(`${anchor}T00:00:00Z`), days),
    [anchor, days]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/cm/property");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
      setProperty(json.property);
      setSource(json.source);
      setExpanded(
        Object.fromEntries((json.property?.rooms || []).map((r) => [r.room_id, true]))
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
    const list = property?.rooms || [];
    if (!q) return list;
    return list
      .map((r) => {
        const roomHit = r.room_name.toLowerCase().includes(q);
        const plans = r.rateplans.filter((p) =>
          p.rateplan_name.toLowerCase().includes(q)
        );
        if (roomHit) return r;
        return plans.length ? { ...r, rateplans: plans } : null;
      })
      .filter(Boolean);
  }, [property, filter]);

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
    if (!property) return;
    setBusy(true);
    setNotice("");
    try {
      const rates = [];
      for (const room of property.rooms) {
        for (const plan of room.rateplans) {
          rates.push({
            roomCode: room.room_id,
            rateplanCode: plan.rateplan_id,
            rate: mockRate(room.room_id, plan.rateplan_id, dates[0]),
          });
        }
      }
      const res = await fetch("/api/cm/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "rates",
          updates: [
            { startDate: dates[0], endDate: dates[dates.length - 1], rates },
          ],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Push failed");
      setNotice(json.message || "Rates pushed to channels.");
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
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
        <p className="text-sm text-red-200">{error}</p>
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
              Mock data — Aiosell not configured
            </span>
          )}
          <button
            type="button"
            onClick={pushAll}
            disabled={busy}
            className="btn btn-primary"
          >
            {busy ? "Working…" : "Push All to Channels"}
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
          className="rounded-lg bg-[var(--surface-2)] px-2.5 py-1.5 text-sm text-ink hover:bg-white/20"
        >
          ‹
        </button>
        <span className="sub">
          {dates[0]} → {dates[dates.length - 1]}
        </span>
        <button
          type="button"
          onClick={() => shiftWindow(1)}
          className="rounded-lg bg-[var(--surface-2)] px-2.5 py-1.5 text-sm text-ink hover:bg-white/20"
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
                days === n ? "bg-white/20 text-ink" : "muted hover:bg-[var(--surface-2)]"
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
                      f.weekend ? "text-amber-300" : "muted"
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
                key={room.room_id}
                room={room}
                dates={dates}
                currency={currency}
                open={expanded[room.room_id]}
                onToggle={() =>
                  setExpanded((p) => ({ ...p, [room.room_id]: !p[room.room_id] }))
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

function ExpandableRoom({ room, dates, currency, open, onToggle }) {
  return (
    <>
      <tr className="bg-white/[0.03]">
        <td className="sticky left-0 z-10 bg-[var(--surface)] px-4 py-3">
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-2 text-left"
          >
            <span className="muted">{open ? "▾" : "▸"}</span>
            <span>
              <span className="block font-medium text-ink">{room.room_name}</span>
              <span className="block text-xs muted">
                {room.rateplans.length} rate plans · {room.count} rooms
              </span>
            </span>
          </button>
        </td>
        {dates.map((d) => (
          <td key={d} className="px-3 py-3 text-center text-ink">
            {mockInventory(room.room_id, d)}
          </td>
        ))}
      </tr>
      {open &&
        room.rateplans.map((plan) => (
          <tr key={plan.rateplan_id} className="">
            <td className="sticky left-0 z-10 bg-[var(--surface)] px-4 py-2 pl-10">
              <span className="block text-sm text-ink">{plan.rateplan_name}</span>
              <span className="block text-xs muted">{plan.description}</span>
            </td>
            {dates.map((d) => (
              <td key={d} className="px-3 py-2 text-center text-ink">
                {currency}
                {mockRate(room.room_id, plan.rateplan_id, d).toLocaleString("en-IN")}
              </td>
            ))}
          </tr>
        ))}
    </>
  );
}
