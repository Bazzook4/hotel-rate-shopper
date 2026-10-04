"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Icon from "../../components/Icon";
import { addDays, formatDateISO, parseDateISO } from "@/lib/date";
import { Change } from "./reportKit";
import { usePageState } from "./usePageState";

/**
 * Booking performance: what the reservations in the PMS add up to.
 *
 * Read top to bottom it answers, in order: how did the period do (headline
 * figures against a comparison period), where did the business come from
 * (the mix by channel, source country, room type, rate plan and booking
 * method), how did it move through the period (trend by channel), and when
 * do guests stay (weekday and month).
 *
 * Every chart has a table with it. Some series colours are pale against a
 * white page, and a hotelier exporting numbers for an owner wants the figures,
 * not a picture of them.
 */

const PRESETS = [
  { id: "mtd", label: "Month to date" },
  { id: "thismonth", label: "This month" },
  { id: "lastmonth", label: "Last month" },
  { id: "last7", label: "Last 7 days" },
  { id: "last30", label: "Last 30 days" },
  { id: "ytd", label: "Year to date" },
  { id: "last12", label: "Last 12 months" },
  { id: "next30", label: "Next 30 days" },
  { id: "next90", label: "Next 3 months" },
  { id: "custom", label: "Custom dates" },
];

function presetRange(id, todayIso) {
  const today = parseDateISO(todayIso);
  const y = today.getFullYear();
  const m = today.getMonth();
  const iso = formatDateISO;
  switch (id) {
    case "thismonth":
      return { start: iso(new Date(y, m, 1)), end: iso(new Date(y, m + 1, 0)) };
    case "lastmonth":
      return { start: iso(new Date(y, m - 1, 1)), end: iso(new Date(y, m, 0)) };
    case "last7":
      return { start: iso(addDays(today, -6)), end: todayIso };
    case "last30":
      return { start: iso(addDays(today, -29)), end: todayIso };
    case "ytd":
      return { start: iso(new Date(y, 0, 1)), end: todayIso };
    case "last12":
      return { start: iso(addDays(new Date(y - 1, m, today.getDate()), 1)), end: todayIso };
    case "next30":
      return { start: todayIso, end: iso(addDays(today, 29)) };
    case "next90":
      return { start: todayIso, end: iso(addDays(today, 89)) };
    case "mtd":
    default:
      return { start: iso(new Date(y, m, 1)), end: todayIso };
  }
}

/**
 * What the headline figures are measured against. Same period last year is
 * the default: a hotel's months are not alike, so September against August
 * mostly measures the season, while September against last September
 * measures the hotel.
 */
const COMPARISONS = [
  { id: "yoy", label: "Same period last year", short: "same period last year" },
  { id: "previous", label: "Previous period", short: "the previous period" },
  { id: "custom", label: "Custom dates", short: "" },
];

/** The same date a year earlier; 29 February becomes the 28th. */
function yearEarlier(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const last = new Date(y - 1, m, 0).getDate();
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

const DIMENSIONS = [
  { id: "channel", label: "Channel" },
  // The guest's country -- where the business comes from.
  { id: "source", label: "Source" },
  { id: "roomType", label: "Room type" },
  { id: "ratePlan", label: "Rate plan" },
  { id: "method", label: "Booking method" },
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The eight chart colours, in their validated order. */
const SERIES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);

// ------------------------------------------------------------------
// Formatting
// ------------------------------------------------------------------

function moneyFormatter(currency) {
  let fmt;
  try {
    fmt = new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    });
  } catch {
    fmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
  }
  return (v) => (v == null ? "–" : fmt.format(v));
}

const whole = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const one = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

function shortDate(iso) {
  return parseDateISO(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function longDate(iso) {
  return parseDateISO(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function monthLabel(key) {
  return parseDateISO(`${key}-01`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

// ------------------------------------------------------------------
// Headline figures
// ------------------------------------------------------------------

/**
 * `better` says which way is good news, so the change can be tinted: more
 * revenue is good, more cancellations are not. `points` marks a figure that is
 * already a percentage, whose change is shown in points -- occupancy going
 * from 60% to 66% is +6 pts, not +10%.
 */
function kpiDefs(money) {
  return [
    { key: "roomRevenue", label: "Room revenue", fmt: money, better: "up" },
    {
      key: "totalRevenue",
      label: "Total revenue",
      hint: "Room revenue plus everything else on the folio (food, transfers), before tax",
      fmt: money,
      better: "up",
    },
    { key: "adr", label: "Avg room rate (ADR)", hint: "Room revenue per paid room night; complimentary nights are left out", fmt: money, better: "up" },
    { key: "occupancy", label: "Occupancy", fmt: (v) => (v == null ? "–" : `${one.format(v)}%`), better: "up", points: true, stayOnly: true },
    { key: "revpar", label: "Revenue per room (RevPAR)", hint: "Room revenue per room available", fmt: money, better: "up", stayOnly: true },
    { key: "roomNights", label: "Room nights", fmt: (v) => whole.format(v ?? 0), better: "up" },
    { key: "reservations", label: "Reservations", hint: "After cancellations", fmt: (v) => whole.format(v ?? 0), better: "up" },
    { key: "alos", label: "Avg. length of stay", fmt: (v) => (v == null ? "–" : `${one.format(v)} nights`), better: "up" },
    { key: "leadTime", label: "Avg. lead time", hint: "Days between booking and arrival", fmt: (v) => (v == null ? "–" : `${one.format(v)} days`), better: null },
    { key: "cancellations", label: "Cancellations", fmt: (v) => whole.format(v ?? 0), better: "down" },
    { key: "cancellationRate", label: "Cancellation rate", fmt: (v) => (v == null ? "–" : `${one.format(v)}%`), better: "down", points: true },
    { key: "lostRevenue", label: "Revenue lost to cancellations", fmt: money, better: "down" },
  ];
}

function KpiGrid({ report, money }) {
  const { current, previous } = report.kpis;
  const defs = kpiDefs(money).filter((d) => !d.stayOnly || report.basis === "stay");
  return (
    <div className="card card-pad">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
          Booking insights
        </h3>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Compared with {COMPARISONS.find((c) => c.id === report.compare)?.short || ""}
          {report.compare === "custom" ? "" : ", "}
          {longDate(report.previous.start)} – {longDate(report.previous.end)}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-3 xl:grid-cols-4">
        {defs.map((d) => (
          <div key={d.key} title={d.hint}>
            <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
              {d.label}
              {d.hint && <span style={{ color: "var(--text-faint)" }}> ⓘ</span>}
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums" style={{ color: "var(--text)" }}>
              {d.fmt(current[d.key])}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <Change now={current[d.key]} before={previous[d.key]} better={d.better} points={d.points} />
              <span className="text-[11px] tabular-nums" style={{ color: "var(--text-faint)" }}>
                was {d.fmt(previous[d.key])}
              </span>
            </div>
          </div>
        ))}
      </div>
      {current.compNights > 0 && (
        <p className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>
          Includes {whole.format(current.compNights)} complimentary room night
          {current.compNights === 1 ? "" : "s"}, counted in room nights and occupancy but not in ADR.
        </p>
      )}
      {current.noShows > 0 && (
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {whole.format(current.noShows)} no-show{current.noShows === 1 ? "" : "s"}, not counted as
          reservations or cancellations.
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Chart pieces
// ------------------------------------------------------------------

const axisTick = { fill: "var(--text-muted)", fontSize: 11 };

function ChartTooltip({ active, payload, label, format, labelFormat }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value != null && p.value !== 0);
  const total = rows.reduce((s, p) => s + (Number(p.value) || 0), 0);
  return (
    <div
      className="rounded-md px-3 py-2 text-xs shadow"
      style={{ background: "var(--surface)", border: "1px solid var(--border-strong)", color: "var(--text)" }}
    >
      <p className="mb-1 font-semibold">{labelFormat ? labelFormat(label) : label}</p>
      {rows.length === 0 && <p style={{ color: "var(--text-muted)" }}>Nothing</p>}
      {rows.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2 tabular-nums">
          <span
            className="inline-block h-2 w-2 rounded-sm"
            style={{ background: p.color || p.fill }}
          />
          <span style={{ color: "var(--text-muted)" }}>{p.name}</span>
          <span className="ml-auto pl-3 font-medium">{format(p.value)}</span>
        </p>
      ))}
      {rows.length > 1 && (
        <p className="mt-1 flex border-t pt-1 font-semibold tabular-nums" style={{ borderColor: "var(--border)" }}>
          Total<span className="ml-auto pl-3">{format(total)}</span>
        </p>
      )}
    </div>
  );
}

/** One measure across the rows of a breakdown, as horizontal bars. */
function RankBars({ title, rows, dataKey, format }) {
  const height = Math.max(120, rows.length * 34 + 30);
  // min-w-0: a grid cell otherwise sizes to its content, and a chart that
  // measures its container then measures nothing.
  return (
    <div className="min-w-0">
      <p className="mb-2 text-sm font-medium" style={{ color: "var(--text)" }}>
        {title}
      </p>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap={6}>
          <CartesianGrid horizontal={false} stroke="var(--border)" />
          <XAxis type="number" tick={axisTick} tickFormatter={format} axisLine={false} tickLine={false} />
          <YAxis
            type="category"
            dataKey="name"
            width={130}
            tick={axisTick}
            axisLine={false}
            tickLine={false}
            interval={0}
          />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={<ChartTooltip format={format} />}
          />
          <Bar dataKey={dataKey} name={title} fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ------------------------------------------------------------------
// Mix
// ------------------------------------------------------------------

function MixSection({ report, money }) {
  const [dim, setDim] = useState("channel");
  const rows = report.breakdowns[dim] || [];
  const totalRevenue = rows.reduce((s, r) => s + r.roomRevenue, 0);
  const label = DIMENSIONS.find((d) => d.id === dim)?.label;

  return (
    <div className="card card-pad space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
          Business mix
        </h3>
        <div className="seg max-w-full overflow-x-auto">
          {DIMENSIONS.map((d) => (
            <button key={d.id} type="button" className={dim === d.id ? "seg-on" : ""} onClick={() => setDim(d.id)}>
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          No reservations in this period.
        </p>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <RankBars title="Room nights" rows={rows} dataKey="roomNights" format={(v) => whole.format(v)} />
            <RankBars title="Room revenue" rows={rows} dataKey="roomRevenue" format={money} />
          </div>

          <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
            <table className="grid-table">
              <thead>
                <tr>
                  <th>{label}</th>
                  <th className="text-right">Reservations</th>
                  <th className="text-right">Room nights</th>
                  <th className="text-right">Room revenue</th>
                  <th>Share of revenue</th>
                  <th className="text-right" title="Average room rate (ADR)">Avg rate</th>
                  <th className="text-right">ALOS</th>
                  <th className="text-right">Lead time</th>
                  <th className="text-right">Cancelled</th>
                  <th className="text-right">Cancel rate</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const share = totalRevenue > 0 ? (r.roomRevenue / totalRevenue) * 100 : 0;
                  return (
                    <tr key={r.name}>
                      <td className="font-medium">{r.name}</td>
                      <td className="text-right tabular-nums">{whole.format(r.reservations)}</td>
                      <td className="text-right tabular-nums">{whole.format(r.roomNights)}</td>
                      <td className="text-right tabular-nums">{money(r.roomRevenue)}</td>
                      <td style={{ minWidth: 150 }}>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full" style={{ background: "var(--surface-2)" }}>
                            <div
                              className="h-1.5 rounded-full"
                              style={{ width: `${share}%`, background: "var(--series-1)" }}
                            />
                          </div>
                          <span className="w-12 text-right text-xs tabular-nums">{one.format(share)}%</span>
                        </div>
                      </td>
                      <td className="text-right tabular-nums">{money(r.adr)}</td>
                      <td className="text-right tabular-nums">{r.alos == null ? "–" : one.format(r.alos)}</td>
                      <td className="text-right tabular-nums">
                        {r.leadTime == null ? "–" : `${one.format(r.leadTime)} d`}
                      </td>
                      <td className="text-right tabular-nums">{whole.format(r.cancellations)}</td>
                      <td className="text-right tabular-nums">
                        {r.cancellationRate == null ? "–" : `${one.format(r.cancellationRate)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Trend
// ------------------------------------------------------------------

/** The Monday a date's week starts on, so weeks read Mon–Sun. */
function weekOf(iso) {
  const d = parseDateISO(iso);
  return formatDateISO(addDays(d, -((d.getDay() + 6) % 7)));
}

/**
 * Channels in a fixed order -- Direct first, then alphabetical -- so each
 * keeps its colour however the period changes. Past eight, the smallest are
 * folded into "Other" rather than given a ninth colour nobody can tell apart.
 */
function channelOrder(series) {
  const names = Object.keys(series);
  const totals = Object.fromEntries(
    names.map((n) => [n, series[n].revenue.reduce((a, b) => a + b, 0) + series[n].nights.reduce((a, b) => a + b, 0)])
  );
  let keep = names;
  let folded = [];
  if (names.length > 8) {
    const bySize = [...names].sort((a, b) => totals[b] - totals[a]);
    keep = bySize.slice(0, 7);
    folded = bySize.slice(7);
  }
  keep.sort((a, b) => (a === "Direct" ? -1 : b === "Direct" ? 1 : a.localeCompare(b)));
  return { keep, folded };
}

function TrendSection({ report, money }) {
  const [grain, setGrain] = useState(report.trend.dates.length > 62 ? "month" : "day");
  const [metric, setMetric] = useState("nights");
  const [showTable, setShowTable] = useState(false);

  const { keep, folded } = useMemo(() => channelOrder(report.trend.series), [report]);
  const channels = folded.length ? [...keep, "Other"] : keep;

  const data = useMemo(() => {
    const { dates, series } = report.trend;
    const buckets = new Map();
    dates.forEach((date, i) => {
      const key = grain === "month" ? date.slice(0, 7) : grain === "week" ? weekOf(date) : date;
      if (!buckets.has(key)) buckets.set(key, { key });
      const b = buckets.get(key);
      for (const [name, s] of Object.entries(series)) {
        const target = folded.includes(name) ? "Other" : name;
        b[target] = (b[target] || 0) + s[metric][i];
      }
    });
    return [...buckets.values()];
  }, [report, grain, metric, folded]);

  const format = metric === "revenue" ? money : (v) => whole.format(v);
  const labelFormat = (key) =>
    grain === "month" ? monthLabel(key) : grain === "week" ? `Week of ${shortDate(key)}` : longDate(key);
  const tickFormat = (key) => (grain === "month" ? monthLabel(key) : shortDate(key));
  const basisWord = report.basis === "booked" ? "booking date" : "stay date";

  return (
    <div className="card card-pad space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
            Trend by channel
          </h3>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            By {basisWord}
          </p>
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap gap-2">
          <div className="seg max-w-full overflow-x-auto">
            {[
              ["day", "Daily"],
              ["week", "Weekly"],
              ["month", "Monthly"],
            ].map(([id, lbl]) => (
              <button key={id} type="button" className={grain === id ? "seg-on" : ""} onClick={() => setGrain(id)}>
                {lbl}
              </button>
            ))}
          </div>
          <div className="seg max-w-full overflow-x-auto">
            {[
              ["nights", "Room nights"],
              ["revenue", "Room revenue"],
            ].map(([id, lbl]) => (
              <button key={id} type="button" className={metric === id ? "seg-on" : ""} onClick={() => setMetric(id)}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
      </div>

      {channels.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          No reservations in this period.
        </p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="key" tick={axisTick} tickFormatter={tickFormat} axisLine={{ stroke: "var(--border-strong)" }} tickLine={false} minTickGap={16} />
              <YAxis tick={axisTick} tickFormatter={format} axisLine={false} tickLine={false} width={metric === "revenue" ? 80 : 40} allowDecimals={false} />
              <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<ChartTooltip format={format} labelFormat={labelFormat} />} />
              <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }} iconType="square" iconSize={10} />
              {channels.map((name, i) => (
                <Bar
                  key={name}
                  dataKey={name}
                  name={name}
                  stackId="c"
                  fill={SERIES[i]}
                  // A hairline of page colour between stacked segments keeps
                  // neighbouring channels apart without relying on hue alone.
                  stroke="var(--surface)"
                  strokeWidth={1}
                  maxBarSize={48}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>

          <button type="button" className="btn btn-ghost text-sm" onClick={() => setShowTable((v) => !v)}>
            {showTable ? "Hide table" : "View as table"}
          </button>
          {showTable && (
            <div className="max-h-96 overflow-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>{grain === "month" ? "Month" : grain === "week" ? "Week of" : "Date"}</th>
                    {channels.map((c) => (
                      <th key={c} className="text-right">
                        {c}
                      </th>
                    ))}
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((row) => (
                    <tr key={row.key}>
                      <td className="whitespace-nowrap">{labelFormat(row.key)}</td>
                      {channels.map((c) => (
                        <td key={c} className="text-right tabular-nums">
                          {format(row[c] || 0)}
                        </td>
                      ))}
                      <td className="text-right font-medium tabular-nums">
                        {format(channels.reduce((s, c) => s + (row[c] || 0), 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Seasonality
// ------------------------------------------------------------------

function SeasonalitySection({ report, money }) {
  const stay = report.basis === "stay";
  const [view, setView] = useState("weekday");
  const [metric, setMetric] = useState(stay ? "occupancy" : "roomNights");
  const active = !stay && (metric === "occupancy" || metric === "revpar") ? "roomNights" : metric;

  const metrics = [
    ...(stay ? [["occupancy", "Occupancy"]] : []),
    ["roomNights", "Room nights"],
    ["roomRevenue", "Room revenue"],
    ["adr", "Avg room rate"],
    ...(stay ? [["revpar", "Revenue per room"]] : []),
  ];
  const formats = {
    occupancy: (v) => (v == null ? "–" : `${one.format(v)}%`),
    roomNights: (v) => whole.format(v ?? 0),
    roomRevenue: money,
    adr: money,
    revpar: money,
  };

  const rows =
    view === "weekday"
      ? report.seasonality.weekdays.map((r, i) => ({ ...r, name: WEEKDAYS[i] }))
      : report.seasonality.months.map((r) => ({ ...r, name: monthLabel(r.key) }));
  const label = metrics.find(([id]) => id === active)?.[1];
  const format = formats[active];

  return (
    <div className="card card-pad space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
            Seasonality
          </h3>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            By the night stayed{stay ? "" : ", for the bookings made in this period"}
          </p>
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap gap-2">
          <div className="seg max-w-full overflow-x-auto">
            {[
              ["weekday", "Day of week"],
              ["month", "Month"],
            ].map(([id, lbl]) => (
              <button key={id} type="button" className={view === id ? "seg-on" : ""} onClick={() => setView(id)}>
                {lbl}
              </button>
            ))}
          </div>
          <div className="seg max-w-full overflow-x-auto">
            {metrics.map(([id, lbl]) => (
              <button key={id} type="button" className={active === id ? "seg-on" : ""} onClick={() => setMetric(id)}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          No stays in this period.
        </p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="name" tick={axisTick} axisLine={{ stroke: "var(--border-strong)" }} tickLine={false} interval={0} />
              <YAxis tick={axisTick} tickFormatter={format} axisLine={false} tickLine={false} width={active === "roomNights" || active === "occupancy" ? 48 : 80} />
              <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<ChartTooltip format={format} />} />
              <Bar dataKey={active} name={label} fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={56} />
            </BarChart>
          </ResponsiveContainer>

          <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
            <table className="grid-table">
              <thead>
                <tr>
                  <th>{view === "weekday" ? "Day" : "Month"}</th>
                  {stay && <th className="text-right">Occupancy</th>}
                  <th className="text-right">Room nights</th>
                  <th className="text-right">Room revenue</th>
                  <th className="text-right" title="Average room rate (ADR)">Avg rate</th>
                  {stay && <th className="text-right" title="Revenue per available room (RevPAR)">Per room</th>}
                  {view === "month" && <th className="text-right">Arrivals</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name}>
                    <td className="font-medium">{r.name}</td>
                    {stay && <td className="text-right tabular-nums">{formats.occupancy(r.occupancy)}</td>}
                    <td className="text-right tabular-nums">{whole.format(r.roomNights)}</td>
                    <td className="text-right tabular-nums">{money(r.roomRevenue)}</td>
                    <td className="text-right tabular-nums">{money(r.adr)}</td>
                    {stay && <td className="text-right tabular-nums">{money(r.revpar)}</td>}
                    {view === "month" && <td className="text-right tabular-nums">{whole.format(r.arrivals ?? 0)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// CSV
// ------------------------------------------------------------------

function csvCell(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Everything on the page as one CSV, a section per table. */
function downloadCsv(report) {
  const lines = [];
  const row = (...cells) => lines.push(cells.map(csvCell).join(","));
  const { current, previous } = report.kpis;

  row("Booking performance", report.basis === "booked" ? "Booked-on date" : "Stay date", report.start, report.end);
  row("Compared with", report.previous.start, report.previous.end);
  row("Currency", report.currency);
  row();
  row("Metric", "This period", "Comparison period");
  for (const key of Object.keys(current)) row(key, current[key], previous[key]);

  const cols = ["reservations", "roomNights", "roomRevenue", "adr", "alos", "leadTime", "cancellations", "cancellationRate", "lostRevenue"];
  for (const d of DIMENSIONS) {
    row();
    row(d.label, ...cols);
    for (const r of report.breakdowns[d.id] || []) row(r.name, ...cols.map((c) => r[c]));
  }

  const seasonCols = ["roomNights", "roomRevenue", "adr", "occupancy", "revpar"];
  row();
  row("Day of week", ...seasonCols);
  report.seasonality.weekdays.forEach((r, i) => row(WEEKDAYS[i], ...seasonCols.map((c) => r[c])));
  row();
  row("Month", ...seasonCols, "arrivals");
  for (const r of report.seasonality.months) row(r.key, ...seasonCols.map((c) => r[c]), r.arrivals);

  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `booking-performance-${report.start}-to-${report.end}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

export default function BookingPerformance({ session }) {
  const propertyId = session?.propertyId || null;
  const todayIso = formatDateISO(new Date());

  const [basis, setBasis] = usePageState("performance.basis", "stay");
  // The period is shared by every report, so moving between them keeps it.
  const [savedPreset, setPreset] = usePageState("reports.preset", "mtd");
  // A period picked on another report that this one has no name for (Today,
  // Yesterday) still applies, shown as custom dates.
  const preset = PRESETS.some((p) => p.id === savedPreset) ? savedPreset : "custom";
  const [range, setRange] = usePageState("reports.range", () => presetRange("mtd", todayIso));
  const [compare, setCompare] = useState("yoy");
  const [compareRange, setCompareRange] = useState({ start: "", end: "" });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function chooseComparison(id) {
    setCompare(id);
    // Custom starts from last year's dates, the likeliest thing to adjust.
    if (id === "custom" && !compareRange.start) {
      setCompareRange({ start: yearEarlier(range.start), end: yearEarlier(range.end) });
    }
  }

  function choosePreset(id) {
    setPreset(id);
    if (id !== "custom") setRange(presetRange(id, todayIso));
  }

  useEffect(() => {
    if (!range.start || !range.end || range.end < range.start) return;
    const custom = compare === "custom";
    if (custom && (!compareRange.start || !compareRange.end || compareRange.end < compareRange.start)) {
      return;
    }
    let stale = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const qs = new URLSearchParams({ start: range.start, end: range.end, basis, compare });
        if (custom) {
          qs.set("compareStart", compareRange.start);
          qs.set("compareEnd", compareRange.end);
        }
        if (propertyId) qs.set("propertyId", propertyId);
        const res = await fetch(`/api/reports/performance?${qs}`);
        const body = await res.json().catch(() => ({}));
        if (stale) return;
        if (!res.ok) throw new Error(body.error || "Could not load the report");
        setReport(body);
      } catch (err) {
        if (!stale) setError(err.message);
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => {
      stale = true;
    };
  }, [propertyId, range.start, range.end, basis, compare, compareRange.start, compareRange.end]);

  const money = useMemo(() => moneyFormatter(report?.currency || "INR"), [report?.currency]);
  const badRange = range.end < range.start;
  const badCompare = compare === "custom" && compareRange.end < compareRange.start;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="h1">Booking Performance</h2>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Revenue, average rate, length of stay, lead time and cancellations from your reservations, by
            channel, source country, room type and rate plan.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary text-sm"
          onClick={() => report && downloadCsv(report)}
          disabled={!report || loading}
        >
          Download CSV
        </button>
      </div>

      <div className="card card-pad">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <span className="label">Show performance by</span>
            <div className="seg max-w-full overflow-x-auto">
              <button type="button" className={basis === "stay" ? "seg-on" : ""} onClick={() => setBasis("stay")}>
                Stay date
              </button>
              <button type="button" className={basis === "booked" ? "seg-on" : ""} onClick={() => setBasis("booked")}>
                Booked-on date
              </button>
            </div>
          </div>

          <div style={{ width: 200 }}>
            <label className="label" htmlFor="perf-period">
              Time period
            </label>
            <select id="perf-period" className="input" value={preset} onChange={(e) => choosePreset(e.target.value)}>
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="label">{basis === "booked" ? "Booked between" : "Stay dates"}</span>
            <div className="flex items-center gap-2">
              <input
                type="date"
                className="input"
                value={range.start}
                onChange={(e) => {
                  setPreset("custom");
                  setRange((r) => ({ ...r, start: e.target.value }));
                }}
                aria-label="From"
              />
              <span style={{ color: "var(--text-muted)" }}>–</span>
              <input
                type="date"
                className="input"
                value={range.end}
                onChange={(e) => {
                  setPreset("custom");
                  setRange((r) => ({ ...r, end: e.target.value }));
                }}
                aria-label="To"
              />
            </div>
          </div>

          <div style={{ width: 220 }}>
            <label className="label" htmlFor="perf-compare">
              Compare with
            </label>
            <select
              id="perf-compare"
              className="input"
              value={compare}
              onChange={(e) => chooseComparison(e.target.value)}
            >
              {COMPARISONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {compare === "custom" && (
            <div>
              <span className="label">Comparison dates</span>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  className="input"
                  value={compareRange.start}
                  onChange={(e) => setCompareRange((r) => ({ ...r, start: e.target.value }))}
                  aria-label="Compare from"
                />
                <span style={{ color: "var(--text-muted)" }}>–</span>
                <input
                  type="date"
                  className="input"
                  value={compareRange.end}
                  onChange={(e) => setCompareRange((r) => ({ ...r, end: e.target.value }))}
                  aria-label="Compare to"
                />
              </div>
            </div>
          )}
        </div>
        {badCompare && (
          <p className="mt-3 text-sm" style={{ color: "var(--danger)" }}>
            The comparison ends before it starts.
          </p>
        )}
        {badRange && (
          <p className="mt-3 text-sm" style={{ color: "var(--danger)" }}>
            The end date is before the start date.
          </p>
        )}
        <p className="mt-3 flex items-start gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
          <Icon name="info" size={14} />
          {basis === "stay"
            ? "Stay date counts the nights slept in the period, whenever they were booked."
            : "Booked-on date counts the reservations made in the period, with their whole stay, whenever it falls."}
        </p>
      </div>

      {error && (
        <div className="card card-pad text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {loading && !report && (
        <div className="card card-pad text-sm" style={{ color: "var(--text-muted)" }}>
          Loading the report…
        </div>
      )}

      {report && (
        <div className="space-y-5" style={{ opacity: loading ? 0.55 : 1, transition: "opacity 0.15s" }}>
          <KpiGrid report={report} money={money} />
          <MixSection report={report} money={money} />
          <TrendSection key={`${report.start}|${report.end}|${report.basis}`} report={report} money={money} />
          <SeasonalitySection key={report.basis} report={report} money={money} />
        </div>
      )}
    </div>
  );
}
