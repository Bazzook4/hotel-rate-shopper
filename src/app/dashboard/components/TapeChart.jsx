"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, formatDateISO, parseDateISO, todayUTC } from "@/lib/date";
import BookingModal from "./BookingModal";
import RoomBlockModal from "./RoomBlockModal";
import GroupBookingModal from "./GroupBookingModal";
import DateToolbar, { ToolbarField } from "./DateToolbar";
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

/**
 * An out-of-order block: grey and striped, so it reads as "not a stay" at a
 * glance and cannot be mistaken for a checked-out guest.
 */
const BLOCK_STYLE = {
  background:
    "repeating-linear-gradient(135deg, var(--surface-2) 0 6px, var(--border-strong) 6px 8px)",
  color: "var(--text-muted)",
  border: "1px solid var(--border-strong)",
};

/** What a selection of empty nights can become. */
const SELECTION_ACTIONS = [
  { id: "reservation", label: "New reservation" },
  { id: "complimentary", label: "Complimentary stay" },
  { id: "group", label: "Group booking" },
  { id: "block", label: "Out of order" },
];

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
  // An out-of-order block being created ({ room, start_date, end_date }) or
  // opened ({ block }), and a group booking started from a selection.
  const [blockEdit, setBlockEdit] = useState(null);
  const [newGroup, setNewGroup] = useState(null);

  /**
   * Empty nights being selected by dragging along a room's row, and the menu
   * that opens once the pointer is let go.
   *
   * The selection is drawn as a ghost bar so the desk sees exactly which
   * nights they are about to book or block -- arrival on the first, departure
   * the morning after the last -- before choosing what to do with them. It
   * stays on screen while the menu is open. Mirrored in a ref for the same
   * reason as the drag: the window handlers would otherwise see a stale one.
   */
  const [selection, setSelection] = useState(null);
  const selectionRef = useRef(null);
  const [menu, setMenu] = useState(null);

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

  // ----- selecting empty nights ----------------------------------------

  /** The stay a selection describes: first night to the morning after the last. */
  function selectionRange(sel) {
    const [first, last] = sel.from <= sel.to ? [sel.from, sel.to] : [sel.to, sel.from];
    return { check_in: first, check_out: shiftDate(last, 1) };
  }

  function beginSelect(e, room, date) {
    if (!room.is_active || e.button !== 0) return;
    e.preventDefault();
    setMenu(null);
    const start = {
      room,
      originX: e.clientX,
      anchor: date,
      from: date,
      to: date,
    };
    selectionRef.current = start;
    setSelection(start);
  }

  useEffect(() => {
    if (!selection || menu) return;

    function onMove(e) {
      const sel = selectionRef.current;
      if (!sel) return;
      const shift = Math.round((e.clientX - sel.originX) / dayWidthRef.current);
      // Held inside the window: a night off-screen cannot be seen being chosen.
      const lastDate = shiftDate(anchor, windowDays - 1);
      let to = shiftDate(sel.anchor, shift);
      if (to < anchor) to = anchor;
      if (to > lastDate) to = lastDate;
      if (to === sel.to) return;
      const next = { ...sel, to };
      selectionRef.current = next;
      setSelection(next);
    }

    function onUp(e) {
      const sel = selectionRef.current;
      if (!sel) return;
      // Kept on screen under the menu; cleared when the menu closes.
      setMenu({ x: e.clientX, y: e.clientY });
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [selection, menu, anchor, windowDays]);

  const closeSelection = useCallback(() => {
    selectionRef.current = null;
    setSelection(null);
    setMenu(null);
  }, []);

  useEffect(() => {
    if (!menu) return;
    function onKey(e) {
      if (e.key === "Escape") closeSelection();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, closeSelection]);

  /**
   * What already sits on a selection's nights in its room, if anything.
   *
   * Shown on the ghost and in the menu so an overlap is seen before it is
   * refused; the server refuses it regardless.
   */
  function selectionConflict(sel) {
    const { check_in, check_out } = selectionRange(sel);
    const stay = sel.room.reservations.find(
      (r) => r.check_in < check_out && r.check_out > check_in
    );
    if (stay) return `Overlaps ${stay.guest_name}`;
    const block = (sel.room.blocks || []).find(
      (b) => b.start_date < check_out && b.end_date > check_in
    );
    if (block) return "Overlaps an out-of-order block";
    return null;
  }

  function chooseAction(action) {
    const sel = selectionRef.current;
    closeSelection();
    if (!sel) return;
    const { check_in, check_out } = selectionRange(sel);
    const room = sel.room;

    if (action === "reservation" || action === "complimentary") {
      setNewBooking({
        room_id: room.id,
        room_type_id: room.room_type_id,
        check_in,
        check_out,
        ...(action === "complimentary" ? { booking_type: "complimentary" } : {}),
      });
    } else if (action === "group") {
      setNewGroup({ room_ids: [room.id], check_in, check_out });
    } else if (action === "block") {
      setBlockEdit({ room, start_date: check_in, end_date: check_out });
    }
  }

  /** Where a span of dates sits in the window, in pixels; null if off-screen. */
  function spanGeometry(from, until) {
    const offset = daysBetween(anchor, from);
    const nights = daysBetween(from, until);
    const start = Math.max(0, offset);
    const end = Math.min(windowDays, offset + nights);
    if (end <= 0 || start >= windowDays) return null;
    return {
      left: start * dayWidth,
      width: Math.max(dayWidth * 0.6, (end - start) * dayWidth - 4),
      clippedStart: offset < 0,
      clippedEnd: offset + nights > windowDays,
    };
  }

  /** Where a bar sits and how wide it is, in pixels across the date window. */
  function barGeometry(reservation) {
    const d =
      drag?.id === reservation.id
        ? drag.preview
        : pending?.move.id === reservation.id
          ? pending.move
          : reservation;

    return spanGeometry(d.check_in, d.check_out);
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
   * How many of each type's rooms are sold on each date of the window.
   *
   * Shown in the type header under every date, so the desk reads "2/8" at a
   * glance instead of counting bars -- and a folded type still answers the
   * one question worth asking of it. Unassigned stays count: they have sold a
   * room of the type even before one is chosen, and the channel manager has
   * already deducted them. A date is sold when it falls on or after arrival
   * and strictly before departure -- departure day is the room handed back.
   */
  const soldByType = useMemo(() => {
    if (!chart) return {};
    const out = {};
    const stays = [
      ...chart.roomTypes.flatMap((rt) =>
        rt.rooms.flatMap((room) => room.reservations)
      ),
      ...(chart.unassigned || []),
    ];
    for (const rt of chart.roomTypes) {
      const own = stays.filter((r) => r.room_type_id === rt.id);
      out[rt.id] = {};
      for (const d of dates) {
        out[rt.id][d] = own.filter((r) => r.check_in <= d && r.check_out > d).length;
      }
    }
    return out;
  }, [chart, dates]);

  /**
   * How many of each type's rooms are out of order on each date. They are
   * neither sold nor for sale, so they come off the count the header divides
   * by -- "2/7" with one room blocked, not "2/8" as if it could still be sold.
   */
  const blockedByType = useMemo(() => {
    if (!chart) return {};
    const out = {};
    for (const rt of chart.roomTypes) {
      out[rt.id] = {};
      for (const d of dates) {
        out[rt.id][d] = rt.rooms.filter(
          (room) =>
            room.is_active &&
            (room.blocks || []).some((b) => b.start_date <= d && b.end_date > d)
        ).length;
      }
    }
    return out;
  }, [chart, dates]);

  function toggleGroup(id) {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="h1">Calendar</h2>
          <p className="sub">
            Every room, night by night. Drag across empty nights to book or block
            them; click a booking to open it, or drag it to move or resize the stay.
          </p>
        </div>
      </div>

      <DateToolbar
        value={anchor}
        onChange={setAnchor}
        step={windowDays}
        windows={WINDOWS.map((w) => w.days)}
        windowDays={windowDays}
        onWindowChange={setWindowDays}
        onClearAll={typeFilter !== "all" ? () => setTypeFilter("all") : undefined}
        filters={
          chart?.roomTypes?.length > 1 && (
            <ToolbarField label="Room types" htmlFor="tape-type">
              <select
                id="tape-type"
                className="input"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="all">All room types</option>
                {chart.roomTypes.map((rt) => (
                  <option key={rt.id} value={rt.id}>
                    {rt.name}
                  </option>
                ))}
              </select>
            </ToolbarField>
          )
        }
      />

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
        <span>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              ...BLOCK_STYLE,
              borderRadius: 2,
              marginRight: 4,
              verticalAlign: "middle",
            }}
          />
          Out of order
        </span>
        <span>
          <BarTag legend>COMP</BarTag> Complimentary
        </span>
        <span>
          <BarTag legend>GRP</BarTag> Group booking
        </span>
      </div>

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
                  {/* The type header: name on the left, then each date's
                      sold count with the two-adult rate in fine print. */}
                  <div
                    onClick={() => toggleGroup(group.id)}
                    style={{
                      display: "flex",
                      background: "var(--surface-2)",
                      borderTop: "1px solid var(--border-strong)",
                      borderBottom: "1px solid var(--border-strong)",
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.4rem",
                        width: ROOM_COL,
                        flexShrink: 0,
                        padding: "0.35rem 0.5rem",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        background: "var(--surface-2)",
                        borderRight: "1px solid var(--border-strong)",
                        position: "sticky",
                        left: 0,
                        zIndex: 2,
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span style={{ width: 10, color: "var(--text-faint)" }}>
                        {collapsed[group.id] ? "▸" : "▾"}
                      </span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                        {group.name}
                      </span>
                      <span style={{ fontWeight: 400, color: "var(--text-faint)" }}>
                        {group.rooms.length} room{group.rooms.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    {dates.map((d) => {
                      const sold = soldByType[group.id]?.[d] || 0;
                      const blocked = blockedByType[group.id]?.[d] || 0;
                      const total = group.rooms.length - blocked;
                      const full = total <= 0 || sold >= total;
                      const blockedNote = blocked > 0 ? ` · ${blocked} out of order` : "";
                      const typeRates = chart.rates?.[group.id];
                      const rate = typeRates?.nights?.[d];
                      return (
                        <div
                          key={d}
                          title={
                            rate != null
                              ? `${sold} of ${total} sold${blockedNote} · ${formatMoney(rate)} for 2 adults${
                                  typeRates.base_price_only
                                    ? " (base price — no channel rate set)"
                                    : typeRates.plan_name
                                      ? ` on ${typeRates.plan_name}`
                                      : ""
                                }`
                              : `${sold} of ${total} sold${blockedNote}`
                          }
                          style={{
                            width: dayWidth,
                            flexShrink: 0,
                            textAlign: "center",
                            padding: "0.2rem 0",
                            lineHeight: 1.2,
                            borderRight: "1px solid var(--border)",
                            background: d === today ? "var(--accent-soft)" : undefined,
                          }}
                        >
                          <div
                            style={{
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              color: full ? "var(--danger)" : "var(--text)",
                            }}
                          >
                            {sold}/{total}
                          </div>
                          {rate != null && (
                            <div
                              style={{
                                fontSize: "0.6rem",
                                color: "var(--text-faint)",
                                fontStyle: typeRates.base_price_only ? "italic" : undefined,
                              }}
                            >
                              {formatMoney(rate)}
                            </div>
                          )}
                        </div>
                      );
                    })}
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
                              onPointerDown={(e) => beginSelect(e, room, d)}
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

                        {/* Out-of-order blocks, under the stays */}
                        {(room.blocks || []).map((b) => {
                          const geo = spanGeometry(b.start_date, b.end_date);
                          if (!geo) return null;
                          return (
                            <div
                              key={b.id}
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={() => setBlockEdit({ room, block: b })}
                              title={`Out of order${b.reason ? ` — ${b.reason}` : ""}\n${b.start_date} → back ${b.end_date}`}
                              style={{
                                position: "absolute",
                                left: geo.left,
                                width: geo.width,
                                top: 5,
                                height: 30,
                                ...BLOCK_STYLE,
                                borderRadius: 4,
                                display: "flex",
                                alignItems: "center",
                                padding: "0 0.4rem",
                                fontSize: "0.7rem",
                                fontWeight: 600,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                cursor: "pointer",
                                userSelect: "none",
                                zIndex: 1,
                              }}
                            >
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                                Out of order{b.reason ? ` · ${b.reason}` : ""}
                              </span>
                            </div>
                          );
                        })}

                        {/* The nights being selected, as a ghost of the stay */}
                        {selection?.room.id === room.id &&
                          (() => {
                            const range = selectionRange(selection);
                            const geo = spanGeometry(range.check_in, range.check_out);
                            if (!geo) return null;
                            const nights = daysBetween(range.check_in, range.check_out);
                            const conflict = selectionConflict(selection);
                            const tone = conflict ? "var(--danger)" : "var(--accent)";
                            return (
                              <div
                                style={{
                                  position: "absolute",
                                  left: geo.left,
                                  width: geo.width,
                                  top: 5,
                                  height: 30,
                                  border: `2px dashed ${tone}`,
                                  background: conflict ? "var(--danger-soft)" : "var(--accent-soft)",
                                  color: conflict ? "var(--danger)" : "var(--accent-text)",
                                  borderRadius: 4,
                                  display: "flex",
                                  alignItems: "center",
                                  padding: "0 0.4rem",
                                  fontSize: "0.7rem",
                                  fontWeight: 600,
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  pointerEvents: "none",
                                  zIndex: 4,
                                }}
                              >
                                {conflict ||
                                  `${nights} night${nights === 1 ? "" : "s"} · ${nightLabel(range.check_in)} → ${nightLabel(range.check_out)}`}
                              </div>
                            );
                          })()}

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
                                  {r.booking_type === "complimentary" && (
                                    <BarTag title="Complimentary">COMP</BarTag>
                                  )}
                                  {r.group_id && <BarTag title="Group booking">GRP</BarTag>}
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

      {menu && selection && (
        <SelectionMenu
          x={menu.x}
          y={menu.y}
          room={selection.room}
          range={selectionRange(selection)}
          conflict={selectionConflict(selection)}
          onChoose={chooseAction}
          onClose={closeSelection}
        />
      )}

      {blockEdit && (
        <RoomBlockModal
          session={session}
          room={blockEdit.room}
          block={blockEdit.block}
          initial={blockEdit}
          onClose={() => setBlockEdit(null)}
          onChanged={(warning) => {
            setSyncWarning(warning);
            load();
          }}
        />
      )}

      {newGroup && (
        <GroupBookingModal
          session={session}
          chart={chart}
          initial={newGroup}
          onClose={() => setNewGroup(null)}
          onChanged={(warning) => {
            setSyncWarning(warning);
            load();
          }}
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

/** A small marker on a bar for what its colour cannot say: comp, group. */
function BarTag({ children, title, legend = false }) {
  return (
    <span
      title={title}
      style={{
        flexShrink: 0,
        marginRight: legend ? 2 : 4,
        padding: "0 3px",
        borderRadius: 3,
        fontSize: "0.55rem",
        fontWeight: 700,
        letterSpacing: "0.03em",
        lineHeight: "14px",
        background: legend ? "var(--surface-2)" : "rgba(255,255,255,0.25)",
        border: legend ? "1px solid var(--border-strong)" : "1px solid rgba(255,255,255,0.6)",
        color: legend ? "var(--text-muted)" : "inherit",
      }}
    >
      {children}
    </span>
  );
}

/**
 * What to do with a selection of empty nights, opened where the pointer let go.
 *
 * Says which room and which nights, because the ghost bar may be scrolled
 * half out of view by the time the desk reads the menu.
 */
function SelectionMenu({ x, y, room, range, conflict, onChoose, onClose }) {
  const nights = daysBetween(range.check_in, range.check_out);
  // Kept on screen when the pointer lets go near the right or bottom edge.
  const left = Math.min(x + 4, (typeof window !== "undefined" ? window.innerWidth : 1200) - 230);
  const top = Math.min(y + 4, (typeof window !== "undefined" ? window.innerHeight : 800) - 250);

  return (
    <>
      <div
        onPointerDown={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 40 }}
      />
      <div
        className="card"
        style={{
          position: "fixed",
          left,
          top,
          zIndex: 41,
          width: 220,
          padding: "0.35rem",
          background: "var(--surface)",
          boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
        }}
      >
        <div style={{ padding: "0.35rem 0.5rem 0.45rem", fontSize: "0.75rem" }}>
          <div style={{ fontWeight: 600 }}>Room {room.room_number}</div>
          <div style={{ color: "var(--text-muted)" }}>
            {nightLabel(range.check_in)} → {nightLabel(range.check_out)} · {nights} night
            {nights === 1 ? "" : "s"}
          </div>
          {conflict && <div style={{ color: "var(--danger)" }}>{conflict}</div>}
        </div>
        {SELECTION_ACTIONS.map((a) => (
          <button
            key={a.id}
            className="btn btn-ghost text-sm"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => onChoose(a.id)}
          >
            {a.label}
          </button>
        ))}
      </div>
    </>
  );
}
