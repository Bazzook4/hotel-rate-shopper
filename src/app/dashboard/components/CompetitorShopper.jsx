"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, clampToToday, formatDateISO, parseDateISO, todayUTC } from "@/lib/date";
import ManageCompetitors from "./ManageCompetitors";
import CompetitorDay from "./CompetitorDay";
import { MAX_COMPETITORS } from "@/lib/competitors";

/** A refresh fills one week of the month; paging then refreshing walks across. */
const REFRESH_DAYS = 7;

function ageLabel(iso) {
  if (!iso) return "Never checked";
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `Updated ${days} day${days === 1 ? "" : "s"} ago`;
}

function money(value) {
  if (value == null) return "—";
  return Math.round(value).toLocaleString("en-IN");
}

/**
 * One day of the month.
 *
 * Shows our own rate against the median competitor, since that comparison --
 * not the raw number -- is what a pricing decision turns on. Green means we
 * are below the median, red above; a day we have not priced shows the median
 * alone so the column is still worth reading.
 */
function DayCell({ date, own, median, diff, inMonth, isToday, onOpen }) {
  const tone =
    diff == null
      ? {}
      : diff <= -10
      ? { background: "var(--accent-soft)", borderColor: "var(--accent)" }
      : diff >= 10
      ? { background: "var(--danger-soft)", borderColor: "var(--danger)" }
      : {};

  const day = parseDateISO(date)?.getDate();

  return (
    <td
      style={{
        verticalAlign: "top",
        padding: "0.35rem",
        opacity: inMonth ? 1 : 0.35,
      }}
    >
      <div className="text-xs" style={{ color: "var(--text-muted)", marginBottom: 2 }}>
        {day}
        {isToday && (
          <span
            className="chip chip-ok"
            style={{ marginLeft: 4, fontSize: "0.6rem", padding: "0 0.3rem" }}
          >
            Today
          </span>
        )}
      </div>
      <button
        type="button"
        className="card"
        onClick={() => onOpen?.(date)}
        style={{
          padding: "0.4rem",
          minHeight: 58,
          textAlign: "center",
          width: "100%",
          cursor: "pointer",
          ...tone,
        }}
      >
        {own == null && median == null ? (
          <div className="text-xs" style={{ color: "var(--text-faint)", paddingTop: 10 }}>
            —
          </div>
        ) : (
          <>
            <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
              {own != null ? money(own) : <span style={{ color: "var(--text-faint)" }}>—</span>}
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              {median != null ? `median ${money(median)}` : "no comp data"}
            </div>
            {diff != null && (
              <div
                className="text-xs"
                style={{
                  fontWeight: 600,
                  color: diff <= 0 ? "var(--accent-text)" : "var(--danger)",
                }}
              >
                {diff > 0 ? "+" : ""}
                {diff.toFixed(1)}%
              </div>
            )}
          </>
        )}
      </button>
    </td>
  );
}

export default function CompetitorShopper({ session }) {
  const propertyId = session?.propertyId || session?.property_id || null;

  const [month, setMonth] = useState(() => {
    const now = new Date();
    return formatDateISO(new Date(now.getFullYear(), now.getMonth(), 1));
  });
  const [guests, setGuests] = useState(2);
  const [nights, setNights] = useState(1);

  // Which week a refresh will fill. Starts at today when the open month
  // contains it, so the first press covers the dates that matter most.
  // Sent to the rate service, so it follows the service's today, not the
  // browser's -- east of UTC the two disagree for part of every evening.
  const [weekStart, setWeekStart] = useState(() => todayUTC());

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // How far through the sweep a running refresh is, for the button label: six
  // competitors across a week takes minutes, and an unchanging spinner reads
  // as a hang.
  const [progress, setProgress] = useState(null);
  const [managing, setManaging] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openDay, setOpenDay] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ month, nights: String(nights), guests: String(guests) });
      if (propertyId) params.set("propertyId", propertyId);
      const res = await fetch(`/api/compshopper/grid?${params}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || "Could not load competitor rates.");
        return;
      }
      setData(json);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [month, nights, guests, propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the refresh week inside the month on screen, so the button never
  // silently scrapes dates the hotelier cannot see.
  useEffect(() => {
    if (!data?.start || !data?.end) return;
    if (weekStart < data.start || weekStart > data.end) {
      // A past month has no week worth refreshing, so the picker starts at
      // today instead of a date the service would reject.
      setWeekStart(clampToToday(data.start));
    }
  }, [data?.start, data?.end, weekStart]);

  /**
   * Refresh the visible week, one batch per request.
   *
   * Six competitors across seven nights is well over a hundred page reads at
   * several seconds each, so the sweep cannot finish in one request. The
   * server does what fits in its time budget and replies with a cursor; this
   * keeps calling from there. Each batch is saved as it completes, so an
   * interrupted refresh leaves real rates behind rather than nothing.
   */
  async function refresh() {
    setRefreshing(true);
    setError("");
    setNotice("");
    setProgress(null);

    let cursor = 0;
    let failed = 0;
    let last = null;

    try {
      // Bounded rather than `while (true)`: a server that kept returning the
      // same cursor would otherwise spin forever. One request per cell is far
      // more than batching should ever need.
      for (let guard = 0; guard <= REFRESH_DAYS * MAX_COMPETITORS; guard += 1) {
        const res = await fetch("/api/compshopper/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            propertyId,
            start: weekStart,
            days: REFRESH_DAYS,
            nights,
            guests,
            from: cursor,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json?.error || "Could not refresh competitor rates.");
          if (json?.needsCompetitors) setManaging(true);
          return;
        }

        last = json;
        failed += json.failures?.length || 0;
        if (json.total) setProgress({ done: json.done, total: json.total });

        if (json.cursor == null) break;
        // A cursor that has not moved means the server made no progress, and
        // asking again would only repeat it.
        if (json.cursor <= cursor) break;
        cursor = json.cursor;
      }

      if (last) {
        setNotice(
          failed > 0
            ? `Checked ${last.competitorsChecked} competitors for ${last.from} to ${last.to}. ${failed} lookups failed and kept their previous rates.`
            : `Checked ${last.competitorsChecked} competitors for ${last.from} to ${last.to}.`
        );
      }
      await load();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setRefreshing(false);
      setProgress(null);
    }
  }

  // The calendar is laid out Monday-first, padded to whole weeks.
  const weeks = useMemo(() => {
    if (!data?.dates?.length) return [];
    const first = parseDateISO(data.dates[0]);
    const lead = (first.getDay() + 6) % 7; // Monday = 0
    const cells = [];
    for (let i = 0; i < lead; i += 1) cells.push(formatDateISO(addDays(first, i - lead)));
    cells.push(...data.dates);
    while (cells.length % 7 !== 0) cells.push(formatDateISO(addDays(parseDateISO(cells[cells.length - 1]), 1)));
    const out = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [data?.dates]);

  const monthLabel = parseDateISO(month)?.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });

  function shiftMonth(by) {
    const d = parseDateISO(month);
    setMonth(formatDateISO(new Date(d.getFullYear(), d.getMonth() + by, 1)));
  }

  const today = formatDateISO(new Date());

  if (managing) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="h1">Competitor rates</h2>
          <p className="sub">Choose the hotels you compete with.</p>
        </div>
        <ManageCompetitors
          propertyId={data?.propertyId || propertyId}
          onClose={() => setManaging(false)}
          onSaved={() => load()}
        />
      </div>
    );
  }

  if (loading && !data) {
    return <p className="sub">Loading competitor rates…</p>;
  }

  // Opening a day replaces the calendar rather than overlaying it: the detail
  // is a table of its own and a modal over a table reads badly on a laptop.
  if (openDay && data) {
    const step = (by) => {
      const next = formatDateISO(addDays(parseDateISO(openDay), by));
      // Paging past the month edge moves the calendar with it, so the day
      // view never shows a date the loaded month does not cover.
      if (next < data.start || next > data.end) {
        setMonth(formatDateISO(new Date(parseDateISO(next).getFullYear(), parseDateISO(next).getMonth(), 1)));
      }
      setOpenDay(next);
    };
    return (
      <div className="space-y-4">
        <div>
          <h2 className="h1">Competitor rates</h2>
          <p className="sub">{data.propertyName}</p>
        </div>
        <CompetitorDay
          date={openDay}
          data={data}
          onClose={() => setOpenDay(null)}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="h1">Competitor rates</h2>
          <p className="sub">
            Monitor your competitors&apos; rates to confidently price your rooms and convert more
            bookings.
          </p>
        </div>
        <button type="button" className="btn" onClick={() => setManaging(true)}>
          Manage competitors
        </button>
      </div>

      {data && !data.configured && (
        <div className="card card-pad" style={{ borderColor: "var(--warn)" }}>
          <p className="text-sm" style={{ color: "var(--warn)" }}>
            Add your Google Business URL in Property Setup first — Competitor Shopper uses it to
            find the hotels near you.
          </p>
        </div>
      )}

      {data?.configured && !data?.hasCompetitors && (
        <div className="card card-pad">
          <p className="sub">
            No competitors yet. Choose <strong>Manage competitors</strong> to find the hotels near
            you and pick up to 6.
          </p>
        </div>
      )}

      {/* Controls */}
      <div className="card card-pad flex flex-wrap items-end gap-4">
        <div>
          <label className="label">Month</label>
          <div className="flex items-center gap-2">
            <button type="button" className="btn" onClick={() => shiftMonth(-1)} aria-label="Previous month">
              ‹
            </button>
            <span className="text-sm" style={{ minWidth: 140, textAlign: "center" }}>
              {monthLabel}
            </span>
            <button type="button" className="btn" onClick={() => shiftMonth(1)} aria-label="Next month">
              ›
            </button>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="comp-guests">
            Guests
          </label>
          <select
            id="comp-guests"
            className="input"
            value={guests}
            onChange={(e) => setGuests(Number(e.target.value))}
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n} guest{n === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="comp-nights">
            Nights
          </label>
          <select
            id="comp-nights"
            className="input"
            value={nights}
            onChange={(e) => setNights(Number(e.target.value))}
          >
            {[1, 2, 3, 7].map((n) => (
              <option key={n} value={n}>
                {n} night{n === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </div>

        {/* A month is far too many lookups for one press, so the refresh
            names the week it will cover rather than pretending otherwise. */}
        <div>
          <label className="label" htmlFor="comp-week">
            Refresh week starting
          </label>
          <input
            id="comp-week"
            type="date"
            className="input"
            value={weekStart}
            min={data?.start}
            max={data?.end}
            onChange={(e) => setWeekStart(e.target.value)}
          />
        </div>

        <div className="ml-auto">
          <button
            type="button"
            className="btn btn-primary"
            onClick={refresh}
            disabled={refreshing || !data?.hasCompetitors}
          >
            {refreshing
              ? progress
                ? `Checking… ${progress.done} of ${progress.total}`
                : "Checking competitors…"
              : "Refresh week"}
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

      {/* Calendar */}
      {data?.hasCompetitors && (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="grid-table">
            <thead>
              <tr>
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <th key={d} className="text-center" style={{ minWidth: 104 }}>
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week[0]}>
                  {week.map((date) => (
                    <DayCell
                      key={date}
                      date={date}
                      own={data.ownByDate?.[date] ?? null}
                      median={data.medianByDate?.[date] ?? null}
                      diff={data.diffByDate?.[date] ?? null}
                      inMonth={date >= data.start && date <= data.end}
                      isToday={date === today}
                      onOpen={setOpenDay}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Who we are comparing against */}
      {data?.competitors?.length > 0 && (
        <div className="card card-pad">
          <h4 className="label">Tracking {data.competitors.length} competitors</h4>
          <div className="flex flex-wrap gap-2">
            {data.competitors.map((c) => (
              <span key={c.id} className="chip chip-off">
                {c.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs" style={{ color: "var(--text-faint)" }}>
        {ageLabel(data?.checkedAt)} · Choose any day to see it competitor by competitor. Your rate
        comes from Rate Parity; the median is across the competitors you track. A refresh covers
        one week at a time.
      </p>
    </div>
  );
}
