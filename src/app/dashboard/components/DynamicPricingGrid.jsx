"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, formatDateISO, parseDateISO, todayUTC } from "@/lib/date";
import PricingSettings from "./PricingSettings";

const WINDOW_DAYS = 14;

function ageLabel(iso) {
  if (!iso) return "Never calculated";
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "Calculated just now";
  if (minutes < 60) return `Calculated ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Calculated ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `Calculated ${days} day${days === 1 ? "" : "s"} ago`;
}

function money(v) {
  return v == null ? "—" : Math.round(v).toLocaleString("en-IN");
}

/**
 * One room's rate for one night: what it is now, and what is proposed.
 *
 * The old rate stays visible beside the new one because the change is the
 * thing being judged, not the number itself. Colour follows direction, and a
 * cell held at a bound says so, since "the algorithm wanted more but your
 * ceiling stopped it" is a different fact from "this is the right rate".
 */
function RateCell({ cell, selected, onToggle, onExplain }) {
  if (!cell) {
    return (
      <td className="text-center" style={{ color: "var(--text-faint)" }}>
        —
      </td>
    );
  }

  const change = cell.current ? ((cell.recommended - cell.current) / cell.current) * 100 : null;
  const decided = cell.status !== "pending";
  const up = change != null && change > 0.5;
  const down = change != null && change < -0.5;

  return (
    <td
      className="text-center"
      style={{
        background: decided
          ? "var(--surface-2)"
          : up
          ? "var(--accent-soft)"
          : down
          ? "var(--warn-soft)"
          : undefined,
      }}
    >
      <label className="inline-flex items-center gap-1" style={{ cursor: decided ? "default" : "pointer" }}>
        {!decided && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(cell.id)}
            aria-label={`Select ${money(cell.recommended)}`}
          />
        )}
        <span style={{ color: "var(--text-muted)", textDecoration: "line-through", fontSize: "0.78rem" }}>
          {money(cell.current)}
        </span>
        <span aria-hidden style={{ color: "var(--text-faint)" }}>→</span>
        <button
          type="button"
          onClick={() => onExplain(cell)}
          title="Why this rate?"
          style={{
            fontWeight: 600,
            color: up ? "var(--accent-text)" : down ? "var(--warn)" : "var(--text)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
        >
          {money(cell.recommended)}
        </button>
      </label>
      {cell.boundedBy && (
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
          at {cell.boundedBy}
        </div>
      )}
      {decided && (
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
          {cell.status}
        </div>
      )}
    </td>
  );
}

/** Why a rate was proposed. The reasons are what make it arguable. */
function Explain({ cell, onClose }) {
  if (!cell) return null;
  const change = cell.current ? ((cell.recommended - cell.current) / cell.current) * 100 : null;

  return (
    <div className="card card-pad space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h4 className="h2">
          {money(cell.current)} → {money(cell.recommended)}
          {change != null && (
            <span className="text-sm" style={{ marginLeft: 8, color: "var(--text-muted)" }}>
              {change > 0 ? "+" : ""}
              {change.toFixed(1)}%
            </span>
          )}
        </h4>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
      {cell.reasons?.length ? (
        <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
          {cell.reasons.map((r, i) => (
            <li key={i} className="text-sm" style={{ color: "var(--text-muted)" }}>
              {r.note}
              {r.pct != null && (
                <span style={{ color: r.pct > 0 ? "var(--accent-text)" : r.pct < 0 ? "var(--warn)" : undefined }}>
                  {" "}
                  ({r.pct > 0 ? "+" : ""}
                  {r.pct}%{r.weight != null ? `, weight ${r.weight}` : ""})
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="sub">No reasons recorded.</p>
      )}
    </div>
  );
}

export default function DynamicPricingGrid({ session }) {
  const propertyId = session?.propertyId || session?.property_id || null;

  const [anchor, setAnchor] = useState(() => todayUTC());
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [explain, setExplain] = useState(null);
  const [settings, setSettings] = useState(false);

  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeSignals, setActiveSignals] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ start: anchor, days: String(WINDOW_DAYS) });
      if (propertyId) params.set("propertyId", propertyId);
      const res = await fetch(`/api/pricing/recommendations?${params}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || "Could not load recommendations.");
        return;
      }
      setData(json);
      setSelected(new Set());
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [anchor, propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  async function calculate() {
    setCalculating(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/pricing/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, start: anchor, days: WINDOW_DAYS }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || "Could not calculate recommendations.");
        return;
      }
      setActiveSignals(json.activeSignals || []);
      setNotice(
        `Priced ${json.roomTypes} room types across ${WINDOW_DAYS} nights using ${
          json.activeSignals?.length || 0
        } signal${json.activeSignals?.length === 1 ? "" : "s"}.`
      );
      await load();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setCalculating(false);
    }
  }

  async function decide(decision) {
    if (selected.size === 0) return;
    setApplying(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/pricing/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, ids: [...selected], decision }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || "Could not apply those rates.");
        return;
      }
      if (decision === "dismissed") {
        setNotice(`Dismissed ${json.dismissed} recommendation${json.dismissed === 1 ? "" : "s"}.`);
      } else if (json.warning) {
        // Saved but not sent is a real distinction, not a failure.
        setNotice(json.warning);
      } else {
        setNotice(
          `Applied ${json.applied} rate${json.applied === 1 ? "" : "s"} and sent them to your channels.`
        );
      }
      await load();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setApplying(false);
    }
  }

  function toggle(id) {
    setSelected((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Every pending cell in a column, so a whole date can be taken at once. */
  function toggleDate(date) {
    const ids = (data?.rooms || [])
      .map((r) => r.cells[date])
      .filter((c) => c && c.status === "pending")
      .map((c) => c.id);
    setSelected((set) => {
      const next = new Set(set);
      const allOn = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  const pendingCount = useMemo(
    () =>
      (data?.rooms || []).reduce(
        (n, r) => n + Object.values(r.cells).filter((c) => c.status === "pending").length,
        0
      ),
    [data]
  );

  const today = formatDateISO(new Date());

  if (settings) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="h1">Dynamic pricing</h2>
          <p className="sub">Settings</p>
        </div>
        <PricingSettings
          propertyId={data?.propertyId || propertyId}
          activeSignals={activeSignals}
          onClose={() => {
            setSettings(false);
            load();
          }}
        />
      </div>
    );
  }

  if (loading && !data) return <p className="sub">Loading dynamic pricing…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="h1">Dynamic pricing</h2>
          <p className="sub">
            Rate recommendations from your comp set, occupancy and trading history. Accepting one
            sends it to your channels.
          </p>
        </div>
        <button type="button" className="btn" onClick={() => setSettings(true)}>
          Settings
        </button>
      </div>

      {/* Controls */}
      <div className="card card-pad flex flex-wrap items-end gap-4">
        <div>
          <label className="label">Dates</label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn"
              onClick={() => setAnchor(formatDateISO(addDays(parseDateISO(anchor), -WINDOW_DAYS)))}
              aria-label="Previous dates"
            >
              ‹
            </button>
            <span className="text-sm" style={{ minWidth: 160, textAlign: "center" }}>
              {parseDateISO(data?.start)?.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              {" – "}
              {parseDateISO(data?.end)?.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </span>
            <button
              type="button"
              className="btn"
              onClick={() => setAnchor(formatDateISO(addDays(parseDateISO(anchor), WINDOW_DAYS)))}
              aria-label="Next dates"
            >
              ›
            </button>
            <button type="button" className="btn" onClick={() => setAnchor(todayUTC())}>
              Today
            </button>
          </div>
        </div>

        <div className="ml-auto flex gap-2">
          <button type="button" className="btn" onClick={calculate} disabled={calculating}>
            {calculating ? "Calculating…" : "Recalculate"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => decide("dismissed")}
            disabled={applying || selected.size === 0}
          >
            Dismiss
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => decide("accepted")}
            disabled={applying || selected.size === 0}
          >
            {applying ? "Applying…" : `Apply selected${selected.size ? ` (${selected.size})` : ""}`}
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
      {notice && <p className="sub">{notice}</p>}

      {explain && <Explain cell={explain} onClose={() => setExplain(null)} />}

      {/* Grid */}
      {data?.rooms?.length ? (
        pendingCount === 0 && !data.calculatedAt ? (
          <div className="card card-pad">
            <p className="sub">
              No recommendations yet. Choose <strong>Recalculate</strong> to price these nights.
            </p>
          </div>
        ) : (
          <div className="card" style={{ overflowX: "auto" }}>
            <table className="grid-table">
              <thead>
                <tr>
                  <th style={{ minWidth: 170, position: "sticky", left: 0, zIndex: 1 }}>Room type</th>
                  {data.dates.map((d) => {
                    const parsed = parseDateISO(d);
                    return (
                      <th
                        key={d}
                        className="text-center"
                        style={{
                          minWidth: 132,
                          background: d === today ? "var(--accent-soft)" : undefined,
                          cursor: "pointer",
                        }}
                        onClick={() => toggleDate(d)}
                        title="Select this whole date"
                      >
                        <div style={{ fontSize: "0.62rem" }}>
                          {parsed?.toLocaleDateString("en-GB", { weekday: "short" })}
                        </div>
                        <div style={{ fontSize: "0.85rem", color: "var(--text)" }}>
                          {parsed?.getDate()}{" "}
                          {parsed?.toLocaleDateString("en-GB", { month: "short" })}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {data.rooms.map((room) => (
                  <tr key={room.roomTypeId}>
                    <td style={{ position: "sticky", left: 0, background: "var(--surface)", zIndex: 1 }}>
                      <div style={{ fontWeight: 500 }}>{room.name}</div>
                      {(room.floor != null || room.ceiling != null) && (
                        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {room.floor != null ? `floor ${money(room.floor)}` : ""}
                          {room.floor != null && room.ceiling != null ? " · " : ""}
                          {room.ceiling != null ? `ceiling ${money(room.ceiling)}` : ""}
                        </div>
                      )}
                    </td>
                    {data.dates.map((d) => (
                      <RateCell
                        key={d}
                        cell={room.cells[d]}
                        selected={selected.has(room.cells[d]?.id)}
                        onToggle={toggle}
                        onExplain={setExplain}
                      />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <div className="card card-pad">
          <p className="sub">Add your room types in Room Setup before running dynamic pricing.</p>
        </div>
      )}

      <p className="text-xs" style={{ color: "var(--text-faint)" }}>
        {ageLabel(data?.calculatedAt)} · {pendingCount} awaiting a decision. Choose a rate to see why
        it was proposed, or a date heading to select the whole column. Applying writes the rate and
        publishes it through Rates &amp; Inventory.
      </p>
    </div>
  );
}
