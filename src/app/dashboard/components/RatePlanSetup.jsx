"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MEAL_PLANS, planLabel } from "@/lib/mealPlans";
import {
  DERIVE_RULES,
  describeRule,
  eligibleMasters,
  gridOwnRateAt,
  roomRateResolver,
  rateSourceOf,
  ruleById,
  ruleProblem,
} from "@/lib/ratePlanPricing";
import { Grid, Messages, SetupHeader, Toolbar, sendJSON } from "./SetupGrid";

/**
 * Rate Plan Setup, laid out the way SiteMinder lays it out.
 *
 * A rate plan sets the defaults -- meal basis, terms, stay limits, minimum
 * rate and how its rates are decided. Each room it is sold in is a room rate
 * listed under it, and a room rate inherits all of that until a field is
 * unlocked and given its own value. So one plan can be "BAR less 10%" in
 * every room while its Suite alone follows a different plan, and its single
 * alone takes a deeper cut than its double.
 *
 * The list is for finding and reading; changes go through a drawer from the
 * row's ⋯ menu, since a room rate holds more than one row can show.
 */

const fmt = (n) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? "—"
    : Math.round(Number(n)).toLocaleString("en-IN");

const blank = (v) => v === null || v === undefined || v === "";
const orBlank = (v) => (blank(v) ? "" : v);
const numOrNull = (v) => (blank(v) ? null : Number(v));

export default function RatePlanSetup({
  propertyId,
  ratePlans,
  roomTypes,
  assignments,
  onReload,
}) {
  const [roomFilter, setRoomFilter] = useState("");
  const [planFilter, setPlanFilter] = useState("");
  // Absent means open, so a newly added plan shows its rooms at once.
  const [collapsed, setCollapsed] = useState({});
  const [drawer, setDrawer] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const roomById = useMemo(
    () => Object.fromEntries(roomTypes.map((r) => [r.id, r])),
    [roomTypes]
  );
  const planById = useMemo(
    () => Object.fromEntries(ratePlans.map((p) => [p.id, p])),
    [ratePlans]
  );
  const assignmentFor = useMemo(() => {
    const out = {};
    for (const a of assignments) out[`${a.rate_plan_id}|${a.room_type_id}`] = a;
    return out;
  }, [assignments]);

  // Priced exactly as the CM grid prices them, so what this page shows is
  // what the channels are sent.
  const resolver = useMemo(
    () => makeResolver(ratePlans, assignments, roomTypes),
    [ratePlans, assignments, roomTypes]
  );

  /** A plan's room rates, in Room Setup order. */
  const roomsOf = (planId) =>
    roomTypes.filter((r) => assignmentFor[`${planId}|${r.id}`]);

  const term = planFilter.trim().toLowerCase();
  const visiblePlans = ratePlans.filter(
    (p) =>
      (!term || p.plan_name?.toLowerCase().includes(term)) &&
      (!roomFilter || assignmentFor[`${p.id}|${roomFilter}`])
  );

  const roomRateName = (planId, roomId) =>
    `${roomById[roomId]?.room_type_name || "Room"} / ${planById[planId]?.plan_name || "Plan"}`;

  /** Room rates that follow this one -- directly, by an unlocked link. */
  const followersOf = (planId, roomId) =>
    assignments.filter((a) => {
      const src = rateSourceOf(planById[a.rate_plan_id], a);
      return !src.manual && src.planId === planId && (src.roomId ?? a.room_type_id) === roomId;
    });

  async function run(action, done) {
    setError("");
    setNotice("");
    try {
      await action();
      await onReload();
      if (done) setNotice(done);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }

  const saveRoomRate = (roomRate) =>
    sendJSON("/api/setup/ratePlanRooms", "PATCH", {
      propertyId: propertyId || undefined,
      roomRate,
    });

  async function assignRooms(plan, roomIds) {
    if (roomIds.length === 0) return;
    const ok = await run(async () => {
      for (const roomId of roomIds) {
        await saveRoomRate({ rate_plan_id: plan.id, room_type_id: roomId });
      }
    }, `${roomIds.length} room type${roomIds.length === 1 ? "" : "s"} assigned to ${plan.plan_name}.`);
    if (ok) setCollapsed((c) => ({ ...c, [plan.id]: false }));
  }

  async function deletePlan(plan) {
    const plans = ratePlans.filter((p) => p.derive_from_id === plan.id);
    const rooms = assignments.filter(
      (a) => a.rate_plan_id !== plan.id && a.derive_from_plan_id === plan.id && a.rate_mode === "derived"
    );
    const lines = [];
    if (plans.length) lines.push(`${plans.length} plan(s) derive from it and will become manual.`);
    if (rooms.length) lines.push(`${rooms.length} room rate(s) derive from it and will follow their own plan again.`);
    if (!window.confirm(`Delete rate plan "${plan.plan_name}"?${lines.length ? `\n\n${lines.join("\n")}` : ""}`)) return;
    await run(
      () => sendJSON(`/api/setup/ratePlans?id=${encodeURIComponent(plan.id)}`, "DELETE"),
      `Deleted ${plan.plan_name}.`
    );
  }

  async function deleteRoomRate(planId, roomId) {
    const followers = followersOf(planId, roomId);
    const warning = followers.length
      ? `\n\n${followers.length} room rate(s) derive from it: ${followers
          .map((a) => roomRateName(a.rate_plan_id, a.room_type_id))
          .join(", ")}. They will fall back to the room's base price.`
      : "";
    if (!window.confirm(`Remove ${roomRateName(planId, roomId)}?${warning}`)) return;
    const qs = new URLSearchParams({ ratePlanId: planId, roomTypeId: roomId });
    if (propertyId) qs.set("propertyId", propertyId);
    await run(
      () => sendJSON(`/api/setup/ratePlanRooms?${qs}`, "DELETE"),
      `Removed ${roomRateName(planId, roomId)}.`
    );
  }

  const allOpen = visiblePlans.every((p) => !collapsed[p.id]);

  return (
    <div className="space-y-4">
      <SetupHeader
        title="Rate Plan Setup"
        count={ratePlans.length}
        sub="A plan sets the defaults; each room rate under it inherits them until you unlock a field. Rates can be derived plan by plan, room by room, or adult by adult."
      >
        <button type="button" className="btn btn-primary" onClick={() => setDrawer({ kind: "plan" })}>
          + Add rate plan
        </button>
      </SetupHeader>

      <Messages error={error} notice={notice} />

      <Toolbar>
        <select
          value={roomFilter}
          onChange={(e) => setRoomFilter(e.target.value)}
          className="input w-48"
          aria-label="Filter room types"
        >
          <option value="">All room types</option>
          {roomTypes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.room_type_name}
            </option>
          ))}
        </select>
        <input
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value)}
          placeholder="Filter rate plans…"
          className="input w-56"
        />
        {(roomFilter || planFilter) && (
          <button
            type="button"
            className="btn btn-ghost text-sm"
            onClick={() => {
              setRoomFilter("");
              setPlanFilter("");
            }}
          >
            Clear all
          </button>
        )}
        <button
          type="button"
          className="ml-auto btn btn-ghost text-sm"
          onClick={() =>
            setCollapsed(allOpen ? Object.fromEntries(ratePlans.map((p) => [p.id, true])) : {})
          }
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </Toolbar>

      <Grid>
        <thead>
          <tr>
            <th className="cm-sticky" style={{ minWidth: 300 }}>
              Rate plan / room rate
            </th>
            <th style={{ minWidth: 220 }}>Rate setup</th>
            <th style={{ minWidth: 200 }}>Rates per adult</th>
            <th style={{ minWidth: 170 }}>Stay rules</th>
          </tr>
        </thead>
        <tbody>
          {visiblePlans.map((plan) => {
            const open = !collapsed[plan.id];
            const rooms = roomsOf(plan.id).filter((r) => !roomFilter || r.id === roomFilter);
            const unassigned = roomTypes.filter((r) => !assignmentFor[`${plan.id}|${r.id}`]);
            const master = plan.derive_from_id ? planById[plan.derive_from_id] : null;

            return (
              <Fragment key={plan.id}>
                <tr className="cm-group">
                  <td className="cm-sticky" style={{ background: "var(--surface-2)" }}>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="muted"
                        style={{ width: 16 }}
                        onClick={() => setCollapsed((c) => ({ ...c, [plan.id]: open }))}
                        aria-expanded={open}
                        aria-label={open ? "Collapse" : "Expand"}
                      >
                        {open ? "▾" : "▸"}
                      </button>
                      <button
                        type="button"
                        className="flex-1 text-left font-semibold"
                        onClick={() => setDrawer({ kind: "plan", plan })}
                      >
                        {plan.plan_name}
                      </button>
                      {plan.meal_plan && <span className="chip chip-off font-mono">{planLabel(plan)}</span>}
                      <span className="text-xs muted whitespace-nowrap">
                        {roomsOf(plan.id).length} room{roomsOf(plan.id).length === 1 ? "" : "s"}
                      </span>
                      <RowMenu
                        title="Rate plan actions"
                        items={[
                          {
                            label: "Assign room type",
                            submenu: unassigned.length
                              ? unassigned.map((r) => ({
                                  label: r.room_type_name,
                                  onClick: () => setDrawer({ kind: "room", plan, room: r }),
                                }))
                              : [{ label: "Every room type is assigned", disabled: true }],
                          },
                          {
                            label: "Assign multiple room types",
                            disabled: unassigned.length === 0,
                            onClick: () => setDrawer({ kind: "assign", plan }),
                          },
                          { label: "Edit", onClick: () => setDrawer({ kind: "plan", plan }) },
                          { label: "Delete", danger: true, onClick: () => deletePlan(plan) },
                        ]}
                      />
                    </div>
                  </td>
                  <td>
                    {master ? (
                      <span>
                        From <strong>{master.plan_name}</strong>{" "}
                        <span className="muted">
                          · {describeRule(plan.derive_method, plan.derive_value, plan.derive_value_2)}
                        </span>
                      </span>
                    ) : (
                      <span className="muted">Rates entered manually</span>
                    )}
                    {!blank(plan.min_rate) && (
                      <span className="ml-2 chip chip-off">min {fmt(plan.min_rate)}</span>
                    )}
                  </td>
                  <td className="muted text-xs">Per room below</td>
                  <td>
                    <StayRules min={plan.min_stay} max={plan.max_stay} release={plan.release_period} stopSell={plan.stop_sell} />
                  </td>
                </tr>

                {open &&
                  rooms.map((room) => {
                    const a = assignmentFor[`${plan.id}|${room.id}`];
                    const src = rateSourceOf(plan, a);
                    const rates = resolver.adultRates(plan.id, room.id);
                    const overrides = Object.keys(a?.adult_overrides || {});
                    const base = resolver.baseAdultsOf(room.id);
                    const max = Math.max(base, Number(room.max_adults) || base);
                    // A manual room rate with no rate of its own for some
                    // adult count sells at the room's base price, as the grid
                    // does -- flagged, since that is rarely what was meant.
                    // Adults beyond base pay the extra-adult rate instead.
                    const missing =
                      src.manual &&
                      Array.from({ length: base }, (_, i) => i + 1).some(
                        (n) =>
                          !a?.occupancy_rules?.[n] &&
                          blank(a?.adult_rates?.[n] ?? a?.adult_rates?.[String(n)])
                      );

                    return (
                      <tr key={room.id}>
                        <td className="cm-sticky" style={{ paddingLeft: 40 }}>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="flex-1 text-left"
                              style={{ color: "var(--accent-text)" }}
                              onClick={() => setDrawer({ kind: "room", plan, room })}
                            >
                              {room.room_type_name}{" "}
                              <span className="muted">({plan.plan_name})</span>
                            </button>
                            <RowMenu
                              title="Room rate actions"
                              items={[
                                { label: "Edit", onClick: () => setDrawer({ kind: "room", plan, room }) },
                                { label: "Delete", danger: true, onClick: () => deleteRoomRate(plan.id, room.id) },
                              ]}
                            />
                          </div>
                        </td>
                        <td>
                          {src.manual ? (
                            <span className={src.inherited ? "muted" : undefined}>
                              Manual{src.inherited ? "" : " (own)"}
                            </span>
                          ) : src.inherited ? (
                            <span className="muted">
                              Follows plan · {roomRateName(src.planId, src.roomId)}
                            </span>
                          ) : (
                            <span>
                              From <strong>{roomRateName(src.planId, src.roomId)}</strong>{" "}
                              <span className="muted">· {describeRule(src.method, src.value, src.value2)}</span>
                            </span>
                          )}
                          {src.manual && Object.keys(a?.occupancy_rules || {}).length > 0 && (
                            <span className="ml-2 chip chip-off" title="Adult counts worked out from the single rate">
                              {Object.entries(a.occupancy_rules)
                                .map(([n, r]) => `${n}A = 1A ${describeRule(r.method, r.value, r.value2)}`)
                                .join(" · ")}
                            </span>
                          )}
                          {overrides.length > 0 && (
                            <span className="ml-2 chip chip-warn" title="Adult counts with their own rule">
                              own rule: {overrides.sort().map((n) => `${n}A`).join(", ")}
                            </span>
                          )}
                        </td>
                        <td className="tabular-nums">
                          {missing ? (
                            <button
                              type="button"
                              className="chip chip-warn"
                              title="No per-adult rates yet, so the room's base price is sold"
                              onClick={() => setDrawer({ kind: "room", plan, room })}
                            >
                              Set rates · base {fmt(room.base_price)} in use
                            </button>
                          ) : (
                            <span>
                              {Object.entries(rates)
                                .filter(([n]) => Number(n) <= base)
                                .map(([n, v]) => `${n}A ${fmt(v)}`)
                                .join(" · ")}
                              {max > base && !blank(a?.extra_adult_rate) && (
                                <span className="muted"> · +{fmt(a.extra_adult_rate)}/extra</span>
                              )}
                            </span>
                          )}
                        </td>
                        <td>
                          <StayRules
                            min={a?.min_stay ?? plan.min_stay}
                            max={a?.max_stay ?? plan.max_stay}
                            release={a?.release_period ?? plan.release_period}
                            stopSell={a?.stop_sell ?? plan.stop_sell}
                            own={{
                              min: !blank(a?.min_stay),
                              max: !blank(a?.max_stay),
                              release: !blank(a?.release_period),
                              stopSell: a?.stop_sell !== null && a?.stop_sell !== undefined,
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}

                {open && rooms.length === 0 && (
                  <tr>
                    <td className="cm-sticky" style={{ paddingLeft: 40 }} colSpan={4}>
                      <span className="text-xs muted">
                        No room types assigned — use ⋯ → Assign room type to start selling this plan.
                      </span>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {visiblePlans.length === 0 && (
            <tr>
              <td colSpan={4} className="cm-empty">
                {ratePlans.length ? "No rate plans match the filters." : "No rate plans yet. Add one to start selling."}
              </td>
            </tr>
          )}
        </tbody>
      </Grid>

      {drawer?.kind === "plan" && (
        <PlanDrawer
          plan={drawer.plan || null}
          propertyId={propertyId}
          ratePlans={ratePlans}
          roomTypes={roomTypes}
          assignments={assignments}
          onClose={() => setDrawer(null)}
          onSaved={async (msg) => {
            setDrawer(null);
            await run(async () => {}, msg);
          }}
          saveRoomRate={saveRoomRate}
        />
      )}
      {drawer?.kind === "room" && (
        <RoomRateDrawer
          plan={drawer.plan}
          room={drawer.room}
          ratePlans={ratePlans}
          roomTypes={roomTypes}
          assignments={assignments}
          onClose={() => setDrawer(null)}
          onSave={async (roomRate) => {
            await saveRoomRate(roomRate);
            setDrawer(null);
            setCollapsed((c) => ({ ...c, [drawer.plan.id]: false }));
            await run(async () => {}, `Saved ${roomRateName(drawer.plan.id, drawer.room.id)}.`);
          }}
        />
      )}
      {drawer?.kind === "assign" && (
        <AssignDrawer
          plan={drawer.plan}
          rooms={roomTypes.filter((r) => !assignmentFor[`${drawer.plan.id}|${r.id}`])}
          onClose={() => setDrawer(null)}
          onAssign={async (ids) => {
            setDrawer(null);
            await assignRooms(drawer.plan, ids);
          }}
        />
      )}
    </div>
  );
}

/**
 * The resolver the CM grid uses, with the grid's fallback for a room rate
 * that has no rate of its own: the room's base price.
 */
function makeResolver(ratePlans, assignments, roomTypes) {
  return roomRateResolver({
    ratePlans,
    assignments,
    roomTypes,
    ownRateAt: gridOwnRateAt(assignments, roomTypes),
  });
}

function StayRules({ min, max, release, stopSell, own = {} }) {
  const part = (label, v, mine) => (
    <span style={mine ? { fontWeight: 600 } : undefined} className={mine ? undefined : "muted"}>
      {label} {blank(v) ? "—" : v}
    </span>
  );
  return (
    <span className="text-xs whitespace-nowrap">
      {part("Min", min, own.min)} · {part("Max", max, own.max)} · {part("Rel", release, own.release)}
      {stopSell && (
        <span className="ml-2 chip chip-warn" style={own.stopSell ? { fontWeight: 700 } : undefined}>
          Stop sell
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* ⋯ menu                                                               */
/* ------------------------------------------------------------------ */

/**
 * The row's action menu. Rendered into the body and positioned against the
 * viewport: inside the grid it would be clipped by the sideways scroll, and
 * the sticky name cells below it would paint over it.
 */
function RowMenu({ title, items }) {
  const [at, setAt] = useState(null);
  const [sub, setSub] = useState(null);
  const btn = useRef(null);
  const box = useRef(null);

  useEffect(() => {
    if (!at) return undefined;
    const close = (e) => {
      if (box.current?.contains(e.target) || btn.current?.contains(e.target)) return;
      setAt(null);
      setSub(null);
    };
    const esc = (e) => e.key === "Escape" && (setAt(null), setSub(null));
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", close, true);
    };
  }, [at]);

  function toggle() {
    if (at) {
      setAt(null);
      setSub(null);
      return;
    }
    const r = btn.current.getBoundingClientRect();
    const width = 260;
    setAt({
      top: r.bottom + 6,
      left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)),
      width,
    });
  }

  const pick = (fn) => {
    setAt(null);
    setSub(null);
    fn?.();
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={toggle}
        className="btn btn-ghost px-2 py-0.5 text-base leading-none"
        style={{ color: "var(--accent)" }}
        aria-haspopup="menu"
        aria-expanded={Boolean(at)}
        aria-label={title}
      >
        ⋯
      </button>
      {at &&
        createPortal(
        <div
          ref={box}
          role="menu"
          className="card"
          style={{ position: "fixed", top: at.top, left: at.left, width: at.width, zIndex: 60, padding: 0 }}
        >
          <div className="flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide muted" style={{ borderBottom: "1px solid var(--border)" }}>
            {title}
            <button type="button" onClick={() => pick()} aria-label="Close">
              ✕
            </button>
          </div>
          {items.map((it) => (
            <div key={it.label}>
              <button
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => (it.submenu ? setSub(sub === it.label ? null : it.label) : pick(it.onClick))}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--surface-2)] disabled:opacity-50"
                style={{ color: it.danger ? "var(--danger)" : "var(--text)" }}
              >
                {it.label}
                {it.submenu && <span className="muted">{sub === it.label ? "▾" : "›"}</span>}
              </button>
              {it.submenu && sub === it.label && (
                <div style={{ background: "var(--surface-2)" }}>
                  {it.submenu.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      role="menuitem"
                      disabled={s.disabled}
                      onClick={() => pick(s.onClick)}
                      className="block w-full py-1.5 pl-7 pr-3 text-left text-sm hover:bg-[var(--surface)] disabled:opacity-60"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>,
          document.body
        )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Drawer and its fields                                                */
/* ------------------------------------------------------------------ */

function Drawer({ title, subtitle, onCancel, onSave, saveLabel = "Save", busy, error, children }) {
  useEffect(() => {
    const esc = (e) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="Close"
        onClick={onCancel}
        className="flex-1"
        style={{ background: "rgba(15, 23, 42, 0.45)" }}
      />
      <div
        className="flex h-full w-full flex-col"
        style={{ maxWidth: 620, background: "var(--surface)", borderLeft: "1px solid var(--border)" }}
      >
        <div
          className="flex items-start justify-between gap-3 px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="min-w-0">
            <h3 className="h2">{title}</h3>
            {subtitle && <p className="sub truncate">{subtitle}</p>}
          </div>
          <div className="flex flex-shrink-0 gap-2">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={onSave} disabled={busy}>
              {busy ? "Saving…" : saveLabel}
            </button>
          </div>
        </div>
        {error && (
          <div className="px-5 py-2 text-sm" style={{ color: "var(--danger)", background: "var(--danger-soft)" }}>
            {error}
          </div>
        )}
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="space-y-3" style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
      <h4 className="text-xs font-semibold uppercase tracking-wide muted">{title}</h4>
      {children}
    </section>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs faint">{hint}</span>}
    </label>
  );
}

/**
 * A field a room rate inherits from its plan. Locked, it shows the plan's
 * value and stores nothing; unlocking copies that value in to be changed.
 */
function LockField({ label, locked, inherited, onUnlock, onLock, children }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          {locked ? (
            <div className="input" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
              {inherited}
            </div>
          ) : (
            children
          )}
        </div>
        <button
          type="button"
          onClick={locked ? onUnlock : onLock}
          className="btn btn-secondary px-2"
          style={{ height: 38, ...(locked ? { color: "var(--accent)" } : {}) }}
          title={locked ? "Following the rate plan — unlock to set this room's own value" : "Lock to follow the rate plan again"}
          aria-label={locked ? `Unlock ${label}` : `Lock ${label}`}
        >
          <LockIcon open={!locked} />
        </button>
      </div>
    </div>
  );
}

function LockIcon({ open }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d={open ? "M5.5 7V5a2.5 2.5 0 0 1 4.9-.7" : "M5.5 7V5a2.5 2.5 0 0 1 5 0v2"} />
    </svg>
  );
}

/**
 * Increase / decrease by an amount or a percentage. Stored signed, typed as
 * a direction and a size, so nobody has to remember that a discount is a
 * negative number.
 */
function SignedValue({ kind, value, onChange }) {
  const v = blank(value) ? "" : Number(value);
  const down = v !== "" && v < 0;
  if (kind === "factor") {
    return (
      <input type="number" step="0.01" min="0" className="input" value={orBlank(value)} onChange={(e) => onChange(e.target.value)} placeholder="0.90" />
    );
  }
  return (
    <div className="flex gap-2">
      <select
        className="input"
        style={{ flex: "0 0 7.5rem" }}
        value={down ? "down" : "up"}
        onChange={(e) => {
          const mag = Math.abs(Number(v) || 0);
          onChange(e.target.value === "down" ? -mag : mag);
        }}
        aria-label="Direction"
      >
        <option value="up">Increase</option>
        <option value="down">Decrease</option>
      </select>
      <div className="relative flex-1">
        <input
          type="number"
          min="0"
          step="0.01"
          className="input"
          style={{ paddingRight: "2.2rem" }}
          value={v === "" ? "" : Math.abs(v)}
          onChange={(e) => {
            if (e.target.value === "") return onChange("");
            const mag = Math.abs(Number(e.target.value));
            onChange(down ? -mag : mag);
          }}
          placeholder={kind === "percent" ? "10" : "500"}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs muted">
          {kind === "percent" ? "%" : "amt"}
        </span>
      </div>
    </div>
  );
}

/** The rule picker: "Adjust daily rates by", then whatever values it needs. */
function RuleEditor({ method, value, value2, onChange, compact = false }) {
  const rule = ruleById(method);
  const options = DERIVE_RULES.filter((r) => !r.legacy || r.id === method);
  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {!compact && <span className="label">Adjust daily rates by *</span>}
      <select
        className="input"
        value={method || ""}
        onChange={(e) => onChange({ method: e.target.value, value: "", value2: "" })}
        style={!method ? { borderColor: "var(--danger)" } : undefined}
      >
        {!method && <option value="">Please select a derivation rule</option>}
        {options.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>
      {rule?.steps.map((kind, i) => (
        <div key={i}>
          {rule.steps.length > 1 && (
            <span className="label">
              {i === 0 ? "First" : "Then"}, by {kind === "percent" ? "a percentage" : "an amount"}
            </span>
          )}
          <SignedValue
            kind={kind}
            value={i === 0 ? value : value2}
            onChange={(v) => onChange(i === 0 ? { method, value: v, value2 } : { method, value, value2: v })}
          />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Edit rate plan                                                       */
/* ------------------------------------------------------------------ */

function PlanDrawer({ plan, propertyId, ratePlans, roomTypes, assignments, onClose, onSaved, saveRoomRate }) {
  const isNew = !plan;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(() => ({
    plan_name: plan?.plan_name ?? "",
    description: plan?.description ?? "",
    meal_plan: plan?.meal_plan ?? "EP",
    refundable: plan?.refundable !== false,
    min_stay: orBlank(plan?.min_stay),
    max_stay: orBlank(plan?.max_stay),
    release_period: orBlank(plan?.release_period),
    stop_sell: Boolean(plan?.stop_sell),
    min_rate: orBlank(plan?.min_rate),
    is_master: Boolean(plan?.is_master),
    derive_from_id: plan?.derive_from_id ?? "",
    derive_method: plan?.derive_method ?? "",
    derive_value: orBlank(plan?.derive_value),
    derive_value_2: orBlank(plan?.derive_value_2),
  }));
  const [newRooms, setNewRooms] = useState(() => new Set());
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const masters = eligibleMasters(
    { id: plan?.id, property_id: plan?.property_id ?? ratePlans[0]?.property_id },
    ratePlans
  );
  const derived = Boolean(form.derive_from_id);

  // What the plan's rooms would cost with these settings, before saving.
  const preview = useMemo(() => {
    const self = {
      ...(plan || {}),
      id: plan?.id || "__new__",
      ...form,
      derive_from_id: form.derive_from_id || null,
      min_rate: numOrNull(form.min_rate),
    };
    const plans = [...ratePlans.filter((p) => p.id !== self.id), self];
    const rooms = plan
      ? roomTypes.filter((r) => assignments.some((a) => a.rate_plan_id === plan.id && a.room_type_id === r.id))
      : roomTypes.filter((r) => newRooms.has(r.id));
    const extra = plan ? [] : rooms.map((r) => ({ rate_plan_id: self.id, room_type_id: r.id }));
    const resolver = makeResolver(plans, [...assignments, ...extra], roomTypes);
    return rooms.map((r) => ({ room: r, rates: resolver.adultRates(self.id, r.id) }));
  }, [form, plan, ratePlans, roomTypes, assignments, newRooms]);
  const widest = Math.max(1, ...preview.map((p) => Object.keys(p.rates).length));

  function problem() {
    if (!form.plan_name.trim()) return "Give the rate plan a name.";
    const min = numOrNull(form.min_stay);
    const max = numOrNull(form.max_stay);
    if (min !== null && !(Number.isInteger(min) && min >= 1)) return "Minimum stay is a whole number of nights.";
    if (max !== null && !(Number.isInteger(max) && max >= 1)) return "Maximum stay is a whole number of nights.";
    if (min !== null && max !== null && min > max) return `A minimum of ${min} nights cannot sit above a maximum of ${max}.`;
    if (!blank(form.release_period) && !(Number(form.release_period) >= 0)) return "Release period cannot be negative.";
    if (!blank(form.min_rate) && !(Number(form.min_rate) >= 0)) return "Minimum rate must be zero or more.";
    if (derived) return ruleProblem(form.derive_method, form.derive_value, form.derive_value_2);
    return "";
  }

  async function save() {
    const p = problem();
    if (p) return setError(p);
    setBusy(true);
    setError("");
    const body = {
      plan_name: form.plan_name.trim(),
      description: form.description,
      meal_plan: form.meal_plan || null,
      refundable: form.refundable,
      stop_sell: form.stop_sell,
      min_stay: numOrNull(form.min_stay),
      max_stay: numOrNull(form.max_stay),
      release_period: numOrNull(form.release_period),
      min_rate: numOrNull(form.min_rate),
      is_master: !derived && form.is_master,
      derive_from_id: derived ? form.derive_from_id : null,
      derive_method: derived ? form.derive_method : null,
      derive_value: derived ? numOrNull(form.derive_value) ?? 0 : null,
      derive_value_2: derived ? numOrNull(form.derive_value_2) : null,
    };
    try {
      if (isNew) {
        const json = await sendJSON("/api/setup/ratePlans", "POST", {
          ...body,
          property_id: propertyId || undefined,
        });
        const id = json?.ratePlan?.id;
        for (const roomId of newRooms) {
          await saveRoomRate({ rate_plan_id: id, room_type_id: roomId });
        }
        await onSaved(`Added ${body.plan_name}.`);
      } else {
        await sendJSON("/api/setup/ratePlans", "PATCH", {
          id: plan.id,
          property_id: propertyId || undefined,
          ...body,
        });
        await onSaved(`Saved ${body.plan_name}.`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      title={isNew ? "Add rate plan" : "Edit rate plan"}
      subtitle={isNew ? null : plan.plan_name}
      onCancel={onClose}
      onSave={save}
      saveLabel={isNew ? "Create" : "Save"}
      busy={busy}
      error={error}
    >
      <Section title="General information">
        <Field label="Rate plan name *">
          <input className="input" value={form.plan_name} onChange={(e) => set({ plan_name: e.target.value })} placeholder="Dinner Bed & Breakfast" autoFocus={isNew} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Inclusions (meal plan)">
            <select className="input" value={form.meal_plan} onChange={(e) => set({ meal_plan: e.target.value })}>
              {MEAL_PLANS.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.code} — {m.hint}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Terms">
            <select className="input" value={form.refundable ? "ref" : "nr"} onChange={(e) => set({ refundable: e.target.value === "ref" })}>
              <option value="ref">Refundable</option>
              <option value="nr">Non-refundable</option>
            </select>
          </Field>
        </div>
        <Field label="Description" hint="For your own reference. Guests never see this.">
          <textarea className="input" rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
      </Section>

      <Section title="Restrictions">
        <p className="text-xs faint">Defaults for every room rate on this plan. A room rate can unlock and change any of them.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Default minimum stay">
            <input type="number" min="1" className="input" value={form.min_stay} onChange={(e) => set({ min_stay: e.target.value })} placeholder="None" />
          </Field>
          <Field label="Default maximum stay">
            <input type="number" min="1" className="input" value={form.max_stay} onChange={(e) => set({ max_stay: e.target.value })} placeholder="None" />
          </Field>
          <Field label="Release period" hint="Days before arrival the plan closes.">
            <input type="number" min="0" className="input" value={form.release_period} onChange={(e) => set({ release_period: e.target.value })} placeholder="None" />
          </Field>
          <Field label="Default stop sell">
            <label className="flex h-[38px] items-center gap-2 text-sm">
              <input type="checkbox" checked={form.stop_sell} onChange={(e) => set({ stop_sell: e.target.checked })} />
              Yes
            </label>
          </Field>
        </div>
      </Section>

      <Section title="Pricing details">
        <Field label="Minimum rate" hint="A derived rate never resolves below this. Leave blank for none.">
          <input type="number" min="0" className="input" value={form.min_rate} onChange={(e) => set({ min_rate: e.target.value })} placeholder="None" style={{ maxWidth: 220 }} />
        </Field>

        <div className="card space-y-3 p-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="plan-rate-setup" checked={!derived} onChange={() => set({ derive_from_id: "" })} />
            Manually input daily rates
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="plan-rate-setup"
              disabled={masters.length === 0}
              checked={derived}
              onChange={() => set({ derive_from_id: masters[0]?.id || "", is_master: false })}
            />
            Derive daily rates from an existing rate plan
          </label>
          {masters.length === 0 && <p className="pl-6 text-xs faint">Needs another rate plan to derive from.</p>}

          {derived ? (
            <div className="space-y-3 pl-6">
              <Field label="Derived from *">
                <select className="input" value={form.derive_from_id} onChange={(e) => set({ derive_from_id: e.target.value })}>
                  {masters.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.plan_name}
                    </option>
                  ))}
                </select>
              </Field>
              <RuleEditor
                method={form.derive_method}
                value={form.derive_value}
                value2={form.derive_value_2}
                onChange={(r) => set({ derive_method: r.method, derive_value: r.value, derive_value_2: r.value2 })}
              />
              <p className="text-xs faint">
                Each room follows the master in the same room, adult by adult — a single follows the single, a double the double. Individual room rates can follow something else, or set their own rule per adult.
              </p>
            </div>
          ) : (
            <label className="flex items-center gap-2 pl-6 text-sm muted">
              <input type="checkbox" checked={form.is_master} onChange={(e) => set({ is_master: e.target.checked })} />
              This is a master plan
            </label>
          )}
        </div>

        {isNew && roomTypes.length > 0 && (
          <div>
            <span className="label">Sell in these room types</span>
            <div className="grid gap-1 sm:grid-cols-2">
              {roomTypes.map((r) => (
                <label key={r.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={newRooms.has(r.id)}
                    onChange={(e) =>
                      setNewRooms((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(r.id);
                        else n.delete(r.id);
                        return n;
                      })
                    }
                  />
                  {r.room_type_name}
                </label>
              ))}
            </div>
            {!derived && newRooms.size > 0 && (
              <p className="mt-1 text-xs faint">Set each room&rsquo;s per-adult rates from its row after creating the plan.</p>
            )}
          </div>
        )}

        {derived && preview.length > 0 && (
          <div>
            <span className="label">Resulting rates</span>
            <div className="overflow-x-auto card" style={{ padding: 0 }}>
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Room</th>
                    {Array.from({ length: widest }, (_, i) => (
                      <th key={i} className="text-right">
                        {i + 1} adult{i ? "s" : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map(({ room, rates }) => (
                    <tr key={room.id}>
                      <td>{room.room_type_name}</td>
                      {Array.from({ length: widest }, (_, i) => (
                        <td key={i} className="text-right tabular-nums">
                          {i + 1 in rates ? fmt(rates[i + 1]) : ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* Edit room rate                                                       */
/* ------------------------------------------------------------------ */

function RoomRateDrawer({ plan, room, ratePlans, roomTypes, assignments, onClose, onSave }) {
  const existing = assignments.find((a) => a.rate_plan_id === plan.id && a.room_type_id === room.id) || null;
  const isNew = !existing;
  const base = Math.max(1, Number(room.base_adults) || 0);
  const maxAdults = Math.max(base, Number(room.max_adults) || base);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState(() => ({
    description: existing?.description ?? "",
    min_stay: existing?.min_stay ?? null,
    max_stay: existing?.max_stay ?? null,
    release_period: existing?.release_period ?? null,
    stop_sell: existing?.stop_sell ?? null,
    min_rate: existing?.min_rate ?? null,
    rate_mode: existing?.rate_mode ?? null,
    derive_from_plan_id: existing?.derive_from_plan_id ?? "",
    derive_from_room_id: existing?.derive_from_room_id ?? "",
    derive_method: existing?.derive_method ?? "",
    derive_value: orBlank(existing?.derive_value),
    derive_value_2: orBlank(existing?.derive_value_2),
    adult_overrides: { ...(existing?.adult_overrides || {}) },
    occupancy_rules: { ...(existing?.occupancy_rules || {}) },
    // Rates are per adult only up to base; every adult beyond it is an
    // extra adult, priced by the extra-adult rate.
    adult_rates: Object.fromEntries(
      Object.entries(existing?.adult_rates || {}).filter(([n]) => Number(n) <= base)
    ),
    extra_adult_rate: (() => {
      // A room rate saved while every adult count had its own rate (Oct
      // 2026) has none; offer the step from base to one more adult, so
      // saving keeps the price it was selling at.
      const own = numOrNull(existing?.extra_adult_rate);
      if (own !== null || maxAdults <= base) return orBlank(own);
      const atBase = numOrNull(existing?.adult_rates?.[base]);
      const above = numOrNull(existing?.adult_rates?.[base + 1]);
      return atBase !== null && above !== null ? String(above - atBase) : "";
    })(),
    extra_child_rate: orBlank(existing?.extra_child_rate),
  }));
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // The room rate as it would be saved, dropped into the property's setup so
  // the resolver can price it -- and anything else -- live.
  const draft = useMemo(
    () => ({
      ...(existing || {}),
      rate_plan_id: plan.id,
      room_type_id: room.id,
      ...form,
      min_rate: numOrNull(form.min_rate),
      derive_from_plan_id: form.derive_from_plan_id || null,
      derive_from_room_id: form.derive_from_room_id || null,
    }),
    [existing, plan.id, room.id, form]
  );
  const liveAssignments = useMemo(
    () => [
      ...assignments.filter((a) => !(a.rate_plan_id === plan.id && a.room_type_id === room.id)),
      draft,
    ],
    [assignments, plan.id, room.id, draft]
  );
  const resolver = useMemo(
    () => makeResolver(ratePlans, liveAssignments, roomTypes),
    [ratePlans, liveAssignments, roomTypes]
  );
  const src = rateSourceOf(plan, draft);
  const effectiveMin = resolver.minRateOf(plan.id, room.id);

  const roomName = (id) => roomTypes.find((r) => r.id === id)?.room_type_name || "Room";
  const planName = (id) => ratePlans.find((p) => p.id === id)?.plan_name || "Plan";

  // Any other room rate this one could follow without closing a loop.
  const sources = useMemo(() => {
    const out = [];
    for (const a of assignments) {
      if (a.rate_plan_id === plan.id && a.room_type_id === room.id) continue;
      const trial = makeResolver(
        ratePlans,
        [
          ...liveAssignments.filter((x) => x !== draft),
          { ...draft, rate_mode: "derived", derive_from_plan_id: a.rate_plan_id, derive_from_room_id: a.room_type_id, derive_method: "same" },
        ],
        roomTypes
      );
      if (trial.loopAt(plan.id, room.id)) continue;
      out.push({ value: `${a.rate_plan_id}|${a.room_type_id}`, label: `${roomName(a.room_type_id)} / ${planName(a.rate_plan_id)}` });
    }
    // Same room first, since that is what is usually meant.
    return out.sort((x, y) => {
      const xs = x.value.endsWith(`|${room.id}`) ? 0 : 1;
      const ys = y.value.endsWith(`|${room.id}`) ? 0 : 1;
      return xs - ys || x.label.localeCompare(y.label);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments, ratePlans, roomTypes, plan.id, room.id]);

  const lock = (field, inheritedValue) => ({
    locked: form[field] === null || form[field] === undefined,
    onUnlock: () => set({ [field]: inheritedValue ?? "" }),
    onLock: () => set({ [field]: null }),
  });
  const show = (v, none = "None") => (blank(v) ? none : String(v));

  const planSetupText = plan.derive_from_id
    ? `Derive from ${roomName(room.id)} / ${planName(plan.derive_from_id)} · ${describeRule(plan.derive_method, plan.derive_value, plan.derive_value_2)}`
    : "Manually input daily rates";

  function problem() {
    const min = numOrNull(form.min_stay);
    const max = numOrNull(form.max_stay);
    const effMin = min ?? numOrNull(plan.min_stay);
    const effMax = max ?? numOrNull(plan.max_stay);
    if (min !== null && !(Number.isInteger(min) && min >= 1)) return "Minimum stay is a whole number of nights.";
    if (max !== null && !(Number.isInteger(max) && max >= 1)) return "Maximum stay is a whole number of nights.";
    if (effMin !== null && effMax !== null && effMin > effMax) return `A minimum of ${effMin} nights cannot sit above a maximum of ${effMax}.`;
    if (form.rate_mode === "derived") {
      if (!form.derive_from_plan_id) return "Choose the room rate to derive from.";
      const p = ruleProblem(form.derive_method, form.derive_value, form.derive_value_2);
      if (p) return p;
    }
    if (src.manual) {
      for (let n = 1; n <= base; n++) {
        const rule = form.occupancy_rules[n];
        if (rule) {
          const p = ruleProblem(rule.method, rule.value, rule.value2);
          if (p) return `${n} adults: ${p}`;
          continue;
        }
        const v = form.adult_rates[n];
        if (blank(v) || !(Number(v) >= 0)) return `Enter the rate for ${n} adult${n === 1 ? "" : "s"}.`;
        if (effectiveMin !== null && Number(v) < effectiveMin) {
          return `The rate for ${n} adult${n === 1 ? "" : "s"} is below the minimum rate of ${fmt(effectiveMin)}.`;
        }
      }
    } else {
      for (const [n, o] of Object.entries(form.adult_overrides)) {
        if (Number(n) > base) continue;
        const p = ruleProblem(o.method, o.value, o.value2);
        if (p) return `${n} adult${n === "1" ? "" : "s"}: ${p}`;
      }
    }
    if (maxAdults > base && !blank(form.extra_adult_rate) && !(Number(form.extra_adult_rate) >= 0)) {
      return "The extra adult rate must be zero or more.";
    }
    return "";
  }

  async function save() {
    const p = problem();
    if (p) return setError(p);
    setBusy(true);
    setError("");
    try {
      await onSave({
        rate_plan_id: plan.id,
        room_type_id: room.id,
        description: form.description || null,
        min_stay: numOrNull(form.min_stay),
        max_stay: numOrNull(form.max_stay),
        release_period: numOrNull(form.release_period),
        stop_sell: form.stop_sell,
        min_rate: numOrNull(form.min_rate),
        rate_mode: form.rate_mode,
        derive_from_plan_id: form.rate_mode === "derived" ? form.derive_from_plan_id : null,
        derive_from_room_id: form.rate_mode === "derived" ? form.derive_from_room_id : null,
        derive_method: form.rate_mode === "derived" ? form.derive_method : null,
        derive_value: form.rate_mode === "derived" ? numOrNull(form.derive_value) ?? 0 : null,
        derive_value_2: form.rate_mode === "derived" ? numOrNull(form.derive_value_2) : null,
        adult_rates: form.adult_rates,
        // Overrides only mean something on a derived rate.
        adult_overrides: (() => {
          if (src.manual) return null;
          const o = Object.fromEntries(
            Object.entries(form.adult_overrides).filter(([n]) => Number(n) <= base)
          );
          return Object.keys(o).length ? o : null;
        })(),
        // Rules from the single only mean something on a manual rate.
        occupancy_rules: (() => {
          if (!src.manual) return null;
          const rules = Object.fromEntries(
            Object.entries(form.occupancy_rules).filter(([n]) => Number(n) <= base)
          );
          return Object.keys(rules).length ? rules : null;
        })(),
        extra_adult_rate: maxAdults > base ? numOrNull(form.extra_adult_rate) : null,
        extra_child_rate: numOrNull(form.extra_child_rate),
      });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const setupLocked = form.rate_mode === null;

  return (
    <Drawer
      title={isNew ? "Assign room type" : "Edit room rate"}
      subtitle={`${room.room_type_name} · assigned to “${plan.plan_name}”`}
      onCancel={onClose}
      onSave={save}
      saveLabel={isNew ? "Assign" : "Save"}
      busy={busy}
      error={error}
    >
      <Section title="General information">
        <Field label="Room type">
          <div className="input" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
            {room.room_type_name}
          </div>
        </Field>
        <Field label="Description">
          <input className="input" value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder={plan.plan_name} maxLength={255} />
        </Field>
      </Section>

      <Section title="Occupancy">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Included occupancy" hint="Adults priced individually. Set in Room Setup.">
            <div className="input" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>{base}</div>
          </Field>
          <Field label="Maximum occupancy" hint="Set in Room Setup.">
            <div className="input" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>{maxAdults}</div>
          </Field>
        </div>
      </Section>

      <Section title="Restrictions">
        <div className="grid gap-3 sm:grid-cols-2">
          <LockField label="Default minimum stay" inherited={show(plan.min_stay)} {...lock("min_stay", plan.min_stay)}>
            <input type="number" min="1" className="input" value={orBlank(form.min_stay)} onChange={(e) => set({ min_stay: e.target.value })} />
          </LockField>
          <LockField label="Default maximum stay" inherited={show(plan.max_stay, "Max. allowed booking nights")} {...lock("max_stay", plan.max_stay)}>
            <input type="number" min="1" className="input" value={orBlank(form.max_stay)} onChange={(e) => set({ max_stay: e.target.value })} />
          </LockField>
          <LockField label="Release period" inherited={show(plan.release_period)} {...lock("release_period", plan.release_period)}>
            <input type="number" min="0" className="input" value={orBlank(form.release_period)} onChange={(e) => set({ release_period: e.target.value })} />
          </LockField>
          <LockField
            label="Default stop sell"
            inherited={plan.stop_sell ? "Yes" : "No"}
            locked={form.stop_sell === null}
            onUnlock={() => set({ stop_sell: Boolean(plan.stop_sell) })}
            onLock={() => set({ stop_sell: null })}
          >
            <label className="flex h-[38px] items-center gap-2 text-sm">
              <input type="checkbox" checked={Boolean(form.stop_sell)} onChange={(e) => set({ stop_sell: e.target.checked })} />
              Yes
            </label>
          </LockField>
        </div>
        <p className="text-xs faint">
          Inclusions come from the plan: {plan.meal_plan || "—"} — {MEAL_PLANS.find((m) => m.code === plan.meal_plan)?.hint || "not set"}.
        </p>
      </Section>

      <Section title="Pricing details">
        <div style={{ maxWidth: 280 }}>
          <LockField label="Minimum rate" inherited={show(plan.min_rate)} {...lock("min_rate", plan.min_rate)}>
            <input type="number" min="0" className="input" value={orBlank(form.min_rate)} onChange={(e) => set({ min_rate: e.target.value })} />
          </LockField>
        </div>

        <LockField
          label="Rate setup"
          inherited={`Follows ${plan.plan_name}: ${planSetupText}`}
          locked={setupLocked}
          onUnlock={() => set({ rate_mode: plan.derive_from_id ? "derived" : "manual", ...(plan.derive_from_id ? {
            derive_from_plan_id: plan.derive_from_id,
            derive_from_room_id: room.id,
            derive_method: plan.derive_method,
            derive_value: orBlank(plan.derive_value),
            derive_value_2: orBlank(plan.derive_value_2),
          } : {}) })}
          onLock={() => set({ rate_mode: null })}
        >
          <div className="card space-y-3 p-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="room-rate-setup" checked={form.rate_mode === "manual"} onChange={() => set({ rate_mode: "manual" })} />
              Manually input daily rates
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="room-rate-setup"
                checked={form.rate_mode === "derived"}
                disabled={sources.length === 0}
                onChange={() => {
                  const first = sources[0]?.value.split("|") || ["", ""];
                  set({
                    rate_mode: "derived",
                    derive_from_plan_id: form.derive_from_plan_id || first[0],
                    derive_from_room_id: form.derive_from_room_id || first[1],
                  });
                }}
              />
              Derive daily rates
            </label>
            {form.rate_mode === "derived" && (
              <div className="space-y-3 pl-6">
                <Field label="Derived from *">
                  <select
                    className="input"
                    value={form.derive_from_plan_id ? `${form.derive_from_plan_id}|${form.derive_from_room_id}` : ""}
                    onChange={(e) => {
                      const [p, r] = e.target.value.split("|");
                      set({ derive_from_plan_id: p, derive_from_room_id: r });
                    }}
                  >
                    {!form.derive_from_plan_id && <option value="">Please select a room rate</option>}
                    {sources.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <RuleEditor
                  method={form.derive_method}
                  value={form.derive_value}
                  value2={form.derive_value_2}
                  onChange={(r) => set({ derive_method: r.method, derive_value: r.value, derive_value_2: r.value2 })}
                />
              </div>
            )}
          </div>
        </LockField>

        <AdultRates
          base={base}
          src={src}
          form={form}
          set={set}
          resolver={resolver}
          plan={plan}
          room={room}
          sourceName={src.manual ? null : `${roomName(src.roomId)} / ${planName(src.planId)}`}
        />

        <div>
          <span className="label">Extra rates</span>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Extra adult"
              hint={
                maxAdults <= base
                  ? "Max equals base adults."
                  : src.manual
                  ? `Per adult beyond ${base}, up to ${maxAdults}, on top of the ${base}-adult rate.`
                  : `Per adult beyond ${base}, up to ${maxAdults}. Leave blank to follow the source.`
              }
            >
              <input type="number" min="0" className="input" disabled={maxAdults <= base} value={form.extra_adult_rate} onChange={(e) => set({ extra_adult_rate: e.target.value })} placeholder={maxAdults > base ? "0" : "n/a"} />
            </Field>
            <Field label="Extra child" hint="Per child, per night.">
              <input type="number" min="0" className="input" value={form.extra_child_rate} onChange={(e) => set({ extra_child_rate: e.target.value })} placeholder="0" />
            </Field>
          </div>
        </div>
      </Section>
    </Drawer>
  );
}

/**
 * The rate for each adult count. Manual: typed. Derived: the source's rate,
 * the rule applied, and the result -- with the option to give one adult
 * count its own rule, which is where a single guest discount lives.
 */
function AdultRates({ base, src, form, set, resolver, plan, room, sourceName }) {
  const adults = Array.from({ length: base }, (_, i) => i + 1);

  if (src.manual) {
    const setRule = (n, r) => {
      const next = { ...form.occupancy_rules };
      if (r) next[n] = r;
      else delete next[n];
      set({ occupancy_rules: next });
    };
    return (
      <div>
        <span className="label">Rates per adult *</span>
        <p className="mb-2 text-xs faint">
          Enter the single, and either enter each further adult count or work it out from the single — then changing the single for a date in the Channel Manager moves the others with it.
        </p>
        <div className="overflow-x-auto card" style={{ padding: 0 }}>
          <table className="grid-table">
            <thead>
              <tr>
                <th>Adults</th>
                <th>Rate setup</th>
                <th className="text-right">Rate</th>
              </tr>
            </thead>
            <tbody>
              {adults.map((n) => {
                const rule = form.occupancy_rules[n];
                return (
                  <tr key={n}>
                    <td>{n}</td>
                    <td style={{ minWidth: 260 }}>
                      {n > 1 && (
                        <label className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={Boolean(rule)}
                            onChange={(e) =>
                              setRule(n, e.target.checked ? { method: "offset", value: "", value2: "" } : null)
                            }
                          />
                          Work out from 1 adult
                        </label>
                      )}
                      {rule ? (
                        <div className="mt-2">
                          <RuleEditor compact method={rule.method} value={rule.value} value2={rule.value2} onChange={(r) => setRule(n, r)} />
                        </div>
                      ) : (
                        <input
                          type="number"
                          min="0"
                          className="input mt-1"
                          value={orBlank(form.adult_rates[n])}
                          onChange={(e) => set({ adult_rates: { ...form.adult_rates, [n]: e.target.value } })}
                          aria-label={`Rate for ${n} adult${n === 1 ? "" : "s"}`}
                        />
                      )}
                    </td>
                    <td className="text-right tabular-nums font-semibold">
                      {fmt(resolver.rate(plan.id, room.id, n))}
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

  const setOverride = (n, o) => {
    const next = { ...form.adult_overrides };
    if (o) next[n] = o;
    else delete next[n];
    set({ adult_overrides: next });
  };

  return (
    <div>
      <span className="label">Derived rate per adult</span>
      <p className="mb-2 text-xs faint">
        Each adult count follows {sourceName} for the same number of adults. Give one its own rule — a single guest discount, say — and the others keep the main rule.
      </p>
      <div className="overflow-x-auto card" style={{ padding: 0 }}>
        <table className="grid-table">
          <thead>
            <tr>
              <th>Adults</th>
              <th className="text-right">Source</th>
              <th>Rule</th>
              <th className="text-right">Rate</th>
            </tr>
          </thead>
          <tbody>
            {adults.map((n) => {
              const o = form.adult_overrides[n];
              const from = resolver.rate(src.planId, src.roomId, n);
              return (
                <tr key={n}>
                  <td>{n}</td>
                  <td className="text-right tabular-nums muted">{fmt(from)}</td>
                  <td style={{ minWidth: 240 }}>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={Boolean(o)}
                        onChange={(e) =>
                          setOverride(n, e.target.checked ? { method: src.method || "same", value: src.value ?? "", value2: src.value2 ?? "" } : null)
                        }
                      />
                      {o ? "Own rule" : `Main rule (${describeRule(src.method, src.value, src.value2) || "—"})`}
                    </label>
                    {o && (
                      <div className="mt-2">
                        <RuleEditor compact method={o.method} value={o.value} value2={o.value2} onChange={(r) => setOverride(n, r)} />
                      </div>
                    )}
                  </td>
                  <td className="text-right tabular-nums font-semibold">{fmt(resolver.rate(plan.id, room.id, n))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {resolver.minRateOf(plan.id, room.id) !== null && (
        <p className="mt-1 text-xs faint">Never below the minimum rate of {fmt(resolver.minRateOf(plan.id, room.id))}.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Assign multiple room types                                           */
/* ------------------------------------------------------------------ */

function AssignDrawer({ plan, rooms, onClose, onAssign }) {
  const [picked, setPicked] = useState(() => new Set(rooms.map((r) => r.id)));
  const [busy, setBusy] = useState(false);
  return (
    <Drawer
      title="Assign multiple room types"
      subtitle={`To “${plan.plan_name}”`}
      onCancel={onClose}
      onSave={async () => {
        setBusy(true);
        await onAssign([...picked]);
      }}
      saveLabel={`Assign ${picked.size}`}
      busy={busy || picked.size === 0}
    >
      <Section title="Room types">
        <p className="text-xs faint">
          Each room rate starts by following the plan
          {plan.derive_from_id ? " — derived, so it prices itself at once." : ". The plan is manual, so set each room's per-adult rates from its row afterwards."}
        </p>
        <div className="space-y-2">
          {rooms.map((r) => (
            <label key={r.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={picked.has(r.id)}
                onChange={(e) =>
                  setPicked((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.add(r.id);
                    else n.delete(r.id);
                    return n;
                  })
                }
              />
              {r.room_type_name}
              <span className="text-xs faint">
                {Math.max(1, Number(r.base_adults) || 0)} included · max {r.max_adults || "—"}
              </span>
            </label>
          ))}
        </div>
      </Section>
    </Drawer>
  );
}
