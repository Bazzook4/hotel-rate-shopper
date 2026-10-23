"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";
import usePopupClose from "./usePopupClose";
import { addDays, formatDateISO, parseDateISO } from "@/lib/date";
import { hotelToday } from "@/lib/hotelTime";

const DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The app's own calendar, opened under the element it belongs to.
 *
 * The browser's date picker looks different in every browser -- on a Mac a
 * small grey sheet with a dot for today -- and never matched the rest of the
 * app. This one is a .pop panel like every other menu: weeks start on
 * Monday, today is ringed, the chosen day is filled, days outside `min` and
 * `max` cannot be picked.
 *
 * The title jumps further: click it for the months of the year, click again
 * for a span of years. `unit="month"` starts at the months and picks the
 * first of the month.
 *
 * Keyboard: the highlighted day holds focus; arrows move a day (a month, a
 * year), Page Up / Page Down a month (a year), Enter picks, Escape closes,
 * Tab goes back to the field. "Today" is the desk's own day, not UTC's, so
 * the night audit after midnight sees the right one.
 *
 * `takeFocus={false}` leaves focus where it is, for a field the desk is
 * typing into; the arrow keys there hand focus over (DateField).
 *
 *   <DatePicker anchor={btnRef} value="2026-10-21" min={today}
 *     onChange={(iso) => ...} onClose={() => setOpen(false)} />
 */
export default function DatePicker({
  anchor,
  value,
  min,
  max,
  unit = "day",
  takeFocus = true,
  boxRef,
  onChange,
  onClose,
}) {
  const box = useRef(null);
  const [at, setAt] = useState(null);
  const base = unit === "month" ? "months" : "days";
  const [view, setView] = useState(base);
  const today = hotelToday();
  const [focus, setFocus] = useState(() => parseDateISO(value) || parseDateISO(today));
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // A date typed into the field moves the calendar to it.
  useEffect(() => {
    const d = parseDateISO(value);
    if (d) setFocus(d);
  }, [value]);

  useEffect(() => {
    const r = anchor.current?.getBoundingClientRect();
    if (!r) return;
    const width = 280;
    const height = 340;
    const below = window.innerHeight - r.bottom;
    let place;
    if (below >= height + 8 || below >= r.top) place = { top: Math.min(r.bottom + 6, window.innerHeight - height - 8) };
    else place = { bottom: Math.min(window.innerHeight - r.top + 6, window.innerHeight - height - 8) };
    // On a screen too short for either, it keeps to the top edge.
    if ((place.top ?? 0) < 8 && place.bottom == null) place.top = 8;
    if (place.bottom != null && place.bottom < 8) place.bottom = 8;
    setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), ...place });
  }, [anchor]);

  // The highlighted day holds focus, so a screen reader reads it as it
  // moves; only once the calendar has focus, never out of a field being typed in.
  const wantFocus = useRef(takeFocus);
  useEffect(() => {
    if (!at) return;
    if (wantFocus.current || box.current?.contains(document.activeElement)) {
      wantFocus.current = false;
      box.current?.querySelector(".cal-focus")?.focus();
    }
  }, [at, focus, view]);

  useEffect(() => {
    if (boxRef) boxRef.current = box.current;
  });

  usePopupClose(Boolean(at), [box, anchor], () => closeRef.current());

  const year = focus.getFullYear();
  const month = focus.getMonth();
  const decade = year - (year % 12);
  const iso = (d) => formatDateISO(d);

  /** Whether any day of the period starting at `d` can be picked. */
  function outside(d, kind) {
    const first = iso(d);
    const last =
      kind === "days" ? first : kind === "months" ? iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) : `${d.getFullYear()}-12-31`;
    return Boolean((min && last < min) || (max && first > max));
  }

  function done() {
    onClose();
    anchor.current?.querySelector?.("input")?.focus() || anchor.current?.focus?.();
  }

  function pick(d) {
    if (view === "years") {
      setFocus(new Date(d.getFullYear(), month, 1));
      setView("months");
    } else if (view === "months" && base === "days") {
      setFocus(new Date(year, d.getMonth(), Math.min(focus.getDate(), 28)));
      setView("days");
    } else if (!outside(d, view)) {
      onChange(view === "months" ? `${iso(d).slice(0, 7)}-01` : iso(d));
      done();
    }
  }

  function shift(n) {
    if (view === "days") setFocus(new Date(year, month + n, Math.min(focus.getDate(), 28)));
    else setFocus(new Date(year + n * (view === "years" ? 12 : 1), month, 1));
  }

  function onKeyDown(e) {
    // On the arrows and the title, Enter and Space press that button.
    const onDay = e.target.classList?.contains("cal-day");
    if ((e.key === "Enter" || e.key === " ") && !onDay && e.target !== box.current) return;
    const across = view === "days" ? 7 : 3;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -across, ArrowDown: across }[e.key];
    if (step) {
      if (view === "days") setFocus(addDays(focus, step));
      else if (view === "months") setFocus(new Date(year, month + step, 1));
      else setFocus(new Date(year + step, month, 1));
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      shift(e.key === "PageUp" ? -1 : 1);
    } else if (e.key === "Enter" || e.key === " ") {
      if (onDay) return; // the day's own click picks it
      pick(focus);
    } else if (e.key === "Escape") {
      done();
    } else if (e.key === "Tab") {
      // Back to the field first, so Tab moves on from there.
      anchor.current?.querySelector?.("input")?.focus() || anchor.current?.focus?.();
      onClose();
      return;
    } else return;
    e.preventDefault();
  }

  // Six weeks from the Monday on or before the 1st, so the panel never
  // changes height from one month to the next.
  const first = new Date(year, month, 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));

  let cells;
  let title;
  let prevOff;
  let nextOff;
  if (view === "days") {
    title = first.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    cells = Array.from({ length: 42 }, (_, i) => {
      const d = addDays(start, i);
      const key = iso(d);
      return {
        d,
        key,
        label: d.getDate(),
        aria: d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
        on: key === value,
        today: key === today,
        focus: key === iso(focus),
        out: d.getMonth() !== month,
      };
    });
    prevOff = Boolean(min) && iso(first) <= min;
    nextOff = Boolean(max) && iso(new Date(year, month + 1, 0)) >= max;
  } else if (view === "months") {
    title = String(year);
    cells = MONTHS.map((name, m) => {
      const d = new Date(year, m, 1);
      const key = iso(d).slice(0, 7);
      return { d, key, label: name, on: key === value?.slice(0, 7), today: key === today.slice(0, 7), focus: m === month };
    });
    prevOff = Boolean(min) && year <= Number(min.slice(0, 4));
    nextOff = Boolean(max) && year >= Number(max.slice(0, 4));
  } else {
    title = `${decade} to ${decade + 11}`;
    cells = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(decade + i, 0, 1);
      const y = decade + i;
      return { d, key: String(y), label: y, on: String(y) === value?.slice(0, 4), today: String(y) === today.slice(0, 4), focus: y === year };
    });
    prevOff = Boolean(min) && decade <= Number(min.slice(0, 4));
    nextOff = Boolean(max) && decade + 11 >= Number(max.slice(0, 4));
  }

  if (!at) return null;

  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label={unit === "month" ? "Pick a month" : "Pick a date"}
      tabIndex={-1}
      className="pop cal"
      style={{ position: "fixed", left: at.left, top: at.top, bottom: at.bottom, outline: "none" }}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => e.target === box.current && e.preventDefault()}
    >
      <div className="cal-head">
        <button
          type="button"
          className="cal-nav"
          onClick={() => shift(-1)}
          disabled={prevOff}
          aria-label={view === "days" ? "Previous month" : view === "months" ? "Previous year" : "Earlier years"}
        >
          <Icon name="left" size={16} />
        </button>
        <button
          type="button"
          className="cal-title"
          onClick={() => setView(view === "days" ? "months" : "years")}
          disabled={view === "years"}
          aria-live="polite"
          title={view === "years" ? undefined : view === "days" ? "Pick a month" : "Pick a year"}
        >
          {title}
        </button>
        <button
          type="button"
          className="cal-nav"
          onClick={() => shift(1)}
          disabled={nextOff}
          aria-label={view === "days" ? "Next month" : view === "months" ? "Next year" : "Later years"}
        >
          <Icon name="right" size={16} />
        </button>
      </div>

      <div className={`cal-grid${view === "days" ? "" : " cal-months"}`} role="group" aria-label={title}>
        {view === "days" &&
          DOW.map((d) => (
            <span key={d} className="cal-dow" aria-hidden>
              {d}
            </span>
          ))}
        {cells.map((c) => (
          <button
            key={c.key}
            type="button"
            tabIndex={c.focus ? 0 : -1}
            aria-label={c.aria}
            aria-pressed={c.on}
            className={[
              "cal-day",
              c.out && "cal-out",
              c.on && "cal-on",
              c.today && "cal-today",
              c.focus && "cal-focus",
            ]
              .filter(Boolean)
              .join(" ")}
            disabled={outside(c.d, view)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(c.d)}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}
