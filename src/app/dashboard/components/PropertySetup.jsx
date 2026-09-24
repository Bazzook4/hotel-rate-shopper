"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DERIVE_METHODS,
  describeDerivation,
  resolveAllRates,
  eligibleMasters,
} from "@/lib/ratePlanPricing";

const METHOD_LABELS = {
  offset: "Add amount",
  multiplier: "Multiply by",
  percent: "Percent change",
};

function Field({ label, children }) {
  return (
    <label className="block text-[11px] text-slate-400">
      {label}
      {children}
    </label>
  );
}

const inputClass =
  "mt-1 w-full rounded-lg border border-white/10 bg-slate-900/60 px-2 py-1.5 text-sm text-white outline-none focus:border-white/30";

export default function PropertySetup({ session }) {
  const [roomTypes, setRoomTypes] = useState([]);
  const [ratePlans, setRatePlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("rooms");
  const [editingRoom, setEditingRoom] = useState(null);
  const [editingPlan, setEditingPlan] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [r, p] = await Promise.all([
        fetch("/api/setup/roomTypes"),
        fetch("/api/setup/ratePlans"),
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
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Base rates come from each plan's room type; masters price directly.
  const baseRates = useMemo(() => {
    const roomById = Object.fromEntries(roomTypes.map((r) => [r.id, r]));
    const out = {};
    for (const p of ratePlans) {
      const room = roomById[p.room_type_id];
      out[p.id] = room ? Number(room.base_price) : null;
    }
    return out;
  }, [ratePlans, roomTypes]);

  const resolved = useMemo(
    () => resolveAllRates(ratePlans, baseRates),
    [ratePlans, baseRates]
  );

  async function send(url, method, payload) {
    setBusy(true);
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
    } finally {
      setBusy(false);
    }
  }

  async function saveRoom(room) {
    const payload = {
      room_type_name: room.room_type_name,
      base_price: Number(room.base_price),
      number_of_rooms: Number(room.number_of_rooms),
      max_adults: room.max_adults ? Number(room.max_adults) : null,
      description: room.description || "",
    };
    const ok = room.id
      ? await send("/api/setup/roomTypes", "PATCH", { id: room.id, ...payload })
      : await send("/api/setup/roomTypes", "POST", payload);
    if (ok) {
      setEditingRoom(null);
      setNotice(room.id ? "Room type updated." : "Room type added.");
    }
  }

  async function savePlan(plan) {
    const linked = Boolean(plan.derive_from_id);
    const payload = {
      plan_name: plan.plan_name,
      description: plan.description || "",
      room_type_id: plan.room_type_id || null,
      is_master: !linked && Boolean(plan.is_master),
      derive_from_id: linked ? plan.derive_from_id : null,
      derive_method: linked ? plan.derive_method : null,
      derive_value: linked ? Number(plan.derive_value) : null,
    };
    const ok = plan.id
      ? await send("/api/setup/ratePlans", "PATCH", { id: plan.id, ...payload })
      : await send("/api/setup/ratePlans", "POST", payload);
    if (ok) {
      setEditingPlan(null);
      setNotice(plan.id ? "Rate plan updated." : "Rate plan added.");
    }
  }

  async function removeRoom(id, name) {
    if (!window.confirm(`Delete room type "${name}"? This cannot be undone.`)) return;
    await send(`/api/setup/roomTypes?id=${encodeURIComponent(id)}`, "DELETE");
  }

  async function removePlan(id, name) {
    const dependents = ratePlans.filter((p) => p.derive_from_id === id);
    const warning = dependents.length
      ? `\n\n${dependents.length} plan(s) derive from it and will become unlinked.`
      : "";
    if (!window.confirm(`Delete rate plan "${name}"?${warning}`)) return;
    await send(`/api/setup/ratePlans?id=${encodeURIComponent(id)}`, "DELETE");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="space-y-3 text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-white" />
          <p className="text-sm text-slate-400">Loading property setup…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
        <p className="text-sm text-amber-100">{error}</p>
        <button
          type="button"
          onClick={load}
          className="mt-3 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-3xl font-semibold text-white">Property Setup</h2>
        <p className="text-sm text-slate-300/80">
          Manage room types and rate plans. Linked plans derive their rate from a
          master, so changing the master updates them all.
        </p>
      </div>

      {notice && (
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200">
          {notice}
        </div>
      )}

      <div className="flex gap-2">
        {[
          ["rooms", `Room types (${roomTypes.length})`],
          ["plans", `Rate plans (${ratePlans.length})`],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-xl px-3 py-1.5 text-sm transition ${
              tab === id
                ? "bg-white/15 text-white"
                : "text-slate-300 hover:bg-white/10 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "rooms" && (
        <RoomTypesPanel
          roomTypes={roomTypes}
          editing={editingRoom}
          setEditing={setEditingRoom}
          onSave={saveRoom}
          onDelete={removeRoom}
          busy={busy}
        />
      )}

      {tab === "plans" && (
        <RatePlansPanel
          ratePlans={ratePlans}
          roomTypes={roomTypes}
          resolved={resolved}
          editing={editingPlan}
          setEditing={setEditingPlan}
          onSave={savePlan}
          onDelete={removePlan}
          busy={busy}
        />
      )}
    </div>
  );
}

function RoomTypesPanel({ roomTypes, editing, setEditing, onSave, onDelete, busy }) {
  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          setEditing({
            room_type_name: "",
            base_price: "",
            number_of_rooms: "",
            max_adults: "",
            description: "",
          })
        }
        className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100 disabled:opacity-50"
      >
        + Add room type
      </button>

      {editing && (
        <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">
            {editing.id ? "Edit room type" : "New room type"}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Name">
              <input
                value={editing.room_type_name}
                onChange={(e) => setEditing({ ...editing, room_type_name: e.target.value })}
                className={inputClass}
                placeholder="Deluxe Room"
              />
            </Field>
            <Field label="Base price">
              <input
                type="number"
                value={editing.base_price}
                onChange={(e) => setEditing({ ...editing, base_price: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Number of rooms">
              <input
                type="number"
                value={editing.number_of_rooms}
                onChange={(e) =>
                  setEditing({ ...editing, number_of_rooms: e.target.value })
                }
                className={inputClass}
              />
            </Field>
            <Field label="Max adults">
              <input
                type="number"
                value={editing.max_adults ?? ""}
                onChange={(e) => setEditing({ ...editing, max_adults: e.target.value })}
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Description">
            <input
              value={editing.description ?? ""}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              className={inputClass}
            />
          </Field>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy || !editing.room_type_name?.trim()}
              onClick={() => onSave(editing)}
              className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-100 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3">Room type</th>
              <th className="px-4 py-3">Base price</th>
              <th className="px-4 py-3">Rooms</th>
              <th className="px-4 py-3">Max adults</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {roomTypes.map((r) => (
              <tr key={r.id} className="border-t border-white/10">
                <td className="px-4 py-3">
                  <span className="block text-white">{r.room_type_name}</span>
                  {r.description && (
                    <span className="block text-xs text-slate-400">{r.description}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-200">{r.base_price}</td>
                <td className="px-4 py-3 text-slate-200">{r.number_of_rooms}</td>
                <td className="px-4 py-3 text-slate-200">{r.max_adults ?? "—"}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => setEditing(r)}
                    className="mr-2 rounded-lg bg-white/10 px-2.5 py-1 text-xs text-white hover:bg-white/20"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(r.id, r.room_type_name)}
                    className="rounded-lg bg-red-500/15 px-2.5 py-1 text-xs text-red-200 hover:bg-red-500/25"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {roomTypes.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">
                  No room types yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RatePlansPanel({
  ratePlans,
  roomTypes,
  resolved,
  editing,
  setEditing,
  onSave,
  onDelete,
  busy,
}) {
  const planName = (id) => ratePlans.find((p) => p.id === id)?.plan_name || "—";
  const roomName = (id) =>
    roomTypes.find((r) => r.id === id)?.room_type_name || "—";

  const masters = editing
    ? eligibleMasters(editing, ratePlans)
    : [];

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          setEditing({
            plan_name: "",
            description: "",
            room_type_id: roomTypes[0]?.id || "",
            is_master: false,
            derive_from_id: "",
            derive_method: "offset",
            derive_value: "",
          })
        }
        className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100 disabled:opacity-50"
      >
        + Add rate plan
      </button>

      {editing && (
        <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">
            {editing.id ? "Edit rate plan" : "New rate plan"}
          </h3>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Plan name">
              <input
                value={editing.plan_name}
                onChange={(e) => setEditing({ ...editing, plan_name: e.target.value })}
                className={inputClass}
                placeholder="Breakfast CP"
              />
            </Field>
            <Field label="Room type">
              <select
                value={editing.room_type_id || ""}
                onChange={(e) => setEditing({ ...editing, room_type_id: e.target.value })}
                className={inputClass}
              >
                <option value="">— none —</option>
                {roomTypes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.room_type_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Description">
              <input
                value={editing.description ?? ""}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                className={inputClass}
              />
            </Field>
          </div>

          <div className="mt-4 rounded-xl border border-white/10 bg-slate-900/40 p-3">
            <label className="flex items-center gap-2 text-sm text-white">
              <input
                type="checkbox"
                checked={Boolean(editing.derive_from_id)}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    derive_from_id: e.target.checked ? masters[0]?.id || "" : "",
                    is_master: e.target.checked ? false : editing.is_master,
                  })
                }
              />
              Link this plan to a master
            </label>

            {editing.derive_from_id ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Field label="Master plan">
                  <select
                    value={editing.derive_from_id}
                    onChange={(e) =>
                      setEditing({ ...editing, derive_from_id: e.target.value })
                    }
                    className={inputClass}
                  >
                    {masters.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.plan_name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Method">
                  <select
                    value={editing.derive_method || "offset"}
                    onChange={(e) =>
                      setEditing({ ...editing, derive_method: e.target.value })
                    }
                    className={inputClass}
                  >
                    {DERIVE_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {METHOD_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Value">
                  <input
                    type="number"
                    step="0.01"
                    value={editing.derive_value ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, derive_value: e.target.value })
                    }
                    className={inputClass}
                    placeholder={
                      editing.derive_method === "multiplier" ? "0.90" : "500"
                    }
                  />
                </Field>
              </div>
            ) : (
              <label className="mt-3 flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={Boolean(editing.is_master)}
                  onChange={(e) =>
                    setEditing({ ...editing, is_master: e.target.checked })
                  }
                />
                This is a master plan
              </label>
            )}
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy || !editing.plan_name?.trim()}
              onClick={() => onSave(editing)}
              className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-100 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3">Rate plan</th>
              <th className="px-4 py-3">Room type</th>
              <th className="px-4 py-3">Linked to</th>
              <th className="px-4 py-3">Rule</th>
              <th className="px-4 py-3 text-right">Rate</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {ratePlans.map((p) => (
              <tr key={p.id} className="border-t border-white/10">
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2">
                    <span className="text-white">{p.plan_name}</span>
                    {p.is_master && (
                      <span className="rounded border border-green-500/20 bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-300">
                        MASTER
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-300">{roomName(p.room_type_id)}</td>
                <td className="px-4 py-3 text-slate-300">
                  {p.derive_from_id ? planName(p.derive_from_id) : "—"}
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {describeDerivation(p) ?? "—"}
                </td>
                <td className="px-4 py-3 text-right text-slate-100">
                  {resolved[p.id] === null || resolved[p.id] === undefined
                    ? "—"
                    : Math.round(resolved[p.id]).toLocaleString("en-IN")}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => setEditing(p)}
                    className="mr-2 rounded-lg bg-white/10 px-2.5 py-1 text-xs text-white hover:bg-white/20"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(p.id, p.plan_name)}
                    className="rounded-lg bg-red-500/15 px-2.5 py-1 text-xs text-red-200 hover:bg-red-500/25"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {ratePlans.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                  No rate plans yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
