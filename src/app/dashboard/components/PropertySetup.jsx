"use client";

import { useCallback, useEffect, useState } from "react";
import RatePlanSetup from "./RatePlanSetup";
import {
  Grid,
  Loading,
  Messages,
  SaveActions,
  SetupHeader,
  Toolbar,
  isDraft,
  sendJSON,
  useGrid,
} from "./SetupGrid";

/**
 * Room types and rate plans for one property.
 *
 * `only` picks which panel to render -- "rooms" or "plans" -- because the two
 * are separate pages in the navigation. The property comes from the session
 * the dashboard passes down, which follows the switcher in the header, so
 * there is no picker here.
 */
export default function PropertySetup({ session, only = "rooms" }) {
  const propertyId = session?.propertyId || "";

  const [roomTypes, setRoomTypes] = useState([]);
  const [ratePlans, setRatePlans] = useState([]);
  const [loading, setLoading] = useState(true);
  // Set once the first load lands. Every save reloads the page's data, and
  // only the very first load should blank it -- after that the tables stay up
  // so a saved row does not look like the whole page reloading.
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [assignments, setAssignments] = useState([]);


  const load = useCallback(async () => {
    // Nothing to load until the dashboard has settled on a property.
    if (!propertyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : "";
    try {
      const [r, p, a] = await Promise.all([
        fetch(`/api/setup/roomTypes${qs}`),
        fetch(`/api/setup/ratePlans${qs}`),
        // Assignments are additive: an older property with none still loads,
        // so a failure here must not block the page.
        fetch(`/api/setup/ratePlanRooms${qs}`).catch(() => null),
      ]);
      if (r.status === 403 || p.status === 403) {
        throw new Error(
          "You do not have permission to manage property setup. Ask an administrator to grant it."
        );
      }
      const rj = await r.json();
      const pj = await p.json();
      if (!r.ok) throw new Error(rj?.error || "Could not load room types");
      if (!p.ok) throw new Error(pj?.error || "Could not load rate plans");
      setRoomTypes(rj.roomTypes || []);
      setRatePlans(pj.ratePlans || []);

      const aj = a && a.ok ? await a.json().catch(() => null) : null;
      setAssignments(aj?.assignments || []);
      setLoaded(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  async function send(url, method, payload) {
    setNotice("");
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: payload ? JSON.stringify(payload) : undefined,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
      await load();
      return json;
    } catch (err) {
      setNotice(err.message);
      return null;
    }
  }

  async function removeRoom(id, name) {
    if (!window.confirm(`Delete room type "${name}"? This cannot be undone.`)) return;
    await send(`/api/setup/roomTypes?id=${encodeURIComponent(id)}`, "DELETE");
  }

  if (loading && !loaded) return <Loading label="Loading property setup…" />;

  if (error) {
    return (
      <div className="rounded-xl border border-[var(--warn)] bg-[var(--warn-soft)] p-4">
        <p className="text-sm text-[var(--warn)]">{error}</p>
        <button type="button" onClick={load} className="mt-3 btn btn-secondary text-xs">
          Retry
        </button>
      </div>
    );
  }

  return only === "rooms" ? (
    <RoomTypesPanel
      propertyId={propertyId}
      roomTypes={roomTypes}
      onReload={load}
      onDelete={removeRoom}
      notice={notice}
    />
  ) : (
    <RatePlanSetup
      propertyId={propertyId}
      ratePlans={ratePlans}
      roomTypes={roomTypes}
      assignments={assignments}
      onReload={load}
    />
  );
}

const BLANK_ROOM_TYPE = {
  room_type_name: "",
  description: "",
  number_of_rooms: "",
  base_price: "",
  base_adults: "2",
  max_adults: "",
};

/**
 * Room types as a grid: one row per type, every field edited in place, all
 * saved together.
 */
function RoomTypesPanel({ propertyId, roomTypes, onReload, onDelete, notice: outerNotice }) {
  const grid = useGrid(roomTypes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("");

  const rows = [...roomTypes, ...grid.drafts].filter(
    (r) =>
      isDraft(r.id) ||
      !filter ||
      r.room_type_name?.toLowerCase().includes(filter.toLowerCase())
  );

  const numberFields = ["number_of_rooms", "base_price", "base_adults", "max_adults"];
  function clean(row) {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      if (k === "id") continue;
      out[k] = numberFields.includes(k) ? (v === "" || v === null ? null : Number(v)) : v;
    }
    return out;
  }

  async function saveAll() {
    setBusy(true);
    setError("");
    setNotice("");
    const saved = grid.count;
    const errors = await grid.save({
      label: (r) => r.room_type_name || "New room type",
      update: (row, changes, next) => {
        if (!next.room_type_name?.trim()) throw new Error("Name is required");
        return sendJSON("/api/setup/roomTypes", "PATCH", { id: row.id, ...clean(changes) });
      },
      create: (d) => {
        if (!d.room_type_name?.trim()) throw new Error("Name is required");
        return sendJSON("/api/setup/roomTypes", "POST", {
          ...clean(d),
          base_price: Number(d.base_price) || 0,
          number_of_rooms: Number(d.number_of_rooms) || 0,
          property_id: propertyId || undefined,
        });
      },
    });
    await onReload();
    setBusy(false);
    if (errors.length) setError(errors.join(" · "));
    else setNotice(`Saved ${saved} change${saved === 1 ? "" : "s"}.`);
  }

  return (
    <div className="space-y-4">
      <SetupHeader
        title="Room Setup"
        count={roomTypes.length}
        sub="The rooms you sell, how many of each, and what they cost as a base."
      >
        <SaveActions count={grid.count} busy={busy} onSave={saveAll} onDiscard={grid.discard} />
      </SetupHeader>

      <Messages error={error} notice={notice || outerNotice} />

      <Toolbar>
        <button
          type="button"
          className="btn btn-secondary text-sm"
          onClick={() => grid.add(BLANK_ROOM_TYPE)}
        >
          + Add room type
        </button>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter room types…"
          className="ml-auto input w-56"
        />
      </Toolbar>

      <Grid>
        <thead>
          <tr>
            <th className="cm-sticky" style={{ minWidth: 220 }}>
              Room type
            </th>
            <th style={{ minWidth: 220 }}>Description</th>
            <th style={{ width: 100 }}>Rooms</th>
            <th style={{ width: 120 }}>Base price</th>
            <th style={{ width: 100 }} title="Adults the room is priced for">
              Base adults
            </th>
            <th style={{ width: 100 }} title="Adults beyond base pay the extra person rate">
              Max adults
            </th>
            <th style={{ width: 50 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const draft = isDraft(r.id);
            const name = grid.value(r, "room_type_name");
            return (
              <tr key={r.id} className={draft ? "cm-new" : undefined}>
                <td className="cm-sticky">
                  {grid.input(r, "room_type_name", {
                    placeholder: "Deluxe Room",
                    invalid: !name?.trim(),
                    autoFocus: draft,
                  })}
                </td>
                <td>{grid.input(r, "description", { placeholder: "—" })}</td>
                <td>{grid.input(r, "number_of_rooms", { type: "number", min: 0 })}</td>
                <td>{grid.input(r, "base_price", { type: "number", min: 0 })}</td>
                <td>{grid.input(r, "base_adults", { type: "number", min: 1 })}</td>
                <td>{grid.input(r, "max_adults", { type: "number", min: 1 })}</td>
                <td className="text-center">
                  <button
                    type="button"
                    className="btn btn-ghost text-xs"
                    title={draft ? "Remove this new row" : "Delete room type"}
                    onClick={() =>
                      draft ? grid.removeDraft(r.id) : onDelete(r.id, r.room_type_name)
                    }
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="cm-empty">
                {roomTypes.length ? `No room types match “${filter}”.` : "No room types yet."}
              </td>
            </tr>
          )}
        </tbody>
      </Grid>
    </div>
  );
}
