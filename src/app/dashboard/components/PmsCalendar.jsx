"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, formatDateISO, parseDateISO, todayUTC } from "@/lib/date";

/**
 * Availability at a glance: rooms free per room type, per night.
 *
 * Read-only on purpose. Selling a room is a booking, which belongs on the
 * Reservations page where the guest's details are taken; this answers the
 * question that comes first -- is there anything left to sell.
 *
 * The counts come from the same nights rows the booking check uses, so the
 * calendar cannot show a free room that a booking would then refuse.
 */

const WINDOWS = [
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
];

/** How full a night is, as the colour the cell takes. */
function cellStyle(free, capacity) {
  if (capacity === 0) return { color: "var(--text-faint)" };
  if (free <= 0) {
    return { background: "var(--warn-soft)", color: "var(--warn)", fontWeight: 600 };
  }
  // Nearly full is worth noticing before it is too late to price for it.
  if (free / capacity <= 0.2) {
    return { color: "var(--warn)", fontWeight: 600 };
  }
  return { color: "var(--text)" };
}

function DateHeader({ date, isToday }) {
  const parsed = parseDateISO(date);
  return (
    <th
      className="text-center"
      style={{
        minWidth: 52,
        background: isToday ? "var(--accent-soft)" : undefined,
        color: isToday ? "var(--accent-text)" : undefined,
      }}
    >
      <div className="leading-tight">
        <div style={{ fontSize: "0.6rem" }}>
          {isToday ? "TODAY" : parsed?.toLocaleDateString("en-GB", { weekday: "short" })}
        </div>
        <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text)" }}>
          {parsed?.getDate()}
        </div>
        <div style={{ fontSize: "0.6rem" }}>
          {parsed?.toLocaleDateString("en-GB", { month: "short" }).toUpperCase()}
        </div>
      </div>
    </th>
  );
}

export default function PmsCalendar({ session }) {
  const propertyId = session?.propertyId || null;

  const [anchor, setAnchor] = useState(() => formatDateISO(todayUTC()));
  const [windowDays, setWindowDays] = useState(14);
  const [grid, setGrid] = useState(null);
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const today = formatDateISO(todayUTC());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const start = anchor;
      const end = formatDateISO(addDays(parseDateISO(anchor), windowDays - 1));

      const qs = new URLSearchParams({ start, end });
      if (propertyId) qs.set("propertyId", propertyId);

      const res = await fetch(`/api/pms/calendar?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load the calendar");

      setGrid(data);
      setReservations(data.reservations || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [anchor, windowDays, propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  /** Arrivals and departures per date, which is what the desk plans around. */
  const movements = useMemo(() => {
    const byDate = {};
    for (const r of reservations) {
      if (r.status === "cancelled" || r.status === "no_show") continue;
      byDate[r.check_in] = byDate[r.check_in] || { in: 0, out: 0 };
      byDate[r.check_in].in += 1;
      byDate[r.check_out] = byDate[r.check_out] || { in: 0, out: 0 };
      byDate[r.check_out].out += 1;
    }
    return byDate;
  }, [reservations]);

  const dates = grid?.dates || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="h1">Calendar</h2>
          <p className="sub">Rooms free per night, and who is coming and going.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn btn-ghost text-sm"
            onClick={() =>
              setAnchor(formatDateISO(addDays(parseDateISO(anchor), -windowDays)))
            }
          >
            ←
          </button>
          <input
            className="input text-sm"
            type="date"
            value={anchor}
            onChange={(e) => setAnchor(e.target.value)}
            style={{ maxWidth: 160 }}
          />
          <button
            className="btn btn-ghost text-sm"
            onClick={() =>
              setAnchor(formatDateISO(addDays(parseDateISO(anchor), windowDays)))
            }
          >
            →
          </button>
          <button className="btn btn-ghost text-sm" onClick={() => setAnchor(today)}>
            Today
          </button>
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              className={`btn text-sm ${windowDays === w.days ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setWindowDays(w.days)}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div
          className="card card-pad text-sm"
          style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
        >
          {error}
        </div>
      )}

      <div className="card card-pad">
        {loading && <p className="sub">Loading…</p>}

        {!loading && grid && grid.roomTypes.length === 0 && (
          <p className="sub">
            No room types set up yet — add them in Room Setup and the calendar
            will fill in.
          </p>
        )}

        {!loading && grid && grid.roomTypes.length > 0 && (
          <div className="overflow-x-auto">
            <table className="grid-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left" style={{ minWidth: 160 }}>
                    Room type
                  </th>
                  {dates.map((d) => (
                    <DateHeader key={d} date={d} isToday={d === today} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.roomTypes.map((rt) => (
                  <tr key={rt.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{rt.name}</div>
                      <div style={{ color: "var(--text-faint)", fontSize: "0.75rem" }}>
                        {rt.capacity} room{rt.capacity === 1 ? "" : "s"}
                      </div>
                    </td>
                    {rt.days.map((day) => (
                      <td
                        key={day.date}
                        className="text-center"
                        style={cellStyle(day.free, rt.capacity)}
                        title={`${day.sold} sold of ${rt.capacity} on ${day.date}`}
                      >
                        {rt.capacity === 0 ? "—" : day.free}
                      </td>
                    ))}
                  </tr>
                ))}

                <tr>
                  <td style={{ fontWeight: 600 }}>Arrivals / departures</td>
                  {dates.map((d) => {
                    const m = movements[d];
                    return (
                      <td
                        key={d}
                        className="text-center"
                        style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}
                      >
                        {m ? `${m.in || 0}↓ ${m.out || 0}↑` : "—"}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>

            <p className="sub mt-2">
              Each cell is the number of rooms still free that night. Amber means
              nearly or fully booked.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
