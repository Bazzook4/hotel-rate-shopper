"use client";

import { useMemo } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Empty, Section, Stats, TableFrame } from "./reportKit";
import { formatAmount, formatMoney, hotelCurrency } from "@/lib/money";
import { SEGMENTS, splitSegments } from "@/lib/revenuePlanMath";

/**
 * The Revenue Planner's reports, for a year (months) or a month (weeks and
 * days). Every report reads the same "period": the goal, what is sold (nights
 * before today), what is on the books (tonight onward) and the business mix,
 * so the year and the month never disagree on a definition.
 *
 *   Plan          the goal against what is booked
 *   Forecast      sold + on the books = where the period will land
 *   Business mix  planned share of OTA, Direct, Corporate... against booked
 *   Why the gap   how much of a shortfall is too few nights and how much rate
 */

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const monthName = (key) => `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
export const money = (v) => (v == null ? "-" : formatMoney(v, { currency: hotelCurrency() }));
export const pct = (v) => (v == null ? "-" : `${formatAmount(v, { decimals: 1 })}%`);
export const count = (v) => (v == null ? "-" : formatAmount(v));

const signed = (v, fmt) => (v == null ? "-" : v > 0 ? `+${fmt(v)}` : fmt(v));
const tone = (v) => (v == null || v === 0 ? undefined : v > 0 ? "var(--success)" : "var(--danger)");

/** How far achieved is from goal, as a short word and a colour. */
export function against(actual, goal) {
  if (actual == null || !goal) return { label: "-", tone: null };
  const p = Math.round((actual / goal) * 100);
  return { label: `${p}%`, tone: p >= 100 ? "success" : p >= 85 ? "warning" : "danger" };
}

const dayOf = (iso) => new Date(`${iso}T00:00:00Z`);

// ------------------------------------------------------------------
// The period every report reads
// ------------------------------------------------------------------

/** What a month row says about planned business by segment. */
function plannedMix(row) {
  if (!row.goal || row.plan?.roomNights == null) return null;
  return splitSegments(row.goal.segments, row.plan.roomNights, row.goal.adr).rows;
}

/** Last year's room nights by segment for a month row, where it can be told. */
function lastMix(row) {
  const l = row.last;
  if (!l) return null;
  const nights = l.roomNights ?? (l.occupancy != null ? Math.round((row.available * l.occupancy) / 100) : null);
  if (nights == null) return null;
  return Object.fromEntries((l.segments || []).map((s) => [s.key, Math.round((nights * (s.share || 0)) / 100)]));
}

function addTo(target, key, nights, revenue) {
  const t = (target[key] ||= { nights: 0, revenue: 0 });
  t.nights += nights || 0;
  t.revenue += revenue || 0;
}

/** The year as a period: units are its months. */
export function yearPeriod(rows, today) {
  const units = rows.map((r) => {
    const a = r.actual;
    const nights = a?.roomNights || 0;
    const revenue = a?.revenue || 0;
    const soldN = a?.soldNights || 0;
    const soldR = a?.soldRevenue || 0;
    return {
      label: monthName(r.month),
      goalNights: r.plan?.roomNights ?? null,
      goalRevenue: r.goal?.revenue ?? null,
      soldNights: soldN,
      soldRevenue: soldR,
      aheadNights: Math.max(0, nights - soldN),
      aheadRevenue: Math.max(0, revenue - soldR),
      over: r.end < today,
    };
  });
  const planned = {};
  const booked = {};
  const last = {};
  for (const r of rows) {
    for (const s of plannedMix(r) || []) addTo(planned, s.key, s.roomNights, s.revenue);
    for (const [key, x] of Object.entries(r.actual?.bySegment || {})) addTo(booked, key, x.roomNights, x.revenue);
    for (const [key, n] of Object.entries(lastMix(r) || {})) addTo(last, key, n, 0);
  }
  return { units, planned, booked, last, unitName: "Month" };
}

/** A month as a period: units are its weeks. */
export function monthPeriod(row, daily, today) {
  const days = daily?.days || [];
  const goalNightsDay = row?.plan?.roomNights != null ? row.plan.roomNights / row.days : null;
  const goalRevenueDay = row?.goal?.revenue != null ? row.goal.revenue / row.days : null;
  const units = [];
  for (let i = 0; i < days.length; i += 7) {
    const week = days.slice(i, i + 7);
    const u = {
      label: `${Number(week[0].date.slice(8))} to ${Number(week[week.length - 1].date.slice(8))} ${MONTH_NAMES[Number(week[0].date.slice(5, 7)) - 1]}`,
      goalNights: goalNightsDay != null ? goalNightsDay * week.length : null,
      goalRevenue: goalRevenueDay != null ? goalRevenueDay * week.length : null,
      soldNights: 0,
      soldRevenue: 0,
      aheadNights: 0,
      aheadRevenue: 0,
      over: week[week.length - 1].date < today,
    };
    for (const d of week) {
      if (d.date < today) {
        u.soldNights += d.roomNights;
        u.soldRevenue += d.revenue;
      } else {
        u.aheadNights += d.roomNights;
        u.aheadRevenue += d.revenue;
      }
    }
    units.push(u);
  }
  const planned = {};
  const booked = {};
  const last = {};
  for (const s of (row && plannedMix(row)) || []) addTo(planned, s.key, s.roomNights, s.revenue);
  for (const [key, x] of Object.entries(row?.actual?.bySegment || {})) addTo(booked, key, x.roomNights, x.revenue);
  for (const [key, n] of Object.entries((row && lastMix(row)) || {})) addTo(last, key, n, 0);
  return { units, planned, booked, last, unitName: "Week" };
}

/** Totals over the units that have a goal, and over all of them. */
function totalsOf(period) {
  const t = { goalNights: 0, goalRevenue: 0, fNights: 0, fRevenue: 0, soldNights: 0, soldRevenue: 0, aheadNights: 0, aheadRevenue: 0, hasGoal: false };
  for (const u of period.units) {
    t.soldNights += u.soldNights;
    t.soldRevenue += u.soldRevenue;
    t.aheadNights += u.aheadNights;
    t.aheadRevenue += u.aheadRevenue;
    if (u.goalNights != null && u.goalRevenue != null) {
      t.hasGoal = true;
      t.goalNights += u.goalNights;
      t.goalRevenue += u.goalRevenue;
      t.fNights += u.soldNights + u.aheadNights;
      t.fRevenue += u.soldRevenue + u.aheadRevenue;
    }
  }
  return t;
}

function NoGoal() {
  return <Empty>Set a goal first. These reports compare what is booked with your goal.</Empty>;
}

// ------------------------------------------------------------------
// Forecast
// ------------------------------------------------------------------

export function ForecastReport({ period, daysLeft, scope }) {
  const t = useMemo(() => totalsOf(period), [period]);
  const gap = t.hasGoal ? t.fRevenue - t.goalRevenue : null;
  const stillN = Math.max(0, t.goalNights - t.fNights);
  const stillR = Math.max(0, t.goalRevenue - t.fRevenue);

  return (
    <div className="space-y-5">
      <Stats
        items={[
          { label: `Revenue goal`, value: t.hasGoal ? money(t.goalRevenue) : "-" },
          { label: "Sold so far", value: money(t.soldRevenue), hint: "Nights before today" },
          { label: "On the books", value: money(t.aheadRevenue), hint: "Tonight and later, already booked" },
          { label: "Forecast", value: t.hasGoal ? money(t.fRevenue) : "-", hint: "Sold plus on the books, if nothing more is booked" },
          { label: "Gap to goal", value: signed(gap, money), tone: gap == null || gap === 0 ? null : gap > 0 ? "success" : "danger" },
          { label: "Still to find", value: t.hasGoal ? `${count(Math.ceil(stillN))} nights` : "-", hint: stillR > 0 && stillN > 0 ? `About ${money(stillR / stillN)} a night` : undefined },
        ]}
      />
      {t.hasGoal && daysLeft > 0 && stillN > 0 && (
        <p className="text-sm" style={{ color: "var(--text)" }}>
          {scope === "year" ? "This year" : "This month"} still needs {count(Math.ceil(stillN))} more room nights, about{" "}
          {formatAmount(stillN / daysLeft, { decimals: 1 })} a day over the {count(daysLeft)} days left.
        </p>
      )}
      {t.hasGoal && stillN === 0 && stillR === 0 && (
        <p className="text-sm" style={{ color: "var(--success)" }}>
          What is booked already reaches the goal.
        </p>
      )}

      <Section title={`Forecast by ${period.unitName.toLowerCase()}`} sub="Nights and revenue sold, booked ahead, and where each will land against the goal.">
        <TableFrame>
          <table className="grid-table w-full text-sm">
            <thead>
              <tr>
                <th rowSpan={2}>{period.unitName}</th>
                <th colSpan={4} className="text-center">Room nights</th>
                <th colSpan={5} className="text-center">Revenue</th>
              </tr>
              <tr>
                <th className="text-right">Goal</th>
                <th className="text-right">Sold</th>
                <th className="text-right">On books</th>
                <th className="text-right">Forecast</th>
                <th className="text-right">Goal</th>
                <th className="text-right">Sold</th>
                <th className="text-right">On books</th>
                <th className="text-right">Forecast</th>
                <th className="text-right">Gap</th>
              </tr>
            </thead>
            <tbody>
              {period.units.map((u) => {
                const fN = u.soldNights + u.aheadNights;
                const fR = u.soldRevenue + u.aheadRevenue;
                const g = u.goalRevenue != null ? fR - u.goalRevenue : null;
                return (
                  <tr key={u.label}>
                    <td className="font-medium">{u.label}</td>
                    <td className="text-right tabular-nums">{u.goalNights != null ? count(Math.round(u.goalNights)) : "-"}</td>
                    <td className="text-right tabular-nums">{count(u.soldNights)}</td>
                    <td className="text-right tabular-nums">{count(u.aheadNights)}</td>
                    <td className="text-right tabular-nums">{count(fN)}</td>
                    <td className="text-right tabular-nums">{money(u.goalRevenue)}</td>
                    <td className="text-right tabular-nums">{money(u.soldRevenue)}</td>
                    <td className="text-right tabular-nums">{money(u.aheadRevenue)}</td>
                    <td className="text-right tabular-nums">{money(fR)}</td>
                    <td className="text-right tabular-nums" style={{ color: tone(g) }}>
                      {signed(g, money)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableFrame>
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------
// Business mix
// ------------------------------------------------------------------

export function MixReport({ period }) {
  const sum = (o) => Object.values(o).reduce((a, x) => a + x.nights, 0);
  const plannedN = sum(period.planned);
  const bookedN = sum(period.booked);
  const lastN = sum(period.last);
  if (plannedN === 0 && bookedN === 0) return <NoGoal />;
  const share = (n, total) => (total > 0 ? (n / total) * 100 : null);

  return (
    <Section
      title="Where the business comes from"
      sub="Planned mix against what is booked (sold plus on the books). Last year is shown where its mix is known."
    >
      <TableFrame>
        <table className="grid-table w-full text-sm">
          <thead>
            <tr>
              <th rowSpan={2}>Business</th>
              <th colSpan={3} className="text-center">Share of room nights</th>
              <th colSpan={2} className="text-center">Room nights</th>
              <th colSpan={3} className="text-center">Revenue</th>
            </tr>
            <tr>
              <th className="text-right">Plan</th>
              <th className="text-right">Booked</th>
              <th className="text-right">Last year</th>
              <th className="text-right">Plan</th>
              <th className="text-right">Booked</th>
              <th className="text-right">Plan</th>
              <th className="text-right">Booked</th>
              <th className="text-right">Gap</th>
            </tr>
          </thead>
          <tbody>
            {SEGMENTS.map((s) => {
              const p = period.planned[s.key] || { nights: 0, revenue: 0 };
              const b = period.booked[s.key] || { nights: 0, revenue: 0 };
              const l = period.last[s.key] || { nights: 0 };
              const gap = plannedN > 0 ? b.revenue - p.revenue : null;
              return (
                <tr key={s.key}>
                  <td className="font-medium">{s.label}</td>
                  <td className="text-right tabular-nums">{pct(share(p.nights, plannedN))}</td>
                  <td className="text-right tabular-nums">{pct(share(b.nights, bookedN))}</td>
                  <td className="text-right tabular-nums">{pct(share(l.nights, lastN))}</td>
                  <td className="text-right tabular-nums">{count(p.nights)}</td>
                  <td className="text-right tabular-nums">{count(b.nights)}</td>
                  <td className="text-right tabular-nums">{money(p.revenue)}</td>
                  <td className="text-right tabular-nums">{money(b.revenue)}</td>
                  <td className="text-right tabular-nums" style={{ color: tone(gap) }}>
                    {signed(gap, money)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableFrame>
    </Section>
  );
}

// ------------------------------------------------------------------
// Why the gap
// ------------------------------------------------------------------

export function GapReport({ period }) {
  const t = useMemo(() => totalsOf(period), [period]);
  if (!t.hasGoal || t.goalNights === 0) return <NoGoal />;

  const goalAdr = t.goalRevenue / t.goalNights;
  const adr = t.fNights > 0 ? t.fRevenue / t.fNights : null;
  const total = t.fRevenue - t.goalRevenue;
  // Nights short or over, at the goal's own rate; the rest is the rate.
  const volume = (t.fNights - t.goalNights) * goalAdr;
  const rate = total - volume;

  const worst = period.units
    .filter((u) => u.goalRevenue != null)
    .map((u) => ({ label: u.label, gap: u.soldRevenue + u.aheadRevenue - u.goalRevenue, over: u.over }))
    .filter((u) => u.gap < 0)
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 3);

  let sentence;
  if (Math.abs(total) < 1) sentence = "Booked business matches the goal.";
  else {
    const dir = total < 0 ? "short of" : "ahead of";
    const main = Math.abs(volume) >= Math.abs(rate) ? "room nights" : "rate";
    sentence = `Booked business is ${money(Math.abs(total))} ${dir} the goal. Most of it is down to ${main === "room nights" ? (volume < 0 ? "too few room nights" : "more room nights than planned") : rate < 0 ? "a lower rate than planned" : "a higher rate than planned"}.`;
  }

  return (
    <div className="space-y-5">
      <p className="text-sm" style={{ color: "var(--text)" }}>
        {sentence}
      </p>
      <Section title="Nights or rate?" sub="Forecast (sold plus on the books) against the goal.">
        <TableFrame>
          <table className="grid-table w-full text-sm">
            <thead>
              <tr>
                <th>Cause</th>
                <th className="text-right">Goal</th>
                <th className="text-right">Forecast</th>
                <th className="text-right">Effect on revenue</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-medium">Room nights</td>
                <td className="text-right tabular-nums">{count(Math.round(t.goalNights))}</td>
                <td className="text-right tabular-nums">{count(t.fNights)}</td>
                <td className="text-right tabular-nums" style={{ color: tone(volume) }}>
                  {signed(Math.round(volume), money)}
                </td>
              </tr>
              <tr>
                <td className="font-medium">Rate (ADR)</td>
                <td className="text-right tabular-nums">{money(goalAdr)}</td>
                <td className="text-right tabular-nums">{money(adr)}</td>
                <td className="text-right tabular-nums" style={{ color: tone(rate) }}>
                  {signed(Math.round(rate), money)}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td className="font-semibold">Revenue</td>
                <td className="text-right font-semibold tabular-nums">{money(t.goalRevenue)}</td>
                <td className="text-right font-semibold tabular-nums">{money(t.fRevenue)}</td>
                <td className="text-right font-semibold tabular-nums" style={{ color: tone(total) }}>
                  {signed(Math.round(total), money)}
                </td>
              </tr>
            </tfoot>
          </table>
        </TableFrame>
      </Section>
      {worst.length > 0 && (
        <Section title={`Furthest behind, by ${period.unitName.toLowerCase()}`}>
          <ul className="space-y-1 text-sm" style={{ color: "var(--text)" }}>
            {worst.map((w) => (
              <li key={w.label}>
                <span className="font-medium">{w.label}</span>: {money(Math.abs(w.gap))} short{w.over ? "" : " so far"}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// A month, day by day
// ------------------------------------------------------------------

export function DayByDay({ row, daily, today }) {
  if (!daily) return <Empty>Loading...</Empty>;
  const goalNights = row?.plan?.roomNights != null ? row.plan.roomNights / row.days : null;
  const goalRevenue = row?.goal?.revenue != null ? row.goal.revenue / row.days : null;
  const chart = daily.days.map((d) => ({
    day: Number(d.date.slice(8)),
    Sold: d.date < today ? d.roomNights : 0,
    "On the books": d.date >= today ? d.roomNights : 0,
  }));

  return (
    <div className="space-y-5">
      <Section title="Room nights each day" sub={goalNights != null ? `The line is your goal spread evenly: ${formatAmount(goalNights, { decimals: 1 })} nights a day. Rooms you have: ${count(daily.capacity)}.` : `Rooms you have: ${count(daily.capacity)}.`}>
        <div style={{ width: "100%", height: 240 }}>
          <ResponsiveContainer>
            <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
              <YAxis allowDecimals={false} domain={[0, Math.max(daily.capacity, 1)]} tick={{ fontSize: 11, fill: "var(--text-muted)" }} width={32} />
              <Tooltip />
              <Legend />
              <Bar dataKey="Sold" stackId="n" fill="var(--series-1)" />
              <Bar dataKey="On the books" stackId="n" fill="var(--series-2)" />
              {goalNights != null && <ReferenceLine y={goalNights} stroke="var(--text)" strokeDasharray="4 3" />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title="Day by day">
        <TableFrame tall>
          <table className="grid-table w-full text-sm">
            <thead>
              <tr>
                <th>Day</th>
                <th className="text-right">Goal nights</th>
                <th className="text-right">Room nights</th>
                <th className="text-right">Occ.</th>
                <th className="text-right">ADR</th>
                <th className="text-right">Revenue</th>
                <th className="text-right">Goal revenue</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {daily.days.map((d) => {
                const g = goalRevenue != null ? d.revenue - goalRevenue : null;
                return (
                  <tr key={d.date}>
                    <td className="font-medium">
                      {Number(d.date.slice(8))} {WEEKDAYS[dayOf(d.date).getUTCDay()]}
                    </td>
                    <td className="text-right tabular-nums">{goalNights != null ? formatAmount(goalNights, { decimals: 1 }) : "-"}</td>
                    <td className="text-right tabular-nums">{count(d.roomNights)}</td>
                    <td className="text-right tabular-nums">{pct(d.occupancy)}</td>
                    <td className="text-right tabular-nums">{money(d.adr)}</td>
                    <td className="text-right tabular-nums" style={{ color: tone(g) }}>
                      {money(d.revenue)}
                    </td>
                    <td className="text-right tabular-nums">{money(goalRevenue)}</td>
                    <td>{d.date < today ? "Sold" : "On the books"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableFrame>
      </Section>
    </div>
  );
}
