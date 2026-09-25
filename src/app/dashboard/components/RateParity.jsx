"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, clampToToday, formatDateISO, parseDateISO, todayUTC } from "@/lib/date";
import GoogleListingSetup from "./GoogleListingSetup";

/**
 * How many nights the grid shows and a refresh scrapes.
 *
 * Seven, because Google prices one stay at a time: a refresh costs one API
 * call per date, so the window is what the hotelier can see and act on in a
 * week rather than the furthest ahead they could book.
 */
const WINDOW_DAYS = 7;

/** How long ago a refresh ran, in the words the header uses. */
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

function money(value, currency) {
  if (value == null) return "-";
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : "₹";
  return `${symbol}${Math.round(value).toLocaleString("en-IN")}`;
}

/** Column header: weekday over day-of-month over month, today called out. */
function DateHeader({ date, isToday }) {
  const parsed = parseDateISO(date);
  return (
    <th
      className="text-center"
      style={{
        minWidth: 68,
        background: isToday ? "var(--accent-soft)" : undefined,
        color: isToday ? "var(--accent-text)" : undefined,
      }}
    >
      <div className="leading-tight">
        <div style={{ fontSize: "0.6rem" }}>
          {isToday ? "TODAY" : parsed?.toLocaleDateString("en-GB", { weekday: "short" })}
        </div>
        <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--text)" }}>
          {parsed?.getDate()}
        </div>
        <div style={{ fontSize: "0.6rem" }}>
          {parsed?.toLocaleDateString("en-GB", { month: "short" }).toUpperCase()}
        </div>
      </div>
    </th>
  );
}

/**
 * One channel's rate on one night.
 *
 * Colour carries the parity verdict and the arrow its direction against the
 * cheapest channel that night, so the grid can be read at a glance without
 * comparing numbers column by column.
 */
function RateCell({ cell }) {
  if (!cell || cell.rate == null) {
    return (
      <td className="text-center" style={{ color: "var(--text-faint)" }}>
        {cell?.soldOut ? "Sold out" : "-"}
      </td>
    );
  }

  const tone =
    cell.status === "breach"
      ? { background: "var(--danger-soft)", color: "var(--danger)" }
      : cell.status === "drift"
      ? { background: "var(--warn-soft)", color: "var(--warn)" }
      : cell.isLowest
      ? { background: "var(--accent-soft)", color: "var(--accent-text)" }
      : {};

  return (
    <td className="text-center" style={tone}>
      <span className="inline-flex items-center justify-center gap-1">
        {cell.link ? (
          <a href={cell.link} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
            {money(cell.rate, cell.currency)}
          </a>
        ) : (
          money(cell.rate, cell.currency)
        )}
        {cell.status === "breach" && <span aria-hidden>↑</span>}
        {cell.isLowest && <span aria-hidden>↓</span>}
      </span>
    </td>
  );
}

/**
 * The headline above the grid.
 *
 * Written from the stored data rather than from a language model, so it says
 * only what the numbers support: how wide the spread is, and where the worst
 * of it falls.
 */
function ParitySummary({ data }) {
  const insight = useMemo(() => {
    if (!data?.channels?.length) return null;

    let breaches = 0;
    let observed = 0;
    let worst = null;

    for (const channel of data.channels) {
      for (const date of data.dates) {
        const cell = channel.cells[date];
        if (!cell || cell.rate == null) continue;
        observed += 1;
        if (cell.status === "breach") breaches += 1;

        const lowest = data.lowestByDate[date];
        if (lowest == null || lowest <= 0 || cell.rate === lowest) continue;
        const gap = ((cell.rate - lowest) / lowest) * 100;
        if (!worst || gap > worst.gap) {
          worst = { gap, channel: channel.name, date, rate: cell.rate, lowest };
        }
      }
    }

    if (observed === 0) return null;
    return { breaches, observed, worst };
  }, [data]);

  if (!insight) return null;

  const clean = insight.breaches === 0;

  return (
    <div
      className="card card-pad"
      style={{
        borderColor: clean ? "var(--accent)" : "var(--warn)",
        background: clean ? "var(--accent-soft)" : "var(--warn-soft)",
      }}
    >
      <p className="text-sm" style={{ color: clean ? "var(--accent-text)" : "var(--warn)" }}>
        {clean ? (
          <>
            Your channels are in parity across all {data.dates.length} dates shown. No channel is
            selling more than 1% above the cheapest.
          </>
        ) : (
          <>
            {insight.breaches} of {insight.observed} channel rates are more than 5% above the
            cheapest channel for the same night.
            {insight.worst && (
              <>
                {" "}
                The widest gap is <strong>{insight.worst.channel}</strong> on{" "}
                {parseDateISO(insight.worst.date)?.toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                })}
                , at {money(insight.worst.rate)} against {money(insight.worst.lowest)} — a{" "}
                {insight.worst.gap.toFixed(0)}% difference.
              </>
            )}{" "}
            Guests comparing channels will book the cheapest, so the higher listings earn nothing
            while still costing commission on the impressions.
          </>
        )}
      </p>
    </div>
  );
}

export default function RateParity({ session }) {
  const propertyId = session?.propertyId || session?.property_id || null;

  // Sent to the rate service, so it uses the service's idea of today rather
  // than the browser's: east of UTC they disagree for part of every evening.
  const [anchor, setAnchor] = useState(() => todayUTC());
  const [nights, setNights] = useState(1);
  const [guests, setGuests] = useState(2);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // How far through the window a running refresh is, for the button label: a
  // scraped sweep takes minutes, and an unchanging spinner reads as a hang.
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        start: anchor,
        days: String(WINDOW_DAYS),
        nights: String(nights),
        guests: String(guests),
      });
      if (propertyId) params.set("propertyId", propertyId);

      const res = await fetch(`/api/parity/grid?${params}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || "Could not load parity data.");
        return;
      }
      setData(json);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [anchor, nights, guests, propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Refresh the visible window, one batch per request.
   *
   * Reading each night's rates from Google takes seconds, so a week does not
   * fit in a single request. The server does what it can inside its own time
   * budget and replies with a cursor; this keeps calling from there until the
   * window is finished. Each batch is saved as it completes, so a refresh
   * that is interrupted leaves real rates behind rather than nothing.
   */
  async function refresh() {
    setRefreshing(true);
    setError("");
    setNotice("");
    setProgress(null);

    let cursor = 0;
    let failed = 0;

    try {
      // Bounded rather than `while (true)`: a server that kept returning the
      // same cursor would otherwise spin forever. One request per date in the
      // window is far more than batching should ever need.
      for (let guard = 0; guard <= WINDOW_DAYS; guard += 1) {
        const res = await fetch("/api/parity/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            propertyId,
            start: anchor,
            days: WINDOW_DAYS,
            nights,
            guests,
            from: cursor,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json?.error || "Could not refresh rates.");
          // A refresh blocked for want of a Google URL should drop the grid
          // back to the setup prompt rather than leaving a dead button.
          if (json?.needsSetup) setData((d) => (d ? { ...d, configured: false } : d));
          return;
        }

        failed += json.failures?.length || 0;
        if (json.total) setProgress({ done: json.done, total: json.total });

        if (json.cursor == null) break;
        // A cursor that has not moved means the server made no progress, and
        // asking again would only repeat it.
        if (json.cursor <= cursor) break;
        cursor = json.cursor;
      }

      if (failed) {
        setNotice(
          `${failed} of ${WINDOW_DAYS} dates could not be checked and kept their previous rates.`
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

  function exportCsv() {
    if (!data?.channels?.length) return;
    const header = ["Channel", ...data.dates];
    const lines = [header.join(",")];
    for (const channel of data.channels) {
      const cells = data.dates.map((d) => {
        const rate = channel.cells[d]?.rate;
        return rate == null ? "" : rate;
      });
      lines.push([`"${channel.name}"`, ...cells].join(","));
    }
    lines.push(["Cheapest", ...data.dates.map((d) => data.lowestByDate[d] ?? "")].join(","));

    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `rate-parity-${data.start}-to-${data.end}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const today = formatDateISO(new Date());
  const rangeLabel = data
    ? `${parseDateISO(data.start)?.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${parseDateISO(
        data.end
      )?.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
    : "";

  if (loading && !data) {
    return <p className="sub">Loading rate parity…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="h1">Rate parity</h2>
          <p className="sub">
            Compare what each channel is charging for the same night, and spot where your rates
            have drifted apart.
          </p>
        </div>
        {data?.configured && (
          <button type="button" className="btn" onClick={exportCsv} disabled={!data?.channels?.length}>
            Download CSV
          </button>
        )}
      </div>

      {data && !data.configured ? (
        <GoogleListingSetup
          propertyId={data.propertyId}
          initialUrl={data.googleBusinessUrl}
          onSaved={() => load()}
          compact
        />
      ) : (
        <>
          {/* Controls: which stay the grid is pricing. */}
          <div className="card card-pad flex flex-wrap items-end gap-4">
            <div>
              <label className="label">Stay date</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    setAnchor(clampToToday(formatDateISO(addDays(parseDateISO(anchor), -WINDOW_DAYS))))
                  }
                  aria-label="Previous dates"
                >
                  ‹
                </button>
                <span className="text-sm" style={{ minWidth: 170, textAlign: "center" }}>
                  {rangeLabel}
                </span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setAnchor(formatDateISO(addDays(parseDateISO(anchor), WINDOW_DAYS)))}
                  aria-label="Next dates"
                >
                  ›
                </button>
              </div>
            </div>

            <div>
              <label className="label" htmlFor="parity-nights">
                Nights
              </label>
              <select
                id="parity-nights"
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

            <div>
              <label className="label" htmlFor="parity-guests">
                Guests
              </label>
              <select
                id="parity-guests"
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

            <div className="ml-auto">
              <button type="button" className="btn btn-primary" onClick={refresh} disabled={refreshing}>
                {refreshing
                  ? progress
                    ? `Checking… ${progress.done} of ${progress.total} nights`
                    : "Checking channels…"
                  : "Refresh"}
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

          <ParitySummary data={data} />

          {data?.channels?.length ? (
            <div className="card" style={{ overflowX: "auto" }}>
              <table className="grid-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: 180, position: "sticky", left: 0, zIndex: 1 }}>Channel</th>
                    {data.dates.map((d) => (
                      <DateHeader key={d} date={d} isToday={d === today} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.channels.map((channel) => (
                    <tr key={channel.key}>
                      <td
                        style={{
                          position: "sticky",
                          left: 0,
                          background: "var(--surface)",
                          zIndex: 1,
                        }}
                      >
                        <span className="inline-flex items-center gap-2">
                          {channel.logo && (
                            <img src={channel.logo} alt="" style={{ height: 16, width: 16 }} />
                          )}
                          <span style={{ fontWeight: 500 }}>{channel.name}</span>
                        </span>
                      </td>
                      {data.dates.map((d) => (
                        <RateCell key={d} cell={channel.cells[d]} />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            !loading && (
              <div className="card card-pad">
                <p className="sub">
                  No rates stored for these dates yet. Choose Refresh to check what each channel is
                  charging.
                </p>
              </div>
            )
          )}

          <p className="text-xs" style={{ color: "var(--text-faint)" }}>
            {ageLabel(data?.checkedAt)} · Rates are read from your hotel&apos;s Google listing and
            compared against the cheapest channel for each night.
          </p>
        </>
      )}
    </div>
  );
}
