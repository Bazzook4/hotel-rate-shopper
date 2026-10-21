"use client";

import { useEffect, useRef, useState } from "react";
import DatePicker from "./DatePicker";
import Icon from "./Icon";
import { isTouch } from "./usePopupClose";
import { addDays, formatDateISO, parseDateISO } from "@/lib/date";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * The app's date box, in place of <input type="date">.
 *
 * The browser's own date box looks and behaves differently in every
 * browser, and its calendar never matched the app. This one shows the date
 * as "21 Oct 2026", opens the app's calendar (DatePicker) on a click, and
 * also takes a typed date: 21/10/2026, 21-10-26, 21 Oct, Oct 21 2026,
 * 2026-10-21, today, tomorrow. A day and month are read day first, as in
 * India; with no year, a date more than three months gone is taken as
 * next year's (5 Jan typed in December) unless that is past `max`. A typed
 * date outside min and max is moved to the nearest one allowed, and one
 * that cannot be read is put back as it was; either way a line under the
 * box says so.
 *
 * On a phone a tap opens the calendar without the keyboard, which would
 * cover it; the date is picked there.
 *
 * It takes what the native input took -- value and min/max as ISO strings,
 * onChange getting { target: { value } } -- so swapping one in keeps the
 * handler. Clearing the box sends "", as the native one did.
 *
 * `className` goes on the text box, `style` on the whole field.
 */
export default function DateField({
  value,
  onChange,
  min,
  max,
  disabled,
  id,
  name,
  className = "input",
  style,
  autoFocus,
  placeholder = "dd mmm yyyy",
  "aria-label": ariaLabel,
}) {
  const wrap = useRef(null);
  const input = useRef(null);
  const calendar = useRef(null);
  const [open, setOpen] = useState(null);
  const [text, setText] = useState(() => show(value));
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [touch, setTouch] = useState(false);

  useEffect(() => setTouch(isTouch()), []);

  useEffect(() => {
    if (!note) return undefined;
    const t = setTimeout(() => setNote(""), 4000);
    return () => clearTimeout(t);
  }, [note]);

  useEffect(() => {
    if (!editing) setText(show(value));
  }, [value, editing]);

  const close = () => setOpen(null);

  // Closed by Tab or a click away while focus was in the calendar: the
  // field never saw a blur, so a typed date is taken here.
  function closeCalendar() {
    setOpen(null);
    if (editing) commit();
  }

  function emit(iso) {
    setText(show(iso));
    if (iso !== (value || "")) {
      const target = { value: iso, name, id };
      onChange?.({ target, currentTarget: target });
    }
  }

  function commit() {
    setEditing(false);
    const t = text.trim();
    if (!t) return emit("");
    let iso = readTyped(t, { max });
    if (!iso) {
      setNote("Could not read that date");
      return setText(show(value));
    }
    if (min && iso < min) {
      iso = min;
      setNote(`Earliest allowed is ${show(min)}`);
    } else if (max && iso > max) {
      iso = max;
      setNote(`Latest allowed is ${show(max)}`);
    }
    emit(iso);
  }

  function onKeyDown(e) {
    if (e.key === "Enter") {
      // A typed date is taken first; Enter again then submits the form, as
      // the submit would otherwise read the date from before it.
      close();
      if (!editing) return;
      e.preventDefault();
      commit();
    } else if (e.key === "ArrowDown" || (e.key === "ArrowUp" && open)) {
      e.preventDefault();
      if (!open) setOpen({ takeFocus: true });
      else calendar.current?.focus();
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      close();
    }
  }

  const typed = editing ? readTyped(text.trim(), { max }) : null;

  return (
    <span ref={wrap} className="df" style={style}>
      <input
        ref={input}
        id={id}
        name={name}
        type="text"
        className={`${className} df-input`}
        value={text}
        size={11}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        inputMode={touch ? "none" : undefined}
        aria-label={ariaLabel}
        aria-describedby={note ? `${id || name || "df"}-note` : undefined}
        aria-haspopup="dialog"
        aria-expanded={Boolean(open)}
        onChange={(e) => {
          setEditing(true);
          setText(e.target.value);
        }}
        onBlur={(e) => {
          // Into the calendar is not leaving the field.
          if (calendar.current?.contains(e.relatedTarget)) return;
          if (editing) commit();
        }}
        onClick={() => !open && setOpen({ takeFocus: touch })}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className="df-btn"
        tabIndex={-1}
        disabled={disabled}
        aria-label="Open the calendar"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? close() : setOpen({ takeFocus: true }))}
      >
        <Icon name="calendar" size={15} />
      </button>
      {open && (
        <DatePicker
          anchor={wrap}
          boxRef={calendar}
          value={typed || value}
          min={min}
          max={max}
          takeFocus={open.takeFocus}
          onChange={(iso) => {
            setEditing(false);
            emit(iso);
          }}
          onClose={closeCalendar}
        />
      )}
      {note && (
        <span id={`${id || name || "df"}-note`} className="df-note" role="status">
          {note}
        </span>
      )}
    </span>
  );
}

function show(iso) {
  const d = parseDateISO(iso);
  return d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
}

/** A typed date as ISO, or null when it cannot be read. */
export function readTyped(raw, { max } = {}) {
  const t = raw.toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const today = new Date();
  if (t === "today") return formatDateISO(today);
  if (t === "tomorrow") return formatDateISO(addDays(today, 1));
  if (t === "yesterday") return formatDateISO(addDays(today, -1));

  let d;
  let m;
  let y;
  let g;
  if ((g = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) {
    [y, m, d] = [g[1], g[2], g[3]].map(Number);
  } else if ((g = t.match(/^(\d{1,2})[-/. ](\d{1,2})(?:[-/. ](\d{2}|\d{4}))?$/))) {
    [d, m] = [Number(g[1]), Number(g[2])];
    y = g[3] ? Number(g[3]) : null;
  } else if ((g = t.match(/^(\d{1,2})(?:st|nd|rd|th)? ?-?([a-z]{3,})\.?(?:[- ](\d{2}|\d{4}))?$/))) {
    d = Number(g[1]);
    m = month(g[2]);
    y = g[3] ? Number(g[3]) : null;
  } else if ((g = t.match(/^([a-z]{3,})\.? ?(\d{1,2})(?:st|nd|rd|th)?(?: (\d{2}|\d{4}))?$/))) {
    m = month(g[1]);
    d = Number(g[2]);
    y = g[3] ? Number(g[3]) : null;
  } else {
    return null;
  }
  if (!m) return null;
  let guessed = false;
  if (y == null) {
    y = today.getFullYear();
    guessed = true;
  } else if (y < 100) y += 2000;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  // No year, and well past: the next time the date comes round ("5 Jan"
  // typed in December), unless that is past max (a payment received). A
  // recent date stays this year, for reports looking back.
  if (guessed && date < addDays(today, -90)) {
    const next = new Date(y + 1, m - 1, d);
    if (next.getMonth() === m - 1 && !(max && formatDateISO(next) > max)) return formatDateISO(next);
  }
  return formatDateISO(date);
}

function month(word) {
  const i = MONTHS.indexOf(word.slice(0, 3));
  return i < 0 ? null : i + 1;
}
