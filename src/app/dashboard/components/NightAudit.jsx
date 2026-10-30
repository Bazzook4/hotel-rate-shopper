"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePageNav } from "@/app/components/PageNav";
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
import { usePageState } from "./usePageState";
import { useFrontDesk } from "./frontDesk";
import DateField from "@/app/components/DateField";
import { hotelToday } from "@/lib/hotelTime";

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


/**
 * The checks a day must pass before it is closed, in the order a night
 * auditor works. A check that passes is a tick; one that fails lists its
 * bookings, each with the fix as a button on the row -- check in, check
 * out, collect, mark clean -- so the list empties as the desk works down it.
 * Only the checks with something to do take up room.
 */
const CHECKS = [
  { id: "arrivals", ok: "Every arrival checked in or marked no-show" },
  { id: "departures", ok: "Every departure checked out" },
  { id: "balance", ok: "Every departed guest settled" },
  { id: "invoice", ok: "Every departed guest invoiced" },
  { id: "zero", ok: "Every night has a rate" },
  { id: "noroom", ok: "Every guest in house has a room" },
  { id: "inquiry", ok: "No inquiry still holding a room today" },
  { id: "dirty", ok: "Every arriving guest's room is clean" },
];

/** The fix for each kind of row, as the buttons on it. */
const FIXES = {
  arrivals: [
    { label: "Check in", desk: "checkIn", primary: true },
    { label: "No show", status: "no_show" },
  ],
  departures: [{ label: "Check out", desk: "checkOut", primary: true }],
  balance: [{ label: "Collect payment", open: "payments", primary: true }],
  invoice: [{ label: "Issue invoice", open: "invoices", primary: true }],
  zero: [{ label: "Set the rate", open: "inclusions", primary: true }],
  noroom: [{ label: "Assign a room", open: "details", primary: true }],
  inquiry: [
    { label: "Confirm", status: "confirmed", primary: true },
    { label: "Open", open: "details" },
  ],
  dirty: [{ label: "Mark clean", clean: true, primary: true }],
};

/** An audit row as the shared front-desk actions expect a booking. */
const asBooking = (r, currency) => ({
  id: r.reservationId,
  reference: r.reference,
  guest_name: r.guest,
  check_in: r.checkIn,
  check_out: r.checkOut,
  room_id: r.roomId,
  room_type_id: r.roomTypeId,
  currency: r.currency || currency,
});

function Exceptions({ report, money, onOpen, propertyId, onChanged }) {
  const desk = useFrontDesk(propertyId);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");

  const failing = report.exceptions.filter((e) => e.tone !== "info");
  const failingIds = new Set(failing.map((e) => e.id));
  const passed = CHECKS.filter((c) => !failingIds.has(c.id));
  const info = report.exceptions.filter((e) => e.tone === "info");

  async function fix(e, r, f) {
    if (f.open) {
      onOpen(r.reservationId, f.open);
      return;
    }
    const key = `${e.id}-${r.reservationId}-${f.label}`;
    setBusy(key);
    setError("");
    try {
      if (f.desk) {
        const done = await desk[f.desk](asBooking(r, report.currency));
        if (!done) return;
      } else if (f.status) {
        const res = await fetch("/api/pms/reservations/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: r.reservationId, status: f.status }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not update the booking");
      } else if (f.clean) {
        const res = await fetch("/api/pms/housekeeping", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ property_id: propertyId, ids: [r.roomId], status: "clean" }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not mark the room clean");
      }
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section
      title="Before closing the day"
      sub={
        failing.length === 0
          ? `All ${CHECKS.length} checks pass.`
          : `${passed.length} of ${CHECKS.length} checks pass. Fix each row here; the list updates as you go.`
      }
    >
      <div className="space-y-5">
        {error && (
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}

        {failing.map((e) => (
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
                    <th>Room</th>
                    <th>Stay</th>
                    {e.rows.some((r) => r.amount !== undefined) && <th className="text-right">Amount</th>}
                    <th className="text-right">Fix</th>
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
                      <td>{r.guest || "-"}</td>
                      <td>
                        {[r.room, r.roomType].filter(Boolean).join(", ") || "No room yet"}
                        {r.detail && (
                          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                            {r.detail}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        {r.checkIn ? `${longDate(r.checkIn)} to ${longDate(r.checkOut)}` : "-"}
                      </td>
                      {e.rows.some((x) => x.amount !== undefined) && (
                        <td className="text-right tabular-nums">{r.amount === undefined ? "" : money(r.amount)}</td>
                      )}
                      <td className="text-right whitespace-nowrap">
                        {(FIXES[e.id] || [{ label: "Open", open: FIX_TAB[e.id] || "details" }]).map((f) => {
                          const key = `${e.id}-${r.reservationId}-${f.label}`;
                          return (
                            <button
                              key={f.label}
                              type="button"
                              className={`btn text-xs ml-1 ${f.primary ? "btn-primary" : "btn-ghost"}`}
                              disabled={busy !== null || (f.clean && !r.roomId)}
                              onClick={() => fix(e, r, f)}
                            >
                              {busy === key ? "..." : f.label}
                            </button>
                          );
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          </div>
        ))}

        {passed.length > 0 && (
          <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {passed.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
                <span style={{ color: "var(--accent)" }}>
                  <Icon name="check" size={16} strokeWidth={2.2} />
                </span>
                {c.ok}
              </li>
            ))}
          </ul>
        )}

        {/* For the auditor to check against the drawer: nothing to fix. */}
        {info.map((e) => (
          <div key={e.id} className="space-y-1">
            <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              {e.title} <span className="font-normal" style={{ color: "var(--text-muted)" }}>({e.rows.length})</span>
            </p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {e.hint}
            </p>
            <ul className="text-sm">
              {e.rows.map((r, i) => (
                <li key={i} className="flex flex-wrap gap-x-3">
                  <BookingLink reference={r.reference} reservationId={r.reservationId} tab={FIX_TAB[e.id] || "details"} onOpen={onOpen} />
                  <span>{r.guest || "-"}</span>
                  <span style={{ color: "var(--text-muted)" }}>{r.detail}</span>
                  <span className="tabular-nums">{money(r.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {desk.settleDialog}
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
          { label: "Occupancy", value: rooms.occupancy == null ? "-" : `${one.format(rooms.occupancy)}%`, sub: `${whole.format(rooms.occupied)} of ${whole.format(rooms.available)} rooms` },
          { label: "Avg room rate (ADR)", value: money(rooms.adr), hint: "Room revenue per paid room tonight; complimentary rooms are left out" },
          { label: "Revenue per room (RevPAR)", value: money(rooms.revpar), hint: "Room revenue per room available tonight" },
          { label: "Guests checked in", value: whole.format(movement.guests), sub: `${whole.format(movement.inHouse)} stays` },
          { label: "Vacant rooms", value: whole.format(rooms.vacant) },
          { label: "Out of order", value: whole.format(rooms.outOfOrder), hint: "Rooms set out of order on the Calendar or Housekeeping for this night" },
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
      sub="Room charges, services and tax for this night"
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
            <tr className="grid-total">
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
            label: "Owed by checked-in guests",
            value: money(report.ledger.inHouseBalance),
            sub: `${whole.format(report.ledger.inHouseCount)} stays`,
            hint: "What guests checked in now still owe, with tax",
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
                  <td>{p.guest || "-"}</td>
                  <td>{p.methodLabel}</td>
                  <td>{p.transaction || "-"}</td>
                  <td>{p.recordedBy || "-"}</td>
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

/**
 * Closing the day in one place: what is left to fix, the cash count and the
 * police register, then one button that keeps a copy of the day as it is.
 * Before, the day ended on three pages and nothing said it was done.
 */
function CloseDay({ date, report, money, propertyId }) {
  const nav = usePageNav();
  const [state, setState] = useState({ ready: true, close: null, loaded: false });
  const [cash, setCash] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const qs = useCallback(() => {
    const q = new URLSearchParams({ date });
    if (propertyId) q.set("propertyId", propertyId);
    return q.toString();
  }, [date, propertyId]);

  useEffect(() => {
    let live = true;
    setError("");
    fetch(`/api/reports/nightaudit/close?${qs()}`)
      .then((r) => r.json().then((b) => ({ ok: r.ok, b })))
      .then(({ ok, b }) => live && setState(ok ? { ...b, loaded: true } : { ready: true, close: null, loaded: true }))
      .catch(() => live && setState({ ready: true, close: null, loaded: true }));
    return () => {
      live = false;
    };
  }, [qs]);

  if (!state.loaded || !state.ready) return null;
  const left = (report?.exceptions || []).reduce((n, e) => n + e.rows.length, 0);

  if (state.close) {
    const c = state.close;
    return (
      <div className="note note-ok">
        <Icon name="check" size={16} />
        <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
          <span>
            Day closed{c.closed_by_name ? ` by ${c.closed_by_name}` : ""} at{" "}
            {new Date(c.closed_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            {c.cash_counted != null ? `, cash counted ${money(c.cash_counted)}` : ""}. The figures below are live; the closed copy is kept.
          </span>
          <button type="button" className="btn btn-secondary text-xs" onClick={() => exportCsv(c.snapshot)}>
            Download closed copy
          </button>
        </div>
      </div>
    );
  }

  async function close() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/reports/nightaudit/close?${qs()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cash_counted: cash }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not close the day");
      setState({ ...body, loaded: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad space-y-3">
      <h3 className="h2">Close the day</h3>
      <ol className="space-y-2 text-sm">
        <li className="flex flex-wrap items-center gap-2">
          <Icon name={left ? "warn" : "check"} size={16} />
          {left ? `${left} thing${left === 1 ? "" : "s"} to fix in the list below` : "Nothing left to fix"}
        </li>
        <li className="flex flex-wrap items-center gap-2">
          <Icon name="money" size={16} />
          <label htmlFor="close-cash">Cash counted in the drawer</label>
          <input
            id="close-cash"
            className="input"
            style={{ width: 140 }}
            type="number"
            inputMode="decimal"
            min="0"
            value={cash}
            onChange={(e) => setCash(e.target.value)}
          />
          {nav.canOpen("cashbook") && (
            <button type="button" className="btn btn-ghost text-xs" onClick={() => nav.openPage("cashbook")}>
              Open Cash
            </button>
          )}
        </li>
        <li className="flex flex-wrap items-center gap-2">
          <Icon name="file" size={16} />
          Print the police register
          {nav.canOpen("policereport") && (
            <button type="button" className="btn btn-ghost text-xs" onClick={() => nav.openPage("policereport")}>
              Open Police
            </button>
          )}
        </li>
      </ol>
      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
      <button type="button" className="btn btn-primary text-sm" disabled={busy || !report} onClick={close}>
        {busy ? "Closing..." : "Close the day"}
      </button>
    </div>
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
  const todayIso = hotelToday();
  const [date, setDate] = usePageState("nightaudit.date", todayIso);

  const { report, loading, error, reload } = useReport("/api/reports/nightaudit", date ? { date } : null, propertyId);
  const { openBooking, modal } = useBookingOpener(session, reload);
  const money = useMemo(() => moneyFormatter(report?.currency, { decimals: 2 }), [report?.currency]);

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
            <DateField id="audit-date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary text-sm" onClick={() => step(-1)} aria-label="Previous day">
              <Icon name="left" size={14} /> Previous day
            </button>
            <button type="button" className="btn btn-secondary text-sm" onClick={() => step(1)} aria-label="Next day">
              Next day <Icon name="right" size={14} />
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
          Worked out live from the bills. Close the day to keep a copy as it is now.
        </p>
      </div>

      <Status loading={loading} error={error} report={report} />

      {report && (
        <div className="space-y-5" style={{ opacity: loading ? 0.55 : 1, transition: "opacity 0.15s" }}>
          <CloseDay date={date} report={report} money={money} propertyId={propertyId} />
          <Exceptions report={report} money={money} onOpen={openBooking} propertyId={propertyId} onChanged={reload} />
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
