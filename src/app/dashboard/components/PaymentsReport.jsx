"use client";

import { useMemo, useState } from "react";
import Icon from "../../components/Icon";
import {
  BookingLink,
  Empty,
  PageHeader,
  PeriodPicker,
  Section,
  Stats,
  Status,
  TableFrame,
  downloadCsv,
  longDate,
  moneyFormatter,
  timeOf,
  useBookingOpener,
  usePeriod,
  useReport,
  whole,
} from "./reportKit";
import { SortTh, useSort } from "./useSort";

/**
 * Payments: the money taken over a period, for the cash-up and the bank.
 *
 * Organised the way it is reconciled: the totals by method first (the cash
 * drawer, the card terminal's settlement, the UPI statement each check
 * against one line), then day by day, then who took it, then every payment.
 * Voided payments are kept out of every total and listed on their own, since
 * a void is exactly what a reconciliation has to be able to explain.
 */

/** Methods in a fixed order, so columns do not move between periods. */
const METHOD_ORDER = ["cash", "card", "upi", "bank_transfer", "ota", "other"];

function ByMethod({ report, money }) {
  const { byMethod } = report.summary;
  return (
    <Section title="By method" sub="Paid to OTA is money the channel collected, not money in the hotel's hands">
      {byMethod.length === 0 ? (
        <Empty>No payments in this period.</Empty>
      ) : (
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
              {byMethod.map((m) => (
                <tr key={m.method}>
                  <td className="font-medium">{m.label}</td>
                  <td className="text-right tabular-nums">{whole.format(m.count)}</td>
                  <td className="text-right tabular-nums">{money(m.received)}</td>
                  <td className="text-right tabular-nums">{money(m.refunded)}</td>
                  <td className="text-right font-medium tabular-nums">{money(m.net)}</td>
                </tr>
              ))}
              <tr>
                <td className="font-semibold">Total</td>
                <td className="text-right font-semibold tabular-nums">{whole.format(report.summary.count)}</td>
                <td className="text-right font-semibold tabular-nums">{money(report.summary.received)}</td>
                <td className="text-right font-semibold tabular-nums">{money(report.summary.refunded)}</td>
                <td className="text-right font-semibold tabular-nums">{money(report.summary.net)}</td>
              </tr>
            </tbody>
          </table>
        </TableFrame>
      )}
    </Section>
  );
}

function ByDay({ report, money, methods }) {
  const [hideEmpty, setHideEmpty] = useState(true);
  const days = hideEmpty ? report.byDay.filter((d) => d.count > 0) : report.byDay;
  return (
    <Section
      title="By day"
      sub="Net collected each day, split by method"
      actions={
        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
          <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
          Hide days with no payments
        </label>
      }
    >
      {days.length === 0 ? (
        <Empty>No payments in this period.</Empty>
      ) : (
        <TableFrame tall>
          <table className="grid-table">
            <thead>
              <tr>
                <th>Date</th>
                <th className="text-right">Payments</th>
                {methods.map((m) => (
                  <th key={m} className="text-right">
                    {report.methods[m] || m}
                  </th>
                ))}
                <th className="text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date}>
                  <td className="whitespace-nowrap">{longDate(d.date)}</td>
                  <td className="text-right tabular-nums">{whole.format(d.count)}</td>
                  {methods.map((m) => (
                    <td key={m} className="text-right tabular-nums">
                      {d.byMethod[m] ? money(d.byMethod[m]) : "–"}
                    </td>
                  ))}
                  <td className="text-right font-medium tabular-nums">{money(d.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}
    </Section>
  );
}

function ByUser({ report, money }) {
  return (
    <Section title="By who recorded them" sub="For settling each shift's drawer">
      {report.byUser.length === 0 ? (
        <Empty>No payments in this period.</Empty>
      ) : (
        <TableFrame>
          <table className="grid-table">
            <thead>
              <tr>
                <th>Recorded by</th>
                <th className="text-right">Payments</th>
                <th className="text-right">Received</th>
                <th className="text-right">Refunded</th>
                <th className="text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {report.byUser.map((u) => (
                <tr key={u.user}>
                  <td className="font-medium">{u.user}</td>
                  <td className="text-right tabular-nums">{whole.format(u.count)}</td>
                  <td className="text-right tabular-nums">{money(u.received)}</td>
                  <td className="text-right tabular-nums">{money(u.refunded)}</td>
                  <td className="text-right tabular-nums">{money(u.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}
    </Section>
  );
}

/** How each sortable column of the payment list reads a payment. */
const PAYMENT_SORT = {
  date: "paidAt",
  booking: "reference",
  guest: "guest",
  method: "methodLabel",
  transaction: "transaction",
  recordedBy: "recordedBy",
  amount: "amount",
};

function PaymentList({ report, money, onOpen, methods }) {
  const [method, setMethod] = useState("all");
  const filtered = useMemo(
    () => report.payments.filter((p) => !p.voidedAt && (method === "all" || p.method === method)),
    [report.payments, method]
  );
  const sorter = useSort(filtered, PAYMENT_SORT);
  const rows = sorter.rows;
  return (
    <Section
      title="Every payment"
      sub="Negative amounts are refunds"
      actions={
        <select className="input" style={{ width: 180 }} value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Method">
          <option value="all">All methods</option>
          {methods.map((m) => (
            <option key={m} value={m}>
              {report.methods[m] || m}
            </option>
          ))}
        </select>
      }
    >
      {rows.length === 0 ? (
        <Empty>No payments to show.</Empty>
      ) : (
        <TableFrame tall>
          <table className="grid-table">
            <thead>
              <tr>
                <SortTh sorter={sorter} col="date">Date</SortTh>
                <th>Time</th>
                <SortTh sorter={sorter} col="booking">Booking</SortTh>
                <SortTh sorter={sorter} col="guest">Guest</SortTh>
                <SortTh sorter={sorter} col="method">Method</SortTh>
                <SortTh sorter={sorter} col="transaction">Reference</SortTh>
                <SortTh sorter={sorter} col="recordedBy">Recorded by</SortTh>
                <SortTh sorter={sorter} col="amount" className="text-right">Amount</SortTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap">{longDate(p.day)}</td>
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

function Voided({ report, money, onOpen }) {
  const rows = report.payments.filter((p) => p.voidedAt);
  if (rows.length === 0) return null;
  return (
    <Section title="Voided payments" sub="Taken in this period and later voided. Not counted in any total above.">
      <TableFrame>
        <table className="grid-table">
          <thead>
            <tr>
              <th>Taken</th>
              <th>Booking</th>
              <th>Guest</th>
              <th>Method</th>
              <th>Voided</th>
              <th>By</th>
              <th>Reason</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="whitespace-nowrap">{longDate(p.day)}</td>
                <td>
                  <BookingLink reference={p.reference} reservationId={p.reservationId} tab="payments" onOpen={onOpen} />
                </td>
                <td>{p.guest || "–"}</td>
                <td>{p.methodLabel}</td>
                <td className="whitespace-nowrap">{longDate(p.voidedAt)}</td>
                <td>{p.voidedBy || "–"}</td>
                <td>{p.voidReason || "–"}</td>
                <td className="text-right tabular-nums" style={{ textDecoration: "line-through" }}>
                  {money(p.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
    </Section>
  );
}

function exportCsv(report) {
  const r = [];
  r.push(["Payments", report.start, report.end]);
  r.push(["Currency", report.currency]);
  r.push([]);
  r.push(["Method", "Payments", "Received", "Refunded", "Net"]);
  for (const m of report.summary.byMethod) r.push([m.label, m.count, m.received, m.refunded, m.net]);
  r.push(["Total", report.summary.count, report.summary.received, report.summary.refunded, report.summary.net]);
  r.push([]);
  r.push(["Date", "Time", "Booking", "Guest", "Method", "Reference", "Recorded by", "Amount", "Voided at", "Voided by", "Void reason"]);
  for (const p of report.payments) {
    r.push([p.day, timeOf(p.paidAt), p.reference, p.guest, p.methodLabel, p.transaction, p.recordedBy, p.amount, p.voidedAt || "", p.voidedBy || "", p.voidReason || ""]);
  }
  downloadCsv(`payments-${report.start}-to-${report.end}.csv`, r);
}

export default function PaymentsReport({ session }) {
  const propertyId = session?.propertyId || null;
  const period = usePeriod("mtd");
  const { report, loading, error, reload } = useReport(
    "/api/reports/payments",
    period.valid ? period.range : null,
    propertyId
  );
  const { openBooking, modal } = useBookingOpener(session, reload);
  const money = useMemo(() => moneyFormatter(report?.currency || "INR", { decimals: 2 }), [report?.currency]);

  const methods = useMemo(() => {
    const seen = new Set((report?.payments || []).filter((p) => !p.voidedAt).map((p) => p.method));
    return [...METHOD_ORDER.filter((m) => seen.has(m)), ...[...seen].filter((m) => !METHOD_ORDER.includes(m))];
  }, [report]);

  const s = report?.summary;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payments"
        blurb="Money taken and refunded, by method, day and who recorded it, for the cash-up and the bank reconciliation."
        actions={
          <button type="button" className="btn btn-secondary text-sm" onClick={() => report && exportCsv(report)} disabled={!report || loading}>
            Download CSV
          </button>
        }
      />

      <div className="card card-pad">
        <PeriodPicker id="payments" label="Paid between" {...period} />
        {!period.valid && (
          <p className="mt-3 text-sm" style={{ color: "var(--danger)" }}>
            The end date is before the start date.
          </p>
        )}
        <p className="mt-3 flex items-start gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
          <Icon name="info" size={14} />
          By the date each payment was taken, on this computer&apos;s clock, whatever stay it was for.
        </p>
      </div>

      <Status loading={loading} error={error} report={report} />

      {report && (
        <div className="space-y-5" style={{ opacity: loading ? 0.55 : 1, transition: "opacity 0.15s" }}>
          <div className="card card-pad">
            <Stats
              items={[
                { label: "Received", value: money(s.received) },
                { label: "Refunded", value: money(s.refunded) },
                { label: "Net collected", value: money(s.net) },
                { label: "Payments", value: whole.format(s.count) },
                {
                  label: "Voided",
                  value: whole.format(s.voidedCount),
                  sub: s.voidedCount > 0 ? money(s.voidedAmount) : null,
                  tone: s.voidedCount > 0 ? "warn" : null,
                  hint: "Payments taken in this period and later voided; left out of every other figure",
                },
              ]}
            />
          </div>
          <ByMethod report={report} money={money} />
          <ByDay report={report} money={money} methods={methods} />
          <ByUser report={report} money={money} />
          <PaymentList report={report} money={money} onOpen={openBooking} methods={methods} />
          <Voided report={report} money={money} onOpen={openBooking} />
        </div>
      )}

      {modal}
    </div>
  );
}
