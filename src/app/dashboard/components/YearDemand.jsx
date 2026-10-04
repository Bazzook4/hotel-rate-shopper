"use client";

import { useEffect, useMemo, useState } from "react";
import { parseDateISO } from "@/lib/date";

/**
 * The coming year in small squares, one per day, so a weak month or a busy
 * weekend can be seen without paging through fourteen days at a time.
 *
 * One colour from light to dark rather than a rainbow: busier is darker, so
 * the order reads without the legend and without telling green from blue.
 * Every square also says its level in words on hover, and choosing one opens
 * the pricing grid at that date -- the strip is a way in, not a second grid.
 */

const LEVELS = [
  { id: "unknown", label: "Not enough data" },
  { id: "low", label: "Low", mix: 22 },
  { id: "normal", label: "Normal", mix: 45 },
  { id: "good", label: "Good", mix: 70 },
  { id: "high", label: "High", mix: 100 },
  { id: "closed", label: "Closed" },
];
const LEVEL_BY_ID = Object.fromEntries(LEVELS.map((l) => [l.id, l]));

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const CELL = 13;
const GAP = 3;

function swatch(level) {
  const l = LEVEL_BY_ID[level];
  if (level === "unknown") return { background: "var(--surface-2)", border: "1px solid var(--border)" };
  if (level === "closed") {
    return {
      background:
        "repeating-linear-gradient(45deg, var(--border-strong) 0 2px, var(--surface) 2px 4px)",
      border: "1px solid var(--border)",
    };
  }
  return {
    background: `color-mix(in srgb, var(--accent) ${l.mix}%, var(--surface))`,
    border: "1px solid transparent",
  };
}

function describe(day) {
  const d = parseDateISO(day.date);
  const parts = [
    d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }),
  ];
  if (day.level === "closed") parts.push("no rooms to sell");
  else if (day.level === "unknown") parts.push("nothing sold yet, no history");
  else {
    if (day.basis === "actual") parts.push(`${day.soldPct}% sold`);
    else {
      parts.push(`${day.soldPct}% sold so far`);
      if (day.lastYearPct != null) parts.push(`${day.lastYearPct}% last year`);
    }
    parts.push(LEVEL_BY_ID[day.level].label);
  }
  if (day.events?.length) parts.push(day.events.join(", "));
  if (day.minStay) parts.push("min stay set");
  return parts.join(" · ");
}

export default function YearDemand({ propertyId, onPick }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [readout, setReadout] = useState("");

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams();
    if (propertyId) qs.set("propertyId", propertyId);
    fetch(`/api/pricing/year?${qs}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((json) => !cancelled && setData(json))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  // Weeks as columns (Sunday first), days as rows, and where each month starts.
  const layout = useMemo(() => {
    if (!data?.days?.length) return null;
    const first = parseDateISO(data.days[0].date);
    const lead = first.getDay();
    const cells = data.days.map((day, i) => ({
      day,
      col: Math.floor((i + lead) / 7) + 2,
      row: ((i + lead) % 7) + 2,
    }));
    const weeks = cells[cells.length - 1].col - 1;
    const months = [];
    for (const c of cells) {
      if (c.day.date.endsWith("-01")) months.push({ key: c.day.date.slice(0, 7), col: c.col });
    }
    return { cells, weeks, months };
  }, [data]);

  if (failed) return null;
  if (!layout) {
    return (
      <div className="card card-pad">
        <p className="sub">Loading the year…</p>
      </div>
    );
  }

  const known = data.days.filter((d) => d.level !== "unknown" && d.level !== "closed").length;

  return (
    <div className="card card-pad space-y-3">
      <div>
        <h3 className="h2">How busy is the year?</h3>
        <p className="sub">
          From your own bookings: rooms sold so far, or the same weekday last year when that was
          fuller. Big events count one level up. Choose a day to price that week.
        </p>
      </div>

      <div style={{ overflowX: "auto", paddingBottom: 4 }}>
        <div
          role="grid"
          aria-label="Demand for each day of the coming year"
          style={{
            display: "grid",
            gridTemplateColumns: `30px repeat(${layout.weeks}, ${CELL}px)`,
            gridTemplateRows: `18px repeat(7, ${CELL}px)`,
            gap: GAP,
            width: "max-content",
          }}
        >
          {layout.months.map((m, i) => {
            const next = layout.months[i + 1]?.col ?? layout.weeks + 2;
            const pct = data.months[m.key];
            const label = parseDateISO(`${m.key}-01`).toLocaleDateString("en-GB", { month: "short" });
            return (
              <div
                key={m.key}
                className="text-xs"
                title={pct == null ? undefined : `${pct}% of room nights sold so far`}
                style={{
                  gridRow: 1,
                  gridColumn: `${m.col} / ${next}`,
                  color: "var(--text-muted)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                }}
              >
                {label}
                {pct != null && <span style={{ color: "var(--text-faint)" }}> {pct}%</span>}
              </div>
            );
          })}

          {WEEKDAYS.map((w, i) => (
            <div
              key={w}
              className="text-xs"
              style={{
                gridRow: i + 2,
                gridColumn: 1,
                color: "var(--text-faint)",
                fontSize: "0.62rem",
                lineHeight: `${CELL}px`,
              }}
            >
              {w}
            </div>
          ))}

          {layout.cells.map(({ day, col, row }) => {
            const text = describe(day);
            const past = day.date < data.today;
            const style = {
              ...swatch(day.level),
              gridRow: row,
              gridColumn: col,
              width: CELL,
              height: CELL,
              borderRadius: 2,
              padding: 0,
              position: "relative",
              outline: day.events?.length ? "2px solid var(--warn)" : undefined,
              outlineOffset: -1,
              opacity: past ? 0.55 : 1,
              boxShadow: day.date === data.today ? "0 0 0 2px var(--text)" : undefined,
            };
            const mark = day.minStay && (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  margin: "auto",
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  background: "var(--text)",
                }}
              />
            );
            if (past) {
              return (
                <span
                  key={day.date}
                  role="gridcell"
                  title={text}
                  aria-label={text}
                  style={style}
                  onMouseEnter={() => setReadout(text)}
                >
                  {mark}
                </span>
              );
            }
            return (
              <button
                key={day.date}
                type="button"
                role="gridcell"
                title={text}
                aria-label={text}
                style={{ ...style, cursor: "pointer" }}
                onMouseEnter={() => setReadout(text)}
                onFocus={() => setReadout(text)}
                onClick={() => onPick?.(day.date)}
              >
                {mark}
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-xs" style={{ minHeight: "1.2em", color: "var(--text-muted)" }}>
        {readout || (known === 0 ? "Fills in as bookings come in." : "Point at a day to see its figures.")}
      </p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs" style={{ color: "var(--text-muted)" }}>
        {LEVELS.map((l) => (
          <span key={l.id} className="inline-flex items-center gap-1">
            <span
              aria-hidden
              style={{ ...swatch(l.id), width: CELL, height: CELL, borderRadius: 2, display: "inline-block" }}
            />
            {l.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span
            aria-hidden
            style={{
              width: CELL,
              height: CELL,
              borderRadius: 2,
              display: "inline-block",
              outline: "2px solid var(--warn)",
              outlineOffset: -1,
            }}
          />
          Big event
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            aria-hidden
            style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--text)", display: "inline-block", margin: "0 4px" }}
          />
          Min stay set
        </span>
      </div>
    </div>
  );
}
