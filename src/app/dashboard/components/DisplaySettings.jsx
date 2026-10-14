"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_DEMAND,
  DEMAND_LEVELS,
  demandFor,
  levelRanges,
  thresholdProblem,
} from "@/lib/demandColours";

/**
 * How the hotel wants its screens to look, for Property Setup.
 *
 * Today that is the occupancy colours on the Calendar and Rates & Inventory
 * date headers. They are off until the hotel turns them on, and the hotel
 * chooses the grids, where each level starts and every colour.
 */

// What a header looks like at each level, for the preview.
const SAMPLES = [
  { day: "Mon", pct: 20 },
  { day: "Tue", pct: 50 },
  { day: "Wed", pct: 72 },
  { day: "Thu", pct: 90 },
];

function Check({ checked, onChange, disabled, children }) {
  return (
    <label className="flex items-center gap-2 text-sm" style={{ opacity: disabled ? 0.5 : 1 }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {children}
    </label>
  );
}

export default function DisplaySettings({ propertyId }) {
  const [demand, setDemand] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const scope = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : "";

  useEffect(() => {
    let cancelled = false;
    setDemand(null);
    setError("");
    setNotice("");
    fetch(`/api/setup/display${scope}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Could not load the display settings.");
        if (!cancelled) setDemand(json.demand);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setDemand(DEFAULT_DEMAND);
      });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const set = (patch) => {
    setNotice("");
    setDemand((d) => ({ ...d, ...patch }));
  };
  const setThreshold = (i, value) =>
    set({ thresholds: demand.thresholds.map((t, j) => (j === i ? value : t)) });
  const setColour = (id, value) => set({ colours: { ...demand.colours, [id]: value } });

  async function save(e) {
    e.preventDefault();
    const problem = thresholdProblem(demand.thresholds);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/setup/display", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: propertyId || undefined,
          demand: { ...demand, thresholds: demand.thresholds.map(Number) },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not save the display settings.");
      setDemand(json.demand);
      setNotice(
        json.demand.enabled
          ? "Saved. The grids show the new colours the next time they open."
          : "Saved. Occupancy colours are off."
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!demand) {
    return (
      <div className="card card-pad">
        <p className="sub">Loading…</p>
      </div>
    );
  }

  const off = !demand.enabled;
  const valid = !thresholdProblem(demand.thresholds);
  const ranges = valid ? levelRanges(demand.thresholds.map(Number)) : {};
  const previewPrefs = { ...demand, thresholds: demand.thresholds.map(Number) };

  return (
    <form onSubmit={save} className="card card-pad space-y-4">
      <div>
        <h3 className="h2">Occupancy colours</h3>
        <p className="sub">
          Colour each date on the Calendar and Rates &amp; Inventory by how full the hotel is,
          from the rooms sold so far. Every date also shows its percentage, so the colours
          never have to be read alone. Off until you turn it on.
        </p>
      </div>

      <div className="space-y-2">
        <Check checked={demand.enabled} onChange={(v) => set({ enabled: v })}>
          Show occupancy colours
        </Check>
        <div className="flex flex-wrap gap-x-5 gap-y-2 pl-6">
          <Check checked={demand.calendar} disabled={off} onChange={(v) => set({ calendar: v })}>
            Front desk Calendar
          </Check>
          <Check checked={demand.cm} disabled={off} onChange={(v) => set({ cm: v })}>
            Rates &amp; Inventory
          </Check>
        </div>
      </div>

      <fieldset className="space-y-2" disabled={off} style={{ opacity: off ? 0.5 : 1 }}>
        <legend className="label">Levels and colours</legend>
        <div className="grid gap-3 sm:grid-cols-4">
          {DEMAND_LEVELS.map((l, i) => (
            <div key={l.id} className="space-y-1">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label={`${l.label} colour`}
                  value={demand.colours[l.id]}
                  onChange={(e) => setColour(l.id, e.target.value)}
                  style={{ width: 36, height: 28, padding: 0, border: "1px solid var(--border)", borderRadius: 4 }}
                />
                <span className="text-sm font-medium">{l.label}</span>
              </div>
              {i === 0 ? (
                <p className="text-xs muted">{valid ? ranges.low : "below Normal"}</p>
              ) : (
                <label className="flex items-center gap-1 text-xs muted">
                  from
                  <input
                    type="number"
                    className="input"
                    min={1}
                    max={100}
                    value={demand.thresholds[i - 1]}
                    onChange={(e) => setThreshold(i - 1, e.target.value)}
                    style={{ width: "4.5rem" }}
                  />
                  % sold
                </label>
              )}
            </div>
          ))}
        </div>

        {valid && (
          <div>
            <span className="label">Preview</span>
            <div className="flex gap-1">
              {SAMPLES.map((s) => {
                const look = demandFor(previewPrefs, s.pct, 100);
                return (
                  <div
                    key={s.day}
                    title={look.title}
                    className="text-center text-xs"
                    style={{
                      width: 56,
                      padding: "0.35rem 0",
                      borderRadius: 4,
                      border: "1px solid var(--border)",
                      background: look.background,
                      color: look.color,
                    }}
                  >
                    <div>{s.day}</div>
                    <div style={{ fontWeight: 600 }}>{s.pct}%</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </fieldset>

      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="text-sm" style={{ color: "var(--accent-text)" }}>
          {notice}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() =>
            set({ thresholds: [...DEFAULT_DEMAND.thresholds], colours: { ...DEFAULT_DEMAND.colours } })
          }
        >
          Reset colours and levels
        </button>
      </div>
    </form>
  );
}
