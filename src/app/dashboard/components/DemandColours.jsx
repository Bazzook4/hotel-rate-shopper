"use client";

import { useEffect, useState } from "react";
import { DEMAND_LEVELS, levelRanges } from "@/lib/demandColours";

/**
 * The hotel's occupancy-colour settings, for one grid ("calendar" or "cm").
 * Null while loading, when the hotel has them off, or when this grid is not
 * one it chose -- so a grid draws its usual headers unless asked otherwise.
 */
export function useDemandPrefs(propertyId, grid) {
  const [prefs, setPrefs] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setPrefs(null);
    const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : "";
    fetch(`/api/setup/display${qs}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        const d = json?.demand;
        if (!cancelled && d?.enabled && d[grid]) setPrefs(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [propertyId, grid]);
  return prefs;
}

/** What each colour means, in words, beside the grid. */
export function DemandKey({ prefs }) {
  if (!prefs) return null;
  const ranges = levelRanges(prefs.thresholds);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs muted">
      <span>Rooms sold:</span>
      {DEMAND_LEVELS.map((l) => (
        <span key={l.id} className="inline-flex items-center gap-1">
          <span
            aria-hidden
            style={{
              width: 12,
              height: 12,
              borderRadius: 3,
              background: prefs.colours[l.id],
              border: "1px solid var(--border)",
            }}
          />
          {l.label} {ranges[l.id]}
        </span>
      ))}
    </div>
  );
}
