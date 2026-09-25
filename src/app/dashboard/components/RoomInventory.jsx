"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * The physical rooms inside each room type.
 *
 * Room types say what the property sells; this says which doors exist. The
 * PMS needs both -- a booking is taken against a type and a guest is checked
 * into a room -- and until now only the types were modelled.
 *
 * Numbering is offered as a range because a property with a few hundred rooms
 * cannot reasonably add them one at a time.
 */

const HOUSEKEEPING = [
  { id: "clean", label: "Clean" },
  { id: "dirty", label: "Dirty" },
  { id: "inspected", label: "Inspected" },
  { id: "out_of_order", label: "Out of order" },
];

const HOUSEKEEPING_CHIP = {
  clean: "chip-ok",
  inspected: "chip-ok",
  dirty: "chip-warn",
  out_of_order: "chip-off",
};

export default function RoomInventory({ session }) {
  const propertyId = session?.propertyId || null;

  const [rooms, setRooms] = useState([]);
  const [roomTypes, setRoomTypes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [range, setRange] = useState({
    room_type_id: "",
    prefix: "",
    from: "",
    to: "",
    floor: "",
  });

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

  /** Rooms grouped under the type they belong to, which is how they are read. */
  const grouped = useMemo(() => {
    const byType = {};
    for (const room of rooms) {
      (byType[room.room_type_id] = byType[room.room_type_id] || []).push(room);
    }
    return byType;
  }, [rooms]);

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

  async function setHousekeeping(room, housekeeping) {
    setError(null);
    try {
      const res = await fetch("/api/pms/rooms", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: room.id, housekeeping }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update the room");
      setRooms((prev) => prev.map((r) => (r.id === room.id ? data.room : r)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeRoom(room) {
    if (!window.confirm(`Remove room ${room.room_number}?`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/pms/rooms?id=${room.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not remove the room");
      setRooms((prev) => prev.filter((r) => r.id !== room.id));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card card-pad space-y-4">
      <div>
        <h3 style={{ fontWeight: 600 }}>Rooms</h3>
        <p className="sub">
          The actual rooms guests are checked into. A booking is taken against a
          room type; a room is what the guest is given.
        </p>
      </div>

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

      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}
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
        <div>
          <label className="label">Floor</label>
          <input
            className="input"
            value={range.floor}
            onChange={(e) => setRange({ ...range, floor: e.target.value })}
            placeholder="optional"
          />
        </div>
        <div className="flex items-end">
          <button className="btn btn-primary text-sm w-full" onClick={addRange}>
            Add rooms
          </button>
        </div>
      </div>

      {loading && <p className="sub">Loading…</p>}

      {!loading && rooms.length === 0 && (
        <p className="sub">
          No rooms yet. Until they are added, availability falls back to the
          room count on each room type.
        </p>
      )}

      {roomTypes.map((rt) => {
        const list = grouped[rt.id] || [];
        if (list.length === 0) return null;
        return (
          <div key={rt.id} className="space-y-2">
            <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
              {rt.room_type_name}{" "}
              <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>
                · {list.length} room{list.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {list.map((room) => (
                <div
                  key={room.id}
                  className="card"
                  style={{ padding: "0.5rem 0.65rem", minWidth: 128 }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span style={{ fontWeight: 600 }}>{room.room_number}</span>
                    <button
                      className="btn btn-ghost text-xs"
                      onClick={() => removeRoom(room)}
                      title="Remove room"
                    >
                      ×
                    </button>
                  </div>
                  <select
                    className="input mt-1"
                    style={{ fontSize: "0.7rem", padding: "0.2rem 0.3rem" }}
                    value={room.housekeeping}
                    onChange={(e) => setHousekeeping(room, e.target.value)}
                  >
                    {HOUSEKEEPING.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.label}
                      </option>
                    ))}
                  </select>
                  <span
                    className={`chip ${HOUSEKEEPING_CHIP[room.housekeeping] || "chip-off"} mt-1`}
                    style={{ fontSize: "0.6rem" }}
                  >
                    {HOUSEKEEPING.find((h) => h.id === room.housekeeping)?.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
