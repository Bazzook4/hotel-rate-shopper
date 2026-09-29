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
  useBookingOpener,
  usePeriod,
  useReport,
  whole,
} from "./reportKit";

/**
 * Invoicing: the register an accountant files from, what is still owed, and
 * what was never billed.
 *
 *   Register        invoices issued in the period, read from their frozen
 *                   snapshots, with tax by rule -- the GST return's inputs --
 *                   and any hole in the numbering
 *   Outstanding     who owes money now, aged from the day they left, and who
 *                   is owed a refund
 *   Not invoiced    stays that left in the period with no invoice, or with an
 *                   invoice their bill has since moved away from
 */

const TABS = [
  { id: "register", label: "Invoice register" },
  { id: "outstanding", label: "Outstanding balances" },
  { id: "uninvoiced", label: "Not invoiced" },
];

const STATUS_LABEL = { in_house: "In house", checked_out: "Checked out" };

// ------------------------------------------------------------------
// Register
// ------------------------------------------------------------------

function Register({ report, money, onOpen }) {
  const { rows, taxNames, totals, taxSummary, gaps } = report.register;
  return (
    <div className="space-y-5">
      <div className="card card-pad">
        <Stats
          items={[
            { label: "Invoices issued", value: whole.format(totals.count), hint: "Not counting voided invoices" },
            { label: "Taxable value", value: money(totals.taxable), hint: "Room and extras before tax" },
            { label: "Tax", value: money(totals.taxTotal) },
            { label: "Invoiced total", value: money(totals.total) },
            {
              label: "Voided",
              value: whole.format(totals.voidedCount),
              sub: totals.voidedCount > 0 ? money(totals.voidedTotal) : null,
              tone: totals.voidedCount > 0 ? "warn" : null,
            },
          ]}
        />
      </div>

      {gaps.length > 0 && (
        <div className="card card-pad text-sm" style={{ borderColor: "var(--danger)" }}>
          <p className="flex items-center gap-2 font-semibold" style={{ color: "var(--danger)" }}>
            <Icon name="warn" size={16} /> Gaps in the invoice numbering
          </p>
          <p className="mt-1" style={{ color: "var(--text-muted)" }}>
            Invoices are never deleted, only voided, so a missing number needs explaining to the tax authority. The
            usual cause is a reservation deleted after it was invoiced, which takes its invoices with it.
          </p>
          <ul className="mt-2 list-disc pl-5" style={{ color: "var(--text)" }}>
            {gaps.slice(0, 20).map((g) => (
              <li key={g.after}>
                {whole.format(g.missing)} missing between {g.after} and {g.before}
              </li>
            ))}
            {gaps.length > 20 && <li>…and {whole.format(gaps.length - 20)} more</li>}
          </ul>
        </div>
      )}

      <Section title="Tax by rule" sub="From the invoices that stand. Taxable base is what each percentage was charged on.">
        {taxSummary.length === 0 ? (
          <Empty>No tax on the invoices in this period.</Empty>
        ) : (
          <TableFrame>
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Tax</th>
                  <th className="text-right">Invoices</th>
                  <th className="text-right">Taxable base</th>
                  <th className="text-right">Tax</th>
                </tr>
              </thead>
              <tbody>
                {taxSummary.map((t) => (
                  <tr key={t.name}>
                    <td className="font-medium">
                      {t.name}
                      {t.inclusive && (
                        <span className="chip chip-off ml-2" style={{ fontSize: "0.6rem" }}>
                          included in price
                        </span>
                      )}
                    </td>
                    <td className="text-right tabular-nums">{whole.format(t.invoices)}</td>
                    <td className="text-right tabular-nums">{t.base == null ? "–" : money(t.base)}</td>
                    <td className="text-right tabular-nums">{money(t.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        )}
      </Section>

      <Section title="Register" sub="Every invoice issued in the period, as it was issued">
        {rows.length === 0 ? (
          <Empty>No invoices issued in this period.</Empty>
        ) : (
          <TableFrame tall>
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Issued</th>
                  <th>Guest</th>
                  <th>Booking</th>
                  <th>Stay</th>
                  <th className="text-right">Taxable</th>
                  {taxNames.map((n) => (
                    <th key={n} className="text-right">
                      {n}
                    </th>
                  ))}
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={r.voided ? { color: "var(--text-faint)" } : undefined}>
                    <td className="whitespace-nowrap">
                      <a
                        href={`/api/pms/invoice?id=${r.id}`}
                        download={`${r.number}.pdf`}
                        className="font-medium underline decoration-dotted underline-offset-2"
                        style={{ color: r.voided ? undefined : "var(--accent)" }}
                        title="Download the PDF"
                      >
                        {r.number}
                      </a>
                      {r.voided && (
                        <span className="chip chip-off ml-2" style={{ fontSize: "0.6rem" }} title={r.voidReason || undefined}>
                          Voided
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">{longDate(r.day)}</td>
                    <td>{r.guest || "–"}</td>
                    <td>
                      <BookingLink reference={r.reference} reservationId={r.reservationId} tab="invoices" onOpen={onOpen} />
                    </td>
                    <td className="whitespace-nowrap">
                      {longDate(r.checkIn)} – {longDate(r.checkOut)}
                    </td>
                    <td className="text-right tabular-nums">{money(r.taxable)}</td>
                    {taxNames.map((n) => (
                      <td key={n} className="text-right tabular-nums">
                        {r.taxes[n] ? money(r.taxes[n]) : "–"}
                      </td>
                    ))}
                    <td
                      className="text-right font-medium tabular-nums"
                      style={r.voided ? { textDecoration: "line-through" } : undefined}
                    >
                      {money(r.total)}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="font-semibold" colSpan={5}>
                    Total, excluding voided
                  </td>
                  <td className="text-right font-semibold tabular-nums">{money(totals.taxable)}</td>
                  {taxNames.map((n) => (
                    <td key={n} className="text-right font-semibold tabular-nums">
                      {money(totals.taxes[n])}
                    </td>
                  ))}
                  <td className="text-right font-semibold tabular-nums">{money(totals.total)}</td>
                </tr>
              </tbody>
            </table>
          </TableFrame>
        )}
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------
// Outstanding
// ------------------------------------------------------------------

function BalanceTable({ rows, money, onOpen, credit = false }) {
  return (
    <TableFrame tall>
      <table className="grid-table">
        <thead>
          <tr>
            <th>Booking</th>
            <th>Guest</th>
            <th>Stay</th>
            <th>Status</th>
            {!credit && <th className="text-right">Days owed</th>}
            <th className="text-right">Bill</th>
            <th className="text-right">Paid</th>
            <th className="text-right">{credit ? "To refund" : "Balance"}</th>
            <th>Last payment</th>
            <th>Invoice</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.reservationId}>
              <td>
                <BookingLink reference={r.reference} reservationId={r.reservationId} tab="payments" onOpen={onOpen} />
              </td>
              <td>{r.guest || "–"}</td>
              <td className="whitespace-nowrap">
                {longDate(r.checkIn)} – {longDate(r.checkOut)}
              </td>
              <td>{STATUS_LABEL[r.status] || r.status}</td>
              {!credit && <td className="text-right tabular-nums">{r.age == null ? "–" : whole.format(r.age)}</td>}
              <td className="text-right tabular-nums">{money(r.total)}</td>
              <td className="text-right tabular-nums">{money(r.paid)}</td>
              <td
                className="text-right font-medium tabular-nums"
                style={{ color: credit ? undefined : r.age > 30 ? "var(--danger)" : r.age != null ? "var(--warn)" : undefined }}
              >
                {money(Math.abs(r.balance))}
              </td>
              <td className="whitespace-nowrap">{r.lastPayment ? longDate(r.lastPayment) : "None"}</td>
              <td>{r.invoice || "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}

function Outstanding({ report, money, onOpen }) {
  const o = report.outstanding;
  return (
    <div className="space-y-5">
      <div className="card card-pad space-y-4">
        <Stats
          items={[
            { label: "Owed by guests", value: money(o.totalOwed), sub: `${whole.format(o.owing.length)} stays`, tone: o.totalOwed > 0 ? "warn" : null },
            {
              label: "Of which departed",
              value: money(o.buckets.filter((b) => b.id !== "inHouse").reduce((s, b) => s + b.amount, 0)),
              hint: "Guests who have left without settling in full",
            },
            {
              label: "Owed to guests",
              value: money(o.totalCredit),
              sub: `${whole.format(o.credits.length)} stays`,
              hint: "Paid more than their bill; a refund or a credit is due",
            },
          ]}
        />
        <p className="flex items-start gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
          <Icon name="info" size={14} />
          As of today, whatever period is chosen above: everyone in house, and everyone who checked out since{" "}
          {longDate(report.lookback)}. Balances include tax and are worked out exactly as each stay&apos;s folio shows them.
        </p>
      </div>

      <Section title="Ageing" sub="Days since check-out">
        <TableFrame>
          <table className="grid-table">
            <thead>
              <tr>
                <th>Owed for</th>
                <th className="text-right">Stays</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {o.buckets.map((b) => (
                <tr key={b.id}>
                  <td className="font-medium">{b.label}</td>
                  <td className="text-right tabular-nums">{whole.format(b.count)}</td>
                  <td className="text-right tabular-nums">{money(b.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      </Section>

      <Section title="Guests who owe" sub="Longest owed first">
        {o.owing.length === 0 ? <Empty>Nobody owes anything.</Empty> : <BalanceTable rows={o.owing} money={money} onOpen={onOpen} />}
      </Section>

      {o.credits.length > 0 && (
        <Section title="Guests owed a refund" sub="Paid more than their bill">
          <BalanceTable rows={o.credits} money={money} onOpen={onOpen} credit />
        </Section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Not invoiced
// ------------------------------------------------------------------

function Uninvoiced({ report, money, onOpen }) {
  const rows = report.uninvoiced;
  const never = rows.filter((r) => r.kind === "none");
  const changed = rows.filter((r) => r.kind === "changed");
  return (
    <div className="space-y-5">
      <div className="card card-pad">
        <Stats
          items={[
            {
              label: "Never invoiced",
              value: whole.format(never.length),
              sub: money(never.reduce((s, r) => s + r.total, 0)),
              tone: never.length > 0 ? "warn" : null,
            },
            {
              label: "Changed since invoiced",
              value: whole.format(changed.length),
              tone: changed.length > 0 ? "warn" : null,
              hint: "The bill today differs from the latest invoice. Void it and issue a new one, or issue a supplementary invoice.",
            },
          ]}
        />
      </div>
      <Section
        title="Stays to invoice"
        sub={`Checked out between ${longDate(report.start)} and ${longDate(report.end)}. Complimentary stays with nothing billed are left out.`}
      >
        {rows.length === 0 ? (
          <Empty>Every stay that left in this period has an invoice that matches its bill.</Empty>
        ) : (
          <TableFrame tall>
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Booking</th>
                  <th>Guest</th>
                  <th>Checked out</th>
                  <th>Channel</th>
                  <th>Problem</th>
                  <th className="text-right">Invoiced</th>
                  <th className="text-right">Bill now</th>
                  <th className="text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.reservationId}>
                    <td>
                      <BookingLink reference={r.reference} reservationId={r.reservationId} tab="invoices" onOpen={onOpen} />
                    </td>
                    <td>{r.guest || "–"}</td>
                    <td className="whitespace-nowrap">{longDate(r.checkOut)}</td>
                    <td>{r.channel}</td>
                    <td>
                      <span className="chip chip-warn">
                        {r.kind === "none" ? "Never invoiced" : `Changed since ${r.invoice}`}
                      </span>
                    </td>
                    <td className="text-right tabular-nums">{r.invoiced == null ? "–" : money(r.invoiced)}</td>
                    <td className="text-right tabular-nums">{money(r.total)}</td>
                    <td className="text-right tabular-nums">{money(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        )}
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------
// CSV
// ------------------------------------------------------------------

function exportCsv(report, tab) {
  const r = [];
  if (tab === "register") {
    const { rows, taxNames, taxSummary } = report.register;
    r.push(["Invoice register", report.start, report.end]);
    r.push(["Currency", report.currency]);
    r.push([]);
    r.push(["Invoice", "Issued", "Guest", "Booking", "Check-in", "Check-out", "Residency", "Taxable", ...taxNames, "Tax", "Total", "Voided", "Void reason", "Issued by"]);
    for (const x of rows) {
      r.push([x.number, x.day, x.guest, x.reference, x.checkIn, x.checkOut, x.residency, x.taxable, ...taxNames.map((n) => x.taxes[n] || 0), x.taxTotal, x.total, x.voided ? "yes" : "", x.voidReason || "", x.issuedBy || ""]);
    }
    r.push([]);
    r.push(["Tax", "Invoices", "Taxable base", "Amount", "Included in price"]);
    for (const t of taxSummary) r.push([t.name, t.invoices, t.base, t.amount, t.inclusive ? "yes" : ""]);
  } else if (tab === "outstanding") {
    r.push(["Outstanding balances as of", report.today]);
    r.push(["Currency", report.currency]);
    r.push([]);
    r.push(["Booking", "Guest", "Check-in", "Check-out", "Status", "Days owed", "Bill", "Paid", "Balance", "Last payment", "Invoice"]);
    for (const x of [...report.outstanding.owing, ...report.outstanding.credits]) {
      r.push([x.reference, x.guest, x.checkIn, x.checkOut, x.status, x.age, x.total, x.paid, x.balance, x.lastPayment || "", x.invoice || ""]);
    }
  } else {
    r.push(["Not invoiced, checked out between", report.start, report.end]);
    r.push([]);
    r.push(["Booking", "Guest", "Check-out", "Channel", "Problem", "Invoiced", "Bill now", "Balance"]);
    for (const x of report.uninvoiced) {
      r.push([x.reference, x.guest, x.checkOut, x.channel, x.kind === "none" ? "Never invoiced" : `Changed since ${x.invoice}`, x.invoiced ?? "", x.total, x.balance]);
    }
  }
  downloadCsv(`${tab}-${report.start}-to-${report.end}.csv`, r);
}

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

export default function InvoicingReport({ session }) {
  const propertyId = session?.propertyId || null;
  const period = usePeriod("mtd");
  const [tab, setTab] = useState("register");
  const { report, loading, error, reload } = useReport(
    "/api/reports/invoicing",
    period.valid ? period.range : null,
    propertyId
  );
  const { openBooking, modal } = useBookingOpener(session, reload);
  const money = useMemo(() => moneyFormatter(report?.currency || "INR", { decimals: 2 }), [report?.currency]);

  const counts = report
    ? {
        register: report.register.rows.length,
        outstanding: report.outstanding.owing.length + report.outstanding.credits.length,
        uninvoiced: report.uninvoiced.length,
      }
    : {};

  return (
    <div className="space-y-5">
      <PageHeader
        title="Invoicing"
        blurb="The invoice register with tax by rule, balances still owed, and stays that were never invoiced."
        actions={
          <button type="button" className="btn btn-secondary text-sm" onClick={() => report && exportCsv(report, tab)} disabled={!report || loading}>
            Download CSV
          </button>
        }
      />

      <div className="card card-pad space-y-3">
        <PeriodPicker id="invoicing" label={tab === "uninvoiced" ? "Checked out between" : "Issued between"} {...period} />
        {!period.valid && (
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            The end date is before the start date.
          </p>
        )}
        <div className="seg max-w-full overflow-x-auto">
          {TABS.map((t) => (
            <button key={t.id} type="button" className={tab === t.id ? "seg-on" : ""} onClick={() => setTab(t.id)}>
              {t.label}
              {report ? ` (${whole.format(counts[t.id])})` : ""}
            </button>
          ))}
        </div>
      </div>

      <Status loading={loading} error={error} report={report} />

      {report && (
        <div style={{ opacity: loading ? 0.55 : 1, transition: "opacity 0.15s" }}>
          {tab === "register" && <Register report={report} money={money} onOpen={openBooking} />}
          {tab === "outstanding" && <Outstanding report={report} money={money} onOpen={openBooking} />}
          {tab === "uninvoiced" && <Uninvoiced report={report} money={money} onOpen={openBooking} />}
        </div>
      )}

      {modal}
    </div>
  );
}
