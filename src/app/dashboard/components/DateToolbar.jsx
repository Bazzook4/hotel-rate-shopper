"use client";

import { useCallback, useRef, useState } from "react";
import DatePicker from "../../components/DatePicker";
import Icon from "../../components/Icon";
import { addDays, formatDateISO, parseDateISO } from "@/lib/date";
import { hotelToday } from "@/lib/hotelTime";

/**
 * The date-and-filter bar that sits over every date grid.
 *
 * Each grid page used to draw its own -- arrows here, a bare date input
 * there, a window toggle somewhere else -- so moving through dates felt
 * different on every screen. This is the one bar they all share, on one
 * row so the grid starts as high up the screen as it can:
 *
 *   [<< < (calendar) 24 Sep 2026 > >>] [Today] [14 | 30 days] [Room type: All v] Clear   actions
 *
 * It wraps on a narrow screen. A phone gets two rows: the stepper (no
 * page jumps, no year), Today and the window switch, then filters and actions. Filters carry their label inside or beside
 * the control (Dropdown, ToolbarField), never on a line above it.
 *
 * < > move one day and << >> a whole window, so a desk can nudge the grid a
 * night at a time or page through it. The date itself opens the app's
 * calendar (DatePicker) for a jump further out. In `unit="month"` the arrows move a month
 * and there is no page jump, since a month is already the page.
 *
 * `value` is the first date shown, as an ISO string. `min` stops the arrows
 * going earlier (the rate service refuses a past check-in).
 */
export default function DateToolbar({
  value,
  onChange,
  unit = "day",
  step = 7,
  min,
  windows,
  windowDays,
  onWindowChange,
  filters,
  onClearAll,
  actions,
}) {
  const dateBtn = useRef(null);
  const [picking, setPicking] = useState(false);
  const closePicker = useCallback(() => setPicking(false), []);
  const today = unit === "month" ? `${hotelToday().slice(0, 7)}-01` : hotelToday();
  const parsed = parseDateISO(value);

  function go(iso) {
    if (!iso) return;
    onChange(min && iso < min ? min : iso);
  }

  function move(amount) {
    if (unit === "month") {
      go(formatDateISO(new Date(parsed.getFullYear(), parsed.getMonth() + amount, 1)));
    } else {
      go(formatDateISO(addDays(parsed, amount)));
    }
  }

  const label =
    unit === "month"
      ? parsed?.toLocaleDateString("en-GB", { month: "long", year: "numeric" })
      : parsed?.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  // The year is for the desk paging months ahead; a phone drops it so the
  // stepper, Today and the window switch share one row.
  const year = unit === "month" ? null : parsed?.getFullYear();

  const atMin = Boolean(min && value <= min);

  return (
    <div className="card flex flex-wrap items-center gap-2" style={{ padding: "0.625rem 0.75rem" }}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="seg">
          {unit === "day" && (
            <button
              type="button"
              className="seg-wide"
              onClick={() => move(-step)}
              disabled={atMin}
              aria-label={`Back ${step} days`}
              title={`Back ${step} days`}
            >
              <Icon name="left" size={14} />
              <Icon name="left" size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={() => move(-1)}
            disabled={atMin}
            aria-label={unit === "month" ? "Previous month" : "Previous day"}
          >
            <Icon name="left" size={14} />
          </button>
          <button
            ref={dateBtn}
            type="button"
            className="seg-date"
            onClick={() => setPicking((p) => !p)}
            aria-haspopup="dialog"
            aria-expanded={picking}
            title="Pick a date"
          >
            <Icon name="calendar" size={15} />
            <span>
              {label}
              {year && <span className="seg-wide"> {year}</span>}
            </span>
          </button>
          <button
            type="button"
            onClick={() => move(1)}
            aria-label={unit === "month" ? "Next month" : "Next day"}
          >
            <Icon name="right" size={14} />
          </button>
          {unit === "day" && (
            <button
              type="button"
              className="seg-wide"
              onClick={() => move(step)}
              aria-label={`Forward ${step} days`}
              title={`Forward ${step} days`}
            >
              <Icon name="right" size={14} />
              <Icon name="right" size={14} />
            </button>
          )}
        </div>

        <button
          type="button"
          className="btn btn-secondary text-sm"
          onClick={() => go(today)}
          disabled={value === today}
        >
          Today
        </button>

        {windows?.length > 1 && (
          <div className="seg">
            {windows.map((n, i) => (
              <button
                key={n}
                type="button"
                className={windowDays === n ? "seg-on" : ""}
                onClick={() => onWindowChange(n)}
                aria-label={`${n} days`}
              >
                {n}
                {/* "14 | 30 days" on a phone: the unit once, on the last. */}
                <span className={i < windows.length - 1 ? "seg-wide" : ""}> days</span>
              </button>
            ))}
          </div>
        )}

      </div>

      {filters && (
        <>
          <span aria-hidden className="hidden h-6 sm:block" style={{ borderLeft: "1px solid var(--border)" }} />
          <div className="tb-filters flex flex-wrap items-center gap-2">
            {filters}
            {onClearAll && (
              <button type="button" className="btn btn-ghost text-sm" onClick={onClearAll}>
                Clear
              </button>
            )}
          </div>
        </>
      )}

      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}

      {picking && (
        <DatePicker
          anchor={dateBtn}
          value={value}
          min={min}
          unit={unit}
          onChange={go}
          onClose={closePicker}
        />
      )}
    </div>
  );
}

/**
 * One labelled control in the filter row, its label beside it. `hideLabel`
 * keeps the label for screen readers only, for a control whose placeholder
 * already says what it is (a search box). A choice from a list should be a
 * Dropdown, which carries its label inside.
 */
export function ToolbarField({ label, htmlFor, width = 200, hideLabel = false, children }) {
  return (
    <div className="tb-field">
      <label className={hideLabel ? "sr-only" : "tb-field-label"} htmlFor={htmlFor}>
        {label}
      </label>
      <div style={{ width, maxWidth: "100%" }}>{children}</div>
    </div>
  );
}
