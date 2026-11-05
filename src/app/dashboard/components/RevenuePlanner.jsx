"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../../components/Icon";
import Select from "@/app/components/Select";
import { useDialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import { useBackdropClose, useEscape } from "@/app/components/useEscape";
import { Empty, PageHeader, Section, Stats, TableFrame, useReport } from "./reportKit";
import { sendJSON } from "./SetupGrid";
import { hotelToday } from "@/lib/hotelTime";
import { formatAmount, formatMoney, hotelCurrency } from "@/lib/money";
import { SEGMENTS, derive, nightsAvailable, solveGoal, splitSegments } from "@/lib/revenuePlanMath";

/**
 * Revenue Planner: what the hotel aims for each month, against what it got.
 *
 * Per month the hotel sets occupancy, one overall ADR and the revenue they
 * make (change any one and the others follow), then says what share of the
 * room nights should come from OTA, Direct, Corporate and so on, each with
 * its own rate if it differs. Room nights and RevPAR are worked out.
 * Admins only.
 */

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const monthName = (key) => `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const money = (v) => (v == null ? "-" : formatMoney(v, { currency: hotelCurrency() }));
const pct = (v) => (v == null ? "-" : `${formatAmount(v, { decimals: 1 })}%`);
const count = (v) => (v == null ? "-" : formatAmount(v));
const text = (v) => (v == null || v === "" ? "" : String(v));
const numberOrNull = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v));

/** How far achieved is from goal, as a short word and a colour. */
function against(actual, goal) {
  if (actual == null || !goal) return { label: "-", tone: null };
  const p = Math.round((actual / goal) * 100);
  return { label: `${p}%`, tone: p >= 100 ? "success" : p >= 85 ? "warning" : "danger" };
}

// ------------------------------------------------------------------
// The page
// ------------------------------------------------------------------

export default function RevenuePlanner({ session }) {
  const propertyId = session?.propertyId || null;
  const toast = useToast();
  const dialog = useDialog();
  const today = hotelToday();
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const { report, loading, error, reload } = useReport("/api/revplan", { year: String(year) }, propertyId);
  const [open, setOpen] = useState(null);

  const rows = useMemo(() => {
    if (!report) return [];
    return report.months.map((m) => {
      const goal = report.goals[m.month] || null;
      const available = nightsAvailable(report.capacity, m.days);
      return {
        ...m,
        available,
        goal,
        plan: goal ? derive(goal, available) : null,
        actual: report.actuals[m.month] || null,
      };
    });
  }, [report]);

  const totals = useMemo(() => {
    const t = { available: 0, goalNights: 0, goalRevenue: 0, actualNights: 0, actualRevenue: 0, planned: 0 };
    for (const r of rows) {
      t.available += r.available;
      if (r.plan?.roomNights != null && r.goal?.revenue != null) {
        t.planned += 1;
        t.goalNights += r.plan.roomNights;
        t.goalRevenue += r.goal.revenue;
        t.actualNights += r.actual?.roomNights || 0;
        t.actualRevenue += r.actual?.revenue || 0;
      }
    }
    return t;
  }, [rows]);

  const yearOptions = [thisYear - 1, thisYear, thisYear + 1, thisYear + 2];

  async function save(goals, message) {
    await sendJSON("/api/revplan", "PUT", { propertyId, goals });
    toast(message);
    reload();
  }

  async function copyToAll(form, fromMonth) {
    const yes = await dialog.confirm({
      title: `Use this plan for every month of ${year}?`,
      message: "Occupancy, rate and business mix are copied to all 12 months. Each month's revenue is worked out from its own days. Goals already set will be replaced.",
      confirmLabel: "Copy to all months",
    });
    if (!yes) return false;
    const goals = report.months.map((m) => {
      const solved = solveGoal({ occupancy: form.occupancy, adr: form.adr }, "occupancy", nightsAvailable(report.capacity, m.days));
      return { month: m.month, occupancy: solved.occupancy, adr: solved.adr, revenue: solved.revenue, segments: form.segments };
    });
    await save(goals, `Copied from ${monthName(fromMonth)} to all months.`);
    return true;
  }

  if (!propertyId) return <Empty>Choose a hotel first.</Empty>;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Revenue Planner"
        blurb="Set what you want each month: how full, at what rate, and where the bookings come from. See how you are doing against it."
        actions={
          <Select className="input" style={{ width: "auto" }} value={String(year)} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        }
      />

      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
      {report?.needsMigration && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          Goals cannot be saved yet. The planner needs a one-time update to the database.
        </p>
      )}
      {report && report.capacity === 0 && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Add your rooms in Rooms first. Goals are worked out from how many rooms you have.
        </p>
      )}

      {report && (
        <Stats
          items={[
            { label: `${year} room nights goal`, value: totals.planned ? count(totals.goalNights) : "-", hint: "Added up over the months with a goal" },
            { label: "Room nights so far", value: totals.planned ? count(totals.actualNights) : "-" },
            { label: `${year} revenue goal`, value: totals.planned ? money(totals.goalRevenue) : "-" },
            { label: "Revenue so far", value: totals.planned ? money(totals.actualRevenue) : "-", tone: totals.planned ? against(totals.actualRevenue, totals.goalRevenue).tone : null },
            { label: "Goal ADR", value: totals.goalNights ? money(totals.goalRevenue / totals.goalNights) : "-" },
            { label: "Goal RevPAR", value: totals.planned && totals.available ? money(totals.goalRevenue / totals.available) : "-", hint: "Revenue for each room you have, sold or not" },
          ]}
        />
      )}

      <Section title={`Month by month, ${year}`} sub="Open a month to set its goal.">
        {loading && !report ? (
          <Empty>Loading...</Empty>
        ) : (
          <TableFrame>
            <table className="grid-table w-full text-sm">
              <thead>
                <tr>
                  <th rowSpan={2}>Month</th>
                  <th colSpan={4} className="text-center">Goal</th>
                  <th colSpan={4} className="text-center">Achieved</th>
                  <th rowSpan={2} className="text-right">Of goal</th>
                  <th rowSpan={2} />
                </tr>
                <tr>
                  <th className="text-right">Occ.</th>
                  <th className="text-right">ADR</th>
                  <th className="text-right">Revenue</th>
                  <th className="text-right">RevPAR</th>
                  <th className="text-right">Occ.</th>
                  <th className="text-right">ADR</th>
                  <th className="text-right">Revenue</th>
                  <th className="text-right">RevPAR</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const g = r.goal;
                  const a = r.actual;
                  const started = r.start <= today;
                  const of = against(started ? a?.revenue : null, g?.revenue);
                  return (
                    <tr key={r.month}>
                      <td className="font-medium">{monthName(r.month)}</td>
                      <td className="text-right tabular-nums">{pct(g?.occupancy)}</td>
                      <td className="text-right tabular-nums">{money(g?.adr)}</td>
                      <td className="text-right tabular-nums">{money(g?.revenue)}</td>
                      <td className="text-right tabular-nums">{money(r.plan?.revpar)}</td>
                      <td className="text-right tabular-nums">{started ? pct(a?.occupancy) : "-"}</td>
                      <td className="text-right tabular-nums">{started ? money(a?.adr) : "-"}</td>
                      <td className="text-right tabular-nums">{started ? money(a?.revenue) : "-"}</td>
                      <td className="text-right tabular-nums">{started ? money(a?.revpar) : "-"}</td>
                      <td className="text-right tabular-nums" style={{ color: of.tone ? `var(--${of.tone})` : undefined }}>
                        {of.label}
                      </td>
                      <td className="text-right">
                        <button type="button" className="btn btn-secondary text-xs" onClick={() => setOpen(r)} disabled={report.capacity === 0}>
                          {g ? "Edit" : "Set goal"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableFrame>
        )}
      </Section>

      <Pace rows={rows} today={today} />

      {open && (
        <GoalPanel
          month={open}
          capacity={report.capacity}
          onClose={() => setOpen(null)}
          onSave={async (goal) => {
            await save([{ month: open.month, ...goal }], `Saved the goal for ${monthName(open.month)}.`);
            setOpen(null);
          }}
          onCopyAll={async (form) => {
            if (await copyToAll(form, open.month)) setOpen(null);
          }}
        />
      )}
    </div>
  );
}

/** What this month still needs, if it has a goal and has started. */
function Pace({ rows, today }) {
  const row = rows.find((r) => r.start <= today && today <= r.end);
  if (!row?.goal || row.plan?.roomNights == null) return null;
  const sold = row.actual?.roomNights || 0;
  const earned = row.actual?.revenue || 0;
  const left = Math.max(0, row.days - Number(today.slice(8, 10)) + 1);
  const needNights = Math.max(0, row.plan.roomNights - sold);
  const needRevenue = Math.max(0, (row.goal.revenue || 0) - earned);
  return (
    <Section title={`${monthName(row.month)}: what you still need`}>
      {needNights === 0 && needRevenue === 0 ? (
        <p className="text-sm" style={{ color: "var(--success)" }}>
          You have reached this month's goal.
        </p>
      ) : (
        <p className="text-sm" style={{ color: "var(--text)" }}>
          {left} {left === 1 ? "day is" : "days are"} left. You need {count(needNights)} more room nights
          {left > 0 ? ` (about ${formatAmount(needNights / left, { decimals: 1 })} a day)` : ""} and {money(needRevenue)} more
          {needNights > 0 ? `, which is ${money(needRevenue / needNights)} a night` : ""}.
        </p>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------
// The goal panel
// ------------------------------------------------------------------

function startForm(month, capacity, goal) {
  const available = nightsAvailable(capacity, month.days);
  const solved = goal
    ? solveGoal({ occupancy: goal.occupancy, adr: goal.adr, revenue: goal.revenue }, "occupancy", available)
    : { occupancy: null, adr: null, revenue: null };
  return {
    occupancy: text(solved.occupancy),
    adr: text(solved.adr),
    revenue: text(goal?.revenue ?? solved.revenue),
    segments: SEGMENTS.map((s) => {
      const own = (goal?.segments || []).find((x) => x.key === s.key) || {};
      return { key: s.key, share: text(own.share), adr: text(own.adr) };
    }),
  };
}

function GoalPanel({ month, capacity, onClose, onSave, onCopyAll }) {
  const dialog = useDialog();
  const toast = useToast();
  const available = nightsAvailable(capacity, month.days);
  const initial = useMemo(() => startForm(month, capacity, month.goal), [month, capacity]);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const firstRef = useRef(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  useEffect(() => firstRef.current?.focus(), []);

  async function close() {
    if (busy) return;
    if (dirty) {
      const yes = await dialog.confirm({
        title: "Leave without saving?",
        message: "What you changed here will be lost.",
        confirmLabel: "Leave",
        cancelLabel: "Keep editing",
        danger: true,
      });
      if (!yes) return;
    }
    onClose();
  }
  useEscape(close);
  const backdrop = useBackdropClose(close);

  /** Change one of the three goal figures; the other two follow. */
  function setGoal(field, value) {
    setForm((f) => {
      const next = { ...f, [field]: value };
      const solved = solveGoal({ occupancy: next.occupancy, adr: next.adr, revenue: next.revenue }, field, available);
      if (field === "revenue") next.occupancy = text(solved.occupancy);
      else next.revenue = text(solved.revenue);
      return next;
    });
  }

  function setSegment(key, patch) {
    setForm((f) => ({ ...f, segments: f.segments.map((s) => (s.key === key ? { ...s, ...patch } : s)) }));
  }

  const goal = { occupancy: numberOrNull(form.occupancy), adr: numberOrNull(form.adr), revenue: numberOrNull(form.revenue) };
  const plan = derive(goal, available);
  const mix = splitSegments(
    form.segments.map((s) => ({ key: s.key, share: numberOrNull(s.share), adr: numberOrNull(s.adr) })),
    plan.roomNights,
    goal.adr
  );
  const actual = month.actual;
  const mixOver = mix.totalShare > 100.01;
  const adrGap = mix.weightedAdr != null && goal.adr ? Math.abs(mix.weightedAdr - goal.adr) / goal.adr > 0.01 : false;

  async function submit(e) {
    e.preventDefault();
    if (mixOver) {
      toast("The business mix adds up to more than 100%.", { tone: "error" });
      return;
    }
    setBusy(true);
    try {
      await onSave({ ...goal, segments: form.segments.map((s) => ({ key: s.key, share: numberOrNull(s.share), adr: numberOrNull(s.adr) })) });
    } catch (err) {
      toast(err.message, { tone: "error" });
      setBusy(false);
    }
  }

  async function copyAll() {
    setBusy(true);
    try {
      await onCopyAll({ ...form, segments: form.segments.map((s) => ({ key: s.key, share: numberOrNull(s.share), adr: numberOrNull(s.adr) })) });
    } catch (err) {
      toast(err.message, { tone: "error" });
    }
    setBusy(false);
  }

  const title = `Goal for ${monthName(month.month)}`;

  return (
    <div className="side-panel-backdrop" role="dialog" aria-modal="true" aria-label={title} {...backdrop}>
      <form className="side-panel flex flex-col" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()} onSubmit={submit} noValidate>
        <div
          className="side-panel-head flex items-center justify-between gap-3"
          style={{ padding: "0.85rem 1.1rem", background: "var(--accent-strong)", color: "#fff", fontWeight: 600, fontSize: "0.9rem" }}
        >
          <h3>{title}</h3>
          <button type="button" className="head-close" onClick={close} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="card-pad flex-1 space-y-5">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            You have {count(capacity)} rooms and {month.days} days: {count(available)} room nights to sell. Change any one of
            occupancy, ADR or revenue and the others follow.
          </p>

          <div className="grid grid-cols-3 gap-3">
            <label className="space-y-1.5">
              <span className="label">Occupancy %</span>
              <input ref={firstRef} className="input" inputMode="decimal" value={form.occupancy} onChange={(e) => setGoal("occupancy", e.target.value)} placeholder="70" />
            </label>
            <label className="space-y-1.5">
              <span className="label">ADR (overall)</span>
              <input className="input" inputMode="decimal" value={form.adr} onChange={(e) => setGoal("adr", e.target.value)} placeholder="3000" />
            </label>
            <label className="space-y-1.5">
              <span className="label">Room revenue</span>
              <input className="input" inputMode="decimal" value={form.revenue} onChange={(e) => setGoal("revenue", e.target.value)} placeholder="600000" />
            </label>
          </div>

          <div className="grid grid-cols-3 gap-3 text-sm">
            <Figure label="Room nights" value={count(plan.roomNights)} />
            <Figure label="RevPAR" value={money(plan.revpar)} />
            <Figure label="Achieved so far" value={actual ? `${count(actual.roomNights)} nights, ${money(actual.revenue)}` : "-"} />
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              Where the bookings should come from
            </h4>
            <TableFrame>
              <table className="grid-table w-full text-sm">
                <thead>
                  <tr>
                    <th>Business</th>
                    <th className="text-right">Share %</th>
                    <th className="text-right">ADR</th>
                    <th className="text-right">Room nights</th>
                    <th className="text-right">Revenue</th>
                    <th className="text-right">Achieved</th>
                  </tr>
                </thead>
                <tbody>
                  {mix.rows.map((m) => {
                    const own = form.segments.find((s) => s.key === m.key);
                    const got = actual?.bySegment?.[m.key];
                    return (
                      <tr key={m.key}>
                        <td className="font-medium">{m.label}</td>
                        <td>
                          <input
                            className="input text-right"
                            style={{ minWidth: 70 }}
                            inputMode="decimal"
                            aria-label={`${m.label} share of room nights`}
                            value={own.share}
                            onChange={(e) => setSegment(m.key, { share: e.target.value })}
                            placeholder="0"
                          />
                        </td>
                        <td>
                          <input
                            className="input text-right"
                            style={{ minWidth: 90 }}
                            inputMode="decimal"
                            aria-label={`${m.label} ADR`}
                            value={own.adr}
                            onChange={(e) => setSegment(m.key, { adr: e.target.value })}
                            placeholder={goal.adr != null ? formatAmount(goal.adr) : "overall"}
                          />
                        </td>
                        <td className="text-right tabular-nums">{count(m.roomNights)}</td>
                        <td className="text-right tabular-nums">{money(m.revenue)}</td>
                        <td className="text-right tabular-nums">{got ? `${count(got.roomNights)} nights` : "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="font-semibold">Total</td>
                    <td className="text-right font-semibold tabular-nums" style={{ color: mixOver ? "var(--danger)" : undefined }}>
                      {formatAmount(mix.totalShare, { decimals: 1 })}%
                    </td>
                    <td className="text-right tabular-nums">{money(mix.weightedAdr)}</td>
                    <td />
                    <td />
                    <td />
                  </tr>
                </tfoot>
              </table>
            </TableFrame>
            {mixOver && (
              <p className="text-sm" style={{ color: "var(--danger)" }}>
                The shares add up to more than 100%.
              </p>
            )}
            {!mixOver && mix.totalShare > 0 && mix.totalShare < 99.99 && (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                {formatAmount(100 - mix.totalShare, { decimals: 1 })}% of room nights is not given to any business yet.
              </p>
            )}
            {adrGap && (
              <p className="text-sm" style={{ color: "var(--warning)" }}>
                The rates above average {money(mix.weightedAdr)}, but your overall ADR goal is {money(goal.adr)}.
              </p>
            )}
          </div>
        </div>

        <div className="side-panel-foot card-pad flex flex-wrap items-center gap-2">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving..." : "Save"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-secondary ml-auto" onClick={copyAll} disabled={busy || goal.occupancy == null || goal.adr == null}>
            Use for all months
          </button>
        </div>
      </form>
    </div>
  );
}

function Figure({ label, value }) {
  return (
    <div>
      <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p className="mt-0.5 font-semibold tabular-nums" style={{ color: "var(--text)" }}>
        {value}
      </p>
    </div>
  );
}
