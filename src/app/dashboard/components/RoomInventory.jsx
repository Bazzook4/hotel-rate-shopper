"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Room Number Setup: the physical rooms, one row each.
 *
 * Room types say what the property sells; this says which doors exist, on
 * which floor, and in what order. The order is the hotel's own -- the way the
 * desk walks the building -- and it is what the calendar, the room pickers
 * and the housekeeping board all follow.
 *
 * Housekeeping status is deliberately absent. Whether a room is clean is
 * front-office work that changes hourly; this page is setup that changes when
 * the building does. It lives under Front Office → Housekeeping.
 */

const EMPTY_NEW = { floor: "", room_number: "", room_type_id: "" };
const EMPTY_RANGE = { room_type_id: "", prefix: "", from: "", to: "", floor: "" };

/** Numeric where the room number is a number, so 99 sorts before 100. */
function naturalCompare(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export default function RoomInventory({ session }) {
  const propertyId = session?.propertyId || null;

  const [rooms, setRooms] = useState([]);
  const [roomTypes, setRoomTypes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [typeFilter, setTypeFilter] = useState("");
  const [floorFilter, setFloorFilter] = useState("");
  const [search, setSearch] = useState("");

  const [newRoom, setNewRoom] = useState(EMPTY_NEW);
  const [showRange, setShowRange] = useState(false);
  const [range, setRange] = useState(EMPTY_RANGE);
  const [dragId, setDragId] = useState(null);
  // A row is only draggable while its handle is held, so the inputs in it
  // still take ordinary clicks and text selection.
  const [armedId, setArmedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = propertyId ? `?propertyId=${propertyId}` : "";
      const [roomsRes, typesRes] = await Promise.all([
        fetch(`/api/pms/rooms${qs}`),
        fetch(`/api/setup/roomTypes${qs}`),
      ]);
      const [roomData, typeData] = await Promise.all([
        roomsRes.json(),
        typesRes.json(),
      ]);
      if (!roomsRes.ok) throw new Error(roomData.error || "Could not load rooms");
      setRooms(roomData.rooms || []);
      setRoomTypes(typeData.roomTypes || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  const floors = useMemo(
    () =>
      [...new Set(rooms.map((r) => r.floor).filter(Boolean))].sort(naturalCompare),
    [rooms]
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rooms.filter(
      (r) =>
        (!typeFilter || r.room_type_id === typeFilter) &&
        (!floorFilter || (r.floor || "") === floorFilter) &&
        (!term || r.room_number.toLowerCase().includes(term))
    );
  }, [rooms, typeFilter, floorFilter, search]);

  const typeName = useMemo(() => {
    const map = {};
    for (const rt of roomTypes) map[rt.id] = rt.room_type_name;
    return map;
  }, [roomTypes]);

  /** Rooms per type against the count the room type declares. */
  const counts = useMemo(() => {
    const byType = {};
    for (const r of rooms) {
      if (r.is_active) byType[r.room_type_id] = (byType[r.room_type_id] || 0) + 1;
    }
    return byType;
  }, [rooms]);

  function flash(message) {
    setNotice(message);
    setError(null);
  }

  async function patch(body) {
    const res = await fetch("/api/pms/rooms", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property_id: propertyId, ...body }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not save the room");
    return data;
  }

  /** Save one field, only if it actually changed. */
  async function saveField(room, field, value) {
    if ((room[field] ?? "") === (value ?? "")) return;
    setError(null);
    setNotice(null);
    // Show the change at once; put it back if the save is refused.
    setRooms((prev) => prev.map((r) => (r.id === room.id ? { ...r, [field]: value } : r)));
    try {
      const data = await patch({ id: room.id, [field]: value });
      setRooms((prev) => prev.map((r) => (r.id === room.id ? data.room : r)));
    } catch (err) {
      setRooms((prev) => prev.map((r) => (r.id === room.id ? room : r)));
      setError(err.message);
    }
  }

  async function saveOrder(next) {
    const previous = rooms;
    setRooms(next);
    setError(null);
    try {
      const data = await patch({ order: next.map((r) => r.id) });
      setRooms(data.rooms || next);
    } catch (err) {
      setRooms(previous);
      setError(err.message);
    }
  }

  /**
   * Put `room` just before or after `target` in the full list.
   *
   * Works against the full list even while a filter is on, so moving 204 past
   * 205 on a filtered view does not scramble rooms the filter hides.
   */
  function placeRelative(room, target, after) {
    if (!target || room.id === target.id) return;
    const rest = rooms.filter((r) => r.id !== room.id);
    const at = rest.findIndex((r) => r.id === target.id) + (after ? 1 : 0);
    saveOrder([...rest.slice(0, at), room, ...rest.slice(at)]);
  }

  function move(room, dir) {
    const i = visible.findIndex((r) => r.id === room.id);
    placeRelative(room, visible[i + dir], dir > 0);
  }

  function autoSort() {
    if (
      !window.confirm(
        "Re-order every room by floor, then room number? Any order you have set by hand is replaced."
      )
    ) {
      return;
    }
    const next = [...rooms].sort(
      (a, b) =>
        naturalCompare(a.floor || "", b.floor || "") ||
        naturalCompare(a.room_number, b.room_number)
    );
    saveOrder(next);
    flash("Rooms sorted by floor and number.");
  }

  async function addOne() {
    setError(null);
    setNotice(null);
    const room_type_id = newRoom.room_type_id || typeFilter;
    if (!newRoom.room_number.trim()) {
      setError("Give the room a number.");
      return;
    }
    if (!room_type_id) {
      setError("Choose which room type this room belongs to.");
      return;
    }
    try {
      const res = await fetch("/api/pms/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_id: propertyId,
          room_type_id,
          room_number: newRoom.room_number,
          floor: newRoom.floor,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not add the room");
      setRooms((prev) => [...prev, data.room]);
      // Keep floor and type: the next room added is usually its neighbour.
      setNewRoom((r) => ({ ...r, room_number: "" }));
      flash(`Added room ${data.room.room_number}.`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function addRange() {
    setError(null);
    setNotice(null);
    if (!range.room_type_id) {
      setError("Choose which room type these rooms belong to.");
      return;
    }
    try {
      const res = await fetch("/api/pms/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_id: propertyId,
          room_type_id: range.room_type_id,
          range: {
            from: range.from,
            to: range.to,
            prefix: range.prefix,
            floor: range.floor,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not add the rooms");

      flash(
        data.created === 0
          ? "Those room numbers already exist — nothing to add."
          : `Added ${data.created} room${data.created === 1 ? "" : "s"}.`
      );
      setRange((r) => ({ ...r, from: "", to: "" }));
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeRoom(room) {
    if (
      !window.confirm(
        `Delete room ${room.room_number}? Bookings assigned to it become unassigned. To take it out of sale for a while, untick Sellable instead.`
      )
    ) {
      return;
    }
    setError(null);
    try {
      const qs = propertyId ? `&propertyId=${propertyId}` : "";
      const res = await fetch(`/api/pms/rooms?id=${room.id}${qs}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not remove the room");
      setRooms((prev) => prev.filter((r) => r.id !== room.id));
    } catch (err) {
      setError(err.message);
    }
  }

  const cellInput = { padding: "0.3rem 0.5rem", fontSize: "0.85rem" };

  return (
    <div className="space-y-4">
      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
      {notice && (
        <p className="text-sm" style={{ color: "var(--accent-text)" }}>
          {notice}
        </p>
      )}

      {/* How many doors each type has against the count it is sold with. A
          mismatch means the channels are selling rooms that do not exist,
          or leaving real ones unsold. */}
      {roomTypes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {roomTypes.map((rt) => {
            const have = counts[rt.id] || 0;
            const declared = Number(rt.number_of_rooms) || 0;
            const ok = !declared || have === declared;
            return (
              <span
                key={rt.id}
                className={`chip ${ok ? "chip-ok" : "chip-warn"}`}
                title={
                  ok
                    ? undefined
                    : `Room Setup says ${declared}; ${have} sellable room${have === 1 ? " is" : "s are"} numbered here.`
                }
              >
                {rt.room_type_name}: {have}
                {declared ? ` / ${declared}` : ""}
              </span>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Room type</label>
          <select
            className="input"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">All types</option>
            {roomTypes.map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.room_type_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Floor</label>
          <select
            className="input"
            value={floorFilter}
            onChange={(e) => setFloorFilter(e.target.value)}
          >
            <option value="">All floors</option>
            {floors.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Room no.</label>
          <input
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
          />
        </div>
        <div className="flex-1" />
        <button
          className="btn btn-ghost text-sm"
          onClick={autoSort}
          disabled={rooms.length < 2}
        >
          Sort by floor &amp; number
        </button>
        <button className="btn btn-ghost text-sm" onClick={() => setShowRange((v) => !v)}>
          {showRange ? "Hide range" : "Add a range"}
        </button>
      </div>

      {showRange && (
        <div className="card card-pad">
          <p className="sub mb-3">
            Numbers a run of rooms at once — 101 to 120 on floor 1, say. Numbers
            that already exist are skipped.
          </p>
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}
          >
            <div>
              <label className="label">Room type</label>
              <select
                className="input"
                value={range.room_type_id}
                onChange={(e) => setRange({ ...range, room_type_id: e.target.value })}
              >
                <option value="">Choose…</option>
                {roomTypes.map((rt) => (
                  <option key={rt.id} value={rt.id}>
                    {rt.room_type_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Floor</label>
              <input
                className="input"
                value={range.floor}
                onChange={(e) => setRange({ ...range, floor: e.target.value })}
                placeholder="optional"
              />
            </div>
            <div>
              <label className="label">Prefix</label>
              <input
                className="input"
                value={range.prefix}
                onChange={(e) => setRange({ ...range, prefix: e.target.value })}
                placeholder="optional"
              />
            </div>
            <div>
              <label className="label">From</label>
              <input
                className="input"
                type="number"
                value={range.from}
                onChange={(e) => setRange({ ...range, from: e.target.value })}
                placeholder="101"
              />
            </div>
            <div>
              <label className="label">To</label>
              <input
                className="input"
                type="number"
                value={range.to}
                onChange={(e) => setRange({ ...range, to: e.target.value })}
                placeholder="120"
              />
            </div>
            <div className="flex items-end">
              <button className="btn btn-primary text-sm w-full" onClick={addRange}>
                Add rooms
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto card">
        <table className="grid-table min-w-full">
          <thead>
            <tr>
              <th style={{ width: 90 }}>Order</th>
              <th style={{ width: 110 }}>Floor</th>
              <th style={{ width: 130 }}>Room no.</th>
              <th>Room type</th>
              <th style={{ width: 90 }}>Sellable</th>
              <th>Notes</th>
              <th style={{ width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="sub">
                  Loading…
                </td>
              </tr>
            )}

            {!loading && rooms.length === 0 && (
              <tr>
                <td colSpan={7} className="sub">
                  No rooms yet. Until they are added, availability falls back to
                  the room count on each room type.
                </td>
              </tr>
            )}

            {!loading && rooms.length > 0 && visible.length === 0 && (
              <tr>
                <td colSpan={7} className="sub">
                  No rooms match the filters.
                </td>
              </tr>
            )}

            {visible.map((room, i) => (
              <tr
                key={room.id}
                draggable={armedId === room.id}
                onDragStart={() => setDragId(room.id)}
                onDragEnd={() => {
                  setDragId(null);
                  setArmedId(null);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const dragged = rooms.find((r) => r.id === dragId);
                  if (!dragged) return;
                  const from = visible.findIndex((r) => r.id === dragId);
                  // Dropped on a row below: land after it; above: before it.
                  placeRelative(dragged, room, from < i);
                  setDragId(null);
                }}
                style={{
                  opacity: dragId === room.id ? 0.4 : room.is_active ? 1 : 0.6,
                }}
              >
                <td>
                  <div className="flex items-center gap-1">
                    <span
                      title="Drag to reorder"
                      onMouseDown={() => setArmedId(room.id)}
                      onMouseUp={() => setArmedId(null)}
                      style={{ cursor: "grab", color: "var(--text-faint)" }}
                    >
                      ⋮⋮
                    </span>
                    <button
                      className="btn btn-ghost text-xs"
                      style={{ padding: "0.1rem 0.35rem" }}
                      onClick={() => move(room, -1)}
                      disabled={i === 0}
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      className="btn btn-ghost text-xs"
                      style={{ padding: "0.1rem 0.35rem" }}
                      onClick={() => move(room, 1)}
                      disabled={i === visible.length - 1}
                      title="Move down"
                    >
                      ↓
                    </button>
                  </div>
                </td>
                <td>
                  <input
                    className="input"
                    style={cellInput}
                    defaultValue={room.floor || ""}
                    key={`floor-${room.id}-${room.floor}`}
                    onBlur={(e) => saveField(room, "floor", e.target.value.trim() || null)}
                    placeholder="—"
                  />
                </td>
                <td>
                  <input
                    className="input"
                    style={{ ...cellInput, fontWeight: 600 }}
                    defaultValue={room.room_number}
                    key={`num-${room.id}-${room.room_number}`}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (!v) {
                        e.target.value = room.room_number;
                        return;
                      }
                      saveField(room, "room_number", v);
                    }}
                  />
                </td>
                <td>
                  <select
                    className="input"
                    style={cellInput}
                    value={room.room_type_id}
                    onChange={(e) => saveField(room, "room_type_id", e.target.value)}
                  >
                    {!typeName[room.room_type_id] && (
                      <option value={room.room_type_id}>Unknown type</option>
                    )}
                    {roomTypes.map((rt) => (
                      <option key={rt.id} value={rt.id}>
                        {rt.room_type_name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={room.is_active}
                    onChange={(e) => saveField(room, "is_active", e.target.checked)}
                    title="Unticked rooms stay on record but are never offered for sale"
                  />
                </td>
                <td>
                  <input
                    className="input"
                    style={cellInput}
                    defaultValue={room.notes || ""}
                    key={`notes-${room.id}-${room.notes}`}
                    onBlur={(e) => saveField(room, "notes", e.target.value.trim() || null)}
                    placeholder="Sea view, connecting to 205…"
                  />
                </td>
                <td>
                  <button
                    className="btn btn-ghost text-xs"
                    onClick={() => removeRoom(room)}
                    title="Delete room"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}

            {/* The add row sits where the next room would appear. */}
            <tr>
              <td className="sub" style={{ fontSize: "0.75rem" }}>
                New
              </td>
              <td>
                <input
                  className="input"
                  style={cellInput}
                  value={newRoom.floor}
                  onChange={(e) => setNewRoom({ ...newRoom, floor: e.target.value })}
                  placeholder="Floor"
                />
              </td>
              <td>
                <input
                  className="input"
                  style={cellInput}
                  value={newRoom.room_number}
                  onChange={(e) => setNewRoom({ ...newRoom, room_number: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && addOne()}
                  placeholder="Room no."
                />
              </td>
              <td>
                <select
                  className="input"
                  style={cellInput}
                  value={newRoom.room_type_id || typeFilter}
                  onChange={(e) => setNewRoom({ ...newRoom, room_type_id: e.target.value })}
                >
                  <option value="">Choose…</option>
                  {roomTypes.map((rt) => (
                    <option key={rt.id} value={rt.id}>
                      {rt.room_type_name}
                    </option>
                  ))}
                </select>
              </td>
              <td colSpan={3}>
                <button className="btn btn-primary text-sm" onClick={addOne}>
                  Add room
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="sub">
        {rooms.length} room{rooms.length === 1 ? "" : "s"}
        {visible.length !== rooms.length ? ` · ${visible.length} shown` : ""}. The
        order here is the order rooms appear on the calendar and the housekeeping
        board — drag a row, or use the arrows.
      </p>
    </div>
  );
}
