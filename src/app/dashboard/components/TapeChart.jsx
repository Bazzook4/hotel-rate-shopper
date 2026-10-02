"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, formatDateISO, parseDateISO, todayUTC } from "@/lib/date";
import BookingModal from "./BookingModal";
import RoomBlockModal from "./RoomBlockModal";
import GroupBookingModal from "./GroupBookingModal";
import DateToolbar, { ToolbarField } from "./DateToolbar";
import { inventoryWarning } from "@/lib/inventoryNotice";
import { visibleModules } from "../modules";

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
/**
 * The same column on a phone. A room row shows only its number, so on a
 * narrow screen the full width goes to the nights instead.
 */
const ROOM_COL_NARROW = 72;
const NARROW_GRID = 640;

const WINDOWS = [
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
];

/**
 * How a bar is coloured, which is how status reads at a glance. A stay that
 * is only promised is light -- dashed while it is still an inquiry -- and one
 * where the guest has actually arrived or left is solid.
 */
const BAR_STYLE = {
  inquiry: {
    background: "var(--warn-soft)",
    color: "var(--warn)",
    border: "1px dashed var(--warn)",
  },
  confirmed: {
    background: "var(--accent-soft)",
    color: "var(--accent-text)",
    border: "1px solid var(--accent)",
  },
  in_house: { background: "var(--status-in)", color: "#fff" },
  checked_out: { background: "var(--status-out)", color: "#fff" },
};

/** The legend, in the order a stay moves through them. */
const LEGEND = [
  { status: "inquiry", label: "Inquiry" },
  { status: "confirmed", label: "Confirmed" },
  { status: "in_house", label: "Checked in" },
  { status: "checked_out", label: "Checked out" },
];

/** Comp and group are tags on top of any status, each in a hue of its own. */
const TAG_COLOR = {
  COMP: "var(--tag-comp)",
  GRP: "var(--tag-group)",
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
  { id: "inquiry", label: "Inquiry (hold the room)" },
  { id: "complimentary", label: "Complimentary stay" },
  { id: "group", label: "Group booking" },
  { id: "block", label: "Out of order" },
];

/**
 * What can be done with a booking already on the chart, offered when its bar
 * is clicked. Each opens the booking where that job is done rather than on
 * Details, so taking a payment is one click and not a hunt for the tab.
 */
const BOOKING_ACTIONS = [
  { id: "details", label: "Edit booking" },
  { id: "upgrade", label: "Upgrade / change room", assign: "Assign a room" },
  { id: "inclusions", label: "Add service" },
  { id: "payments", label: "Collect payment" },
];

/** Stays whose room can no longer change: they are over, or never happened. */
const SETTLED = ["checked_out", "cancelled", "no_show"];

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
  const [windowDays, setWindowDays] = useState(14);
  const [chart, setChart] = useState(null);
  const [extras, setExtras] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Kept apart from `error`, which every reload clears: a change saves and
  // then reloads, and the warning that the OTAs missed it must outlive that.
  const [syncWarning, setSyncWarning] = useState(null);

  const [openId, setOpenId] = useState(null);
  // Which tab an opened booking starts on, and the job it was opened for --
  // "payments" from Collect payment puts the cursor in the amount.
  const [openTab, setOpenTab] = useState("details");
  const [newBooking, setNewBooking] = useState(null);
  // A clicked booking's menu ({ reservation, x, y }), and a stay whose room is
  // being changed from it.
  const [bookingMenu, setBookingMenu] = useState(null);
  const [upgrade, setUpgrade] = useState(null);
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
  const narrow = gridWidth > 0 && gridWidth < NARROW_GRID;
  const roomCol = narrow ? ROOM_COL_NARROW : ROOM_COL;
  const dayWidth = Math.max(
    MIN_DAY_WIDTH,
    Math.floor((gridWidth - roomCol) / windowDays) || 0
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

  // Only the first load blanks the chart. Every save reloads it, and swapping
  // the grid for "Loading…" each time threw away the scroll position and made
  // a one-cell change look like the whole page reloading; after that the
  // chart stays up, dimmed, until the fresh copy replaces it.
  const firstLoad = !chart && !error;

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
      reservation,
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

    async function onUp(e) {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d) return;

      const moved =
        d.preview.check_in !== d.check_in ||
        d.preview.check_out !== d.check_out ||
        d.preview.room_id !== d.room_id;

      // A click that never moved is a click, and asks what to do with it.
      if (!moved) {
        setBookingMenu({ reservation: d.reservation, x: e.clientX, y: e.clientY });
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

    if (action === "reservation" || action === "complimentary" || action === "inquiry") {
      setNewBooking({
        room_id: room.id,
        room_type_id: room.room_type_id,
        check_in,
        check_out,
        ...(action === "complimentary" ? { booking_type: "complimentary" } : {}),
        ...(action === "inquiry" ? { status: "inquiry" } : {}),
      });
    } else if (action === "group") {
      setNewGroup({ room_ids: [room.id], check_in, check_out });
    } else if (action === "block") {
      setBlockEdit({ room, start_date: check_in, end_date: check_out });
    }
  }

  // Whether this user may change a room's clean/dirty status. The status is
  // shown to everyone; only the Housekeeping right makes it a button, the
  // same right the housekeeping route checks.
  const canHousekeep = useMemo(
    () => visibleModules(session).some((p) => p.id === "housekeeping"),
    [session]
  );

  /**
   * Flip a room between clean and dirty from its row, so the desk need not
   * open Housekeeping to say a room is ready. Shown at once and put back if
   * the save fails; tapping again is the undo.
   */
  async function toggleHousekeeping(room) {
    const next = room.housekeeping === "dirty" ? "clean" : "dirty";
    const setRoom = (status) =>
      setChart((prev) =>
        prev && {
          ...prev,
          roomTypes: prev.roomTypes.map((rt) => ({
            ...rt,
            rooms: rt.rooms.map((x) => (x.id === room.id ? { ...x, housekeeping: status } : x)),
          })),
        }
      );
    setError(null);
    setRoom(next);
    try {
      const res = await fetch("/api/pms/housekeeping", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_id: propertyId, ids: [room.id], status: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update housekeeping");
    } catch (err) {
      setRoom(room.housekeeping);
      setError(err.message);
    }
  }

  /**
   * Move a booking on from the chart: check a guest in, or confirm an
   * inquiry. The route refuses an early arrival or a stay with no room, and
   * the menu only offers check-in when neither applies.
   */
  async function setStatus(r, status) {
    setError(null);
    try {
      const res = await fetch("/api/pms/reservations/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: r.id, status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update the booking");
      setSyncWarning(inventoryWarning(data));
    } catch (err) {
      setError(err.message);
    }
    await load();
  }

  function chooseBookingAction(action) {
    const r = bookingMenu?.reservation;
    setBookingMenu(null);
    if (!r) return;
    if (action === "checkin") {
      setStatus(r, "in_house");
    } else if (action === "confirm") {
      setStatus(r, "confirmed");
    } else if (action === "upgrade") {
      setUpgrade(r);
    } else {
      setOpenTab(action);
      setOpenId(r.id);
    }
  }

  /**
   * Where a span of dates sits in the window, in pixels; null if off-screen.
   *
   * A span runs from the middle of its first day to the middle of its last,
   * not edge to edge. Check-out is late morning and check-in early afternoon,
   * so a departure day is shared: the leaving guest holds the room's first
   * half, and the next arrival can take its second. Drawn whole-day, the
   * departure cell looked empty and a same-day turnover looked like a clash.
   */
  function spanGeometry(from, until) {
    const offset = daysBetween(anchor, from) + 0.5;
    const nights = daysBetween(from, until);
    const start = Math.max(0, offset);
    const end = Math.min(windowDays, offset + nights);
    if (end <= 0 || start >= windowDays) return null;
    const clippedStart = offset < 0;
    const clippedEnd = offset + nights > windowDays;
    // A small gap either end, so a departure and an arrival on the same day
    // read as two bars meeting rather than one.
    const left = start * dayWidth + (clippedStart ? 0 : 2);
    const right = end * dayWidth - (clippedEnd ? 0 : 2);
    return {
      left,
      width: right - left,
      clippedStart,
      clippedEnd,
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
                onClick={(e) =>
                  setBookingMenu({ reservation: r, x: e.clientX, y: e.clientY })
                }
                title={`${r.check_in} → ${r.check_out}`}
              >
                {r.guest_name} · {r.room_types?.room_type_name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3 text-xs" style={{ color: "var(--text-muted)" }}>
        {LEGEND.map(({ status, label }) => (
          <span key={status}>
            <span
              style={{
                display: "inline-block",
                width: 12,
                height: 12,
                boxSizing: "border-box",
                ...BAR_STYLE[status],
                borderRadius: 2,
                marginRight: 4,
                verticalAlign: "middle",
              }}
            />
            {label}
          </span>
        ))}
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

      <div
        className="card"
        style={{
          overflow: "hidden",
          opacity: loading && !firstLoad ? 0.6 : 1,
          transition: "opacity 0.15s",
        }}
      >
        {firstLoad && <p className="sub card-pad">Loading…</p>}

        {!firstLoad && allRooms.length === 0 && (
          <p className="sub card-pad">
            No rooms set up yet. Add them in Room Setup — the chart needs actual
            rooms to lay bookings out against.
          </p>
        )}

        {!firstLoad && allRooms.length > 0 && visibleRooms.length === 0 && (
          <p className="sub card-pad">
            That room type has no rooms yet. Add them in Room Setup, or pick
            another type above.
          </p>
        )}

        {!firstLoad && visibleRooms.length > 0 && (
          <div style={{ overflowX: "auto" }} ref={measureGrid}>
            <div style={{ minWidth: roomCol + windowDays * dayWidth }}>
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
                    width: roomCol,
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
                        width: roomCol,
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
                      {/* The count gives way on a phone, where the column
                          is only wide enough for the type's name. */}
                      {!narrow && (
                        <span style={{ fontWeight: 400, color: "var(--text-faint)" }}>
                          {group.rooms.length} room{group.rooms.length === 1 ? "" : "s"}
                        </span>
                      )}
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
                          width: roomCol,
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
                        {!room.is_active ? (
                          <div
                            style={{ fontSize: "0.65rem", color: "var(--text-faint)" }}
                          >
                            out of order
                          </div>
                        ) : (
                          <HousekeepingTag
                            status={room.housekeeping}
                            onToggle={canHousekeep ? () => toggleHousekeeping(room) : null}
                          />
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
                                    boxSizing: "border-box",
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

      {bookingMenu && (
        <BookingMenu
          x={bookingMenu.x}
          y={bookingMenu.y}
          reservation={bookingMenu.reservation}
          room={allRooms.find((room) => room.id === bookingMenu.reservation.room_id)}
          today={today}
          onChoose={chooseBookingAction}
          onClose={() => setBookingMenu(null)}
        />
      )}

      {upgrade && (
        <RoomChangeDialog
          reservation={upgrade}
          roomTypes={chart?.roomTypes || []}
          onChoose={async (roomId) => {
            setUpgrade(null);
            await sendMove({
              id: upgrade.id,
              room_id: roomId,
              check_in: upgrade.check_in,
              check_out: upgrade.check_out,
            });
          }}
          onCancel={() => setUpgrade(null)}
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
          initialTab={openTab}
          prefill={newBooking}
          extras={extras}
          onClose={() => {
            setOpenId(null);
            setOpenTab("details");
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

/**
 * A small marker on a bar for what its colour cannot say: comp, group. Solid
 * in a hue no status uses, so it stands out on a light bar and a solid one
 * alike.
 */
/**
 * A room's clean/dirty status under its number. A button for anyone with the
 * Housekeeping right -- one tap flips clean and dirty -- and plain text for
 * everyone else. Out of order is set on the Housekeeping page, not here.
 */
function HousekeepingTag({ status, onToggle }) {
  const dirty = status === "dirty";
  const label =
    status === "out_of_order" ? "OOO" : dirty ? "Dirty" : status === "inspected" ? "Inspected" : "Clean";
  const style = {
    fontSize: "0.65rem",
    lineHeight: 1.2,
    color: dirty ? "var(--warn)" : "var(--text-faint)",
    fontWeight: dirty ? 600 : 400,
  };
  if (!onToggle || status === "out_of_order") return <div style={style}>{label}</div>;
  return (
    <button
      type="button"
      onClick={onToggle}
      title={dirty ? "Mark clean" : "Mark dirty"}
      aria-label={`${label} — tap to mark ${dirty ? "clean" : "dirty"}`}
      style={{ ...style, display: "block", padding: 0, background: "none", border: "none", cursor: "pointer", textDecoration: "underline dotted" }}
    >
      {label}
    </button>
  );
}

function BarTag({ children, title, legend = false }) {
  return (
    <span
      title={title}
      style={{
        flexShrink: 0,
        marginRight: legend ? 2 : 4,
        padding: "0 4px",
        borderRadius: 3,
        fontSize: "0.55rem",
        fontWeight: 700,
        letterSpacing: "0.03em",
        lineHeight: "14px",
        background: TAG_COLOR[children],
        color: "#fff",
        // A thin light edge keeps it apart from a solid bar of similar depth.
        boxShadow: "0 0 0 1px rgba(255,255,255,0.7)",
      }}
    >
      {children}
    </span>
  );
}

/**
 * A small menu opened where the pointer let go, with a click-away layer
 * behind it. Kept on screen when that is near the right or bottom edge.
 */
function MenuShell({ x, y, onClose, children }) {
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
        {children}
      </div>
    </>
  );
}

function MenuItem({ label, disabled, title, onClick }) {
  return (
    <button
      className="btn btn-ghost text-sm"
      style={{ width: "100%", justifyContent: "flex-start" }}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {label}
    </button>
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

  return (
    <MenuShell x={x} y={y} onClose={onClose}>
      <div style={{ padding: "0.35rem 0.5rem 0.45rem", fontSize: "0.75rem" }}>
        <div style={{ fontWeight: 600 }}>Room {room.room_number}</div>
        <div style={{ color: "var(--text-muted)" }}>
          {nightLabel(range.check_in)} → {nightLabel(range.check_out)} · {nights} night
          {nights === 1 ? "" : "s"}
        </div>
        {conflict && <div style={{ color: "var(--danger)" }}>{conflict}</div>}
      </div>
      {SELECTION_ACTIONS.map((a) => (
        <MenuItem key={a.id} label={a.label} onClick={() => onChoose(a.id)} />
      ))}
    </MenuShell>
  );
}

/**
 * What to do with a booking already on the chart, opened where it was clicked.
 *
 * The same gesture as for empty nights, so the desk learns one thing: click,
 * then say what for. A stay that is over cannot change room, and the action
 * stays in the menu but disabled so its absence is not a puzzle.
 */
function BookingMenu({ x, y, reservation: r, room, today, onChoose, onClose }) {
  const nights = daysBetween(r.check_in, r.check_out);
  const settled = SETTLED.includes(r.status);
  // Offered from the arrival day on -- a late arrival still checks in -- and
  // never before it, which the route would refuse anyway.
  const arriving = r.status === "confirmed" && r.check_in <= today;

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <MenuShell x={x} y={y} onClose={onClose}>
      <div style={{ padding: "0.35rem 0.5rem 0.45rem", fontSize: "0.75rem" }}>
        <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
          {r.guest_name}
        </div>
        <div style={{ color: "var(--text-muted)" }}>
          {r.reference}
          {room ? ` · Room ${room.room_number}` : " · no room yet"}
        </div>
        <div style={{ color: "var(--text-muted)" }}>
          {nightLabel(r.check_in)} → {nightLabel(r.check_out)} · {nights} night
          {nights === 1 ? "" : "s"}
        </div>
      </div>
      {r.status === "inquiry" && (
        <MenuItem label="Confirm booking" onClick={() => onChoose("confirm")} />
      )}
      {arriving && (
        <MenuItem
          label="Check in"
          disabled={!room}
          title={room ? undefined : "Assign a room first"}
          onClick={() => onChoose("checkin")}
        />
      )}
      {BOOKING_ACTIONS.map((a) => {
        const locked = a.id === "upgrade" && settled;
        return (
          <MenuItem
            key={a.id}
            label={a.id === "upgrade" && !room ? a.assign : a.label}
            disabled={locked}
            title={locked ? "This stay is over — its room can no longer change" : undefined}
            onClick={() => onChoose(a.id)}
          />
        );
      })}
    </MenuShell>
  );
}

/**
 * Pick another room for a stay's same nights: an upgrade, a move for a
 * complaint, or a first room for a booking that has none.
 *
 * Saved through the same move a drag makes, so it keeps what the guest is
 * paying night by night -- an upgrade given, not sold. Charging for the
 * better room is a price change, made on the booking where the new type can
 * be re-quoted.
 *
 * Rooms are offered only if nothing on the chart sits on those nights. The
 * chart shows a window, so a clash beyond it is not seen here; the server
 * checks the whole stay and refuses one.
 */
function RoomChangeDialog({ reservation: r, roomTypes, onChoose, onCancel }) {
  const [busy, setBusy] = useState(false);
  const nights = daysBetween(r.check_in, r.check_out);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const free = (room) =>
    room.is_active &&
    room.id !== r.room_id &&
    !room.reservations.some(
      (o) => o.id !== r.id && o.check_in < r.check_out && o.check_out > r.check_in
    ) &&
    !(room.blocks || []).some((b) => b.start_date < r.check_out && b.end_date > r.check_in);

  // The stay's own type first -- a move within it is the common case -- then
  // the rest in the chart's order.
  const options = roomTypes
    .map((rt) => ({ ...rt, rooms: rt.rooms.filter(free) }))
    .filter((rt) => rt.rooms.length > 0)
    .sort((a, b) => (b.id === r.room_type_id) - (a.id === r.room_type_id));

  async function choose(roomId) {
    setBusy(true);
    await onChoose(roomId);
  }

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
        <div>
          <div style={{ fontWeight: 600 }}>
            {r.room_id ? "Upgrade / change room" : "Assign a room"} — {r.guest_name}
          </div>
          <div className="sub" style={{ fontSize: "0.75rem" }}>
            {nightLabel(r.check_in)} → {nightLabel(r.check_out)} · {nights} night
            {nights === 1 ? "" : "s"}
          </div>
        </div>

        {options.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            No other room is free for all of these nights.
          </p>
        ) : (
          <div className="space-y-2" style={{ maxHeight: "50vh", overflowY: "auto" }}>
            {options.map((rt) => (
              <div key={rt.id}>
                <div
                  style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--text-muted)" }}
                >
                  {rt.name}
                  {rt.id === r.room_type_id ? " · same type" : ""}
                </div>
                <div className="flex flex-wrap gap-1" style={{ marginTop: 4 }}>
                  {rt.rooms.map((room) => (
                    <button
                      key={room.id}
                      className="btn btn-secondary text-sm"
                      disabled={busy}
                      onClick={() => choose(room.id)}
                    >
                      {room.room_number}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="sub" style={{ fontSize: "0.7rem" }}>
          The guest keeps paying what they were booked at. To charge for a better
          room, use Edit booking and re-quote the new type.
        </p>

        <div className="flex justify-end">
          <button className="btn btn-ghost text-sm" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
