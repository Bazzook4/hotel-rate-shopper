"use client";

import { useRef } from "react";
import Icon from "../../components/Icon";
import { addDays, formatDateISO, parseDateISO, todayUTC } from "@/lib/date";

/**
 * The date-and-filter bar that sits over every date grid.
 *
 * Each grid page used to draw its own -- arrows here, a bare date input
 * there, a window toggle somewhere else -- so moving through dates felt
 * different on every screen. This is the one bar they all share:
 *
 *   [ filter ] [ filter ] [ filter ]                         Clear all
 *   [« ‹ 📅 24 Sep 2026 › »] [Today] [14 days | 30 days]      actions
 *
 * ‹ › move one day and « » a whole window, so a desk can nudge the grid a
 * night at a time or page through it. The date itself opens the native
 * picker for a jump further out. In `unit="month"` the arrows move a month
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
  const pickerRef = useRef(null);
  const today = unit === "month" ? `${todayUTC().slice(0, 7)}-01` : todayUTC();
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

  function openPicker() {
    const input = pickerRef.current;
    if (!input) return;
    // showPicker is the only way to open the calendar from another element;
    // older Safari lacks it, where focusing the input is the best on offer.
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  }

  const label =
    unit === "month"
      ? parsed?.toLocaleDateString("en-GB", { month: "long", year: "numeric" })
      : parsed?.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  const atMin = Boolean(min && value <= min);

  return (
    <div className="card card-pad space-y-4">
      {filters && (
        <div className="flex flex-wrap items-end gap-3">
          {filters}
          {onClearAll && (
            <button type="button" className="btn btn-ghost ml-auto text-sm" onClick={onClearAll}>
              Clear all
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="seg">
          {unit === "day" && (
            <button
              type="button"
              onClick={() => move(-step)}
              disabled={atMin}
              aria-label={`Back ${step} days`}
              title={`Back ${step} days`}
            >
              «
            </button>
          )}
          <button
            type="button"
            onClick={() => move(-1)}
            disabled={atMin}
            aria-label={unit === "month" ? "Previous month" : "Previous day"}
          >
            ‹
          </button>
          <button
            type="button"
            className="seg-date"
            onClick={openPicker}
            title="Pick a date"
          >
            <Icon name="calendar" size={15} />
            {label}
            <input
              ref={pickerRef}
              type={unit === "month" ? "month" : "date"}
              tabIndex={-1}
              aria-hidden
              className="seg-picker"
              value={unit === "month" ? value?.slice(0, 7) ?? "" : value ?? ""}
              min={unit === "month" ? min?.slice(0, 7) : min}
              onChange={(e) =>
                e.target.value && go(unit === "month" ? `${e.target.value}-01` : e.target.value)
              }
            />
          </button>
          <button
            type="button"
            onClick={() => move(1)}
            aria-label={unit === "month" ? "Next month" : "Next day"}
          >
            ›
          </button>
          {unit === "day" && (
            <button
              type="button"
              onClick={() => move(step)}
              aria-label={`Forward ${step} days`}
              title={`Forward ${step} days`}
            >
              »
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
            {windows.map((n) => (
              <button
                key={n}
                type="button"
                className={windowDays === n ? "seg-on" : ""}
                onClick={() => onWindowChange(n)}
              >
                {n} days
              </button>
            ))}
          </div>
        )}

        {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** One labelled control in the filter row. */
export function ToolbarField({ label, htmlFor, width = 200, children }) {
  return (
    <div style={{ width, maxWidth: "100%" }}>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}
