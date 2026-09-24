"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { planLabel } from "@/lib/mealPlans";
import RatePlanWizard from "./RatePlanWizard";
import { describeDerivation, resolveAllRates } from "@/lib/ratePlanPricing";


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
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingRoom, setEditingRoom] = useState(null);
  const [editingPlan, setEditingPlan] = useState(null);
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
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  // Base rates come from each plan's room type; masters price directly.
  /**
   * Each plan's own rate, before any derivation.
   *
   * A plan is priced per assigned room, so the list shows the lowest assigned
   * rate as the plan's headline -- one number has to stand for several, and
   * the cheapest is the one a guest sees first. A plan with no assignments
   * falls back to its old room_type_id, so a property not yet migrated still
   * shows a rate.
   */
  const baseRates = useMemo(() => {
    const roomById = Object.fromEntries(roomTypes.map((r) => [r.id, r]));
    const byPlan = new Map();
    for (const a of assignments) {
      const rate = Number(a.full_rate);
      if (!Number.isFinite(rate)) continue;
      const cur = byPlan.get(a.rate_plan_id);
      if (cur === undefined || rate < cur) byPlan.set(a.rate_plan_id, rate);
    }

    const out = {};
    for (const p of ratePlans) {
      if (byPlan.has(p.id)) {
        out[p.id] = byPlan.get(p.id);
        continue;
      }
      const room = roomById[p.room_type_id];
      out[p.id] = room ? Number(room.base_price) : null;
    }
    return out;
  }, [ratePlans, roomTypes, assignments]);

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

  /**
   * Save a rate plan and, in the same action, which rooms it applies to.
   *
   * The plan is written first because the assignments reference its id, which
   * a new plan does not have until it exists.
   */
  async function savePlan(plan, rooms) {
    const linked = Boolean(plan.derive_from_id);
    const payload = {
      plan_name: plan.plan_name,
      meal_plan: plan.meal_plan || null,
      refundable: plan.refundable !== false,
      stop_sell: Boolean(plan.stop_sell),
      min_stay: plan.min_stay === "" ? null : plan.min_stay,
      max_stay: plan.max_stay === "" ? null : plan.max_stay,
      release_period: plan.release_period === "" ? null : plan.release_period,
      description: plan.description || "",
      is_master: !linked && Boolean(plan.is_master),
      derive_from_id: linked ? plan.derive_from_id : null,
      derive_method: linked ? plan.derive_method : null,
      derive_value: linked ? Number(plan.derive_value) : null,
    };

    setBusy(true);
    setNotice("");
    try {
      const url = "/api/setup/ratePlans";
      const res = plan.id
        ? await fetch(url, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: plan.id, ...payload }),
          })
        : await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...payload,
              property_id: propertyId || undefined,
            }),
          });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not save the rate plan");

      const planId = plan.id || json?.ratePlan?.id || json?.id;

      if (planId) {
        const ra = await fetch("/api/setup/ratePlanRooms", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ratePlanId: planId,
            propertyId: propertyId || undefined,
            rooms: rooms || [],
          }),
        });
        if (!ra.ok) {
          const rj = await ra.json().catch(() => null);
          // The plan itself saved, so say what did and did not.
          throw new Error(
            `${rj?.error || "Could not save room assignments"} The rate plan itself was saved.`
          );
        }
      }

      setEditingPlan(null);
      setNotice(plan.id ? "Rate plan updated." : "Rate plan added.");
      await load();
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusy(false);
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

  const showRooms = only === "rooms";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="h1">
          {showRooms ? "Room Setup" : "Rate Plan Setup"}
          <span className="ml-2 text-base font-normal muted">
            ({showRooms ? roomTypes.length : ratePlans.length})
          </span>
        </h2>
        <p className="sub">
          {showRooms
            ? "The rooms you sell, how many of each, and what they cost as a base."
            : "What a guest is buying, and what it costs. A plan can take its rate from another, so changing one moves them together."}
        </p>
      </div>

      {notice && (
        <div className="card px-4 py-2 sub">
          {notice}
        </div>
      )}

      {showRooms ? (
        <RoomTypesPanel
          roomTypes={roomTypes}
          editing={editingRoom}
          setEditing={setEditingRoom}
          onSave={saveRoom}
          onDelete={removeRoom}
          busy={busy}
        />
      ) : (
        <RatePlansPanel
          ratePlans={ratePlans}
          roomTypes={roomTypes}
          assignments={assignments}
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
  assignments,
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


  // Rows are collapsed by id; absent means open, so a newly added plan shows
  // its children without needing to be registered first.
  const [expanded, setExpanded] = useState({});

  /**
   * Plans nested under the plan they derive from.
   *
   * Derivation chains are followed to any depth, because the pricing engine
   * supports them: a plan derived from a derived plan must still appear, and
   * flattening to one level dropped it from the list entirely.
   */
  const tree = useMemo(() => {
    const childrenOf = new Map();
    for (const p of ratePlans) {
      if (!p.derive_from_id) continue;
      if (!childrenOf.has(p.derive_from_id)) childrenOf.set(p.derive_from_id, []);
      childrenOf.get(p.derive_from_id).push(p);
    }

    // A cycle would otherwise recurse forever; the schema should prevent one,
    // but the list must not hang if a bad row exists.
    const build = (plan, seen) => {
      if (seen.has(plan.id)) return { plan, children: [] };
      const next = new Set(seen).add(plan.id);
      return {
        plan,
        children: (childrenOf.get(plan.id) || []).map((c) => build(c, next)),
      };
    };

    // A plan whose parent is missing would otherwise vanish, so it is treated
    // as a root instead.
    const ids = new Set(ratePlans.map((p) => p.id));
    return ratePlans
      .filter((p) => !p.derive_from_id || !ids.has(p.derive_from_id))
      .map((p) => build(p, new Set()));
  }, [ratePlans]);

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={busy}
        onClick={() => setEditing({})}
        className="btn btn-primary"
      >
        + Add rate plan
      </button>

      {editing && (
        <RatePlanWizard
          plan={editing.id ? editing : null}
          ratePlans={ratePlans}
          roomTypes={roomTypes}
          assignments={assignments}
          onSave={onSave}
          onCancel={() => setEditing(null)}
          busy={busy}
        />
      )}

      {/* Plans are listed under the plan they derive from, so a chain is read
          down the page rather than reconstructed from a "linked to" column. */}
      <div className="overflow-x-auto card">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide muted">
              <th className="px-4 py-3">Rate plan &amp; room type</th>
              <th className="px-4 py-3">Rate setup</th>
              <th className="px-4 py-3 text-right">Rate</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {tree.map((node) => (
              <PlanBranch
                key={node.plan.id}
                node={node}
                depth={0}
                expanded={expanded}
                setExpanded={setExpanded}
                roomName={roomName}
                planName={planName}
                resolved={resolved}
                assignments={assignments}
                onEdit={setEditing}
                onDelete={onDelete}
              />
            ))}
            {ratePlans.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center sub">
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

/**
 * Which rooms a plan can be booked on, as a short phrase.
 *
 * Falls back to the plan's old room_type_id where there are no assignments,
 * so a plan created before rooms were assignable still names its room rather
 * than reading as unassigned.
 */
function assignedRooms(plan, assignments, roomName) {
  const mine = (assignments || []).filter((a) => a.rate_plan_id === plan.id);

  if (mine.length === 0) {
    return plan.room_type_id ? roomName(plan.room_type_id) : "No rooms assigned";
  }
  if (mine.length <= 2) {
    return mine.map((a) => roomName(a.room_type_id)).join(", ");
  }
  return `${roomName(mine[0].room_type_id)} +${mine.length - 1} more`;
}

/**
 * One rate plan in the list.
 *
 * `depth` of 1 is a derived plan, indented under the plan it comes from. The
 * Rate setup column names that plan outright rather than saying "derived",
 * since the whole point of the row is which plan the rate follows.
 */
function PlanRow({
  plan,
  depth,
  hasChildren,
  open,
  onToggle,
  roomName,
  planName,
  resolved,
  assignments,
  onEdit,
  onDelete,
}) {
  const rate = resolved?.[plan.id];
  const derived = Boolean(plan.derive_from_id);

  return (
    <tr
      style={
        derived
          ? { borderLeft: "2px solid var(--accent)" }
          : { background: "var(--surface-2)" }
      }
    >
      <td
        className="px-4 py-2.5"
        style={{ paddingLeft: depth ? 16 + Math.min(depth, 4) * 18 : undefined }}
      >
        <span className="flex items-center gap-2">
          {hasChildren ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              aria-label={open ? "Collapse" : "Expand"}
              className="muted"
              style={{ width: 14 }}
            >
              {open ? "▾" : "▸"}
            </button>
          ) : (
            <span style={{ width: 14 }} />
          )}
          <span className="chip chip-off font-mono">{planLabel(plan)}</span>
          <span className="text-ink">{plan.plan_name}</span>
          {plan.is_master && <span className="chip chip-ok">MASTER</span>}
        </span>
        <span className="mt-0.5 block text-xs muted" style={{ paddingLeft: 30 }}>
          {assignedRooms(plan, assignments, roomName)}
          {[
            plan.stop_sell ? "Stop sell" : null,
            plan.min_stay ? `Min ${plan.min_stay}` : null,
            plan.max_stay ? `Max ${plan.max_stay}` : null,
          ]
            .filter(Boolean)
            .map((t) => ` · ${t}`)
            .join("")}
        </span>
      </td>

      <td className="px-4 py-2.5 text-xs">
        {derived ? (
          <>
            <span className="muted">Derived from </span>
            <span className="font-medium text-ink">
              {planName(plan.derive_from_id)}
            </span>
            <span className="muted">, {describeDerivation(plan) ?? "no rule set"}</span>
          </>
        ) : (
          <span className="muted">Rates entered directly</span>
        )}
      </td>

      <td className="px-4 py-2.5 text-right text-[var(--text)]">
        {rate === null || rate === undefined
          ? "—"
          : Math.round(rate).toLocaleString("en-IN")}
      </td>

      <td className="px-4 py-2.5 text-right whitespace-nowrap">
        <button
          type="button"
          onClick={() => onEdit(plan)}
          className="mr-2 btn btn-secondary text-xs"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onDelete(plan.id, plan.plan_name)}
          className="btn btn-danger text-xs"
        >
          Delete
        </button>
      </td>
    </tr>
  );
}

/**
 * A rate plan and, when open, everything derived from it.
 *
 * Recursive so a derivation chain of any depth is drawn; the indent grows
 * with each level, up to a cap so a deep chain does not run off the column.
 */
function PlanBranch({
  node,
  depth,
  expanded,
  setExpanded,
  roomName,
  planName,
  resolved,
  assignments,
  onEdit,
  onDelete,
}) {
  const { plan, children } = node;
  // Absent means open, so a newly added plan shows its children immediately.
  const open = expanded[plan.id] !== false;

  return (
    <Fragment>
      <PlanRow
        plan={plan}
        depth={depth}
        hasChildren={children.length > 0}
        open={open}
        onToggle={() =>
          setExpanded((prev) => ({ ...prev, [plan.id]: prev[plan.id] === false }))
        }
        roomName={roomName}
        planName={planName}
        resolved={resolved}
        assignments={assignments}
        onEdit={onEdit}
        onDelete={onDelete}
      />
      {open &&
        children.map((child) => (
          <PlanBranch
            key={child.plan.id}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            setExpanded={setExpanded}
            roomName={roomName}
            planName={planName}
            resolved={resolved}
            assignments={assignments}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
    </Fragment>
  );
}
