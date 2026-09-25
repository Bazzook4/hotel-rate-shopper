"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, clampToToday, formatDateISO, parseDateISO, todayUTC } from "@/lib/date";
import GoogleListingSetup from "./GoogleListingSetup";
import ParityTrend from "./ParityTrend";

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
  // The row being dragged, and the live order while dragging. Kept separate
  // from `data` so an abandoned drag leaves the saved order untouched.
  const [dragKey, setDragKey] = useState(null);
  const [order, setOrder] = useState(null);

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
    // Kept so the notice can say what went wrong, not just how many did.
    let firstFailure = null;
    // A sweep that ends without the server saying "finished" is incomplete,
    // however normal the button looks afterwards. Tracked explicitly so a
    // partial refresh cannot be mistaken for a successful one.
    let finished = false;
    // Kept outside the loop so the message after it can say how far we got.
    let done = 0;
    let total = WINDOW_DAYS;

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
          // Google only prices the next bookable night from the page we can
          // read, so a window further out cannot be filled at all. Saying so
          // is better than a generic failure the hotelier would retry.
          setError(
            json?.code === "wrong_date"
              ? "Google only publishes rates for the next night or two on the page we read, so these dates cannot be checked yet. Move the window closer to today and refresh."
              : json?.error || "Could not refresh rates."
          );
          // A refresh blocked for want of a Google URL should drop the grid
          // back to the setup prompt rather than leaving a dead button.
          if (json?.needsSetup) setData((d) => (d ? { ...d, configured: false } : d));
          return;
        }

        failed += json.failures?.length || 0;
        if (!firstFailure && json.failures?.length) firstFailure = json.failures[0];
        if (json.total) {
          done = json.done;
          total = json.total;
          setProgress({ done, total });
        }

        if (json.cursor == null) {
          finished = true;
          break;
        }
        // A cursor that has not moved means the server made no progress, and
        // asking again would only repeat it.
        if (json.cursor <= cursor) break;
        cursor = json.cursor;
      }

      // Said plainly, and as an error rather than a notice: stopping early
      // leaves later nights showing rates from the last successful run, which
      // read as current when they are not.
      if (!finished) {
        setError(
          `Only ${done} of ${total} nights were checked before the refresh stopped. The rest still show their previous rates — refresh again to finish.`
        );
      } else if (failed) {
        setNotice(
          `${failed} of ${WINDOW_DAYS} dates could not be checked and kept their previous rates${
            firstFailure ? ` (${firstFailure.date}: ${firstFailure.message})` : ""
          }.`
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

  // What the grid draws: the live order while dragging, otherwise the order
  // the server sent. Recomputed rather than stored so a refresh cannot leave
  // a stale arrangement on screen.
  const channels = useMemo(() => {
    if (!data?.channels) return [];
    if (!order) return data.channels;
    const byKey = new Map(data.channels.map((c) => [c.key, c]));
    const arranged = order.map((k) => byKey.get(k)).filter(Boolean);
    // Anything the saved order does not mention keeps its place at the end,
    // so a newly appearing channel is never dropped from the grid.
    for (const c of data.channels) if (!order.includes(c.key)) arranged.push(c);
    return arranged;
  }, [data?.channels, order]);

  /** The property's own listing, which the chart draws against the rest. */
  const ownChannelKey = useMemo(() => {
    if (!data?.channels?.length || !data?.propertyName) return null;
    const mine = String(data.propertyName).trim().toLowerCase();
    const hit = data.channels.find((c) => {
      const name = String(c.name || "").trim().toLowerCase();
      // Google labels the direct rate with the hotel's own trading name,
      // which is rarely written exactly as the property is recorded here, so
      // containment either way is the workable test.
      return name === mine || name.includes(mine) || mine.includes(name);
    });
    return hit?.key || null;
  }, [data?.channels, data?.propertyName]);

  /** Move the dragged channel above the one it was dropped on. */
  function reorder(fromKey, toKey) {
    if (!fromKey || !toKey || fromKey === toKey) return;
    const keys = channels.map((c) => c.key);
    const from = keys.indexOf(fromKey);
    const to = keys.indexOf(toKey);
    if (from === -1 || to === -1) return;
    keys.splice(to, 0, keys.splice(from, 1)[0]);
    setOrder(keys);
  }

  /**
   * Persist the arrangement.
   *
   * Saved on drop rather than behind a Save button: the grid already shows
   * the new order, so a button would only invite leaving it unsaved.
   */
  async function saveOrder(keys) {
    try {
      const res = await fetch("/api/parity/channel-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, channelKeys: keys }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json?.error || "Could not save the channel order.");
      }
    } catch {
      setError("Could not save the channel order.");
    }
  }

  /** Drop the saved order and return to cheapest-first. */
  async function resetOrder() {
    setOrder(null);
    await saveOrder([]);
    await load();
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
                  {channels.map((channel) => (
                    <tr
                      key={channel.key}
                      draggable
                      onDragStart={() => setDragKey(channel.key)}
                      onDragOver={(e) => {
                        // Without this the browser refuses the drop outright.
                        e.preventDefault();
                        reorder(dragKey, channel.key);
                      }}
                      onDragEnd={() => {
                        if (order) saveOrder(order);
                        setDragKey(null);
                      }}
                      style={{
                        cursor: "grab",
                        opacity: dragKey === channel.key ? 0.4 : 1,
                      }}
                    >
                      <td
                        style={{
                          position: "sticky",
                          left: 0,
                          background: "var(--surface)",
                          zIndex: 1,
                        }}
                      >
                        <span className="inline-flex items-center gap-2">
                          <span
                            aria-hidden
                            title="Drag to reorder"
                            style={{ color: "var(--text-faint)", cursor: "grab", fontSize: "0.8rem" }}
                          >
                            ⠿
                          </span>
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

          {data?.channels?.length > 0 && (
            <ParityTrend data={data} ownChannelKey={ownChannelKey} />
          )}

          {(order || data?.customOrder) && (
            <p className="text-xs" style={{ color: "var(--text-faint)" }}>
              Channels are in your own order.{" "}
              <button
                type="button"
                onClick={resetOrder}
                style={{
                  color: "var(--accent-text)",
                  textDecoration: "underline",
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  font: "inherit",
                }}
              >
                Reset to cheapest first
              </button>
            </p>
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
