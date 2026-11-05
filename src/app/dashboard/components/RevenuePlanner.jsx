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
import { formatAmount } from "@/lib/money";
import {
  DayByDay,
  ForecastReport,
  GapReport,
  MixReport,
  against,
  count,
  money,
  monthName,
  monthPeriod,
  pct,
  yearPeriod,
} from "./RevenuePlannerReports";
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

const text = (v) => (v == null || v === "" ? "" : String(v));
const numberOrNull = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v));

/** The panel's month for typing in last year's figures: that month a year back. */
function historyRow(r) {
  const key = r.last?.lastMonth || `${Number(r.month.slice(0, 4)) - 1}${r.month.slice(4)}`;
  const [y, m] = key.split("-").map(Number);
  const entered = r.last?.source === "entered" ? r.last : null;
  return { month: key, days: new Date(Date.UTC(y, m, 0)).getUTCDate(), goal: entered, actual: null, last: null, history: true };
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
  const [view, setView] = useState("year");
  const [tab, setTab] = useState("plan");
  const [monthNo, setMonthNo] = useState(Number(today.slice(5, 7)));
  const monthKey = `${year}-${String(monthNo).padStart(2, "0")}`;
  const { report, loading, error, reload } = useReport("/api/revplan", { year: String(year), today }, propertyId);
  const daily = useReport("/api/revplan", view === "month" ? { daily: monthKey } : null, propertyId);
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
        last: report.lastYear?.[m.month] || null,
      };
    });
  }, [report]);

  const totals = useMemo(() => {
    const t = { available: 0, goalNights: 0, goalRevenue: 0, actualNights: 0, actualRevenue: 0, planned: 0, lastRevenue: 0, lastMonths: 0 };
    for (const r of rows) {
      t.available += r.available;
      if (r.last?.revenue != null) {
        t.lastRevenue += r.last.revenue;
        t.lastMonths += 1;
      }
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

  const monthRow = rows.find((r) => r.month === monthKey) || null;
  const period = useMemo(
    () => (view === "year" ? yearPeriod(rows, today) : monthPeriod(monthRow, daily.report, today)),
    [view, rows, monthRow, daily.report, today]
  );
  const daysLeft = useMemo(() => {
    const [from, to] = view === "year" ? [`${year}-01-01`, `${year}-12-31`] : [monthRow?.start, monthRow?.end];
    if (!from || to < today) return 0;
    const start = from > today ? from : today;
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
  }, [view, year, monthRow, today]);

  const yearOptions = [thisYear - 1, thisYear, thisYear + 1, thisYear + 2];

  async function save(goals, message, history = false) {
    await sendJSON("/api/revplan", "PUT", { propertyId, goals, history });
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
          <div className="flex flex-wrap items-center gap-2">
            <Choice value={view} onChange={setView} options={[{ id: "year", label: "Year" }, { id: "month", label: "Month" }]} label="View" />
            {view === "month" && (
              <Select className="input" style={{ width: "auto" }} value={String(monthNo)} onChange={(e) => setMonthNo(Number(e.target.value))} aria-label="Month">
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {monthName(`${year}-${String(i + 1).padStart(2, "0")}`).slice(0, 3)}
                  </option>
                ))}
              </Select>
            )}
            <Select className="input" style={{ width: "auto" }} value={String(year)} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </div>
        }
      />

      <Choice
        value={tab}
        onChange={setTab}
        label="Report"
        options={[
          { id: "plan", label: "Plan" },
          { id: "forecast", label: "Forecast" },
          { id: "mix", label: "Business mix" },
          { id: "gap", label: "Why the gap" },
        ]}
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

      {report && tab === "forecast" && <ForecastReport period={period} daysLeft={daysLeft} scope={view} />}
      {report && tab === "mix" && <MixReport period={period} />}
      {report && tab === "gap" && <GapReport period={period} />}

      {report && tab === "plan" && view === "month" && (
        <MonthPlan
          row={monthRow}
          daily={daily}
          today={today}
          onSet={() => monthRow && setOpen(monthRow)}
          canSet={report.capacity > 0}
        />
      )}

      {report && tab === "plan" && view === "year" && (
        <Stats
          items={[
            { label: `Last year revenue`, value: totals.lastMonths ? money(totals.lastRevenue) : "-", hint: totals.lastMonths ? `Added up over ${totals.lastMonths} months with figures` : "No figures for last year yet. Use Add in the table." },
            { label: `${year} room nights goal`, value: totals.planned ? count(totals.goalNights) : "-", hint: "Added up over the months with a goal" },
            { label: "Room nights so far", value: totals.planned ? count(totals.actualNights) : "-" },
            { label: `${year} revenue goal`, value: totals.planned ? money(totals.goalRevenue) : "-" },
            { label: "Revenue so far", value: totals.planned ? money(totals.actualRevenue) : "-", tone: totals.planned ? against(totals.actualRevenue, totals.goalRevenue).tone : null },
            { label: "Goal ADR", value: totals.goalNights ? money(totals.goalRevenue / totals.goalNights) : "-" },
            { label: "Goal RevPAR", value: totals.planned && totals.available ? money(totals.goalRevenue / totals.available) : "-", hint: "Revenue for each room you have, sold or not" },
          ]}
        />
      )}

      {tab === "plan" && view === "year" && (
      <Section title={`Month by month, ${year}`} sub="Open a month to set its goal.">
        {loading && !report ? (
          <Empty>Loading...</Empty>
        ) : (
          <TableFrame>
            <table className="grid-table w-full text-sm">
              <thead>
                <tr>
                  <th rowSpan={2}>Month</th>
                  <th colSpan={4} className="text-center">Last year</th>
                  <th colSpan={4} className="text-center">Goal</th>
                  <th colSpan={4} className="text-center">Booked (sold and on the books)</th>
                  <th rowSpan={2} className="text-right">Of goal</th>
                  <th rowSpan={2} />
                </tr>
                <tr>
                  <th className="text-right">Occ.</th>
                  <th className="text-right">ADR</th>
                  <th className="text-right">Revenue</th>
                  <th />
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
                  const of = against(a?.revenue || null, g?.revenue);
                  return (
                    <tr key={r.month}>
                      <td className="font-medium">{monthName(r.month)}</td>
                      <td className="text-right tabular-nums">{pct(r.last?.occupancy)}</td>
                      <td className="text-right tabular-nums">{money(r.last?.adr)}</td>
                      <td className="text-right tabular-nums" title={r.last?.source === "entered" ? "Typed in by you" : r.last ? "From your bookings" : undefined}>
                        {money(r.last?.revenue)}
                      </td>
                      <td className="text-right">
                        {r.last?.source !== "bookings" && (
                          <button type="button" className="btn btn-secondary text-xs" onClick={() => setOpen(historyRow(r))}>
                            {r.last ? "Edit" : "Add"}
                          </button>
                        )}
                      </td>
                      <td className="text-right tabular-nums">{pct(g?.occupancy)}</td>
                      <td className="text-right tabular-nums">{money(g?.adr)}</td>
                      <td className="text-right tabular-nums">{money(g?.revenue)}</td>
                      <td className="text-right tabular-nums">{money(r.plan?.revpar)}</td>
                      <td className="text-right tabular-nums">{pct(a?.occupancy)}</td>
                      <td className="text-right tabular-nums">{money(a?.adr)}</td>
                      <td className="text-right tabular-nums">{money(a?.revenue)}</td>
                      <td className="text-right tabular-nums">{money(a?.revpar)}</td>
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
      )}

      {tab === "plan" && view === "year" && <Pace rows={rows} today={today} />}

      {open && (
        <GoalPanel
          kind={open.history ? "history" : "goal"}
          month={open}
          capacity={report.capacity}
          onClose={() => setOpen(null)}
          onSave={async (goal) => {
            if (open.history) await save([{ month: open.month, ...goal }], `Saved last year's figures for ${monthName(open.month)}.`, true);
            else await save([{ month: open.month, ...goal }], `Saved the goal for ${monthName(open.month)}.`);
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

/** A short row of buttons, one picked. */
function Choice({ value, onChange, options, label }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.id)}
            className="btn text-sm"
            style={{
              background: on ? "var(--accent-soft)" : "var(--surface)",
              color: on ? "var(--accent-text)" : "var(--text)",
              borderColor: on ? "var(--accent)" : "var(--border-strong)",
              fontWeight: on ? 600 : 400,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** One month: its goal, last year, and the nights day by day. */
function MonthPlan({ row, daily, today, onSet, canSet }) {
  if (!row) return <Empty>Loading...</Empty>;
  const g = row.goal;
  const a = row.actual;
  const of = against(a?.revenue || null, g?.revenue);
  return (
    <div className="space-y-5">
      <Stats
        items={[
          { label: "Last year revenue", value: money(row.last?.revenue), hint: row.last ? undefined : "No figures for last year yet. Add them on the Year view." },
          { label: "Goal occupancy", value: pct(g?.occupancy) },
          { label: "Goal ADR", value: money(g?.adr) },
          { label: "Goal revenue", value: money(g?.revenue) },
          { label: "Goal RevPAR", value: money(row.plan?.revpar), hint: "Revenue for each room you have, sold or not" },
          { label: "Booked revenue", value: money(a?.revenue), hint: "Sold plus on the books", tone: of.tone },
          { label: "Booked occupancy", value: pct(a?.occupancy) },
          { label: "Booked ADR", value: money(a?.adr) },
        ]}
      />
      <div>
        <button type="button" className="btn btn-secondary text-sm" onClick={onSet} disabled={!canSet}>
          {g ? "Edit this month's goal" : "Set this month's goal"}
        </button>
      </div>
      <DayByDay row={row} daily={daily.report} today={today} />
      {daily.error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {daily.error}
        </p>
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

function GoalPanel({ kind = "goal", month, capacity, onClose, onSave, onCopyAll }) {
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

  /** Fill the goal with last year's figures, to adjust from. */
  function startFromLast() {
    const l = month.last;
    const solved = solveGoal({ occupancy: l.occupancy, adr: l.adr }, "occupancy", available);
    setForm({
      occupancy: text(solved.occupancy),
      adr: text(solved.adr),
      revenue: text(solved.revenue),
      segments: SEGMENTS.map((x) => {
        const own = (l.segments || []).find((y) => y.key === x.key) || {};
        return { key: x.key, share: text(own.share), adr: text(own.adr) };
      }),
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

  const history = kind === "history";
  const title = history ? `Last year: ${monthName(month.month)}` : `Goal for ${monthName(month.month)}`;

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
            {history && " Type what the hotel did in this month. Bookings on the system always count first."}
          </p>
          {!history && month.last && (
            <div className="flex flex-wrap items-center gap-3 text-sm" style={{ color: "var(--text-muted)" }}>
              <span>
                Last year: {pct(month.last.occupancy)} full, ADR {money(month.last.adr)}, revenue {money(month.last.revenue)}.
              </span>
              <button type="button" className="btn btn-secondary text-xs" onClick={startFromLast}>
                Start from last year
              </button>
            </div>
          )}

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
            {!history && <Figure label="Achieved so far" value={actual ? `${count(actual.roomNights)} nights, ${money(actual.revenue)}` : "-"} />}
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              {history ? "Where the bookings came from" : "Where the bookings should come from"}
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
                    {!history && <th className="text-right">Achieved</th>}
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
                        {!history && <td className="text-right tabular-nums">{got ? `${count(got.roomNights)} nights` : "-"}</td>}
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
                    {!history && <td />}
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
          {!history && (
          <button type="button" className="btn btn-secondary ml-auto" onClick={copyAll} disabled={busy || goal.occupancy == null || goal.adr == null}>
            Use for all months
          </button>
          )}
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
