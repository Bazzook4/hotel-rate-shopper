"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { MEAL_PLANS, planLabel } from "@/lib/mealPlans";
import RatePlanWizard from "./RatePlanWizard";
import { eligibleMasters, resolveAllRates } from "@/lib/ratePlanPricing";
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
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
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

  if (loading) return <Loading label="Loading property setup…" />;

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
    <RatePlansPanel
      propertyId={propertyId}
      ratePlans={ratePlans}
      roomTypes={roomTypes}
      assignments={assignments}
      baseRates={baseRates}
      editing={editingPlan}
      setEditing={setEditingPlan}
      onSave={savePlan}
      onDelete={removePlan}
      onReload={load}
      busy={busy}
      notice={notice}
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

const DERIVE_OPTIONS = [
  { id: "offset", label: "± amount" },
  { id: "percent", label: "± %" },
  { id: "multiplier", label: "× factor" },
];

const MEAL_OPTIONS = [
  { id: "", label: "—" },
  ...MEAL_PLANS.map((m) => ({ id: m.code, label: `${m.code} · ${m.hint}` })),
];

/**
 * Rate plans as a grid, derived plans indented under the plan they follow.
 *
 * The terms of a plan -- meal basis, refundability, stay limits, the rule it
 * derives by -- are edited in place and saved together. Creating a plan and
 * choosing its rooms still goes through the wizard, because that is where
 * each room's own rate is set.
 */
function RatePlansPanel({
  propertyId,
  ratePlans,
  roomTypes,
  assignments,
  baseRates,
  editing,
  setEditing,
  onSave,
  onDelete,
  onReload,
  busy: wizardBusy,
  notice: outerNotice,
}) {
  const grid = useGrid(ratePlans);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("");
  // Absent means open, so a newly added plan shows its children at once.
  const [expanded, setExpanded] = useState({});

  const roomName = (id) => roomTypes.find((r) => r.id === id)?.room_type_name || "—";

  // Rates follow the pending edits, so changing a rule shows its effect
  // before it is saved -- the way a CM cell does.
  const livePlans = ratePlans.map((p) => {
    const m = grid.merged(p);
    // Inputs hand back text; the pricing maths needs numbers.
    return { ...m, derive_value: m.derive_value === "" ? null : Number(m.derive_value) };
  });
  const resolved = resolveAllRates(livePlans, baseRates);

  /** Plans nested under the plan they derive from, to any depth. */
  const tree = useMemo(() => {
    const childrenOf = new Map();
    for (const p of ratePlans) {
      if (!p.derive_from_id) continue;
      if (!childrenOf.has(p.derive_from_id)) childrenOf.set(p.derive_from_id, []);
      childrenOf.get(p.derive_from_id).push(p);
    }
    // A cycle would otherwise recurse forever; the schema should prevent one.
    const build = (plan, seen) => {
      if (seen.has(plan.id)) return { plan, children: [] };
      const next = new Set(seen).add(plan.id);
      return {
        plan,
        children: (childrenOf.get(plan.id) || []).map((c) => build(c, next)),
      };
    };
    // A plan whose parent is missing is treated as a root rather than lost.
    const ids = new Set(ratePlans.map((p) => p.id));
    return ratePlans
      .filter((p) => !p.derive_from_id || !ids.has(p.derive_from_id))
      .map((p) => build(p, new Set()));
  }, [ratePlans]);

  const term = filter.trim().toLowerCase();
  const matches = (node) =>
    !term ||
    node.plan.plan_name?.toLowerCase().includes(term) ||
    planLabel(node.plan).toLowerCase().includes(term) ||
    node.children.some(matches);

  async function saveAll() {
    setBusy(true);
    setError("");
    setNotice("");
    const saved = grid.count;
    const errors = await grid.save({
      label: (p) => p.plan_name || "Rate plan",
      update: (plan, changes, next) => {
        if (!next.plan_name?.trim()) throw new Error("Name is required");
        const body = { id: plan.id, property_id: propertyId || undefined, ...changes };
        for (const k of ["min_stay", "max_stay", "release_period"]) {
          if (k in body) body[k] = body[k] === "" ? null : Number(body[k]);
        }
        if ("meal_plan" in body) body.meal_plan = body.meal_plan || null;
        // A derivation is validated as a whole, so any part of it sends all.
        if (["derive_from_id", "derive_method", "derive_value"].some((k) => k in changes)) {
          body.derive_from_id = next.derive_from_id;
          body.derive_method = next.derive_method;
          body.derive_value = next.derive_value;
        }
        return sendJSON("/api/setup/ratePlans", "PATCH", body);
      },
      create: async () => {},
    });
    await onReload();
    setBusy(false);
    if (errors.length) setError(errors.join(" · "));
    else setNotice(`Saved ${saved} change${saved === 1 ? "" : "s"}.`);
  }

  function assignedRooms(plan) {
    const mine = (assignments || []).filter((a) => a.rate_plan_id === plan.id);
    if (mine.length === 0) {
      return plan.room_type_id ? roomName(plan.room_type_id) : "No rooms assigned";
    }
    if (mine.length <= 2) return mine.map((a) => roomName(a.room_type_id)).join(", ");
    return `${roomName(mine[0].room_type_id)} +${mine.length - 1} more`;
  }

  function renderBranch(node, depth) {
    if (!matches(node)) return null;
    const { plan, children } = node;
    const open = expanded[plan.id] !== false;
    const derived = Boolean(plan.derive_from_id);
    const rate = resolved?.[plan.id];
    const master = derived ? ratePlans.find((p) => p.id === plan.derive_from_id) : null;
    // The master a derived plan follows can be changed to any plan that
    // would not create a loop.
    const masters = derived
      ? eligibleMasters(plan, ratePlans).map((p) => ({ id: p.id, label: p.plan_name }))
      : [];

    return (
      <Fragment key={plan.id}>
        <tr className={depth === 0 ? "cm-group" : undefined}>
          <td
            className="cm-sticky"
            style={{
              paddingLeft: 12 + Math.min(depth, 4) * 22,
              background: depth === 0 ? "var(--surface-2)" : "var(--surface)",
              minWidth: 300,
            }}
          >
            <div className="flex items-center gap-2">
              {children.length > 0 ? (
                <button
                  type="button"
                  className="muted"
                  style={{ width: 14 }}
                  onClick={() => setExpanded((p) => ({ ...p, [plan.id]: !open }))}
                  aria-expanded={open}
                >
                  {open ? "▾" : "▸"}
                </button>
              ) : (
                <span style={{ width: 14 }} />
              )}
              <span className="chip chip-off font-mono">{planLabel(grid.merged(plan))}</span>
              <div className="flex-1">
                {grid.input(plan, "plan_name", { invalid: !grid.value(plan, "plan_name")?.trim() })}
              </div>
              {plan.is_master && <span className="chip chip-ok">MASTER</span>}
            </div>
            <span className="mt-0.5 block text-xs muted" style={{ paddingLeft: 22 }}>
              {assignedRooms(plan)}
            </span>
          </td>
          <td>{grid.select(plan, "meal_plan", MEAL_OPTIONS)}</td>
          <td className="text-center">
            {/* Stored null has always meant refundable, as planLabel reads it. */}
            <input
              type="checkbox"
              checked={grid.value(plan, "refundable") !== false}
              onChange={(e) => grid.change(plan, "refundable", e.target.checked)}
              style={
                grid.edited(plan, "refundable")
                  ? { outline: "2px solid var(--accent)", outlineOffset: 1 }
                  : undefined
              }
            />
          </td>
          <td>
            {derived ? (
              <div className="flex items-center gap-1" style={{ minWidth: 260 }}>
                <span className="text-xs muted">From</span>
                {grid.select(plan, "derive_from_id", masters.length ? masters : [
                  { id: plan.derive_from_id, label: master?.plan_name || "—" },
                ])}
                {grid.select(plan, "derive_method", DERIVE_OPTIONS)}
                <div style={{ width: 80 }}>
                  {grid.input(plan, "derive_value", { type: "number", step: "any" })}
                </div>
              </div>
            ) : (
              <span className="text-xs muted">Rates entered directly</span>
            )}
          </td>
          <td className="cm-num" style={{ fontWeight: 600 }}>
            {rate === null || rate === undefined ? "—" : Math.round(rate).toLocaleString("en-IN")}
          </td>
          <td style={{ width: 80 }}>{grid.input(plan, "min_stay", { type: "number", min: 1, placeholder: "—" })}</td>
          <td style={{ width: 80 }}>{grid.input(plan, "max_stay", { type: "number", min: 1, placeholder: "—" })}</td>
          <td style={{ width: 80 }}>
            {grid.input(plan, "release_period", { type: "number", min: 0, placeholder: "—" })}
          </td>
          <td className="text-center">{grid.check(plan, "stop_sell")}</td>
          <td className="whitespace-nowrap text-right">
            <button
              type="button"
              className="btn btn-ghost text-xs"
              onClick={() => setEditing(plan)}
              title="Rooms and per-room rates"
            >
              Rooms…
            </button>
            <button
              type="button"
              className="btn btn-ghost text-xs"
              onClick={() => onDelete(plan.id, plan.plan_name)}
              title="Delete rate plan"
            >
              ✕
            </button>
          </td>
        </tr>
        {open && children.map((child) => renderBranch(child, depth + 1))}
      </Fragment>
    );
  }

  return (
    <div className="space-y-4">
      <SetupHeader
        title="Rate Plan Setup"
        count={ratePlans.length}
        sub="What a guest is buying, and what it costs. A plan can take its rate from another, so changing one moves them together."
      >
        <SaveActions count={grid.count} busy={busy} onSave={saveAll} onDiscard={grid.discard} />
      </SetupHeader>

      <Messages error={error} notice={notice || outerNotice} />

      <Toolbar>
        <button
          type="button"
          className="btn btn-secondary text-sm"
          disabled={wizardBusy}
          onClick={() => setEditing({})}
        >
          + Add rate plan
        </button>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter rate plans…"
          className="ml-auto input w-56"
        />
      </Toolbar>

      {editing && (
        <RatePlanWizard
          plan={editing.id ? editing : null}
          ratePlans={ratePlans}
          roomTypes={roomTypes}
          assignments={assignments}
          onSave={onSave}
          onCancel={() => setEditing(null)}
          busy={wizardBusy}
        />
      )}

      <Grid>
        <thead>
          <tr>
            <th className="cm-sticky">Rate plan &amp; rooms</th>
            <th style={{ minWidth: 170 }}>Meal plan</th>
            <th title="Unticked is sold non-refundable (NR)">Refundable</th>
            <th>Rate rule</th>
            <th className="text-right">Rate</th>
            <th title="Minimum nights">Min</th>
            <th title="Maximum nights">Max</th>
            <th title="Days before arrival the plan closes">Release</th>
            <th>Stop sell</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tree.map((node) => renderBranch(node, 0))}
          {ratePlans.length === 0 && (
            <tr>
              <td colSpan={10} className="cm-empty">
                No rate plans yet. Add one to start selling.
              </td>
            </tr>
          )}
        </tbody>
      </Grid>
    </div>
  );
}
