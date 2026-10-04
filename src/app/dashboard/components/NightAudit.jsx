"use client";

import { useMemo, useState } from "react";
import Icon from "../../components/Icon";
import { addDays, formatDateISO } from "@/lib/date";
import {
  BookingLink,
  Empty,
  FIX_TAB,
  TONE,
  PageHeader,
  Section,
  Stats,
  Status,
  TableFrame,
  downloadCsv,
  longDate,
  moneyFormatter,
  one,
  timeOf,
  useBookingOpener,
  useReport,
  whole,
} from "./reportKit";

/**
 * The night audit: the close of one business day.
 *
 * Read top to bottom it is the order a night auditor works in -- first what
 * has to be put right before the day can be called closed, then the rooms and
 * who moved, then what the day earned, then what was collected against it.
 * Every exception row opens the stay on the tab where it is fixed, and the
 * report reloads when the stay is saved, so the list shrinks as the desk works
 * through it.
 */


function Exceptions({ report, money, onOpen }) {
  const toFix = report.exceptions.filter((e) => e.tone !== "info");
  const count = toFix.reduce((s, e) => s + e.rows.length, 0);
  return (
    <Section
      title="Before closing the day"
      sub={
        count === 0
          ? "Nothing to put right."
          : `${whole.format(count)} item${count === 1 ? "" : "s"} to put right. Open a booking to fix it; this list updates as you do.`
      }
    >
      {report.exceptions.length === 0 ? (
        <p className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
          <Icon name="check" size={16} /> Every arrival and departure is accounted for, every departed guest is
          settled and invoiced, and every night carries a rate.
        </p>
      ) : (
        <div className="space-y-5">
          {report.exceptions.map((e) => (
            <div key={e.id} className="space-y-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="chip" style={TONE[e.tone]}>
                  {whole.format(e.rows.length)}
                </span>
                <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                  {e.title}
                </span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {e.hint}
                </span>
              </div>
              <TableFrame>
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th>Booking</th>
                      <th>Guest</th>
                      <th>{e.rows[0]?.detail !== undefined ? "Detail" : "Room"}</th>
                      {e.rows[0]?.checkIn !== undefined && <th>Stay</th>}
                      {e.rows.some((r) => r.amount !== undefined) && <th className="text-right">Amount</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {e.rows.map((r, i) => (
                      <tr key={`${r.reservationId}-${i}`}>
                        <td>
                          <BookingLink
                            reference={r.reference}
                            reservationId={r.reservationId}
                            tab={FIX_TAB[e.id] || "details"}
                            onOpen={onOpen}
                          />
                        </td>
                        <td>{r.guest || "–"}</td>
                        <td>
                          {r.detail !== undefined
                            ? r.detail || "–"
                            : [r.room, r.roomType].filter(Boolean).join(" · ") || "Not assigned"}
                        </td>
                        {r.checkIn !== undefined && (
                          <td className="whitespace-nowrap">
                            {longDate(r.checkIn)} – {longDate(r.checkOut)}
                          </td>
                        )}
                        {e.rows.some((x) => x.amount !== undefined) && (
                          <td className="text-right tabular-nums">{r.amount === undefined ? "" : money(r.amount)}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableFrame>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function RoomsAndMovement({ report, money }) {
  const { rooms, movement } = report;
  const lines = [
    ["Arrivals expected", movement.arrivals.expected],
    ["  Checked in", movement.arrivals.arrived],
    ["  Not yet arrived", movement.arrivals.pending],
    ["  No-shows", movement.arrivals.noShows],
    ["Arrivals cancelled", movement.arrivals.cancelled],
    ["Departures expected", movement.departures.expected],
    ["  Checked out", movement.departures.departed],
    ["  Not yet checked out", movement.departures.pending],
    ["Stayovers", movement.stayovers],
    ["Bookings made on this day", movement.newBookings],
  ];
  return (
    <Section title="Rooms and movement" sub={`Tonight, the night of ${longDate(report.date)}`}>
      <Stats
        items={[
          { label: "Occupancy", value: rooms.occupancy == null ? "–" : `${one.format(rooms.occupancy)}%`, sub: `${whole.format(rooms.occupied)} of ${whole.format(rooms.available)} rooms` },
          { label: "Avg room rate (ADR)", value: money(rooms.adr), hint: "Room revenue per paid room tonight; complimentary rooms are left out" },
          { label: "Revenue per room (RevPAR)", value: money(rooms.revpar), hint: "Room revenue per room available tonight" },
          { label: "Guests in house", value: whole.format(movement.guests), sub: `${whole.format(movement.inHouse)} stays` },
          { label: "Vacant rooms", value: whole.format(rooms.vacant) },
          { label: "Out of order", value: whole.format(rooms.outOfOrder), hint: "Rooms blocked on the tape chart for this night, taken off what is available" },
          { label: "Complimentary", value: whole.format(rooms.comp) },
          ...(report.housekeeping
            ? [{ label: "Rooms dirty now", value: whole.format(report.housekeeping.dirty), tone: report.housekeeping.dirty > 0 ? "warn" : null, hint: "From the housekeeping board, as it stands right now" }]
            : []),
        ]}
      />
      <TableFrame>
        <table className="grid-table">
          <tbody>
            {lines.map(([label, value]) => (
              <tr key={label}>
                <td style={label.startsWith("  ") ? { paddingLeft: "1.5rem", color: "var(--text-muted)" } : { fontWeight: 500 }}>
                  {label.trim()}
                </td>
                <td className="text-right tabular-nums">{whole.format(value)}</td>
              </tr>
            ))}
            <tr>
              <td style={{ paddingLeft: "1.5rem", color: "var(--text-muted)" }}>Value of those bookings</td>
              <td className="text-right tabular-nums">{money(movement.newBookingValue)}</td>
            </tr>
          </tbody>
        </table>
      </TableFrame>
    </Section>
  );
}

function Revenue({ report, money }) {
  const { revenue } = report;
  return (
    <Section
      title="Revenue posted"
      sub="The night's room charges, folio lines dated to this day (undated ones go with the arrival), and the taxes on them"
    >
      <TableFrame>
        <table className="grid-table">
          <tbody>
            <tr>
              <td className="font-medium">Room revenue</td>
              <td className="text-right tabular-nums">{money(revenue.room)}</td>
            </tr>
            {revenue.other.map((o) => (
              <tr key={o.name}>
                <td className="font-medium">{o.name}</td>
                <td className="text-right tabular-nums">{money(o.amount)}</td>
              </tr>
            ))}
            {revenue.taxes
              .filter((t) => !t.inclusive)
              .map((t) => (
                <tr key={t.name}>
                  <td style={{ color: "var(--text-muted)" }}>{t.name}</td>
                  <td className="text-right tabular-nums">{money(t.amount)}</td>
                </tr>
              ))}
            <tr>
              <td className="font-semibold">Total</td>
              <td className="text-right font-semibold tabular-nums">{money(revenue.total)}</td>
            </tr>
            {revenue.taxes
              .filter((t) => t.inclusive)
              .map((t) => (
                <tr key={t.name}>
                  <td style={{ color: "var(--text-muted)" }}>Includes {t.name}</td>
                  <td className="text-right tabular-nums" style={{ color: "var(--text-muted)" }}>
                    {money(t.amount)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </TableFrame>
    </Section>
  );
}

function Collections({ report, money, onOpen }) {
  const { summary, rows } = report.payments;
  const live = rows.filter((p) => !p.voidedAt);
  return (
    <Section title="Money collected" sub="Payments recorded on this day, by the desk's clock">
      <Stats
        items={[
          { label: "Received", value: money(summary.received) },
          { label: "Refunded", value: money(summary.refunded) },
          { label: "Net collected", value: money(summary.net) },
          { label: "Invoices issued", value: whole.format(report.invoices.count), sub: money(report.invoices.total) },
          {
            label: "Owed by guests in house",
            value: money(report.ledger.inHouseBalance),
            sub: `${whole.format(report.ledger.inHouseCount)} stays`,
            hint: "What everyone checked in right now still owes on their folio, taxes included",
          },
        ]}
      />
      {summary.byMethod.length > 0 && (
        <TableFrame>
          <table className="grid-table">
            <thead>
              <tr>
                <th>Method</th>
                <th className="text-right">Payments</th>
                <th className="text-right">Received</th>
                <th className="text-right">Refunded</th>
                <th className="text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {summary.byMethod.map((m) => (
                <tr key={m.method}>
                  <td className="font-medium">{m.label}</td>
                  <td className="text-right tabular-nums">{whole.format(m.count)}</td>
                  <td className="text-right tabular-nums">{money(m.received)}</td>
                  <td className="text-right tabular-nums">{money(m.refunded)}</td>
                  <td className="text-right tabular-nums">{money(m.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}
      {live.length === 0 ? (
        <Empty>No payments recorded on this day.</Empty>
      ) : (
        <TableFrame tall>
          <table className="grid-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Booking</th>
                <th>Guest</th>
                <th>Method</th>
                <th>Reference</th>
                <th>Recorded by</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {live.map((p) => (
                <tr key={p.id}>
                  <td className="tabular-nums">{timeOf(p.paidAt)}</td>
                  <td>
                    <BookingLink reference={p.reference} reservationId={p.reservationId} tab="payments" onOpen={onOpen} />
                  </td>
                  <td>{p.guest || "–"}</td>
                  <td>{p.methodLabel}</td>
                  <td>{p.transaction || "–"}</td>
                  <td>{p.recordedBy || "–"}</td>
                  <td className="text-right tabular-nums" style={{ color: p.amount < 0 ? "var(--danger)" : undefined }}>
                    {money(p.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}
    </Section>
  );
}

function exportCsv(report) {
  const r = [];
  r.push(["Night audit", report.date]);
  r.push(["Currency", report.currency]);
  r.push([]);
  r.push(["Rooms"]);
  for (const [k, v] of Object.entries(report.rooms)) r.push([k, v]);
  r.push([]);
  r.push(["Movement"]);
  for (const [k, v] of Object.entries(report.movement)) {
    if (typeof v === "object") for (const [k2, v2] of Object.entries(v)) r.push([`${k} ${k2}`, v2]);
    else r.push([k, v]);
  }
  r.push([]);
  r.push(["Revenue posted"]);
  r.push(["Room revenue", report.revenue.room]);
  for (const o of report.revenue.other) r.push([o.name, o.amount]);
  for (const t of report.revenue.taxes) r.push([t.inclusive ? `Includes ${t.name}` : t.name, t.amount]);
  r.push(["Total", report.revenue.total]);
  r.push([]);
  r.push(["Payments", "Time", "Booking", "Guest", "Method", "Reference", "Recorded by", "Amount", "Voided", "Void reason"]);
  for (const p of report.payments.rows) {
    r.push(["", p.paidAt, p.reference, p.guest, p.methodLabel, p.transaction, p.recordedBy, p.amount, p.voidedAt || "", p.voidReason || ""]);
  }
  r.push([]);
  r.push(["Exceptions", "Booking", "Guest", "Room / detail", "Check-in", "Check-out", "Amount"]);
  for (const e of report.exceptions) {
    for (const x of e.rows) {
      r.push([e.title, x.reference, x.guest, x.detail ?? x.room, x.checkIn, x.checkOut, x.amount]);
    }
  }
  downloadCsv(`night-audit-${report.date}.csv`, r);
}

export default function NightAudit({ session }) {
  const propertyId = session?.propertyId || null;
  const todayIso = formatDateISO(new Date());
  const [date, setDate] = useState(todayIso);

  const { report, loading, error, reload } = useReport("/api/reports/nightaudit", date ? { date } : null, propertyId);
  const { openBooking, modal } = useBookingOpener(session, reload);
  const money = useMemo(() => moneyFormatter(report?.currency || "INR"), [report?.currency]);

  const step = (days) => setDate((d) => formatDateISO(addDays(d, days)));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Night Audit"
        blurb="The close of a business day: what to put right, who arrived and left, what the day earned and what was collected."
        actions={
          <button type="button" className="btn btn-secondary text-sm" onClick={() => report && exportCsv(report)} disabled={!report || loading}>
            Download CSV
          </button>
        }
      />

      <div className="card card-pad">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="audit-date">
              Business date
            </label>
            <input id="audit-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary text-sm" onClick={() => step(-1)} aria-label="Previous day">
              ‹ Previous day
            </button>
            <button type="button" className="btn btn-secondary text-sm" onClick={() => step(1)} aria-label="Next day">
              Next day ›
            </button>
            {date !== todayIso && (
              <button type="button" className="btn btn-ghost text-sm" onClick={() => setDate(todayIso)}>
                Today
              </button>
            )}
          </div>
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
          <Icon name="info" size={14} />
          Worked out from the folios as they stand now, so a day already audited changes if a stay on it is edited
          later. Download the CSV to keep the day as it was when you closed it.
        </p>
      </div>

      <Status loading={loading} error={error} report={report} />

      {report && (
        <div className="space-y-5" style={{ opacity: loading ? 0.55 : 1, transition: "opacity 0.15s" }}>
          <Exceptions report={report} money={money} onOpen={openBooking} />
          <RoomsAndMovement report={report} money={money} />
          <div className="grid gap-5 xl:grid-cols-2">
            <Revenue report={report} money={money} />
            <Collections report={report} money={money} onOpen={openBooking} />
          </div>
        </div>
      )}

      {modal}
    </div>
  );
}
