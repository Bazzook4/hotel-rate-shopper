"use client";

import { useEffect, useRef, useState } from "react";
import { addDays, formatDateISO, parseDateISO } from "@/lib/date";
import { categoryLabel, impactOf } from "@/lib/eventTags";

/**
 * Events on a date header, wherever someone decides about a night.
 *
 * The Calendar and the Channel Manager both show the events this hotel sees
 * -- the same list as Insights → Events and the same one Dynamic Pricing
 * reads -- so a person setting a rate or taking a booking knows the town is
 * full that week without opening another page.
 *
 * Reading events never blocks a grid: a failure, a missing migration or a
 * user without the rights simply shows no markers.
 */

const RANK = { high: 3, medium: 2, low: 1, none: 0 };

/** Colours per impact, from the theme's tokens. */
const TONE = {
  high: { background: "var(--warn-soft)", color: "var(--warn)", border: "var(--warn)" },
  medium: { background: "var(--accent-soft)", color: "var(--accent-text)", border: "var(--accent)" },
  low: { background: "var(--surface-2)", color: "var(--text-muted)", border: "var(--border-strong)" },
  none: { background: "var(--surface)", color: "var(--text-muted)", border: "var(--border-strong)" },
};

/**
 * The events on each date from `start` to `end`, biggest first:
 * `{ "2026-11-08": [event, ...] }`.
 */
export function useEventsByDate(propertyId, start, end) {
  const [byDate, setByDate] = useState({});

  useEffect(() => {
    if (!start || !end) return undefined;
    let cancelled = false;
    const qs = new URLSearchParams({ start, end });
    if (propertyId) qs.set("propertyId", propertyId);
    fetch(`/api/events?${qs}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json) return;
        const out = {};
        for (const e of json.events || []) {
          const from = e.start_date > start ? e.start_date : start;
          const to = e.end_date < end ? e.end_date : end;
          for (let d = parseDateISO(from); formatDateISO(d) <= to; d = addDays(d, 1)) {
            (out[formatDateISO(d)] ||= []).push(e);
          }
        }
        for (const list of Object.values(out)) {
          list.sort((a, b) => (RANK[b.impact] || 0) - (RANK[a.impact] || 0));
        }
        setByDate(out);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [propertyId, start, end]);

  return byDate;
}

function formatRange(start, end) {
  const fmt = (iso) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
}

/**
 * The marker for one date: the biggest event's name, "+2" when there are
 * more, coloured by impact. Tapping it lists them all, since a tooltip does
 * not exist on a phone.
 */
export default function EventMarker({ events }) {
  const [at, setAt] = useState(null);
  const btn = useRef(null);
  const box = useRef(null);

  useEffect(() => {
    if (!at) return undefined;
    const close = (e) => {
      if (box.current?.contains(e.target) || btn.current?.contains(e.target)) return;
      setAt(null);
    };
    const esc = (e) => e.key === "Escape" && setAt(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", close, true);
    };
  }, [at]);

  if (!events?.length) return null;
  const top = events[0];
  const tone = TONE[top.impact] || TONE.low;
  const summary = events.map((e) => `${e.name} (${impactOf(e.impact).label.toLowerCase()})`).join("\n");

  function toggle(e) {
    // Inside a clickable row header the tap is for the marker alone.
    e.stopPropagation();
    if (at) {
      setAt(null);
      return;
    }
    const r = btn.current.getBoundingClientRect();
    const width = 260;
    setAt({
      top: r.bottom + 6,
      left: Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8)),
      width,
    });
  }

  return (
    <>
      {/* Zero width, stretched to the cell: the marker takes the date
          column's width instead of setting it, so a long name like
          "Dussehra long weekend" is cut short rather than widening its
          column. The full list is a tap away. */}
      <div style={{ width: 0, minWidth: "100%" }}>
      <button
        ref={btn}
        type="button"
        onClick={toggle}
        title={summary}
        aria-label={`Events: ${summary.replace(/\n/g, ", ")}`}
        className="mx-auto mt-1 block max-w-full truncate"
        style={{
          fontSize: 9,
          lineHeight: "14px",
          fontWeight: 600,
          padding: "0 4px",
          borderRadius: 4,
          background: tone.background,
          color: tone.color,
          border: `1px solid ${tone.border}`,
          textTransform: "none",
          letterSpacing: 0,
        }}
      >
        {top.name}
        {events.length > 1 ? ` +${events.length - 1}` : ""}
      </button>
      </div>

      {at && (
        <div
          ref={box}
          role="dialog"
          aria-label="Events on this night"
          className="card"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: at.top,
            left: at.left,
            width: at.width,
            zIndex: 60,
            padding: "0.5rem 0.75rem",
            textAlign: "left",
            textTransform: "none",
            letterSpacing: 0,
            boxShadow: "0 12px 32px rgba(15, 23, 42, 0.25)",
          }}
        >
          <ul className="space-y-2">
            {events.map((e) => {
              const t = TONE[e.impact] || TONE.low;
              return (
                <li key={e.id} className="text-sm" style={{ color: "var(--text)", fontWeight: 400 }}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold">{e.name}</span>
                    <span
                      className="shrink-0 text-[10px] font-semibold"
                      style={{ padding: "0 6px", borderRadius: 999, background: t.background, color: t.color }}
                    >
                      {impactOf(e.impact).label}
                    </span>
                  </div>
                  <div className="text-xs muted">
                    {categoryLabel(e.category)} · {formatRange(e.start_date, e.end_date)}
                    {e.property_id ? " · this hotel only" : ""}
                  </div>
                  {e.notes && <div className="text-xs faint">{e.notes}</div>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
