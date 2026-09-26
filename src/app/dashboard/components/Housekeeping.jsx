"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDateISO } from "@/lib/date";

/**
 * The housekeeping board: every room, whether it is clean, and whether
 * anyone is in it, leaving it or arriving to it today.
 *
 * The two axes are shown side by side on purpose. "Dirty" alone does not say
 * what to do; "vacant dirty with an arrival today" does, and it is the first
 * room to clean. The front-office shorthand -- VC, VD, OC, OD, OOO -- is
 * shown because it is what the desk and housekeeping already say to each
 * other.
 *
 * Checking a guest out marks their room dirty automatically, so the board is
 * right without anyone having to remember to tell housekeeping.
 */

const STATUSES = [
  { id: "dirty", label: "Dirty", chip: "chip-warn" },
  { id: "clean", label: "Clean", chip: "chip-ok" },
  { id: "inspected", label: "Inspected", chip: "chip-ok" },
  { id: "out_of_order", label: "Out of order", chip: "chip-off" },
];
const STATUS = Object.fromEntries(STATUSES.map((s) => [s.id, s]));

/** The code the desk uses, e.g. VD = vacant and dirty. */
function roomCode(room) {
  if (room.housekeeping === "out_of_order") return "OOO";
  const occupancy = room.occupied ? "O" : "V";
  const clean = room.housekeeping === "dirty" ? "D" : "C";
  return occupancy + clean;
}

function occupancyLabel(room) {
  if (room.occupied && room.departing) return "Due out";
  if (room.occupied) return "Occupied";
  if (room.departing?.status === "checked_out") return "Departed";
  return "Vacant";
}

/**
 * How urgently a room needs housekeeping. A dirty room with a guest on the
 * way is first; an out-of-order room is last because nobody can use it.
 */
function priority(room) {
  if (room.housekeeping === "out_of_order") return 9;
  const dirty = room.housekeeping === "dirty";
  if (dirty && room.arriving && !room.occupied) return 0;
  if (dirty && !room.occupied) return 1;
  if (room.housekeeping === "clean" && room.arriving) return 2; // to inspect
  if (dirty) return 3; // stay-over service
  return 5;
}

function timeAgo(iso) {
  if (!iso) return "—";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
}

const VIEWS = [
  { id: "all", label: "All rooms" },
  { id: "todo", label: "To clean" },
  { id: "arrivals", label: "Arrivals" },
  { id: "departures", label: "Departures" },
  { id: "occupied", label: "Occupied" },
  { id: "ooo", label: "Out of order" },
];

export default function Housekeeping({ session }) {
  const propertyId = session?.propertyId || null;

  const [date, setDate] = useState(() => formatDateISO(new Date()));
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [view, setView] = useState("all");
  const [floorFilter, setFloorFilter] = useState("");
  const [byPriority, setByPriority] = useState(false);
  const [selected, setSelected] = useState(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ date });
      if (propertyId) qs.set("propertyId", propertyId);
      const res = await fetch(`/api/pms/housekeeping?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load housekeeping");
      setRooms(data.rooms || []);
      setSelected(new Set());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [propertyId, date]);

  useEffect(() => {
    load();
  }, [load]);

  const floors = useMemo(
    () =>
      [...new Set(rooms.map((r) => r.floor).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true })
      ),
    [rooms]
  );

  const summary = useMemo(() => {
    const s = { VC: 0, VD: 0, OC: 0, OD: 0, OOO: 0, arrivals: 0, departures: 0 };
    for (const r of rooms) {
      s[roomCode(r)] += 1;
      if (r.arriving) s.arrivals += 1;
      if (r.departing) s.departures += 1;
    }
    return s;
  }, [rooms]);

  const visible = useMemo(() => {
    const list = rooms.filter((r) => {
      if (floorFilter && (r.floor || "") !== floorFilter) return false;
      switch (view) {
        case "todo":
          return r.housekeeping === "dirty";
        case "arrivals":
          return !!r.arriving;
        case "departures":
          return !!r.departing;
        case "occupied":
          return !!r.occupied;
        case "ooo":
          return r.housekeeping === "out_of_order";
        default:
          return true;
      }
    });
    // Array.prototype.sort is stable, so equal priorities keep room order.
    return byPriority ? [...list].sort((a, b) => priority(a) - priority(b)) : list;
  }, [rooms, view, floorFilter, byPriority]);

  async function mark(ids, status) {
    if (ids.length === 0) return;
    setError(null);
    const previous = rooms;
    setRooms((prev) =>
      prev.map((r) => (ids.includes(r.id) ? { ...r, housekeeping: status } : r))
    );
    try {
      const res = await fetch("/api/pms/housekeeping", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_id: propertyId, ids, status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update housekeeping");
      // The response carries the rooms only; keep the stay details the board
      // already has for them.
      const byId = Object.fromEntries((data.rooms || []).map((r) => [r.id, r]));
      setRooms((prev) => prev.map((r) => (byId[r.id] ? { ...r, ...byId[r.id] } : r)));
      setSelected(new Set());
    } catch (err) {
      setRooms(previous);
      setError(err.message);
    }
  }

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allVisibleSelected =
    visible.length > 0 && visible.every((r) => selected.has(r.id));

  function toggleAll() {
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((r) => r.id)));
  }

  const today = formatDateISO(new Date());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="h1">Housekeeping</h2>
          <p className="sub">
            Room status for the day, next to who is in, leaving or arriving.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <input
            type="date"
            className="input"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
          {date !== today && (
            <button className="btn btn-ghost text-sm" onClick={() => setDate(today)}>
              Today
            </button>
          )}
          <button className="btn btn-ghost text-sm" onClick={load}>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}
      >
        {[
          ["VC", "Vacant clean"],
          ["VD", "Vacant dirty"],
          ["OC", "Occupied clean"],
          ["OD", "Occupied dirty"],
          ["OOO", "Out of order"],
          ["arrivals", "Arrivals"],
          ["departures", "Departures"],
        ].map(([key, label]) => (
          <div key={key} className="card card-pad">
            <div className="sub" style={{ fontSize: "0.7rem" }}>
              {label}
            </div>
            <div style={{ fontSize: "1.4rem", fontWeight: 600 }}>{summary[key]}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={`btn text-sm ${view === v.id ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
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
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={byPriority}
            onChange={(e) => setByPriority(e.target.checked)}
          />
          Priority first
        </label>
      </div>

      {selected.size > 0 && (
        <div className="card card-pad flex flex-wrap items-center gap-2">
          <span className="text-sm" style={{ fontWeight: 600 }}>
            {selected.size} selected — mark as
          </span>
          {STATUSES.map((s) => (
            <button
              key={s.id}
              className="btn btn-ghost text-sm"
              onClick={() => mark([...selected], s.id)}
            >
              {s.label}
            </button>
          ))}
          <button className="btn btn-ghost text-sm" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      <div className="overflow-x-auto card" style={{ padding: 0 }}>
        <table className="cm-grid">
          <thead>
            <tr>
              <th style={{ width: 40 }}>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAll}
                  title="Select all shown"
                />
              </th>
              <th>Floor</th>
              <th>Room</th>
              <th>Type</th>
              <th>Code</th>
              <th>Occupancy</th>
              <th>Guest</th>
              <th>Status</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9} className="sub">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && rooms.length === 0 && (
              <tr>
                <td colSpan={9} className="sub">
                  No rooms yet — add them under Setup → Room Number Setup.
                </td>
              </tr>
            )}
            {!loading && rooms.length > 0 && visible.length === 0 && (
              <tr>
                <td colSpan={9} className="sub">
                  Nothing here for this view.
                </td>
              </tr>
            )}
            {!loading &&
              visible.map((room) => {
                const guest = room.occupied || room.arriving || room.departing;
                return (
                  <tr key={room.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(room.id)}
                        onChange={() => toggle(room.id)}
                      />
                    </td>
                    <td>{room.floor || "—"}</td>
                    <td style={{ fontWeight: 600 }}>{room.room_number}</td>
                    <td>{room.room_types?.room_type_name || "—"}</td>
                    <td>
                      <span className={`chip ${STATUS[room.housekeeping]?.chip || "chip-off"}`}>
                        {roomCode(room)}
                      </span>
                    </td>
                    <td>
                      {occupancyLabel(room)}
                      {room.arriving && (
                        <span className="chip chip-warn" style={{ marginLeft: 6 }}>
                          Arrival
                        </span>
                      )}
                    </td>
                    <td className="text-sm">
                      {guest ? (
                        <>
                          {guest.guest_name}
                          <span style={{ color: "var(--text-faint)" }}>
                            {" "}
                            · {guest.adults}A
                            {guest.children ? ` ${guest.children}C` : ""}
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <select
                        className="input"
                        style={{ padding: "0.25rem 0.4rem", fontSize: "0.8rem" }}
                        value={room.housekeeping}
                        onChange={(e) => mark([room.id], e.target.value)}
                      >
                        {STATUSES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="sub" style={{ fontSize: "0.75rem" }}>
                      {timeAgo(room.housekeeping_updated_at)}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
