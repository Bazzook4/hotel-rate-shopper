"use client";

import { useCallback, useEffect, useState } from "react";
import BookingModal from "./BookingModal";
import { addDays, formatDateISO, parseDateISO } from "@/lib/date";
import { usePageState } from "./usePageState";

/**
 * The pieces the Insights reports share: the period picker and its presets,
 * money formatting, CSV export, loading a report, and opening the booking a
 * row is about.
 */

export const PRESETS = [
  { id: "mtd", label: "Month to date" },
  { id: "thismonth", label: "This month" },
  { id: "lastmonth", label: "Last month" },
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last7", label: "Last 7 days" },
  { id: "last30", label: "Last 30 days" },
  { id: "last90", label: "Last 90 days" },
  { id: "ytd", label: "Year to date" },
  { id: "last12", label: "Last 12 months" },
  { id: "next30", label: "Next 30 days" },
  { id: "next90", label: "Next 3 months" },
  { id: "custom", label: "Custom dates" },
];

export function presetRange(id, todayIso) {
  const today = parseDateISO(todayIso);
  const y = today.getFullYear();
  const m = today.getMonth();
  const iso = formatDateISO;
  switch (id) {
    case "thismonth":
      return { start: iso(new Date(y, m, 1)), end: iso(new Date(y, m + 1, 0)) };
    case "lastmonth":
      return { start: iso(new Date(y, m - 1, 1)), end: iso(new Date(y, m, 0)) };
    case "today":
      return { start: todayIso, end: todayIso };
    case "yesterday":
      return { start: iso(addDays(today, -1)), end: iso(addDays(today, -1)) };
    case "last7":
      return { start: iso(addDays(today, -6)), end: todayIso };
    case "last30":
      return { start: iso(addDays(today, -29)), end: todayIso };
    case "last90":
      return { start: iso(addDays(today, -89)), end: todayIso };
    case "ytd":
      return { start: iso(new Date(y, 0, 1)), end: todayIso };
    case "last12":
      return { start: iso(addDays(new Date(y - 1, m, today.getDate()), 1)), end: todayIso };
    case "next30":
      return { start: todayIso, end: iso(addDays(today, 29)) };
    case "next90":
      return { start: todayIso, end: iso(addDays(today, 89)) };
    case "mtd":
    default:
      return { start: iso(new Date(y, m, 1)), end: todayIso };
  }
}

export function moneyFormatter(currency, { decimals = 0 } = {}) {
  let fmt;
  try {
    fmt = new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    fmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: decimals });
  }
  return (v) => (v == null ? "–" : fmt.format(v));
}

export const whole = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
export const one = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

export function longDate(iso) {
  if (!iso) return "–";
  return parseDateISO(iso.slice(0, 10)).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function shortDate(iso) {
  if (!iso) return "–";
  return parseDateISO(iso.slice(0, 10)).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

/** A stored moment, in the desk's own clock. */
export function timeOf(ts) {
  if (!ts) return "–";
  return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// ------------------------------------------------------------------
// CSV
// ------------------------------------------------------------------

function csvCell(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** `rows` is an array of arrays; an empty array is a blank line between sections. */
export function downloadCsv(filename, rows) {
  const text = rows.map((cells) => cells.map(csvCell).join(",")).join("\n");
  const blob = new Blob([text], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------------
// Loading
// ------------------------------------------------------------------

/**
 * Fetch a report whenever its query changes. `query` is null while the page's
 * inputs do not yet make a valid request. A slower earlier answer arriving
 * after a later one is dropped, so the page never shows yesterday's numbers
 * under today's date.
 *
 * The desk's UTC offset goes with every request: the server cuts payments and
 * invoices into days on the desk's clock, not its own.
 */
export function useReport(path, query, propertyId) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  const key = query ? new URLSearchParams(query).toString() : null;

  useEffect(() => {
    if (key === null) return;
    let stale = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const qs = new URLSearchParams(key);
        qs.set("tz", String(new Date().getTimezoneOffset()));
        if (propertyId) qs.set("propertyId", propertyId);
        const res = await fetch(`${path}?${qs}`);
        const body = await res.json().catch(() => ({}));
        if (stale) return;
        if (!res.ok) throw new Error(body.error || "Could not load the report");
        setReport(body);
      } catch (err) {
        if (!stale) setError(err.message);
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => {
      stale = true;
    };
  }, [path, key, propertyId, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { report, loading, error, reload };
}

// ------------------------------------------------------------------
// Opening a booking from a row
// ------------------------------------------------------------------

/**
 * Most rows on these reports are something the desk has to go and fix in a
 * stay, so a row opens that stay's folio on the tab the fix is made in. The
 * services list the folio's add-a-line form needs is fetched the first time.
 */
export function useBookingOpener(session, onChanged) {
  const [open, setOpen] = useState(null);
  const [services, setServices] = useState(null);
  const propertyId = session?.propertyId || null;

  const openBooking = useCallback(
    async (reservationId, tab = "details") => {
      if (!reservationId) return;
      setOpen({ reservationId, tab });
      if (services) return;
      try {
        const qs = propertyId ? `?propertyId=${propertyId}` : "";
        const res = await fetch(`/api/pms/services${qs}`);
        const body = await res.json();
        if (res.ok) setServices(body.services || []);
      } catch {
        // The folio still opens; only its add-a-service list is empty.
      }
    },
    [services, propertyId]
  );

  const modal = open ? (
    <BookingModal
      session={session}
      reservationId={open.reservationId}
      initialTab={open.tab}
      extras={services || []}
      onClose={() => setOpen(null)}
      onChanged={() => onChanged?.()}
    />
  ) : null;

  return { openBooking, modal };
}

// ------------------------------------------------------------------
// Pieces of page
// ------------------------------------------------------------------

export function PageHeader({ title, blurb, actions }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-2xl font-semibold" style={{ color: "var(--text)" }}>
          {title}
        </h2>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {blurb}
        </p>
      </div>
      {actions}
    </div>
  );
}

/** The preset list and the two dates, as booking performance has them. */
export function PeriodPicker({ id, label = "Dates", preset, range, onPreset, onRange }) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div style={{ width: 200 }}>
        <label className="label" htmlFor={`${id}-period`}>
          Time period
        </label>
        <select id={`${id}-period`} className="input" value={preset} onChange={(e) => onPreset(e.target.value)}>
          {PRESETS.filter((p) => !p.id.startsWith("next")).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <span className="label">{label}</span>
        <div className="flex items-center gap-2">
          <input
            type="date"
            className="input"
            value={range.start}
            onChange={(e) => onRange({ ...range, start: e.target.value })}
            aria-label="From"
          />
          <span style={{ color: "var(--text-muted)" }}>–</span>
          <input
            type="date"
            className="input"
            value={range.end}
            onChange={(e) => onRange({ ...range, end: e.target.value })}
            aria-label="To"
          />
        </div>
      </div>
    </div>
  );
}

/** Period state: a preset, or dates typed in (which turns the preset to Custom). */
export function usePeriod(initial = "mtd") {
  const todayIso = formatDateISO(new Date());
  // Shared by every report (and Booking Performance), so the period chosen on
  // one is the period on the next.
  const [preset, setPreset] = usePageState("reports.preset", initial);
  const [range, setRange] = usePageState("reports.range", () => presetRange(initial, todayIso));
  return {
    preset,
    range,
    valid: Boolean(range.start && range.end && range.end >= range.start),
    onPreset: (id) => {
      setPreset(id);
      if (id !== "custom") setRange(presetRange(id, todayIso));
    },
    onRange: (r) => {
      setPreset("custom");
      setRange(r);
    },
  };
}

/** A row of headline figures. `tone` tints one that needs attention. */
export function Stats({ items }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-3 xl:grid-cols-4">
      {items.map((s) => (
        <div key={s.label} title={s.hint}>
          <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
            {s.label}
            {s.hint && <span style={{ color: "var(--text-faint)" }}> ⓘ</span>}
          </p>
          <p
            className="mt-1 text-xl font-semibold tabular-nums"
            style={{ color: s.tone ? `var(--${s.tone})` : "var(--text)" }}
          >
            {s.value}
          </p>
          {s.sub && (
            <p className="mt-0.5 text-[11px] tabular-nums" style={{ color: "var(--text-faint)" }}>
              {s.sub}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * How a figure moved against its comparison. `better` says which way is good
 * news, so the change can be tinted: more revenue is good, more cancellations
 * are not. `points` marks a figure that is already a percentage, whose change
 * is shown in points -- occupancy going from 60% to 66% is +6 pts, not +10%.
 */
export function Change({ now, before, better, points }) {
  if (now == null || before == null) return <span className="chip chip-off">no comparison</span>;
  const diff = now - before;
  let text;
  if (points) {
    text = `${diff >= 0 ? "+" : ""}${one.format(diff)} pts`;
  } else if (before === 0) {
    if (now === 0) return <span className="chip chip-off">no change</span>;
    return <span className="chip chip-off">new</span>;
  } else {
    const pct = (diff / Math.abs(before)) * 100;
    text = `${pct >= 0 ? "+" : ""}${one.format(pct)}%`;
  }
  if (Math.abs(diff) < 1e-9) return <span className="chip chip-off">no change</span>;
  const up = diff > 0;
  const good = better === null ? null : (better === "up") === up;
  const tone = good === null ? "chip-off" : good ? "chip-ok" : "chip-warn";
  // The arrow carries the direction, so the tint is never the only signal.
  return (
    <span className={`chip ${tone}`}>
      {up ? "↑" : "↓"} {text}
    </span>
  );
}

/** The night audit's exception tones, as chip colours. */
export const TONE = {
  danger: { background: "var(--danger-soft)", color: "var(--danger)" },
  warn: { background: "var(--warn-soft)", color: "var(--warn)" },
  info: { background: "var(--surface-2)", color: "var(--text-muted)" },
};

/** Which folio tab each kind of night audit exception is fixed in. */
export const FIX_TAB = {
  balance: "payments",
  owing: "payments",
  invoice: "invoices",
  voidedPayments: "payments",
  voidedInvoices: "invoices",
};

export function Section({ title, sub, actions, children }) {
  return (
    <div className="card card-pad space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
            {title}
          </h3>
          {sub && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {sub}
            </p>
          )}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

export function Empty({ children }) {
  return (
    <p className="text-sm" style={{ color: "var(--text-muted)" }}>
      {children}
    </p>
  );
}

/** A scrolling frame for a wide table, so the page itself never scrolls sideways. */
export function TableFrame({ children, tall = false }) {
  return (
    <div
      className={`table-frame ${tall ? "max-h-[32rem] " : ""}overflow-auto rounded-lg`}
      style={{ border: "1px solid var(--border)" }}
    >
      {children}
    </div>
  );
}

/** The booking reference as a link that opens the stay. */
export function BookingLink({ reference, reservationId, tab, onOpen }) {
  if (!reservationId) return <span>{reference || "–"}</span>;
  return (
    <button
      type="button"
      className="font-medium underline decoration-dotted underline-offset-2"
      style={{ color: "var(--accent)" }}
      onClick={() => onOpen(reservationId, tab)}
    >
      {reference || "Open"}
    </button>
  );
}

export function Status({ loading, error, report }) {
  return (
    <>
      {error && (
        <div className="card card-pad text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </div>
      )}
      {loading && !report && !error && (
        <div className="card card-pad text-sm" style={{ color: "var(--text-muted)" }}>
          Loading the report…
        </div>
      )}
    </>
  );
}
