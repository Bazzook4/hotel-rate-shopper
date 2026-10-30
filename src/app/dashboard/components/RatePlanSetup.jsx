"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MEAL_PLANS, planLabel } from "@/lib/mealPlans";
import { isDayUsePlan, validDayUseHours } from "@/lib/dayUse";
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
import { isoDate, sendPlanRates } from "@/lib/cmRates";
import { Grid, Messages, SetupHeader, Toolbar, sendJSON } from "./SetupGrid";
import { confirmDiscardChanges, useDialog } from "../../components/Dialog";
import { SetUpLink } from "../../components/PageNav";
import Icon from "../../components/Icon";
import RowMenu from "../../components/RowMenu";
import { useEscape } from "../../components/useEscape";
import Select from "@/app/components/Select";
import DateField from "@/app/components/DateField";
import { formatAmount } from "@/lib/money";

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
 * row's actions menu, since a room rate holds more than one row can show.
 */

const fmt = (n) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? "-"
    : formatAmount(n);

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
  const dialog = useDialog();
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
    if (plans.length) lines.push(`${plans.length} plan(s) are based on it and will need their own prices.`);
    if (rooms.length) lines.push(`${rooms.length} room rate(s) are based on it and will follow their own plan again.`);
    const yes = await dialog.confirm({
      title: `Delete rate plan "${plan.plan_name}"?`,
      message: lines.join("\n") || null,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!yes) return;
    await run(
      () => sendJSON(`/api/setup/ratePlans?id=${encodeURIComponent(plan.id)}`, "DELETE"),
      `Deleted ${plan.plan_name}.`
    );
  }

  async function deleteRoomRate(planId, roomId) {
    const followers = followersOf(planId, roomId);
    const warning = followers.length
      ? `${followers.length} room rate(s) are based on it: ${followers
          .map((a) => roomRateName(a.rate_plan_id, a.room_type_id))
          .join(", ")}. They will fall back to the room's base price.`
      : "";
    const yes = await dialog.confirm({
      title: `Remove ${roomRateName(planId, roomId)}?`,
      message: warning || null,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!yes) return;
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
        sub="A plan sets the defaults; its room rates follow them until you unlock a field."
      >
        <button type="button" className="btn btn-primary" onClick={() => setDrawer({ kind: "plan" })}>
          <Icon name="plus" size={14} /> Add rate plan
        </button>
      </SetupHeader>

      <Messages error={error} notice={notice} />

      <Toolbar>
        <Select
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
        </Select>
        <input
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value)}
          placeholder="Filter rate plans..."
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
                        <Icon name={open ? "down" : "right"} size={14} />
                      </button>
                      <button
                        type="button"
                        className="flex-1 text-left font-semibold"
                        onClick={() => setDrawer({ kind: "plan", plan })}
                      >
                        {plan.plan_name}
                      </button>
                      {isDayUsePlan(plan) && (
                        <span className="chip" title="Sells some hours of one day, not a night">
                          Day use {plan.day_use_hours}h
                        </span>
                      )}
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
                         , {describeRule(plan.derive_method, plan.derive_value, plan.derive_value_2)}
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
                              Follows plan, {roomRateName(src.planId, src.roomId)}
                            </span>
                          ) : (
                            <span>
                              From <strong>{roomRateName(src.planId, src.roomId)}</strong>{" "}
                              <span className="muted">, {describeRule(src.method, src.value, src.value2)}</span>
                            </span>
                          )}
                          {src.manual && Object.keys(a?.occupancy_rules || {}).length > 0 && (
                            <span className="ml-2 chip chip-off" title="Adult counts worked out from the single rate">
                              {Object.entries(a.occupancy_rules)
                                .map(([n, r]) => `${n}A = 1A ${describeRule(r.method, r.value, r.value2)}`)
                                .join(", ")}
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
                              className="btn btn-secondary text-xs"
                              style={{ color: "var(--warn)" }}
                              title="No per-adult rates yet, so this room is not sold on this plan"
                              onClick={() => setDrawer({ kind: "room", plan, room })}
                            >
                              Set rates
                            </button>
                          ) : (
                            <span>
                              {Object.entries(rates)
                                .filter(([n]) => Number(n) <= base)
                                .map(([n, v]) => `${n}A ${fmt(v)}`)
                                .join(", ")}
                              {max > base && !blank(a?.extra_adult_rate) && (
                                <span className="muted">, +{fmt(a.extra_adult_rate)}/extra</span>
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
                        No room types assigned. Use the row menu &gt; Assign room type to start selling this plan.
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
      {label} {blank(v) ? "-" : v}
    </span>
  );
  return (
    <span className="text-xs whitespace-nowrap">
      {part("Min", min, own.min)}, {part("Max", max, own.max)}, {part("Rel", release, own.release)}
      {stopSell && (
        <span className="ml-2 chip chip-warn" style={own.stopSell ? { fontWeight: 700 } : undefined}>
          Stop sell
        </span>
      )}
    </span>
  );
}


/* ------------------------------------------------------------------ */
/* Drawer and its fields                                                */
/* ------------------------------------------------------------------ */

/**
 * The right-hand panel every record opens in. Without `onSave` it only
 * shows (a record's ledger, a grid with its own Save) and its button reads
 * Close. `extraActions` sit before Cancel, `tabs` under the title, and
 * `width` widens it for a record with tables in it. `onEscape` is what
 * Escape does when it is not the Cancel button's job (a wizard's Back).
 */
export function Drawer({
  title,
  subtitle,
  onCancel,
  onSave,
  saveLabel = "Save",
  busyLabel = "Saving...",
  cancelLabel,
  saveDisabled = false,
  busy,
  error,
  extraActions = null,
  tabs = null,
  width = 620,
  onEscape = null,
  children,
}) {
  // Closing mid-save would drop the request's outcome on the floor.
  const cancel = () => {
    if (!busy) onCancel();
  };
  useEscape(() => {
    if (!busy) (onEscape || onCancel)();
  });

  // Focus moves into the panel when it opens, and back to whatever opened
  // it when it closes, so a keyboard user keeps their place in the list.
  const panel = useRef(null);
  useEffect(() => {
    const before = document.activeElement;
    const el = panel.current;
    if (el && !el.contains(document.activeElement)) {
      const first = el.querySelector("[autofocus], input:not([type=hidden]):not([disabled]), select, textarea, [role=tab]");
      (first || el).focus({ preventScroll: true });
    }
    return () => {
      if (before && document.contains(before)) before.focus?.({ preventScroll: true });
    };
  }, []);

  // A form, so Enter in any field presses the main button; a plain panel
  // when there is nothing to save, so Enter in a grid inside does nothing.
  const Body = onSave ? "form" : "div";
  const bodyProps = onSave
    ? {
        onSubmit: (e) => {
          e.preventDefault();
          if (!busy && !saveDisabled) onSave();
        },
      }
    : {};

  return (
    <div className="side-panel-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" onClick={cancel} className="flex-1" style={{ background: "transparent" }} />
      <Body
        ref={panel}
        tabIndex={-1}
        className="side-panel flex flex-col"
        style={{ maxWidth: width, overflow: "hidden" }}
        {...bodyProps}
      >
        <div
          className="flex flex-wrap items-start justify-between gap-3 px-5 py-4"
          style={{ borderBottom: tabs ? undefined : "1px solid var(--border)" }}
        >
          <div className="min-w-0">
            <h3 className="h2">{title}</h3>
            {subtitle && <p className="sub truncate">{subtitle}</p>}
          </div>
          <div className="flex flex-shrink-0 flex-wrap gap-2">
            {extraActions}
            <button type="button" className="btn btn-secondary" onClick={cancel} disabled={busy}>
              {cancelLabel || (onSave ? "Cancel" : "Close")}
            </button>
            {onSave && (
              <button type="submit" className="btn btn-primary" disabled={busy || saveDisabled}>
                {busy ? busyLabel : saveLabel}
              </button>
            )}
          </div>
        </div>
        {tabs && (
          <div className="px-5 pb-3" style={{ borderBottom: "1px solid var(--border)" }}>
            {tabs}
          </div>
        )}
        {error && (
          <div role="alert" className="px-5 py-2 text-sm" style={{ color: "var(--danger)", background: "var(--danger-soft)" }}>
            {error}
          </div>
        )}
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">{children}</div>
      </Body>
    </div>
  );
}

export function Section({ title, children }) {
  return (
    <section className="space-y-3" style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
      <h4 className="text-xs font-semibold uppercase tracking-wide muted">{title}</h4>
      {children}
    </section>
  );
}

export function Field({ label, hint, children }) {
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
          title={locked ? "Following the rate plan. Unlock to set this room's own value" : "Lock to follow the rate plan again"}
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
      <Select
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
      </Select>
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
      <Select
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
      </Select>
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
    sells: isDayUsePlan(plan) ? "day_use" : "nights",
    day_use_hours: orBlank(plan?.day_use_hours),
    min_stay: orBlank(plan?.min_stay),
    max_stay: orBlank(plan?.max_stay),
    release_period: orBlank(plan?.release_period),
    stop_sell: Boolean(plan?.stop_sell),
    min_rate: orBlank(plan?.min_rate),
    // The first plan is the main plan: room base prices are read from it.
    is_master: plan ? Boolean(plan.is_master) : !ratePlans.some((p) => p.is_master),
    derive_from_id: plan?.derive_from_id ?? "",
    derive_method: plan?.derive_method ?? "",
    derive_value: orBlank(plan?.derive_value),
    derive_value_2: orBlank(plan?.derive_value_2),
  }));
  // A new plan sells in every room unless some are unticked.
  const [newRooms, setNewRooms] = useState(() => new Set(plan ? [] : roomTypes.map((r) => r.id)));
  // Once a new plan is created the drawer walks on to its rates, then to
  // sending them: { id, name, roomIds, step: "rates" | "send" }.
  const [created, setCreated] = useState(null);
  // Set as soon as a new plan is stored, so a retry after a room fails to
  // save updates that plan instead of creating a second one.
  const [newId, setNewId] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  // A day-use plan sells hours of one day, so stay lengths in nights mean
  // nothing on it.
  const dayUse = form.sells === "day_use";

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
    if (dayUse && !validDayUseHours(form.day_use_hours)) return "Day-use hours are a whole number from 1 to 23.";
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
      day_use_hours: dayUse ? Number(form.day_use_hours) : null,
      stop_sell: form.stop_sell,
      min_stay: dayUse ? null : numOrNull(form.min_stay),
      max_stay: dayUse ? null : numOrNull(form.max_stay),
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
        let id = newId;
        if (id) {
          await sendJSON("/api/setup/ratePlans", "PATCH", { id, property_id: propertyId || undefined, ...body });
        } else {
          const json = await sendJSON("/api/setup/ratePlans", "POST", {
            ...body,
            property_id: propertyId || undefined,
          });
          id = json?.ratePlan?.id;
          setNewId(id);
        }
        for (const roomId of newRooms) {
          await saveRoomRate({ rate_plan_id: id, room_type_id: roomId });
        }
        if (newRooms.size === 0) {
          await onSaved(`Added ${body.plan_name}. Assign room types to start selling it.`);
        } else {
          // A plan based on another already has its rates, shown on step 1.
          setCreated({ id, name: body.plan_name, roomIds: [...newRooms], derived, step: derived ? "send" : "rates" });
        }
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

  if (created) {
    const steps = created.derived ? 2 : 3;
    const later = (msg) => onSaved(`Added ${created.name}. ${msg}`);
    return created.step === "rates" ? (
      <PlanRatesStep
        plan={created}
        rooms={roomTypes.filter((r) => created.roomIds.includes(r.id))}
        subtitle={`${created.name}, step 2 of ${steps}: rates`}
        saveRoomRate={saveRoomRate}
        onLater={() => later("Set its rates from each room's row.")}
        onDone={() => setCreated((c) => ({ ...c, step: "send" }))}
      />
    ) : (
      <PlanSendStep
        plan={created}
        propertyId={propertyId}
        subtitle={`${created.name}, step ${steps} of ${steps}: send to channels`}
        onLater={() => later("Send its rates later with Resync in the Channel Manager.")}
        onSent={(days) => onSaved(`Added ${created.name} and sent its rates for ${days} days to channels.`)}
      />
    );
  }

  return (
    <Drawer
      title={isNew ? "Add rate plan" : "Edit rate plan"}
      subtitle={isNew ? null : plan.plan_name}
      onCancel={onClose}
      onSave={save}
      saveLabel={isNew && !derived && newRooms.size > 0 ? "Next: rates" : isNew ? "Create" : "Save"}
      busy={busy}
      error={error}
    >
      <Section title="General information">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Field label="Rate plan name *">
              <input className="input" value={form.plan_name} onChange={(e) => set({ plan_name: e.target.value })} placeholder="Dinner Bed & Breakfast" autoFocus={isNew} />
            </Field>
          </div>
          <Field label="Sells" hint={dayUse ? "Hours from check-in. The room goes back on sale when the guest checks out." : null}>
            <Select
              className="input"
              value={form.sells}
              onChange={(e) =>
                set({
                  sells: e.target.value,
                  day_use_hours: e.target.value === "day_use" && blank(form.day_use_hours) ? 6 : form.day_use_hours,
                })
              }
            >
              <option value="nights">Nights</option>
              <option value="day_use">Day use (hours)</option>
            </Select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {dayUse && (
            <Field label="Hours *">
              <input
                type="number"
                min="1"
                max="23"
                className="input"
                value={form.day_use_hours}
                onChange={(e) => set({ day_use_hours: e.target.value })}
              />
            </Field>
          )}
          <Field label="Inclusions (meal plan)">
            <Select className="input" value={form.meal_plan} onChange={(e) => set({ meal_plan: e.target.value })}>
              {MEAL_PLANS.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.code}: {m.hint}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Terms">
            <Select className="input" value={form.refundable ? "ref" : "nr"} onChange={(e) => set({ refundable: e.target.value === "ref" })}>
              <option value="ref">Refundable</option>
              <option value="nr">Non-refundable</option>
            </Select>
          </Field>
        </div>
        <Field label="Description">
          <input className="input" value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="Notes for staff. Guests never see this." />
        </Field>
      </Section>

      <Section title="Pricing details">
        <div className="flex flex-wrap items-center gap-3">
          <div className="seg" role="group" aria-label="How the rates are set">
            <button type="button" className={!derived ? "seg-on" : ""} aria-pressed={!derived} onClick={() => set({ derive_from_id: "" })}>
              Enter rates
            </button>
            <button
              type="button"
              className={derived ? "seg-on" : ""}
              aria-pressed={derived}
              disabled={masters.length === 0}
              title={masters.length === 0 ? "Needs another rate plan to base it on" : undefined}
              onClick={() => set({ derive_from_id: masters[0]?.id || "", is_master: false })}
            >
              Based on a plan
            </button>
          </div>
          {!derived && (
            <label className="flex items-center gap-2 text-sm muted">
              <input type="checkbox" checked={form.is_master} onChange={(e) => set({ is_master: e.target.checked })} />
              Main plan (other plans can be based on it)
            </label>
          )}
        </div>

        {/* Minimum rate only floors rates worked out from another plan, so it
            sits with those settings; a manual plan with one keeps it shown. */}
        {!derived && !blank(form.min_rate) && (
          <Field label="Minimum rate" hint="Rooms on this plan that are based on another plan never go below this.">
            <input type="number" min="0" className="input" value={form.min_rate} onChange={(e) => set({ min_rate: e.target.value })} placeholder="None" style={{ maxWidth: 220 }} />
          </Field>
        )}

        {derived && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Based on *">
                  <Select className="input" value={form.derive_from_id} onChange={(e) => set({ derive_from_id: e.target.value })}>
                    {masters.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.plan_name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Minimum rate">
                  <input type="number" min="0" className="input" value={form.min_rate} onChange={(e) => set({ min_rate: e.target.value })} placeholder="None" />
                </Field>
              </div>
              <RuleEditor
                method={form.derive_method}
                value={form.derive_value}
                value2={form.derive_value_2}
                onChange={(r) => set({ derive_method: r.method, derive_value: r.value, derive_value_2: r.value2 })}
              />
              <p className="text-xs faint">Each room follows the same room and adult count on the plan it is based on. Rates never go below the minimum.</p>
            </div>
        )}

        {isNew && roomTypes.length > 0 && (
          <div>
            <span className="label">Sell in these room types</span>
            <div className="grid gap-1 grid-cols-2 sm:grid-cols-3">
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

      <Section title="Restrictions">
        <p className="text-xs faint">
          Defaults for every room on this plan; a room can unlock and change any of them. Release is the days before arrival the plan closes.
        </p>
        <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4">
          {!dayUse && (
            <>
              <Field label="Min stay">
                <input type="number" min="1" className="input" value={form.min_stay} onChange={(e) => set({ min_stay: e.target.value })} placeholder="None" />
              </Field>
              <Field label="Max stay">
                <input type="number" min="1" className="input" value={form.max_stay} onChange={(e) => set({ max_stay: e.target.value })} placeholder="None" />
              </Field>
            </>
          )}
          <Field label="Release (days)">
            <input type="number" min="0" className="input" value={form.release_period} onChange={(e) => set({ release_period: e.target.value })} placeholder="None" />
          </Field>
          <label className="flex h-[38px] items-center gap-2 text-sm">
            <input type="checkbox" checked={form.stop_sell} onChange={(e) => set({ stop_sell: e.target.checked })} />
            Stop sell
          </label>
        </div>
      </Section>
    </Drawer>
  );
}

/**
 * Step 2 of a new plan: each room's rates, typed once here rather than room
 * by room afterwards. Adults up to the room's base adults are priced one by
 * one; each adult above that pays the extra adult rate.
 */
function PlanRatesStep({ plan, rooms, subtitle, saveRoomRate, onLater, onDone }) {
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const baseOf = (r) => Math.max(1, Number(r.base_adults) || 0);
  const hasExtra = (r) => (Number(r.max_adults) || 0) > baseOf(r);
  const widest = Math.max(1, ...rooms.map(baseOf));
  const [rates, setRates] = useState(() =>
    Object.fromEntries(rooms.map((r) => [r.id, { adults: {}, extra_adult_rate: "", extra_child_rate: "" }]))
  );
  const setRoom = (id, patch) => setRates((all) => ({ ...all, [id]: { ...all[id], ...patch } }));

  function problem() {
    for (const r of rooms) {
      const row = rates[r.id];
      for (let n = 1; n <= baseOf(r); n++) {
        const v = row.adults[n];
        const who = `${n} adult${n === 1 ? "" : "s"} in ${r.room_type_name}`;
        if (blank(v)) return `Enter the rate for ${who}.`;
        // A 0 would be sent to the OTAs as a free room.
        if (!(Number(v) > 0)) return `The rate for ${who} must be more than 0.`;
      }
      if ([row.extra_adult_rate, row.extra_child_rate].some((v) => !blank(v) && !(Number(v) >= 0))) {
        return `Extra adult and extra child rates in ${r.room_type_name} must be zero or more.`;
      }
    }
    return "";
  }

  async function save() {
    const p = problem();
    if (p) return setError(p);
    setBusy(true);
    setError("");
    try {
      for (const r of rooms) {
        const row = rates[r.id];
        await saveRoomRate({
          rate_plan_id: plan.id,
          room_type_id: r.id,
          adult_rates: Object.fromEntries(
            Object.entries(row.adults).filter(([n, v]) => Number(n) <= baseOf(r) && !blank(v)).map(([n, v]) => [n, Number(v)])
          ),
          extra_adult_rate: hasExtra(r) ? numOrNull(row.extra_adult_rate) : null,
          extra_child_rate: numOrNull(row.extra_child_rate),
        });
      }
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const cell = { width: 80, padding: "4px 6px" };
  const head = { padding: "0.55rem 0.5rem", whiteSpace: "normal" };
  const typed = rooms.some((r) => {
    const row = rates[r.id];
    return [...Object.values(row.adults), row.extra_adult_rate, row.extra_child_rate].some((v) => !blank(v));
  });

  async function skip() {
    if (typed) {
      const yes = await dialog.confirm({
        title: "Discard the rates you typed?",
        message: "The plan is kept. You can set its rates later from each room's row.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
      });
      if (!yes) return;
    }
    onLater();
  }

  return (
    <Drawer
      title="Add rate plan"
      subtitle={subtitle}
      onCancel={skip}
      cancelLabel="Set later"
      onSave={save}
      saveLabel="Next: send"
      busy={busy}
      error={error}
    >
      <p className="text-sm muted">
        Rate per night. Each adult above a room&apos;s base adults pays the extra adult rate.
      </p>
      <div className="overflow-x-auto card" style={{ padding: 0 }}>
        <table className="grid-table">
          <thead>
            <tr>
              <th className="cm-sticky" style={head}>Room</th>
              {Array.from({ length: widest }, (_, i) => (
                <th key={i} className="text-right" style={head}>
                  {i + 1} adult{i ? "s" : ""}
                </th>
              ))}
              <th className="text-right" style={head}>Extra adult</th>
              <th className="text-right" style={head}>Extra child</th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((r, ri) => {
              const row = rates[r.id];
              const input = (value, onChange, label, autoFocus = false) => (
                <input
                  type="number"
                  min="0"
                  inputMode="decimal"
                  className="input text-right"
                  aria-label={`${r.room_type_name} ${label}`}
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  autoFocus={autoFocus}
                />
              );
              return (
                <tr key={r.id}>
                  <td className="cm-sticky">{r.room_type_name}</td>
                  {Array.from({ length: widest }, (_, i) => (
                    <td key={i} style={cell}>
                      {i + 1 <= baseOf(r) ? (
                        input(
                          row.adults[i + 1] ?? "",
                          (v) => setRoom(r.id, { adults: { ...row.adults, [i + 1]: v } }),
                          `${i + 1} adult rate`,
                          ri === 0 && i === 0
                        )
                      ) : (
                        <span className="faint">-</span>
                      )}
                    </td>
                  ))}
                  <td style={cell}>
                    {hasExtra(r) ? (
                      input(row.extra_adult_rate, (v) => setRoom(r.id, { extra_adult_rate: v }), "extra adult rate")
                    ) : (
                      <span className="faint">-</span>
                    )}
                  </td>
                  <td style={cell}>{input(row.extra_child_rate, (v) => setRoom(r.id, { extra_child_rate: v }), "extra child rate")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Drawer>
  );
}

/** The longest span a new plan's rates are sent for in one go. */
const SEND_MAX_DAYS = 366;

/**
 * Last step of a new plan: send its rates to the channels, since saving a
 * plan stores its rates but the OTAs only know what they are sent. Goes out
 * exactly as a Channel Manager resync of this plan would.
 */
function PlanSendStep({ plan, propertyId, subtitle, onLater, onSent }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const today = isoDate(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 364);
    return isoDate(d);
  });
  const days = from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1 : 0;
  const lastDay = from ? isoDate(new Date(Date.parse(from) + (SEND_MAX_DAYS - 1) * 86400000)) : undefined;

  async function send() {
    if (!(days >= 1)) return setError("The end date is before the start date.");
    if (days > SEND_MAX_DAYS) return setError(`Send at most ${SEND_MAX_DAYS} days at a time.`);
    setBusy(true);
    setError("");
    try {
      const count = await sendPlanRates({ planId: plan.id, from, to, propertyId });
      if (count === 0) {
        setError("This plan has no rates to send yet. Set its rates first, or send them later.");
        setBusy(false);
        return;
      }
      onSent(days);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Drawer
      title="Add rate plan"
      subtitle={subtitle}
      onCancel={onLater}
      cancelLabel="Send later"
      onSave={send}
      busyLabel="Sending..."
      saveLabel={days >= 1 ? `Send ${days} day${days === 1 ? "" : "s"}` : "Send"}
      busy={busy}
      error={error}
    >
      <p className="text-sm muted">
        {plan.derived
          ? "The plan's rates are worked out from the plan it is based on."
          : "The plan's rates are saved."}{" "}
        The channels only sell it once its rates are sent.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From">
          <DateField className="input" value={from} min={today} onChange={(e) => setFrom(e.target.value)} autoFocus />
        </Field>
        <Field label="To">
          <DateField className="input" value={to} min={from} max={lastDay} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
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
  // What the drawer opened with, so leaving for Rooms asks only after a change.
  const opened = useRef(form);
  const dialog = useDialog();
  const leaveForRooms = () =>
    JSON.stringify(form) === JSON.stringify(opened.current) || confirmDiscardChanges(dialog, "this room rate");

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
    ? `Based on ${roomName(room.id)} / ${planName(plan.derive_from_id)}, ${describeRule(plan.derive_method, plan.derive_value, plan.derive_value_2)}`
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
      subtitle={`${room.room_type_name}, assigned to "${plan.plan_name}"`}
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
          <Field label="Included occupancy" hint="Adults priced individually. Set on the room type.">
            <div className="input" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>{base}</div>
          </Field>
          <Field label="Maximum occupancy" hint="Set on the room type.">
            <div className="input" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>{maxAdults}</div>
          </Field>
        </div>
        <p className="mt-2 text-xs faint">
          <SetUpLink page="rooms" confirm={leaveForRooms}>
            Change on Rooms
          </SetUpLink>
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
              Base the rates on another room rate
            </label>
            {form.rate_mode === "derived" && (
              <div className="space-y-3 pl-6">
                <Field label="Based on *">
                  <Select
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
                  </Select>
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
          Inclusions come from the plan: {plan.meal_plan || "-"}: {MEAL_PLANS.find((m) => m.code === plan.meal_plan)?.hint || "not set"}.
        </p>
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
          Enter the single, and either enter each further adult count or work it out from the single. Then changing the single for a date in the Channel Manager moves the others with it.
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
      <span className="label">Rate per adult, from the one it is based on</span>
      <p className="mb-2 text-xs faint">
        Each adult count follows {sourceName} for the same number of adults. Give one its own rule (a single guest discount, say) and the others keep the main rule.
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
                      {o ? "Own rule" : `Main rule (${describeRule(src.method, src.value, src.value2) || "-"})`}
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
      subtitle={`To "${plan.plan_name}"`}
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
          {plan.derive_from_id ? ". It is derived, so it prices itself at once." : ". The plan is manual, so set each room's per-adult rates from its row afterwards."}
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
                {Math.max(1, Number(r.base_adults) || 0)} included, max {r.max_adults || "-"}
              </span>
            </label>
          ))}
        </div>
      </Section>
    </Drawer>
  );
}
