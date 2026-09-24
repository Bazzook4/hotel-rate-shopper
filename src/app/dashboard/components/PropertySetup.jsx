"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MEAL_PLANS, planLabel } from "@/lib/mealPlans";
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
    <label className="block label">
      {label}
      {children}
    </label>
  );
}

const inputClass =
  "input mt-1";

export default function PropertySetup({ session }) {
  // A super admin is not tied to one property, so they choose which to
  // configure. Everyone else is scoped to their own and sees no picker.
  const [properties, setProperties] = useState([]);
  const [propertyId, setPropertyId] = useState(session?.propertyId || "");
  const canChoose = session?.canSwitchProperties === true;

  const [roomTypes, setRoomTypes] = useState([]);
  const [ratePlans, setRatePlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("rooms");
  const [editingRoom, setEditingRoom] = useState(null);
  const [editingPlan, setEditingPlan] = useState(null);

  // Load the property list once, so a super admin has something to pick.
  useEffect(() => {
    if (!canChoose) return;
    let cancelled = false;
    fetch("/api/properties")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.properties) return;
        setProperties(j.properties);
        setPropertyId((cur) => cur || j.properties[0]?.id || "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canChoose]);

  const load = useCallback(async () => {
    // Nothing to load until a property is known.
    if (canChoose && !propertyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : "";
    try {
      const [r, p] = await Promise.all([
        fetch(`/api/setup/roomTypes${qs}`),
        fetch(`/api/setup/ratePlans${qs}`),
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
  }, [propertyId, canChoose]);

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
      : await send("/api/setup/roomTypes", "POST", { ...payload, property_id: propertyId || undefined });
    if (ok) {
      setEditingRoom(null);
      setNotice(room.id ? "Room type updated." : "Room type added.");
    }
  }

  async function savePlan(plan) {
    const linked = Boolean(plan.derive_from_id);
    const payload = {
      plan_name: plan.plan_name,
      meal_plan: plan.meal_plan || null,
      refundable: plan.refundable !== false,
      stop_sell: Boolean(plan.stop_sell),
      min_stay: plan.min_stay === "" ? null : plan.min_stay,
      max_stay: plan.max_stay === "" ? null : plan.max_stay,
      description: plan.description || "",
      room_type_id: plan.room_type_id || null,
      is_master: !linked && Boolean(plan.is_master),
      derive_from_id: linked ? plan.derive_from_id : null,
      derive_method: linked ? plan.derive_method : null,
      derive_value: linked ? Number(plan.derive_value) : null,
    };
    const ok = plan.id
      ? await send("/api/setup/ratePlans", "PATCH", { id: plan.id, ...payload })
      : await send("/api/setup/ratePlans", "POST", { ...payload, property_id: propertyId || undefined });
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
          <div className="inline-block h-7 w-7 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" />
          <p className="sub">Loading property setup…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-[var(--warn)] bg-[var(--warn-soft)] p-4">
        <p className="text-sm text-[var(--warn)]">{error}</p>
        <button
          type="button"
          onClick={load}
          className="mt-3 btn btn-secondary text-xs"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="h1">Property Setup</h2>
        <p className="sub">
          Manage room types and rate plans. Linked plans derive their rate from a
          master, so changing the master updates them all.
        </p>
      </div>

      {canChoose && (
        <div className="card card-pad">
          <label className="label">Property</label>
          <select
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            className="input"
          >
            {properties.length === 0 && <option value="">No properties found</option>}
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {notice && (
        <div className="card px-4 py-2 sub">
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
                ? "bg-[var(--accent-soft)] text-ink"
                : "muted hover:bg-[var(--surface-2)] hover:text-ink"
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
        className="btn btn-primary"
      >
        + Add room type
      </button>

      {editing && (
        <div className="card card-pad">
          <h3 className="mb-3 h2 text-sm">
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
              className="btn btn-primary"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="btn btn-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto card">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide muted">
              <th className="px-4 py-3">Room type</th>
              <th className="px-4 py-3">Base price</th>
              <th className="px-4 py-3">Rooms</th>
              <th className="px-4 py-3">Max adults</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {roomTypes.map((r) => (
              <tr key={r.id} className="">
                <td className="px-4 py-3">
                  <span className="block text-ink">{r.room_type_name}</span>
                  {r.description && (
                    <span className="block text-xs muted">{r.description}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-ink">{r.base_price}</td>
                <td className="px-4 py-3 text-ink">{r.number_of_rooms}</td>
                <td className="px-4 py-3 text-ink">{r.max_adults ?? "—"}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => setEditing(r)}
                    className="mr-2 btn btn-secondary text-xs"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(r.id, r.room_type_name)}
                    className="btn btn-danger text-xs"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {roomTypes.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center sub">
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
            plan_name: "EP",
            meal_plan: "EP",
            refundable: true,
            stop_sell: false,
            min_stay: "",
            max_stay: "",
            description: "",
            room_type_id: roomTypes[0]?.id || "",
            is_master: false,
            derive_from_id: "",
            derive_method: "offset",
            derive_value: "",
          })
        }
        className="btn btn-primary"
      >
        + Add rate plan
      </button>

      {editing && (
        <div className="card card-pad">
          <h3 className="mb-3 h2 text-sm">
            {editing.id ? "Edit rate plan" : "New rate plan"}
          </h3>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Meal plan">
              <select
                value={editing.meal_plan || "EP"}
                onChange={(e) => {
                  const next = { ...editing, meal_plan: e.target.value };
                  // Keep the name in step with the code unless it was edited.
                  if (!editing.plan_name || editing.plan_name === planLabel(editing)) {
                    next.plan_name = planLabel(next);
                  }
                  setEditing(next);
                }}
                className={inputClass}
              >
                {MEAL_PLANS.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.code} — {m.hint}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Terms">
              <select
                value={editing.refundable === false ? "nr" : "ref"}
                onChange={(e) => {
                  const next = { ...editing, refundable: e.target.value === "ref" };
                  if (!editing.plan_name || editing.plan_name === planLabel(editing)) {
                    next.plan_name = planLabel(next);
                  }
                  setEditing(next);
                }}
                className={inputClass}
              >
                <option value="ref">Refundable</option>
                <option value="nr">Non-refundable</option>
              </select>
            </Field>
            <Field label="Plan name">
              <input
                value={editing.plan_name}
                onChange={(e) => setEditing({ ...editing, plan_name: e.target.value })}
                className={inputClass}
                placeholder={planLabel(editing)}
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

          <div className="mt-4 card p-3">
            <p className="label">Restrictions</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex items-center gap-2 pt-5 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={Boolean(editing.stop_sell)}
                  onChange={(e) =>
                    setEditing({ ...editing, stop_sell: e.target.checked })
                  }
                />
                Stop sell
              </label>
              <Field label="Min length of stay">
                <input
                  type="number"
                  min="1"
                  value={editing.min_stay ?? ""}
                  onChange={(e) => setEditing({ ...editing, min_stay: e.target.value })}
                  className={inputClass}
                  placeholder="1"
                />
              </Field>
              <Field label="Max length of stay">
                <input
                  type="number"
                  min="1"
                  value={editing.max_stay ?? ""}
                  onChange={(e) => setEditing({ ...editing, max_stay: e.target.value })}
                  className={inputClass}
                  placeholder="14"
                />
              </Field>
            </div>
          </div>

          <div className="mt-4 card p-3">
            <label className="flex items-center gap-2 text-sm text-ink">
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
              <label className="mt-3 flex items-center gap-2 sub">
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
              className="btn btn-primary"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="btn btn-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto card">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide muted">
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Room type</th>
              <th className="px-4 py-3">Restrictions</th>
              <th className="px-4 py-3">Linked to</th>
              <th className="px-4 py-3">Rule</th>
              <th className="px-4 py-3 text-right">Rate</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {ratePlans.map((p) => (
              <tr key={p.id} className="">
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2">
                    <span className="chip chip-off font-mono">{planLabel(p)}</span>
                    <span className="text-ink">{p.plan_name}</span>
                    {p.is_master && (
                      <span className="chip chip-ok">
                        MASTER
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-3 muted">{roomName(p.room_type_id)}</td>
                <td className="px-4 py-3 muted text-xs">
                  {[
                    p.stop_sell ? "Stop sell" : null,
                    p.min_stay ? `Min ${p.min_stay}` : null,
                    p.max_stay ? `Max ${p.max_stay}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </td>
                <td className="px-4 py-3 muted">
                  {p.derive_from_id ? planName(p.derive_from_id) : "—"}
                </td>
                <td className="px-4 py-3 muted">
                  {describeDerivation(p) ?? "—"}
                </td>
                <td className="px-4 py-3 text-right text-[var(--text)]">
                  {resolved[p.id] === null || resolved[p.id] === undefined
                    ? "—"
                    : Math.round(resolved[p.id]).toLocaleString("en-IN")}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => setEditing(p)}
                    className="mr-2 btn btn-secondary text-xs"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(p.id, p.plan_name)}
                    className="btn btn-danger text-xs"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {ratePlans.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center sub">
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
