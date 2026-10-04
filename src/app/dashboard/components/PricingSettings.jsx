"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BOLDNESS,
  boldnessFor,
  DEFAULT_CEILING_PCT,
  DEFAULT_FLOOR_PCT,
} from "@/lib/pricingStrategy";
import PricingRules from "./PricingRules";

/** The signals, in the order the settings list them. */
const SIGNALS = [
  { key: "weight_compset", label: "Competitor rates", hint: "Where you sit against the comp set median. Never more than a fifth of any decision" },
  { key: "weight_occupancy", label: "Occupancy", hint: "How full you already are for that night" },
  { key: "weight_weekday", label: "Weekday / weekend", hint: "The usual shape of the week" },
  { key: "weight_pickup", label: "Pickup", hint: "Bookings taken lately, against your usual pace" },
  { key: "weight_pace", label: "Pace against last year", hint: "Rooms booked now against this point last year" },
  { key: "weight_adr_90", label: "Avg room rate, last 90 days", hint: "What you have achieved recently" },
  { key: "weight_adr_ly", label: "Last year, same date", hint: "Annual shape a 90-day window misses" },
  { key: "weight_events", label: "Events", hint: "Events near you on that date" },
];

const BOLDNESS_HINTS = {
  cautious: "Small steps. Rates move at most 10% at a time.",
  balanced: "Recommended. Rates move at most 20% at a time.",
  aggressive: "Reacts fast to demand. Rates move up to 30% at a time.",
};

/** Which signals can say anything yet, so the page is honest about it. */
function SignalAvailability({ active }) {
  if (!active) return null;
  const dormant = SIGNALS.filter((s) => !active.includes(s.key.replace("weight_", "")));
  if (dormant.length === 0) return null;

  return (
    <div className="card card-pad" style={{ borderColor: "var(--warn)" }}>
      <p className="text-sm" style={{ color: "var(--warn)" }}>
        {dormant.length} signal{dormant.length === 1 ? " has" : "s have"} no data yet:{" "}
        {dormant.map((s) => s.label).join(", ")}. They contribute nothing until the data exists, and
        their weight is shared among the signals that do — so they start working on their own.
      </p>
    </div>
  );
}

function pctOf(base, pct) {
  if (base == null || pct === "" || pct == null) return null;
  return Math.round((Number(base) * Number(pct)) / 100);
}

export default function PricingSettings({ propertyId, onClose, activeSignals }) {
  const [rooms, setRooms] = useState([]);
  const [strategy, setStrategy] = useState(null);
  const [advanced, setAdvanced] = useState(false);
  const [tab, setTab] = useState("setup");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : "";
      const res = await fetch(`/api/pricing/settings${params}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || "Could not load pricing settings.");
        return;
      }
      setRooms(json.rooms || []);
      setStrategy(json.strategy || null);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  function setField(key, value) {
    setSaved(false);
    setStrategy((st) => ({ ...st, [key]: value }));
  }

  function setBound(roomTypeId, field, value) {
    setSaved(false);
    setRooms((list) =>
      list.map((r) => (r.roomTypeId === roomTypeId ? { ...r, [field]: value } : r))
    );
  }

  async function save() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/pricing/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          bounds: rooms.map((r) => ({
            room_type_id: r.roomTypeId,
            name: r.name,
            floor_rate: r.floor,
            ceiling_rate: r.ceiling,
          })),
          strategy,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || "Could not save your settings.");
        return;
      }
      setSaved(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="sub">Loading settings…</p>;

  const floorPct = strategy?.floor_pct ?? DEFAULT_FLOOR_PCT;
  const ceilingPct = strategy?.ceiling_pct ?? DEFAULT_CEILING_PCT;
  const boldness = boldnessFor(strategy?.max_change_pct);
  const custom = strategy?.weights_mode === "custom";
  const example = rooms.find((r) => r.basePrice != null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="h2">Pricing settings</h3>
          <p className="sub">
            {tab === "setup"
              ? "Two answers are enough. Everything else is worked out from your bookings."
              : "Optional. Every table starts with the numbers pricing already uses."}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Close
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      {error && (
        <div className="card card-pad" style={{ borderColor: "var(--danger)" }}>
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        </div>
      )}
      {saved && (
        <p className="text-sm" style={{ color: "var(--accent-text)" }}>
          Saved. Recalculate to see the effect.
        </p>
      )}

      <div className="flex gap-2" role="tablist">
        {[
          ["setup", "Setup"],
          ["rules", "Scales & rules"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "btn btn-primary" : "btn btn-secondary"}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "rules" && <PricingRules rooms={rooms} strategy={strategy} setField={setField} />}

      {tab === "setup" && (
        <>
          <div className="card card-pad space-y-2">
            <label className="label" htmlFor="floor-pct">
              1. Lowest rate you&apos;ll accept (% of each room&apos;s base rate)
            </label>
            <input
              id="floor-pct"
              type="number"
              min="1"
              max="100"
              className="input"
              style={{ width: 110 }}
              value={floorPct}
              onChange={(e) => setField("floor_pct", e.target.value)}
            />
            {example && (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {example.name} has a base rate of {example.basePrice}, so it will never be priced below{" "}
                {pctOf(example.basePrice, floorPct) ?? "—"}.
              </p>
            )}
          </div>

          <div className="card card-pad space-y-2">
            <p className="label">2. How bold should pricing be?</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(BOLDNESS).map(([key, b]) => (
                <button
                  key={key}
                  type="button"
                  className={boldness === key ? "btn btn-primary" : "btn"}
                  onClick={() => setField("max_change_pct", b.maxChangePct)}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {boldness
                ? BOLDNESS_HINTS[boldness]
                : `Custom: rates move at most ${strategy?.max_change_pct}% at a time.`}
            </p>
          </div>

          <button type="button" className="btn" onClick={() => setAdvanced((a) => !a)}>
            {advanced ? "Hide advanced settings" : "Advanced settings"}
          </button>

          {advanced && (
            <div className="space-y-3">
              <div className="card" style={{ overflowX: "auto" }}>
                <div className="card-pad space-y-2">
                  <p className="label">Limits per room type</p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Leave blank to follow the percentages. A rate typed here wins for that room.
                  </p>
                  <label className="label" htmlFor="ceiling-pct">
                    Highest rate (% of base rate)
                  </label>
                  <input
                    id="ceiling-pct"
                    type="number"
                    min="100"
                    className="input"
                    style={{ width: 110 }}
                    value={ceilingPct}
                    onChange={(e) => setField("ceiling_pct", e.target.value)}
                  />
                </div>
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th>Room type</th>
                      <th>Base rate</th>
                      <th>Floor (min)</th>
                      <th>Ceiling (max)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rooms.map((r) => (
                      <tr key={r.roomTypeId}>
                        <td style={{ fontWeight: 500 }}>{r.name}</td>
                        <td style={{ color: "var(--text-muted)" }}>
                          {r.basePrice != null ? r.basePrice : "—"}
                        </td>
                        <td>
                          <input
                            type="number"
                            className="input"
                            style={{ width: 110 }}
                            value={r.floor ?? ""}
                            placeholder={String(pctOf(r.basePrice, floorPct) ?? "None")}
                            onChange={(e) => setBound(r.roomTypeId, "floor", e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            className="input"
                            style={{ width: 110 }}
                            value={r.ceiling ?? ""}
                            placeholder={String(pctOf(r.basePrice, ceilingPct) ?? "None")}
                            onChange={(e) => setBound(r.roomTypeId, "ceiling", e.target.value)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="card card-pad space-y-2">
                <p className="label">Signal weights</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={!custom ? "btn btn-primary" : "btn"}
                    onClick={() => setField("weights_mode", "auto")}
                  >
                    Automatic
                  </button>
                  <button
                    type="button"
                    className={custom ? "btn btn-primary" : "btn"}
                    onClick={() => setField("weights_mode", "custom")}
                  >
                    Set my own
                  </button>
                </div>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {custom
                    ? "Your weights are used as typed. Zero switches a signal off."
                    : "Occupancy, weekday and events count from day one. Pickup and past rates gain weight as your own bookings build up, so new hotels are not priced on thin history."}
                </p>
                <label className="label" htmlFor="max-change">
                  Most a rate may move at once (%), if none of the three choices fits
                </label>
                <input
                  id="max-change"
                  type="number"
                  min="1"
                  max="100"
                  className="input"
                  style={{ width: 110 }}
                  value={strategy?.max_change_pct ?? 20}
                  onChange={(e) => setField("max_change_pct", e.target.value)}
                />
              </div>

              <SignalAvailability active={activeSignals} />

              {custom && (
                <div className="card" style={{ overflowX: "auto" }}>
                  <table className="grid-table">
                    <thead>
                      <tr>
                        <th>Signal</th>
                        <th>What it reads</th>
                        <th>Weight</th>
                      </tr>
                    </thead>
                    <tbody>
                      {SIGNALS.map((s) => (
                        <tr key={s.key}>
                          <td style={{ fontWeight: 500 }}>{s.label}</td>
                          <td style={{ color: "var(--text-muted)" }}>{s.hint}</td>
                          <td>
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              className="input"
                              style={{ width: 90 }}
                              value={strategy?.[s.key] ?? 0}
                              onChange={(e) => setField(s.key, e.target.value)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
