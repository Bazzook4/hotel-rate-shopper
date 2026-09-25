"use client";

import { useCallback, useEffect, useState } from "react";

/** The signals, in the order the settings list them. */
const SIGNALS = [
  { key: "weight_compset", label: "Competitor rates", hint: "Where you sit against the comp set median" },
  { key: "weight_occupancy", label: "Occupancy", hint: "How full you already are for that night" },
  { key: "weight_weekday", label: "Weekday / weekend", hint: "The usual shape of the week" },
  { key: "weight_pickup", label: "Pickup", hint: "Bookings taken lately, against your usual pace" },
  { key: "weight_adr_90", label: "Last 90 days ADR", hint: "What you have achieved recently" },
  { key: "weight_adr_ly", label: "Last year, same date", hint: "Annual shape a 90-day window misses" },
  { key: "weight_events", label: "Events", hint: "Events near you on that date" },
];

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
        their weight is shared among the signals that do — so you can set them now and they start
        working on their own.
      </p>
    </div>
  );
}

export default function PricingSettings({ propertyId, onClose, activeSignals }) {
  const [rooms, setRooms] = useState([]);
  const [strategy, setStrategy] = useState(null);
  const [tab, setTab] = useState("bounds");
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="h2">Pricing settings</h3>
          <p className="sub">What the algorithm may do, and what it pays attention to.</p>
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

      <div className="flex gap-2">
        <button
          type="button"
          className={tab === "bounds" ? "btn btn-primary" : "btn"}
          onClick={() => setTab("bounds")}
        >
          Floor and ceiling
        </button>
        <button
          type="button"
          className={tab === "algorithm" ? "btn btn-primary" : "btn"}
          onClick={() => setTab("algorithm")}
        >
          Algorithm
        </button>
      </div>

      {tab === "bounds" ? (
        <div className="card" style={{ overflowX: "auto" }}>
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
                      placeholder="None"
                      onChange={(e) => setBound(r.roomTypeId, "floor", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className="input"
                      style={{ width: 110 }}
                      value={r.ceiling ?? ""}
                      placeholder="None"
                      onChange={(e) => setBound(r.roomTypeId, "ceiling", e.target.value)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="card-pad">
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              A recommendation is never allowed past these, whatever the signals say. Leave either
              blank to set no limit.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <SignalAvailability active={activeSignals} />

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
                        onChange={(e) => {
                          setSaved(false);
                          setStrategy((st) => ({ ...st, [s.key]: e.target.value }));
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card card-pad">
            <label className="label" htmlFor="max-change">
              Most a rate may move at once (%)
            </label>
            <input
              id="max-change"
              type="number"
              min="1"
              max="100"
              className="input"
              style={{ width: 110 }}
              value={strategy?.max_change_pct ?? 25}
              onChange={(e) => {
                setSaved(false);
                setStrategy((st) => ({ ...st, max_change_pct: e.target.value }));
              }}
            />
            <p className="text-xs" style={{ color: "var(--text-muted)", marginTop: 6 }}>
              A guard against one noisy signal producing a rate nobody would sanction. Zero weight
              switches a signal off entirely.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
