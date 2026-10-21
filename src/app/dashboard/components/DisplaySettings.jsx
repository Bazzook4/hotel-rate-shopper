"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_DEMAND,
  DEMAND_LEVELS,
  inkOn,
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

function Check({ checked, onChange, disabled, children }) {
  return (
    <label className="flex items-center gap-1.5 text-sm" style={{ opacity: disabled ? 0.5 : 1 }}>
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
        <p className="sub">Loading...</p>
      </div>
    );
  }

  const off = !demand.enabled;
  const valid = !thresholdProblem(demand.thresholds);
  const ranges = valid ? levelRanges(demand.thresholds.map(Number)) : {};
  const small = { padding: "0.3rem 0.75rem" };

  return (
    <form onSubmit={save} className="card card-pad space-y-3">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="h2">Occupancy colours</h3>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Check checked={demand.enabled} onChange={(v) => set({ enabled: v })}>
              <span className="font-medium">Turn on</span>
            </Check>
            <Check checked={demand.calendar} disabled={off} onChange={(v) => set({ calendar: v })}>
              Calendar
            </Check>
            <Check checked={demand.cm} disabled={off} onChange={(v) => set({ cm: v })}>
              Rates &amp; Inventory
            </Check>
          </div>
        </div>
        <p className="sub">Tint each date by rooms sold so far. The % always shows too.</p>
      </div>

      {/* Each level is drawn in its own colour, so the row is its own
          preview: the swatch picks the colour, the box sets where it starts. */}
      <div className="flex flex-wrap items-center gap-2">
        <fieldset
          disabled={off}
          className="flex flex-wrap items-center gap-1.5"
          style={{ opacity: off ? 0.5 : 1 }}
        >
          <legend className="sr-only">Levels and colours</legend>
          {DEMAND_LEVELS.map((l, i) => {
            const bg = demand.colours[l.id];
            const ink = inkOn(bg);
            return (
              <div
                key={l.id}
                className="flex items-center gap-1.5 text-xs"
                style={{
                  background: bg,
                  color: ink,
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: "0.2rem 0.4rem",
                  minHeight: "2rem",
                }}
              >
                <label
                  className="flex items-center gap-1.5"
                  title={`Change the ${l.label} colour`}
                  style={{ cursor: "pointer" }}
                >
                  <input
                    type="color"
                    className="demand-swatch"
                    aria-label={`${l.label} colour`}
                    value={bg}
                    onChange={(e) => setColour(l.id, e.target.value)}
                    style={{ border: `1px solid ${ink}` }}
                  />
                  <span className="font-semibold">{l.label}</span>
                </label>
                {i === 0 ? (
                  <span>{valid ? ranges.low : "below Normal"}</span>
                ) : (
                  <label className="flex items-center gap-0.5">
                    <span aria-hidden>≥</span>
                    <input
                      type="number"
                      className="demand-pct"
                      aria-label={`${l.label} starts at, percent sold`}
                      min={1}
                      max={100}
                      value={demand.thresholds[i - 1]}
                      onChange={(e) => setThreshold(i - 1, e.target.value)}
                    />
                    %
                  </label>
                )}
              </div>
            );
          })}
        </fieldset>

        <div className="flex items-center gap-2 sm:ml-auto">
          <button
            type="button"
            className="btn btn-ghost text-xs"
            style={small}
            disabled={busy || off}
            onClick={() =>
              set({ thresholds: [...DEFAULT_DEMAND.thresholds], colours: { ...DEFAULT_DEMAND.colours } })
            }
          >
            Reset
          </button>
          <button type="submit" className="btn btn-primary" style={small} disabled={busy}>
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

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
    </form>
  );
}
