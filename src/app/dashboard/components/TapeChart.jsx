"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, formatDateISO, parseDateISO, todayUTC } from "@/lib/date";
import BookingModal from "./BookingModal";
import { inventoryWarning } from "@/lib/inventoryNotice";

/**
 * The tape chart: one row per physical room, each stay a bar across its nights.
 *
 * This is the front desk's working view. A count of free rooms answers whether
 * anything is left to sell; this answers the question that follows -- which
 * room, and who is either side of it. Seeing that 204 is empty Tuesday to
 * Thursday between two bookings is the whole point, and no count can show it.
 *
 * Layout is a CSS grid of equal-width day columns rather than a table, because
 * a bar spans nights and has to be positioned across cell boundaries. Bars sit
 * in an absolutely positioned layer over each room's row, offset by the nights
 * between the window start and the stay's arrival.
 */

/**
 * The narrowest a night may be, in pixels. Days widen to fill the chart, so a
 * short window spreads across the screen rather than stopping halfway; only
 * when the window cannot fit at this width does the chart scroll sideways.
 * Bars are positioned in multiples of the width actually used.
 */
const MIN_DAY_WIDTH = 44;
/** Width of the fixed room-name column on the left. */
const ROOM_COL = 150;

const WINDOWS = [
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
];

/** How a bar is coloured, which is how status reads at a glance. */
const BAR_STYLE = {
  confirmed: { background: "var(--accent)", color: "#fff" },
  in_house: { background: "var(--warn)", color: "#fff" },
  checked_out: { background: "var(--surface-2)", color: "var(--text-muted)" },
};

function daysBetween(a, b) {
  return Math.round(
    (new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000
  );
}

function shiftDate(date, days) {
  return formatDateISO(addDays(parseDateISO(date), days));
}

export default function TapeChart({ session }) {
  const propertyId = session?.propertyId || null;

  // todayUTC() already gives a YYYY-MM-DD string; formatDateISO takes a Date
  // and returns "" for anything else, which would leave the chart with no
  // window to ask for.
  const [anchor, setAnchor] = useState(() => todayUTC());
  const [windowDays, setWindowDays] = useState(30);
  const [chart, setChart] = useState(null);
  const [extras, setExtras] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Kept apart from `error`, which every reload clears: a change saves and
  // then reloads, and the warning that the OTAs missed it must outlive that.
  const [syncWarning, setSyncWarning] = useState(null);

  const [openId, setOpenId] = useState(null);
  const [newBooking, setNewBooking] = useState(null);

  /**
   * Which room type the chart is narrowed to, and which type headers are folded
   * shut.
   *
   * A property with six types and forty rooms is forty rows of scrolling, and
   * the desk usually wants one type at a time. The filter answers that; the
   * collapse answers the other half, where two types matter and the rest are
   * noise. Both are view state and deliberately not persisted -- the chart
   * should open showing everything.
   */
  const [typeFilter, setTypeFilter] = useState("all");
  const [collapsed, setCollapsed] = useState({});

  /**
   * The drag in progress.
   *
   * Held in a ref as well as state: the pointer handlers are bound to the
   * window and would otherwise close over the value from the render in which
   * the drag started.
   */
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  const gridRef = useRef(null);

  /**
   * How wide a night is: the chart's width shared between the days, never
   * below the minimum. Measured because the grid is only rendered once rooms
   * have loaded, and re-measured as the window resizes. Mirrored in a ref for
   * the drag handlers, which bind to `window` and would otherwise keep the
   * width from the render the drag began in.
   */
  const [gridWidth, setGridWidth] = useState(0);
  const observerRef = useRef(null);
  const measureGrid = useCallback((el) => {
    gridRef.current = el;
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;
    setGridWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setGridWidth(el.clientWidth));
    observer.observe(el);
    observerRef.current = observer;
  }, []);
  const dayWidth = Math.max(
    MIN_DAY_WIDTH,
    Math.floor((gridWidth - ROOM_COL) / windowDays) || 0
  );
  const dayWidthRef = useRef(dayWidth);
  dayWidthRef.current = dayWidth;

  /**
   * A resize waiting on the desk's pricing decision.
   *
   * The bar stays where it was dropped while the dialog is open, so the desk
   * is deciding about what they can see rather than a bar that snapped back.
   */
  const [pending, setPending] = useState(null);

  const today = todayUTC();

  const dates = useMemo(() => {
    const out = [];
    for (let i = 0; i < windowDays; i += 1) out.push(shiftDate(anchor, i));
    return out;
  }, [anchor, windowDays]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const start = anchor;
      const end = shiftDate(anchor, windowDays - 1);
      const qs = new URLSearchParams({ start, end });
      if (propertyId) qs.set("propertyId", propertyId);

      const res = await fetch(`/api/pms/tape?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load the chart");

      setChart(data);
      setExtras(data.extras || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [anchor, windowDays, propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * The chart's rooms grouped by type, which is what the body iterates.
   *
   * The grid was one flat list of rooms with the type name in small print under
   * each number, which reads as a single undifferentiated block -- a deluxe and
   * a suite in adjacent rows look like neighbours. Grouping puts a header
   * between them, so a type's rooms can be found without reading every row.
   */
  const groups = useMemo(() => {
    if (!chart) return [];
    return chart.roomTypes
      .filter((rt) => typeFilter === "all" || rt.id === typeFilter)
      .map((rt) => ({ id: rt.id, name: rt.name, rooms: rt.rooms }));
  }, [chart, typeFilter]);

  /**
   * Every room in the chart, ignoring the filter.
   *
   * The drag handlers need this -- a bar being dragged has to be findable by id
   * even if its row is filtered out -- and "has this property any rooms at all"
   * is a question about the property, not about the current filter.
   */
  const allRooms = useMemo(() => {
    if (!chart) return [];
    return chart.roomTypes.flatMap((rt) => rt.rooms);
  }, [chart]);

  /** The rooms actually drawn, which is what the empty state asks about. */
  const visibleRooms = useMemo(() => groups.flatMap((g) => g.rooms), [groups]);

  // ----- dragging -------------------------------------------------------

  /**
   * Send a move to the server, and handle its answer.
   *
   * A resize comes back unsaved with the pricing worked out, and waits in
   * `pending` for the desk to choose; everything else is saved on the spot.
   */
  const sendMove = useCallback(
    async (move, pricing = null) => {
      setError(null);
      try {
        const res = await fetch("/api/pms/reservations/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: move.id,
            property_id: propertyId,
            room_id: move.room_id,
            check_in: move.check_in,
            check_out: move.check_out,
            ...(pricing ? { pricing } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not move the booking");

        if (data.needsPricing) {
          setPending({ move, plan: data.plan });
          return;
        }
        setPending(null);
        setSyncWarning(inventoryWarning(data));
      } catch (err) {
        setPending(null);
        setError(err.message);
      }
      // Reload either way: on success to pick up the move, on failure to snap
      // the bar back to where it actually is.
      await load();
    },
    [load, propertyId]
  );

  function beginDrag(e, reservation, mode) {
    e.preventDefault();
    e.stopPropagation();

    const start = {
      id: reservation.id,
      mode, // "move" | "start" | "end"
      originX: e.clientX,
      originY: e.clientY,
      check_in: reservation.check_in,
      check_out: reservation.check_out,
      room_id: reservation.room_id,
      // What the bar currently shows, updated as the pointer moves so the
      // bar follows without waiting for the server.
      preview: {
        check_in: reservation.check_in,
        check_out: reservation.check_out,
        room_id: reservation.room_id,
      },
    };
    dragRef.current = start;
    setDrag(start);
  }

  useEffect(() => {
    if (!drag) return;

    function onMove(e) {
      const d = dragRef.current;
      if (!d) return;

      const dayShift = Math.round((e.clientX - d.originX) / dayWidthRef.current);

      let check_in = d.check_in;
      let check_out = d.check_out;
      let room_id = d.room_id;

      if (d.mode === "move") {
        check_in = shiftDate(d.check_in, dayShift);
        check_out = shiftDate(d.check_out, dayShift);

        // Which room row the pointer is over, so a bar can be dragged
        // vertically into another room.
        const rowEl = document
          .elementsFromPoint(e.clientX, e.clientY)
          .find((el) => el.dataset?.roomId);
        if (rowEl) room_id = rowEl.dataset.roomId;
      } else if (d.mode === "start") {
        const moved = shiftDate(d.check_in, dayShift);
        // A stay cannot start on or after it ends.
        if (moved < d.check_out) check_in = moved;
      } else if (d.mode === "end") {
        const moved = shiftDate(d.check_out, dayShift);
        if (moved > d.check_in) check_out = moved;
      }

      const next = { ...d, preview: { check_in, check_out, room_id } };
      dragRef.current = next;
      setDrag(next);
    }

    async function onUp() {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d) return;

      const moved =
        d.preview.check_in !== d.check_in ||
        d.preview.check_out !== d.check_out ||
        d.preview.room_id !== d.room_id;

      // A click that never moved is a click, and opens the booking.
      if (!moved) {
        setOpenId(d.id);
        return;
      }

      await sendMove({ id: d.id, ...d.preview });
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, sendMove]);

  /** Where a bar sits and how wide it is, in pixels across the date window. */
  function barGeometry(reservation) {
    const d =
      drag?.id === reservation.id
        ? drag.preview
        : pending?.move.id === reservation.id
          ? pending.move
          : reservation;

    const offset = daysBetween(anchor, d.check_in);
    const nights = daysBetween(d.check_in, d.check_out);

    // A stay running off either edge of the window is clipped to it, so the
    // bar stays inside the chart while still showing it continues.
    const from = Math.max(0, offset);
    const to = Math.min(windowDays, offset + nights);
    if (to <= 0 || from >= windowDays) return null;

    return {
      left: from * dayWidth,
      width: Math.max(dayWidth * 0.6, (to - from) * dayWidth - 4),
      clippedStart: offset < 0,
      clippedEnd: offset + nights > windowDays,
    };
  }

  /**
   * The bars to draw in one room's row.
   *
   * Normally just the stays the server put there, but a bar being dragged
   * between rooms belongs to whichever room the pointer is currently over --
   * so it is added to that row and removed from the one it is leaving, and the
   * bar follows the cursor instead of snapping back until the drop lands.
   */
  function barsForRoom(room) {
    const dragged = drag
      ? allRooms.flatMap((r) => r.reservations).find((r) => r.id === drag.id)
      : null;

    const here = room.reservations.filter((r) => r.id !== drag?.id);

    if (dragged && drag.preview.room_id === room.id) return [...here, dragged];
    return here;
  }

  /**
   * How many of a type's rooms are occupied on the window's first date.
   *
   * Shown on the type header so a folded group still answers the one question
   * worth asking about a type: is anything left. A stay counts when the date
   * falls on or after arrival and strictly before departure -- departure day is
   * the room being handed back, not slept in.
   */
  function occupiedOnAnchor(group) {
    return group.rooms.filter((room) =>
      room.reservations.some((r) => r.check_in <= anchor && r.check_out > anchor)
    ).length;
  }

  function toggleGroup(id) {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="h1">Calendar</h2>
          <p className="sub">
            Every room, night by night. Click a booking to open it, or drag it to
            move or resize the stay.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn btn-ghost text-sm"
            onClick={() => setAnchor(shiftDate(anchor, -windowDays))}
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
            onClick={() => setAnchor(shiftDate(anchor, windowDays))}
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
          {chart?.roomTypes?.length > 1 && (
            <select
              className="input text-sm"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              style={{ maxWidth: 170 }}
            >
              <option value="all">All room types</option>
              {chart.roomTypes.map((rt) => (
                <option key={rt.id} value={rt.id}>
                  {rt.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {syncWarning && (
        <div
          className="card card-pad text-sm flex items-start gap-3"
          style={{ borderColor: "var(--warn)", background: "var(--warn-soft)", color: "var(--warn)" }}
        >
          <span className="flex-1">{syncWarning}</span>
          <button type="button" className="muted" onClick={() => setSyncWarning(null)}>
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div
          className="card card-pad text-sm"
          style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
        >
          {error}
        </div>
      )}

      {chart?.unassigned?.length > 0 && (
        <div className="card card-pad space-y-2">
          <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>
            Not yet assigned a room ({chart.unassigned.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {chart.unassigned.map((r) => (
              <button
                key={r.id}
                className="chip chip-warn"
                style={{ cursor: "pointer" }}
                onClick={() => setOpenId(r.id)}
                title={`${r.check_in} → ${r.check_out}`}
              >
                {r.guest_name} · {r.room_types?.room_type_name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ overflow: "hidden" }}>
        {loading && <p className="sub card-pad">Loading…</p>}

        {!loading && allRooms.length === 0 && (
          <p className="sub card-pad">
            No rooms set up yet. Add them in Room Setup — the chart needs actual
            rooms to lay bookings out against.
          </p>
        )}

        {!loading && allRooms.length > 0 && visibleRooms.length === 0 && (
          <p className="sub card-pad">
            That room type has no rooms yet. Add them in Room Setup, or pick
            another type above.
          </p>
        )}

        {!loading && visibleRooms.length > 0 && (
          <div style={{ overflowX: "auto" }} ref={measureGrid}>
            <div style={{ minWidth: ROOM_COL + windowDays * dayWidth }}>
              {/* Date header */}
              <div
                style={{
                  display: "flex",
                  position: "sticky",
                  top: 0,
                  zIndex: 3,
                  background: "var(--surface)",
                  borderBottom: "1px solid var(--border-strong)",
                }}
              >
                <div
                  style={{
                    width: ROOM_COL,
                    flexShrink: 0,
                    padding: "0.5rem",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    borderRight: "1px solid var(--border-strong)",
                  }}
                >
                  Room
                </div>
                {dates.map((d) => {
                  const parsed = parseDateISO(d);
                  const isToday = d === today;
                  const weekend = [0, 6].includes(parsed.getUTCDay());
                  return (
                    <div
                      key={d}
                      style={{
                        width: dayWidth,
                        flexShrink: 0,
                        textAlign: "center",
                        padding: "0.35rem 0",
                        fontSize: "0.65rem",
                        lineHeight: 1.25,
                        background: isToday
                          ? "var(--accent-soft)"
                          : weekend
                            ? "var(--surface-2)"
                            : undefined,
                        color: isToday ? "var(--accent-text)" : "var(--text-muted)",
                        borderRight: "1px solid var(--border)",
                      }}
                    >
                      <div>
                        {parsed.toLocaleDateString("en-GB", { weekday: "short" })}
                      </div>
                      <div style={{ fontWeight: 600, color: "var(--text)", fontSize: "0.8rem" }}>
                        {parsed.getUTCDate()}
                      </div>
                      <div>
                        {parsed.toLocaleDateString("en-GB", { month: "short" }).toUpperCase()}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* One group per room type, one row per room within it */}
              {groups.map((group) => (
                <div key={group.id}>
                  {/* The type header. Sticky to the left edge so it stays
                      readable while the grid scrolls sideways. */}
                  <div
                    onClick={() => toggleGroup(group.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.4rem",
                      position: "sticky",
                      left: 0,
                      width: ROOM_COL + windowDays * dayWidth,
                      padding: "0.35rem 0.5rem",
                      background: "var(--surface-2)",
                      borderTop: "1px solid var(--border-strong)",
                      borderBottom: "1px solid var(--border-strong)",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      cursor: "pointer",
                      userSelect: "none",
                      zIndex: 2,
                    }}
                  >
                    <span style={{ width: 10, color: "var(--text-faint)" }}>
                      {collapsed[group.id] ? "▸" : "▾"}
                    </span>
                    <span>{group.name}</span>
                    <span style={{ fontWeight: 400, color: "var(--text-faint)" }}>
                      {group.rooms.length} room{group.rooms.length === 1 ? "" : "s"}
                      {" · "}
                      {occupiedOnAnchor(group)} occupied
                    </span>
                  </div>

                  {!collapsed[group.id] &&
                    group.rooms.map((room) => (
                    <div
                      key={room.id}
                      style={{
                        display: "flex",
                        position: "relative",
                        height: 40,
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <div
                        style={{
                          width: ROOM_COL,
                          flexShrink: 0,
                          padding: "0.35rem 0.5rem",
                          fontSize: "0.8rem",
                          borderRight: "1px solid var(--border-strong)",
                          background: "var(--surface)",
                          position: "sticky",
                          left: 0,
                          zIndex: 2,
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>{room.room_number}</div>
                        {/* The type sits on the group header now, so the row
                            shows only what the header cannot say about this
                            one room. */}
                        {!room.is_active && (
                          <div
                            style={{ fontSize: "0.65rem", color: "var(--text-faint)" }}
                          >
                            out of order
                          </div>
                        )}
                      </div>

                      {/* The day cells: the drop target, and a click starts a booking */}
                      <div style={{ display: "flex", position: "relative", flex: 1 }}>
                        {dates.map((d) => {
                          const parsed = parseDateISO(d);
                          const weekend = [0, 6].includes(parsed.getUTCDay());
                          return (
                            <div
                              key={d}
                              data-room-id={room.id}
                              data-date={d}
                              onClick={() =>
                                room.is_active &&
                                setNewBooking({
                                  room_id: room.id,
                                  room_type_id: room.room_type_id,
                                  check_in: d,
                                  check_out: shiftDate(d, 1),
                                })
                              }
                              style={{
                                width: dayWidth,
                                flexShrink: 0,
                                borderRight: "1px solid var(--border)",
                                background:
                                  d === today
                                    ? "var(--accent-soft)"
                                    : weekend
                                      ? "var(--surface-2)"
                                      : undefined,
                                cursor: room.is_active ? "cell" : "not-allowed",
                              }}
                            />
                          );
                        })}

                        {/* Bars for this room, over the cells */}
                        {barsForRoom(room).map((r) => {
                              const geo = barGeometry(r);
                              if (!geo) return null;
                              const isDragging = drag?.id === r.id;
                              const style = BAR_STYLE[r.status] || BAR_STYLE.confirmed;

                              return (
                                <div
                                  key={r.id}
                                  onPointerDown={(e) => beginDrag(e, r, "move")}
                                  title={`${r.guest_name} · ${r.reference}\n${r.check_in} → ${r.check_out}`}
                                  style={{
                                    position: "absolute",
                                    left: geo.left,
                                    width: geo.width,
                                    top: 5,
                                    height: 30,
                                    ...style,
                                    borderRadius: 4,
                                    borderTopLeftRadius: geo.clippedStart ? 0 : 4,
                                    borderBottomLeftRadius: geo.clippedStart ? 0 : 4,
                                    borderTopRightRadius: geo.clippedEnd ? 0 : 4,
                                    borderBottomRightRadius: geo.clippedEnd ? 0 : 4,
                                    display: "flex",
                                    alignItems: "center",
                                    padding: "0 0.4rem",
                                    fontSize: "0.7rem",
                                    fontWeight: 600,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    cursor: isDragging ? "grabbing" : "grab",
                                    opacity: isDragging ? 0.75 : 1,
                                    zIndex: isDragging ? 5 : 1,
                                    userSelect: "none",
                                    boxShadow: isDragging
                                      ? "0 2px 8px rgba(0,0,0,0.3)"
                                      : undefined,
                                  }}
                                >
                                  {/* Resize handles, left and right */}
                                  <span
                                    onPointerDown={(e) => beginDrag(e, r, "start")}
                                    style={{
                                      position: "absolute",
                                      left: 0,
                                      top: 0,
                                      bottom: 0,
                                      width: 6,
                                      cursor: "ew-resize",
                                    }}
                                  />
                                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {r.guest_name}
                                  </span>
                                  <span
                                    onPointerDown={(e) => beginDrag(e, r, "end")}
                                    style={{
                                      position: "absolute",
                                      right: 0,
                                      top: 0,
                                      bottom: 0,
                                      width: 6,
                                      cursor: "ew-resize",
                                    }}
                                  />
                                </div>
                              );
                            })}
                      </div>
                    </div>
                    ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3 text-xs" style={{ color: "var(--text-muted)" }}>
        <span>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              background: "var(--accent)",
              borderRadius: 2,
              marginRight: 4,
            }}
          />
          Confirmed
        </span>
        <span>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              background: "var(--warn)",
              borderRadius: 2,
              marginRight: 4,
            }}
          />
          In house
        </span>
        <span>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              background: "var(--surface-2)",
              border: "1px solid var(--border-strong)",
              borderRadius: 2,
              marginRight: 4,
            }}
          />
          Checked out
        </span>
      </div>

      {pending && (
        <PricingDialog
          plan={pending.plan}
          reservation={allRooms
            .flatMap((r) => r.reservations)
            .find((r) => r.id === pending.move.id)}
          onChoose={(pricing) => sendMove(pending.move, pricing)}
          onCancel={() => setPending(null)}
        />
      )}

      {(openId || newBooking) && (
        <BookingModal
          session={session}
          reservationId={openId}
          prefill={newBooking}
          extras={extras}
          onClose={() => {
            setOpenId(null);
            setNewBooking(null);
          }}
          onChanged={(warning) => {
            if (warning) setSyncWarning(warning);
            load();
          }}
        />
      )}
    </div>
  );
}

function formatMoney(value, currency = "INR") {
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : "₹";
  return `${symbol}${(Number(value) || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;
}

function nightLabel(date) {
  return parseDateISO(date).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * The question a resize asks: what happens to the price?
 *
 * Both answers are shown with their real figures, because "adjust the total"
 * means nothing until the desk can see it is ₹9,000 for two Saturday nights.
 * Neither answer is assumed: closing the dialog cancels the move.
 */
function PricingDialog({ plan, reservation, onChoose, onCancel }) {
  const [busy, setBusy] = useState(false);
  const currency = reservation?.currency || "INR";
  const longer = plan.added.length > 0;
  const changed = longer ? plan.added : plan.removed;
  const nights = changed.length;
  const noun = `${nights} night${nights === 1 ? "" : "s"}`;
  const estimated = plan.added.some((n) => n.estimated);

  async function choose(pricing) {
    setBusy(true);
    await onChoose(pricing);
    setBusy(false);
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 60,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "4rem 1rem",
      }}
    >
      <div
        className="card card-pad space-y-3"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 460, background: "var(--surface)" }}
      >
        <div style={{ fontWeight: 600 }}>
          {longer ? `Stay extended by ${noun}` : `Stay shortened by ${noun}`}
          {reservation ? ` — ${reservation.guest_name}` : ""}
        </div>

        <table className="grid-table w-full text-sm">
          <tbody>
            {changed.map((n) => (
              <tr key={n.stay_date}>
                <td>
                  {longer ? "+ " : "− "}
                  {nightLabel(n.stay_date)}
                  {n.estimated && (
                    <span style={{ color: "var(--warn)", fontSize: "0.7rem" }}>
                      {" "}
                      · no rate set, stay average used
                    </span>
                  )}
                </td>
                <td className="text-right">{formatMoney(n.rate, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="text-sm space-y-1">
          <div className="flex justify-between">
            <span style={{ color: "var(--text-muted)" }}>Room charge now</span>
            <span>{formatMoney(plan.currentTotal, currency)}</span>
          </div>
          <div className="flex justify-between" style={{ fontWeight: 600 }}>
            <span>{longer ? "If increased" : "If decreased"}</span>
            <span>
              {formatMoney(plan.adjustedTotal, currency)}{" "}
              <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                ({plan.delta >= 0 ? "+" : "−"}
                {formatMoney(Math.abs(plan.delta), currency)})
              </span>
            </span>
          </div>
        </div>

        {estimated && (
          <p className="sub" style={{ fontSize: "0.7rem" }}>
            The Channel Manager has no rate for some of the new nights, so they are
            priced at this stay&apos;s average night. You can change any night
            afterwards in the booking&apos;s Inclusions tab.
          </p>
        )}

        <p className="sub" style={{ fontSize: "0.7rem" }}>
          {longer
            ? "Keeping the amount adds the new nights at no charge."
            : "Keeping the amount records the dropped nights as a retention charge on the folio, so the total stays the same."}
        </p>

        <div className="flex flex-wrap gap-2 justify-end">
          <button className="btn btn-ghost text-sm" disabled={busy} onClick={onCancel}>
            Cancel move
          </button>
          <button
            className="btn btn-secondary text-sm"
            disabled={busy}
            onClick={() => choose("keep")}
          >
            Keep {formatMoney(plan.currentTotal, currency)}
          </button>
          <button
            className="btn btn-primary text-sm"
            disabled={busy}
            onClick={() => choose("adjust")}
          >
            {longer ? "Increase" : "Decrease"} to {formatMoney(plan.adjustedTotal, currency)}
          </button>
        </div>
      </div>
    </div>
  );
}
