"use client";

import { useMemo, useRef, useState } from "react";
import { Grid } from "./SetupGrid";
import { effectiveBounds } from "@/lib/pricingStrategy";
import { occupancySignal, weekdaySignal, recommendRate } from "@/lib/pricingSignals";
import {
  PRESETS,
  PRESET_LABELS,
  WEEKDAY_NAMES,
  bandLabels,
  columnLabels,
  presetOf,
  presetScale,
  resolveAdjustments,
  resolveScales,
  rulesFor,
} from "@/lib/pricingScales";
import { addDays, formatDateISO, parseDateISO } from "@/lib/date";

/**
 * Scales & rules: what each signal does with what it reads, and the
 * hotelier's own discounts and premiums on top.
 *
 * Grouped by the question a hotelier asks -- "what do I give away close in",
 * "what happens when I'm empty", "how does this compare with before" -- and
 * every table starts filled with the numbers pricing already uses, so nothing
 * here has to be typed for pricing to work. The preview at the top runs the
 * same functions the engine does, so it shows what a change will really do.
 */

const num = (v) => (v === "" || v == null ? "" : Number(v));
const signed = (n) => `${n > 0 ? "+" : ""}${Math.round(n * 10) / 10}`;
const money = (n) => (n == null ? "—" : Math.round(n).toLocaleString("en-IN"));

function Section({ title, sub, children }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="h2">{title}</h3>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function Sub({ title, hint, right, children }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="label" style={{ marginBottom: 0 }}>
            {title}
          </p>
          {hint && <p className="text-xs muted">{hint}</p>}
        </div>
        {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
      </div>
      {children}
    </div>
  );
}

function NumIn({ value, onChange, width = 72, label, ...rest }) {
  return (
    <input
      type="number"
      className="cm-input"
      style={{ width }}
      aria-label={label}
      value={value ?? ""}
      onChange={(e) => onChange(num(e.target.value))}
      {...rest}
    />
  );
}

function RemoveBtn({ onClick, label }) {
  return (
    <button type="button" className="btn btn-ghost" style={{ padding: "2px 8px" }} onClick={onClick} aria-label={label} title={label}>
      ✕
    </button>
  );
}

function PresetPicker({ scaleKey, scale, onPick }) {
  const current = presetOf(scaleKey, scale);
  return (
    <select
      className="input"
      style={{ width: "auto" }}
      aria-label="Start from"
      value={current}
      onChange={(e) => e.target.value !== "custom" && onPick(presetScale(scaleKey, e.target.value))}
    >
      {Object.keys(PRESETS[scaleKey]).map((k) => (
        <option key={k} value={k}>
          {PRESET_LABELS[k]}
        </option>
      ))}
      <option value="custom" disabled>
        Custom
      </option>
    </select>
  );
}

/* ------------------------------------------------------------- preview */

function TryIt({ rooms, strategy, scales, adjustments }) {
  const priced = rooms.filter((r) => r.basePrice != null);
  const [roomId, setRoomId] = useState(priced[0]?.roomTypeId || "");
  const [date, setDate] = useState(formatDateISO(addDays(new Date(), 3)));
  const [occ, setOcc] = useState(30);
  const [gap, setGap] = useState("");

  const room = priced.find((r) => r.roomTypeId === roomId) || priced[0];
  if (!room) {
    return (
      <div className="card card-pad sub">
        Give your rooms a base rate in Rate Plan Setup to see a preview here.
      </div>
    );
  }

  const today = formatDateISO(new Date());
  const daysOut = Math.max(0, Math.round((parseDateISO(date) - parseDateISO(today)) / 86400000));
  const base = room.basePrice;
  const result = recommendRate({
    currentRate: base,
    signals: {
      occupancy: occupancySignal({ occupancyPct: Number(occ) || 0, daysOut, scale: scales.occupancy }),
      weekday: weekdaySignal({ stayDate: date, scale: scales.weekday }),
    },
    weights: { occupancy: 1, weekday: 0.5 },
    maxChangePct: Number(strategy?.max_change_pct ?? 20),
    bounds: effectiveBounds(
      { base_price: base },
      { floor_rate: room.floor === "" ? null : room.floor, ceiling_rate: room.ceiling === "" ? null : room.ceiling },
      strategy
    ),
    rules: rulesFor({ adjustments, daysOut, gapNights: gap === "" ? null : Number(gap), rate: base }),
  });
  const change = ((result.rate - base) / base) * 100;

  return (
    <div className="card card-pad space-y-2" style={{ borderColor: "var(--accent)" }}>
      <p className="label" style={{ marginBottom: 0 }}>
        Try it
      </p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select className="input" style={{ width: "auto" }} value={room.roomTypeId} onChange={(e) => setRoomId(e.target.value)} aria-label="Room">
          {priced.map((r) => (
            <option key={r.roomTypeId} value={r.roomTypeId}>
              {r.name}
            </option>
          ))}
        </select>
        <span>on</span>
        <input type="date" className="input" style={{ width: "auto" }} min={today} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Night" />
        <span>with</span>
        <NumIn value={occ} onChange={setOcc} width={64} label="Occupancy %" min={0} max={100} />
        <span>% sold,</span>
        <select className="input" style={{ width: "auto" }} value={gap} onChange={(e) => setGap(e.target.value)} aria-label="Gap">
          <option value="">not a gap</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              in a {n}-night gap
            </option>
          ))}
        </select>
      </div>
      <p className="text-sm">
        <strong>
          {money(base)} → {money(result.rate)}
        </strong>{" "}
        <span className="muted">
          ({signed(change)}%, {daysOut} day{daysOut === 1 ? "" : "s"} out)
        </span>
      </p>
      <ul className="text-xs muted" style={{ margin: 0, paddingLeft: "1.1rem" }}>
        {result.reasons.map((r, i) => (
          <li key={i}>
            {r.note}
            {r.pct != null && r.signal !== "rule" ? ` (${signed(r.pct)}%)` : ""}
          </li>
        ))}
      </ul>
      <p className="text-xs muted">
        Shown from the base rate with occupancy and day of week only. Pace, pickup, past rates and events also count once they have data.
      </p>
    </div>
  );
}

/* --------------------------------------------------------- rule tables */

const LM_TYPES = [
  { value: "pct", label: "% (same every day)" },
  { value: "gradual", label: "% building up to the day" },
  { value: "amount", label: "Amount a night" },
];

function RuleTable({ columns, rows, onChange, blank, addLabel, empty }) {
  const update = (i, field, value) => onChange(rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  return (
    <>
      {rows.length > 0 ? (
        <Grid>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.field}>{c.label}</th>
              ))}
              <th style={{ width: 48 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.field}>
                    {c.options ? (
                      <select className="cm-input" value={r[c.field] || c.options[0].value} onChange={(e) => update(i, c.field, e.target.value)} aria-label={c.label}>
                        {c.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <NumIn value={r[c.field]} onChange={(v) => update(i, c.field, v)} label={c.label} />
                    )}
                  </td>
                ))}
                <td>
                  <RemoveBtn label="Remove rule" onClick={() => onChange(rows.filter((_, j) => j !== i))} />
                </td>
              </tr>
            ))}
          </tbody>
        </Grid>
      ) : (
        <p className="text-xs muted">{empty}</p>
      )}
      <button type="button" className="btn btn-secondary" onClick={() => onChange([...rows, { ...blank }])}>
        + {addLabel}
      </button>
    </>
  );
}

/* --------------------------------------------------------- band tables */

function BandTable({ rows, unit, measure, onChange }) {
  const labels = bandLabels(rows, unit);
  const update = (i, field, value) => onChange(rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  const addRow = () => {
    const at = rows.length - 1;
    const prev = at > 0 ? Number(rows[at - 1].below) || 0 : 0;
    onChange([...rows.slice(0, at), { below: prev + 10, pct: rows[at].pct }, rows[at]]);
  };
  return (
    <>
      <Grid>
        <thead>
          <tr>
            <th className="cm-sticky">{measure}</th>
            <th>Move</th>
            <th style={{ width: 48 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="cm-sticky">
                {r.below == null ? (
                  labels[i]
                ) : (
                  <span className="flex items-center gap-1">
                    Under <NumIn value={r.below} onChange={(v) => update(i, "below", v)} width={64} label="Under" /> {unit}
                  </span>
                )}
              </td>
              <td>
                <span className="flex items-center gap-1">
                  <NumIn value={r.pct} onChange={(v) => update(i, "pct", v)} label="Move %" /> %
                </span>
              </td>
              <td>{r.below != null && rows.length > 2 && <RemoveBtn label="Remove band" onClick={() => onChange(rows.filter((_, j) => j !== i))} />}</td>
            </tr>
          ))}
        </tbody>
      </Grid>
      <button type="button" className="btn btn-secondary" onClick={addRow}>
        + Add band
      </button>
    </>
  );
}

function Follower({ value, onChange, what }) {
  return (
    <div className="card card-pad flex flex-wrap items-center gap-2 text-sm">
      <span>Ignore differences under</span>
      <NumIn value={value.ignore} onChange={(v) => onChange({ ...value, ignore: v })} width={64} label="Ignore under %" />
      <span>%. Otherwise move</span>
      <NumIn value={value.share} onChange={(v) => onChange({ ...value, share: v })} width={72} label="Share %" />
      <span>% of the way towards {what}.</span>
    </div>
  );
}

/* ------------------------------------------------------ occupancy matrix */

function toCsv(m) {
  const head = ["occupancy under %", ...m.cols.map((c) => (c == null ? "beyond" : c))];
  const lines = m.rows.map((r) => [r.below == null ? "above" : r.below, ...r.pcts]);
  return [head, ...lines].map((l) => l.join(",")).join("\n");
}

function fromCsv(text) {
  const lines = text.trim().split(/\r?\n/).map((l) => l.split(",").map((c) => c.trim()));
  if (lines.length < 2) throw new Error("The file needs a heading line and at least one row.");
  const cols = lines[0].slice(1).map((c, i, all) => (i === all.length - 1 ? null : Number(c)));
  const rows = lines.slice(1).map((l, i, all) => ({
    below: i === all.length - 1 ? null : Number(l[0]),
    pcts: l.slice(1, cols.length + 1).map(Number),
  }));
  if (cols.some((c, i) => i < cols.length - 1 && !Number.isFinite(c)) || rows.some((r) => r.pcts.length !== cols.length || r.pcts.some((p) => !Number.isFinite(p)))) {
    throw new Error("Every box needs a number. Download the table first to see the layout.");
  }
  return { cols, rows };
}

function OccupancyMatrix({ value, onChange }) {
  const fileRef = useRef(null);
  const [csvError, setCsvError] = useState("");
  const labels = columnLabels(value.cols);
  const rowLabels = bandLabels(value.rows);

  const setCell = (ri, ci, v) =>
    onChange({ ...value, rows: value.rows.map((r, i) => (i === ri ? { ...r, pcts: r.pcts.map((p, j) => (j === ci ? v : p)) } : r)) });
  const setBelow = (ri, v) => onChange({ ...value, rows: value.rows.map((r, i) => (i === ri ? { ...r, below: v } : r)) });
  const setCol = (ci, v) => onChange({ ...value, cols: value.cols.map((c, i) => (i === ci ? v : c)) });

  const addColumn = () => {
    if (value.cols.length >= 8) return;
    const at = value.cols.length - 1;
    const prev = at > 0 ? Number(value.cols[at - 1]) || 0 : 0;
    onChange({
      cols: [...value.cols.slice(0, at), prev + 30, null],
      rows: value.rows.map((r) => ({ ...r, pcts: [...r.pcts.slice(0, at), r.pcts[at], r.pcts[at]] })),
    });
  };
  const removeColumn = (ci) => {
    const cols = value.cols.filter((_, i) => i !== ci);
    cols[cols.length - 1] = null;
    onChange({ cols, rows: value.rows.map((r) => ({ ...r, pcts: r.pcts.filter((_, i) => i !== ci) })) });
  };
  const addRow = () => {
    const at = value.rows.length - 1;
    const prev = at > 0 ? Number(value.rows[at - 1].below) || 0 : 0;
    onChange({ ...value, rows: [...value.rows.slice(0, at), { below: Math.min(99, prev + 10), pcts: [...value.rows[at].pcts] }, value.rows[at]] });
  };

  const download = () => {
    const blob = new Blob([toCsv(value)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "occupancy-scale.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const upload = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        onChange(fromCsv(String(reader.result)));
        setCsvError("");
      } catch (e) {
        setCsvError(e.message);
      }
    };
    reader.readAsText(file);
  };

  return (
    <>
      <Grid>
        <thead>
          <tr>
            <th className="cm-sticky">Sold</th>
            {value.cols.map((c, ci) => (
              <th key={ci} style={{ minWidth: 104 }}>
                <span className="flex items-center gap-1">
                  {c == null ? (
                    <span>{labels[ci]} days</span>
                  ) : (
                    <>
                      <span>{ci === 0 ? "0" : Number(value.cols[ci - 1]) + 1}–</span>
                      <NumIn value={c} onChange={(v) => setCol(ci, v)} width={56} label="Last day of column" />
                    </>
                  )}
                  {value.cols.length > 1 && <RemoveBtn label="Remove column" onClick={() => removeColumn(ci)} />}
                </span>
              </th>
            ))}
            <th style={{ width: 48 }} />
          </tr>
        </thead>
        <tbody>
          {value.rows.map((r, ri) => (
            <tr key={ri}>
              <td className="cm-sticky">
                {r.below == null ? (
                  rowLabels[ri]
                ) : (
                  <span className="flex items-center gap-1">
                    Under <NumIn value={r.below} onChange={(v) => setBelow(ri, v)} width={56} label="Under %" /> %
                  </span>
                )}
              </td>
              {r.pcts.map((p, ci) => (
                <td key={ci}>
                  <NumIn value={p} onChange={(v) => setCell(ri, ci, v)} label={`${rowLabels[ri]}, ${labels[ci]} days`} />
                </td>
              ))}
              <td>{r.below != null && value.rows.length > 2 && <RemoveBtn label="Remove row" onClick={() => onChange({ ...value, rows: value.rows.filter((_, i) => i !== ri) })} />}</td>
            </tr>
          ))}
        </tbody>
      </Grid>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-secondary" onClick={addRow}>
          + Add row
        </button>
        <button type="button" className="btn btn-secondary" onClick={addColumn} disabled={value.cols.length >= 8}>
          + Add column
        </button>
        <span className="muted">·</span>
        <button type="button" className="btn btn-secondary" onClick={download}>
          Download
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
          Upload
        </button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
        {csvError && (
          <span className="text-xs" style={{ color: "var(--danger)" }}>
            {csvError}
          </span>
        )}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- page */

export default function PricingRules({ rooms, strategy, setField }) {
  const scales = useMemo(() => resolveScales(strategy?.scales), [strategy?.scales]);
  const adjustments = useMemo(() => resolveAdjustments(strategy?.adjustments), [strategy?.adjustments]);

  const setScale = (key, value) => setField("scales", { ...scales, [key]: value });
  const setRules = (key, value) => setField("adjustments", { ...adjustments, [key]: value });

  return (
    <div className="space-y-6">
      <TryIt rooms={rooms} strategy={strategy} scales={scales} adjustments={adjustments} />

      <Section
        title="Discounts and premiums you set"
        sub="Your own rules, added after pricing has worked out the rate. Use a minus for a discount: -10 means 10% off. Your lowest and highest rates still apply."
      >
        <Sub title="Close to arrival" hint="If more than one fits, the shortest window wins.">
          <RuleTable
            columns={[
              { field: "within", label: "Within (days)" },
              { field: "type", label: "How", options: LM_TYPES },
              { field: "value", label: "Value" },
            ]}
            rows={adjustments.last_minute}
            onChange={(v) => setRules("last_minute", v)}
            blank={{ within: 3, type: "pct", value: -10 }}
            addLabel="Add rule"
            empty="No close-to-arrival rule. Pricing still lowers empty nights through occupancy below."
          />
        </Sub>
        <Sub title="Booking far ahead" hint="A plus charges more for early bookings; a minus gives an early-bird discount.">
          <RuleTable
            columns={[
              { field: "beyond", label: "More than (days) ahead" },
              { field: "value", label: "%" },
            ]}
            rows={adjustments.far_out}
            onChange={(v) => setRules("far_out", v)}
            blank={{ beyond: 90, value: 10 }}
            addLabel="Add rule"
            empty="No far-ahead rule."
          />
        </Sub>
        <Sub title="Short gaps between bookings" hint="Free nights with a full night on both sides, which only a short stay can fill.">
          <RuleTable
            columns={[
              { field: "nights", label: "Gap of up to (nights)" },
              { field: "value", label: "%" },
            ]}
            rows={adjustments.orphan_gaps}
            onChange={(v) => setRules("orphan_gaps", v)}
            blank={{ nights: 2, value: -10 }}
            addLabel="Add rule"
            empty="No short-gap rule."
          />
        </Sub>
      </Section>

      <Section title="When you're empty or full" sub="How pricing reacts to what you have sold. Start from a ready-made scale and change any box.">
        <Sub
          title="Occupancy by days before arrival"
          hint="30% sold three days out is a problem; 30% sold two months out is normal. Each box is the move for that mix."
          right={<PresetPicker scaleKey="occupancy" scale={scales.occupancy} onPick={(v) => setScale("occupancy", v)} />}
        >
          <OccupancyMatrix value={scales.occupancy} onChange={(v) => setScale("occupancy", v)} />
        </Sub>
        <Sub
          title="Pace against last year"
          hint="Rooms booked now as a % of what was booked this many days out last year. Waits until you have last year's bookings."
          right={<PresetPicker scaleKey="pace" scale={scales.pace} onPick={(v) => setScale("pace", v)} />}
        >
          <BandTable rows={scales.pace.rows} unit="%" measure="Booked vs last year" onChange={(rows) => setScale("pace", { rows })} />
        </Sub>
        <Sub
          title="Bookings this week"
          hint="This week's bookings for a night as a % of a usual week."
          right={<PresetPicker scaleKey="pickup" scale={scales.pickup} onPick={(v) => setScale("pickup", v)} />}
        >
          <BandTable rows={scales.pickup.rows} unit="%" measure="This week vs usual" onChange={(rows) => setScale("pickup", { rows })} />
        </Sub>
      </Section>

      <Section title="Compared with your past" sub="How far your own history pulls the rate.">
        <Sub title="Last year, same date" hint="When this date sold above or below your recent average last year.">
          <Follower value={scales.adr_ly} onChange={(v) => setScale("adr_ly", v)} what="last year's level" />
        </Sub>
        <Sub title="Last 90 days" hint="The average rate you actually sold at recently.">
          <Follower value={scales.adr_90} onChange={(v) => setScale("adr_90", v)} what="your 90-day average" />
        </Sub>
        <Sub title="Day of the week" hint="The move for each night of the week.">
          <Grid>
            <thead>
              <tr>
                {WEEKDAY_NAMES.map((d) => (
                  <th key={d}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {scales.weekday.pcts.map((p, i) => (
                  <td key={i}>
                    <NumIn
                      value={p}
                      width={60}
                      label={`${WEEKDAY_NAMES[i]} %`}
                      onChange={(v) => setScale("weekday", { pcts: scales.weekday.pcts.map((x, j) => (j === i ? v : x)) })}
                    />
                  </td>
                ))}
              </tr>
            </tbody>
          </Grid>
        </Sub>
      </Section>
    </div>
  );
}
