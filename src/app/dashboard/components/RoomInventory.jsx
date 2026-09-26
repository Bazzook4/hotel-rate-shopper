"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Grid,
  Messages,
  SaveActions,
  SetupHeader,
  Toolbar,
  isDraft,
  sendJSON,
  useGrid,
} from "./SetupGrid";

/**
 * Room Number Setup: the physical rooms, one row each.
 *
 * Room types say what the property sells; this says which doors exist, on
 * which floor, and in what order. The order is the hotel's own -- the way the
 * desk walks the building -- and it is what the calendar, the room pickers
 * and the housekeeping board all follow.
 *
 * Edited like the Channel Manager grid: changes, new rows and a new order are
 * held and highlighted until "Save", which sends them together.
 *
 * Housekeeping status is deliberately absent. Whether a room is clean is
 * front-office work that changes hourly; this page is setup that changes when
 * the building does. It lives under Front Office → Housekeeping.
 */

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [typeFilter, setTypeFilter] = useState("");
  const [floorFilter, setFloorFilter] = useState("");
  const [search, setSearch] = useState("");

  const [showRange, setShowRange] = useState(false);
  const [range, setRange] = useState(EMPTY_RANGE);

  // A re-order not yet saved: the full list of stored room ids, top to bottom.
  const [order, setOrder] = useState(null);
  const [dragId, setDragId] = useState(null);
  // A row is only draggable while its handle is held, so the inputs in it
  // still take ordinary clicks and text selection.
  const [armedId, setArmedId] = useState(null);

  const grid = useGrid(rooms, order ? 1 : 0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = propertyId ? `?propertyId=${propertyId}` : "";
      const [roomsRes, typesRes] = await Promise.all([
        fetch(`/api/pms/rooms${qs}`),
        fetch(`/api/setup/roomTypes${qs}`),
      ]);
      const [roomData, typeData] = await Promise.all([roomsRes.json(), typesRes.json()]);
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

  /** Stored rooms in the pending order if there is one, then new rows. */
  const ordered = useMemo(() => {
    if (!order) return rooms;
    const byId = Object.fromEntries(rooms.map((r) => [r.id, r]));
    return order.map((id) => byId[id]).filter(Boolean);
  }, [rooms, order]);

  const floors = useMemo(
    () =>
      [...new Set(rooms.map((r) => grid.value(r, "floor")).filter(Boolean))].sort(
        naturalCompare
      ),
    [rooms, grid]
  );

  const term = search.trim().toLowerCase();
  const visible = ordered.filter(
    (r) =>
      (!typeFilter || grid.value(r, "room_type_id") === typeFilter) &&
      (!floorFilter || (grid.value(r, "floor") || "") === floorFilter) &&
      (!term || String(grid.value(r, "room_number")).toLowerCase().includes(term))
  );
  const rows = [...visible, ...grid.drafts];

  /** Sellable rooms per type against the count the room type declares. */
  const counts = {};
  for (const r of [...rooms, ...grid.drafts]) {
    const m = grid.merged(r);
    if (m.is_active !== false && m.room_type_id) {
      counts[m.room_type_id] = (counts[m.room_type_id] || 0) + 1;
    }
  }

  const typeOptions = roomTypes.map((rt) => ({ id: rt.id, label: rt.room_type_name }));

  /**
   * Put `room` just before or after `target` in the full list.
   *
   * Works against the full list even while a filter is on, so moving 204 past
   * 205 on a filtered view does not scramble rooms the filter hides.
   */
  function placeRelative(room, target, after) {
    if (!target || room.id === target.id) return;
    const rest = ordered.filter((r) => r.id !== room.id);
    const at = rest.findIndex((r) => r.id === target.id) + (after ? 1 : 0);
    setOrder([...rest.slice(0, at), room, ...rest.slice(at)].map((r) => r.id));
  }

  function move(room, dir) {
    const i = visible.findIndex((r) => r.id === room.id);
    placeRelative(room, visible[i + dir], dir > 0);
  }

  function autoSort() {
    const next = [...rooms].sort(
      (a, b) =>
        naturalCompare(grid.value(a, "floor") || "", grid.value(b, "floor") || "") ||
        naturalCompare(grid.value(a, "room_number"), grid.value(b, "room_number"))
    );
    setOrder(next.map((r) => r.id));
    setNotice("Sorted by floor and number — Save to keep this order.");
  }

  function addRow() {
    grid.add({
      floor: floorFilter || "",
      room_number: "",
      room_type_id: typeFilter || roomTypes[0]?.id || "",
      is_active: true,
      notes: "",
    });
  }

  async function saveAll() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const saved = grid.count;
    const errors = [];

    if (order) {
      try {
        await sendJSON("/api/pms/rooms", "PATCH", { property_id: propertyId, order });
        setOrder(null);
      } catch (err) {
        errors.push(`Order: ${err.message}`);
      }
    }

    errors.push(
      ...(await grid.save({
        label: (r) => (r.room_number ? `Room ${r.room_number}` : "New room"),
        update: (room, changes) =>
          sendJSON("/api/pms/rooms", "PATCH", {
            property_id: propertyId,
            id: room.id,
            ...changes,
          }),
        create: (d) => {
          if (!String(d.room_number).trim()) throw new Error("Give the room a number");
          if (!d.room_type_id) throw new Error("Choose a room type");
          return sendJSON("/api/pms/rooms", "POST", {
            property_id: propertyId,
            room_type_id: d.room_type_id,
            room_number: d.room_number,
            floor: d.floor,
            notes: d.notes,
          });
        },
      }))
    );

    await load();
    setBusy(false);
    if (errors.length) setError(errors.join(" · "));
    else setNotice(`Saved ${saved} change${saved === 1 ? "" : "s"}.`);
  }

  function discard() {
    grid.discard();
    setOrder(null);
    setNotice(null);
  }

  async function addRange() {
    setError(null);
    setNotice(null);
    if (!range.room_type_id) {
      setError("Choose which room type these rooms belong to.");
      return;
    }
    try {
      const data = await sendJSON("/api/pms/rooms", "POST", {
        property_id: propertyId,
        room_type_id: range.room_type_id,
        range: { from: range.from, to: range.to, prefix: range.prefix, floor: range.floor },
      });
      setNotice(
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
    if (isDraft(room.id)) {
      grid.removeDraft(room.id);
      return;
    }
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
      await sendJSON(`/api/pms/rooms?id=${room.id}${qs}`, "DELETE");
      setRooms((prev) => prev.filter((r) => r.id !== room.id));
      setOrder((o) => (o ? o.filter((id) => id !== room.id) : o));
    } catch (err) {
      setError(err.message);
    }
  }

  const filtered = Boolean(typeFilter || floorFilter || term);

  return (
    <div className="space-y-4">
      <SetupHeader
        title="Room Number Setup"
        count={rooms.length}
        sub="Every room the property owns — its floor, number and type — in the order the calendar and room lists show them."
      >
        <SaveActions count={grid.count} busy={busy} onSave={saveAll} onDiscard={discard} />
      </SetupHeader>

      <Messages error={error} notice={notice} />

      {/* How many doors each type has against the count it is sold with. A
          mismatch means the channels are selling rooms that do not exist,
          or leaving real ones unsold. */}
      {roomTypes.length > 0 && rooms.length > 0 && (
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

      <Toolbar>
        <button type="button" className="btn btn-secondary text-sm" onClick={addRow}>
          + Add room
        </button>
        <button
          type="button"
          className="btn btn-secondary text-sm"
          onClick={() => setShowRange((v) => !v)}
        >
          {showRange ? "Hide range" : "+ Add a range"}
        </button>
        <button
          type="button"
          className="btn btn-secondary text-sm"
          onClick={autoSort}
          disabled={rooms.length < 2}
        >
          Sort by floor &amp; number
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            className="input"
            style={{ width: "auto" }}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">All room types</option>
            {roomTypes.map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.room_type_name}
              </option>
            ))}
          </select>
          <select
            className="input"
            style={{ width: "auto" }}
            value={floorFilter}
            onChange={(e) => setFloorFilter(e.target.value)}
          >
            <option value="">All floors</option>
            {floors.map((f) => (
              <option key={f} value={f}>
                Floor {f}
              </option>
            ))}
          </select>
          <input
            className="input w-40"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Room no…"
          />
        </div>
      </Toolbar>

      {showRange && (
        <div className="card card-pad">
          <p className="sub mb-3">
            Numbers a run of rooms at once — 101 to 120 on floor 1, say. Numbers
            that already exist are skipped. Added straight away.
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
            {[
              ["floor", "Floor", "optional", "text"],
              ["prefix", "Prefix", "optional", "text"],
              ["from", "From", "101", "number"],
              ["to", "To", "120", "number"],
            ].map(([key, label, placeholder, type]) => (
              <div key={key}>
                <label className="label">{label}</label>
                <input
                  className="input"
                  type={type}
                  value={range[key]}
                  onChange={(e) => setRange({ ...range, [key]: e.target.value })}
                  placeholder={placeholder}
                />
              </div>
            ))}
            <div className="flex items-end">
              <button className="btn btn-primary text-sm w-full" onClick={addRange}>
                Add rooms
              </button>
            </div>
          </div>
        </div>
      )}

      <Grid>
        <thead>
          <tr>
            <th style={{ width: 96 }} title={filtered ? "Arrows move past the rooms shown" : undefined}>
              Order
            </th>
            <th style={{ width: 110 }}>Floor</th>
            <th className="cm-sticky" style={{ width: 140 }}>
              Room no.
            </th>
            <th style={{ minWidth: 180 }}>Room type</th>
            <th style={{ width: 90 }} title="Unticked rooms stay on record but are never sold">
              Sellable
            </th>
            <th style={{ minWidth: 220 }}>Notes</th>
            <th style={{ width: 50 }} />
          </tr>
        </thead>
        <tbody>
          {loading && rooms.length === 0 && (
            <tr>
              <td colSpan={7} className="cm-empty">
                Loading…
              </td>
            </tr>
          )}

          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={7} className="cm-empty">
                {rooms.length
                  ? "No rooms match the filters."
                  : "No rooms yet. Until they are added, availability falls back to the room count on each room type."}
              </td>
            </tr>
          )}

          {rows.map((room) => {
            const draft = isDraft(room.id);
            const i = visible.findIndex((r) => r.id === room.id);
            const sellable = grid.value(room, "is_active") !== false;
            return (
              <tr
                key={room.id}
                className={draft ? "cm-new" : sellable ? undefined : "cm-muted"}
                draggable={!draft && armedId === room.id}
                onDragStart={() => setDragId(room.id)}
                onDragEnd={() => {
                  setDragId(null);
                  setArmedId(null);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const dragged = rooms.find((r) => r.id === dragId);
                  if (!dragged || draft) return;
                  const from = visible.findIndex((r) => r.id === dragId);
                  // Dropped on a row below: land after it; above: before it.
                  placeRelative(dragged, room, from < i);
                  setDragId(null);
                }}
                style={dragId === room.id ? { opacity: 0.4 } : undefined}
              >
                <td>
                  {draft ? (
                    <span className="chip chip-warn">New</span>
                  ) : (
                    <div className="flex items-center gap-1">
                      <span
                        title="Drag to reorder"
                        onMouseDown={() => setArmedId(room.id)}
                        onMouseUp={() => setArmedId(null)}
                        style={{ cursor: "grab", color: "var(--text-faint)", padding: "0 2px" }}
                      >
                        ⋮⋮
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost text-xs"
                        style={{ padding: "0.1rem 0.35rem" }}
                        onClick={() => move(room, -1)}
                        disabled={i <= 0}
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost text-xs"
                        style={{ padding: "0.1rem 0.35rem" }}
                        onClick={() => move(room, 1)}
                        disabled={i === visible.length - 1}
                        title="Move down"
                      >
                        ↓
                      </button>
                    </div>
                  )}
                </td>
                <td>{grid.input(room, "floor", { placeholder: "—" })}</td>
                <td className="cm-sticky">
                  {grid.input(room, "room_number", {
                    placeholder: "Room no.",
                    invalid: !String(grid.value(room, "room_number") ?? "").trim(),
                    autoFocus: draft,
                    style: { fontWeight: 600 },
                  })}
                </td>
                <td>
                  {grid.select(
                    room,
                    "room_type_id",
                    draft ? [{ id: "", label: "Choose…" }, ...typeOptions] : typeOptions
                  )}
                </td>
                <td className="text-center">{grid.check(room, "is_active")}</td>
                <td>{grid.input(room, "notes", { placeholder: "Sea view, connects to 205…" })}</td>
                <td className="text-center">
                  <button
                    type="button"
                    className="btn btn-ghost text-xs"
                    onClick={() => removeRoom(room)}
                    title={draft ? "Remove this new row" : "Delete room"}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Grid>

      <p className="sub">
        {rooms.length} room{rooms.length === 1 ? "" : "s"}
        {filtered ? ` · ${visible.length} shown` : ""}. The order here is the order
        rooms appear on the calendar and the housekeeping board — drag a row by
        its handle, or use the arrows.
      </p>
    </div>
  );
}
