"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BookingLink,
  Empty,
  PageHeader,
  Section,
  Stats,
  Status,
  TableFrame,
  downloadCsv,
  longDate,
  moneyFormatter,
  shortDate,
  useBookingOpener,
  useReport,
} from "./reportKit";
import { SortTh, useSort } from "./useSort";
import { useDialog } from "../../components/Dialog";

/**
 * City Ledger: what companies and travel agents owe for stays billed to
 * them, when the money is due, and what they have paid.
 *
 * Read the way a receivables clerk works: the cash picture first (owed,
 * overdue, coming in this week and this month), then each company aged by
 * how far past due it is, then one company's statement -- its open bills,
 * oldest due first, and the payments it sent -- with the form to record the
 * next payment right there.
 *
 * Balances are each stay's own folio balance, so a figure here is the figure
 * the desk sees when it opens the stay.
 */

const METHODS = [
  { id: "bank_transfer", label: "Bank transfer" },
  { id: "upi", label: "UPI" },
  { id: "card", label: "Card" },
  { id: "cash", label: "Cash" },
  { id: "other", label: "Other / cheque" },
];
const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.id, m.label]));
const KIND_LABEL = { company: "Company", travel_agent: "Agent" };

const PENNY = 0.009;
const todayLocal = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const round2 = (n) => Math.round(n * 100) / 100;

/** Split an amount over bills oldest due first, as the server would. */
function oldestFirst(bills, amount) {
  let left = round2(Number(amount) || 0);
  const out = {};
  for (const b of bills) {
    if (left <= PENNY) break;
    const take = round2(Math.min(left, b.balance));
    out[b.reservationId] = take;
    left = round2(left - take);
  }
  return out;
}

async function send(method, body) {
  const res = await fetch("/api/reports/cityledger/receipts", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, tz: new Date().getTimezoneOffset() }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

/**
 * Record money received. The amount is applied to the open bills oldest due
 * first as it is typed; the desk can change any line, and whatever is not
 * applied stays with the company as credit.
 */
function ReceivePayment({ propertyId, statement, money, onDone, onCancel }) {
  const bills = statement.stays.filter((s) => s.phase === "billed" && s.balance > PENNY);
  const [amount, setAmount] = useState("");
  const [receivedOn, setReceivedOn] = useState(todayLocal());
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [split, setSplit] = useState({});
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Until the desk changes a line by hand, the split follows the amount.
  useEffect(() => {
    if (!touched) setSplit(oldestFirst(bills, amount));
    // bills is derived from the statement, which does not change while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, touched]);

  const applied = round2(Object.values(split).reduce((s, v) => s + (Number(v) || 0), 0));
  const credit = round2((Number(amount) || 0) - applied);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const result = await send("POST", {
        property_id: propertyId,
        company_id: statement.company.id,
        amount,
        received_on: receivedOn,
        method,
        reference,
        notes,
        allocations: Object.entries(split)
          .filter(([, v]) => Number(v) > 0)
          .map(([reservationId, v]) => ({ reservationId, amount: Number(v) })),
      });
      onDone(
        `Recorded ${money(Number(amount))} from ${statement.company.name}` +
          (result.unapplied > PENNY ? ` — ${money(result.unapplied)} kept as credit.` : ".")
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad space-y-3" style={{ borderColor: "var(--accent)" }}>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
        <label>
          <span className="label">Amount received</span>
          <input className="input" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </label>
        <label>
          <span className="label">Received on</span>
          <input className="input" type="date" value={receivedOn} max={todayLocal()} onChange={(e) => setReceivedOn(e.target.value)} />
        </label>
        <label>
          <span className="label">Method</span>
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Reference</span>
          <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." />
        </label>
        <label>
          <span className="label">Notes</span>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>

      {bills.length > 0 ? (
        <TableFrame>
          <table className="grid-table">
            <thead>
              <tr>
                <th>Apply to</th>
                <th>Guest</th>
                <th>Due</th>
                <th className="text-right">Owes</th>
                <th className="text-right" style={{ width: 140 }}>
                  Apply
                </th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.reservationId}>
                  <td className="font-medium">{b.reference}</td>
                  <td>{b.guestName}</td>
                  <td style={{ color: b.overdueDays > 0 ? "var(--danger)" : undefined }}>
                    {shortDate(b.dueOn)}
                    {b.overdueDays > 0 ? ` · ${b.overdueDays}d late` : ""}
                  </td>
                  <td className="text-right tabular-nums">{money(b.balance)}</td>
                  <td className="text-right">
                    <input
                      className="input text-right"
                      type="number"
                      min="0"
                      max={b.balance}
                      value={split[b.reservationId] ?? ""}
                      onChange={(e) => {
                        setTouched(true);
                        setSplit((s) => ({ ...s, [b.reservationId]: e.target.value }));
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      ) : (
        <Empty>No bills owing — the whole amount is kept as credit for the next bills.</Empty>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm tabular-nums">
          Applied {money(applied)}
          {credit > PENNY && <> · <strong>{money(credit)}</strong> kept as credit</>}
          {credit < -PENNY && <span style={{ color: "var(--danger)" }}> · {money(-credit)} more than received</span>}
        </span>
        {touched && (
          <button type="button" className="btn btn-ghost text-xs" onClick={() => setTouched(false)}>
            Oldest first
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn btn-ghost text-sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary text-sm"
            onClick={submit}
            disabled={busy || !(Number(amount) > 0) || credit < -PENNY}
          >
            {busy ? "Recording…" : "Record payment"}
          </button>
        </div>
      </div>
      {error && <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}

function Statement({ session, propertyId, companyId, startReceiving, onChanged }) {
  const dialog = useDialog();
  const [all, setAll] = useState(false);
  const [receiving, setReceiving] = useState(startReceiving);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const { report: st, loading, error, reload } = useReport(
    "/api/reports/cityledger",
    { companyId, ...(all ? { all: "1" } : {}) },
    propertyId
  );
  const { openBooking, modal } = useBookingOpener(session, () => {
    reload();
    onChanged();
  });

  useEffect(() => setReceiving(startReceiving), [startReceiving, companyId]);

  const money = useMemo(() => moneyFormatter(st?.stays?.[0]?.currency || "INR"), [st]);

  function changed(message) {
    setNotice(message);
    setActionError("");
    setReceiving(false);
    reload();
    onChanged();
  }

  async function applyCredit(rc) {
    try {
      const r = await send("PATCH", { property_id: propertyId, id: rc.id, action: "apply" });
      changed(`Applied ${money(r.applied)} of credit to the oldest bills.`);
    } catch (err) {
      setActionError(err.message);
    }
  }

  async function voidIt(rc) {
    const reason = await dialog.prompt({
      title: `Void this ${money(rc.amount)} payment?`,
      message: "Every bill it was applied to will owe that amount again. The payment stays on record, struck through.",
      placeholder: "Reason — e.g. cheque bounced",
      confirmLabel: "Void payment",
      danger: true,
    });
    if (reason == null) return;
    try {
      await send("PATCH", { property_id: propertyId, id: rc.id, action: "void", reason });
      changed("Payment voided.");
    } catch (err) {
      setActionError(err.message);
    }
  }

  function exportCsv() {
    const c = st.company;
    downloadCsv(`statement-${c.name.replace(/\W+/g, "-").toLowerCase()}-${st.today}.csv`, [
      ["Statement", c.name],
      ["GSTIN", c.gstin || ""],
      ["As of", st.today],
      [],
      ["Booking", "Guest", "Check in", "Check out", "Invoice", "Billed", "Due", "Charges", "Paid", "Balance", "Days overdue"],
      ...st.stays.map((s) => [
        s.reference, s.guestName, s.checkIn, s.checkOut, s.invoiceNumber || "", s.billedOn || "", s.dueOn || "",
        s.charges, s.paid, s.balance, s.overdueDays || "",
      ]),
      [],
      ["Payment received", "Amount", "Method", "Reference", "Applied", "Credit left", "Voided"],
      ...st.receipts.map((r) => [r.receivedOn, r.amount, METHOD_LABEL[r.method] || r.method, r.reference || "", r.applied, r.unapplied, r.voided ? "yes" : ""]),
    ]);
  }

  if (!st) return <Status loading={loading} error={error} report={st} />;
  const c = st.company;
  const terms = [
    KIND_LABEL[c.kind],
    c.gstin ? `GSTIN ${c.gstin}` : "No GSTIN on record",
    c.creditDays != null ? `${c.creditDays} days credit` : "Due on the bill date",
    c.creditLimit != null ? `limit ${money(c.creditLimit)}` : null,
    c.contactPerson,
    c.phone,
    c.email,
  ].filter(Boolean);

  return (
    <Section
      title={`Statement — ${c.name}`}
      sub={terms.join(" · ")}
      actions={
        <div className="flex flex-wrap gap-2">
          <label className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show settled bills
          </label>
          <button type="button" className="btn btn-secondary text-sm" onClick={exportCsv}>
            Download CSV
          </button>
          {!receiving && (
            <button type="button" className="btn btn-primary text-sm" onClick={() => setReceiving(true)}>
              Receive payment
            </button>
          )}
        </div>
      }
    >
      {notice && <p className="text-sm" style={{ color: "var(--accent-text)" }}>{notice}</p>}
      {actionError && <p className="text-sm" style={{ color: "var(--danger)" }}>{actionError}</p>}

      {receiving && (
        <ReceivePayment
          propertyId={propertyId}
          statement={st}
          money={money}
          onDone={changed}
          onCancel={() => setReceiving(false)}
        />
      )}

      <Stats
        items={[
          { label: "Owed", value: money(st.totals.receivable) },
          { label: "Overdue", value: money(st.totals.overdue), tone: st.totals.overdue > PENNY ? "danger" : undefined },
          { label: "Still in house", value: money(st.totals.running), hint: "Bills of guests not yet checked out — still growing" },
          { label: "Credit held", value: money(st.totals.credit), hint: "Paid but not yet applied to a bill" },
        ]}
      />

      {st.stays.length === 0 ? (
        <Empty>{all ? "No stays billed to this company yet." : "Nothing owing. Tick Show settled bills to see paid ones."}</Empty>
      ) : (
        <TableFrame tall>
          <table className="grid-table">
            <thead>
              <tr>
                <th>Booking</th>
                <th>Guest</th>
                <th>Stay</th>
                <th>Invoice</th>
                <th>Due</th>
                <th className="text-right">Charges</th>
                <th className="text-right">Paid</th>
                <th className="text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {st.stays.map((s) => (
                <tr key={s.reservationId}>
                  <td>
                    <BookingLink reference={s.reference} reservationId={s.reservationId} tab="bill" onOpen={openBooking} />
                  </td>
                  <td>{s.guestName}</td>
                  <td>
                    {shortDate(s.checkIn)} – {shortDate(s.checkOut)}
                  </td>
                  <td>{s.invoiceNumber || <span style={{ color: "var(--text-faint)" }}>Not invoiced</span>}</td>
                  <td style={{ color: s.overdueDays > 0 ? "var(--danger)" : undefined }}>
                    {s.phase === "running"
                      ? "In house"
                      : s.phase === "upcoming"
                      ? "Not arrived"
                      : s.balance <= PENNY
                      ? "Settled"
                      : `${shortDate(s.dueOn)}${s.overdueDays > 0 ? ` · ${s.overdueDays}d late` : ""}`}
                  </td>
                  <td className="text-right tabular-nums">{money(s.charges)}</td>
                  <td className="text-right tabular-nums">{money(s.paid)}</td>
                  <td className="text-right tabular-nums font-medium">{money(s.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}

      <h4 className="text-sm font-semibold">Payments received</h4>
      {st.receipts.length === 0 ? (
        <Empty>No payments recorded from {c.name} yet.</Empty>
      ) : (
        <TableFrame>
          <table className="grid-table">
            <thead>
              <tr>
                <th>Received</th>
                <th className="text-right">Amount</th>
                <th>Method</th>
                <th>Reference</th>
                <th className="text-right">Applied</th>
                <th className="text-right">Credit left</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {st.receipts.map((r) => (
                <tr key={r.id} style={r.voided ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>
                  <td title={r.voided && r.voidReason ? `Voided: ${r.voidReason}` : r.notes || undefined}>{longDate(r.receivedOn)}</td>
                  <td className="text-right tabular-nums">{money(r.amount)}</td>
                  <td>{METHOD_LABEL[r.method] || r.method}</td>
                  <td>{r.reference || "–"}</td>
                  <td className="text-right tabular-nums">{money(r.applied)}</td>
                  <td className="text-right tabular-nums">{r.unapplied > PENNY ? money(r.unapplied) : "–"}</td>
                  <td className="text-right" style={{ whiteSpace: "nowrap" }}>
                    {!r.voided && r.unapplied > PENNY && st.totals.receivable > PENNY && (
                      <button type="button" className="btn btn-secondary text-xs" onClick={() => applyCredit(r)}>
                        Apply credit
                      </button>
                    )}
                    {!r.voided && (
                      <button type="button" className="btn btn-ghost text-xs" onClick={() => voidIt(r)}>
                        Void
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}
      {modal}
    </Section>
  );
}

export default function CityLedger({ session }) {
  const propertyId = session?.propertyId || null;
  const { report, loading, error, reload } = useReport("/api/reports/cityledger", {}, propertyId);
  const [open, setOpen] = useState(null);

  const money = useMemo(() => moneyFormatter(report?.currency || "INR"), [report]);
  const rows = report?.companies || [];
  const sorter = useSort(rows, {
    name: (r) => r.name.toLowerCase(),
    owed: "receivable",
    overdue: "overdue",
    running: "running",
    credit: "credit",
  }, { key: "overdue", dir: "desc" });

  function exportCsv() {
    downloadCsv(`city-ledger-${report.today}.csv`, [
      ["Company", "Type", "GSTIN", "Credit days", "In house", "Owed", ...report.buckets.map((b) => b.label), "Credit held", "Received this month"],
      ...rows.map((r) => [
        r.name, KIND_LABEL[r.kind], r.gstin || "", r.creditDays ?? "", r.running, r.receivable,
        ...report.buckets.map((b) => r.buckets[b.id]), r.credit, r.receivedThisMonth,
      ]),
    ]);
  }

  const t = report?.totals;

  return (
    <div className="space-y-4">
      <PageHeader
        title="City Ledger"
        blurb="What companies and travel agents owe for stays billed to them, when it is due, and what they have paid."
        actions={
          report && rows.length > 0 ? (
            <button type="button" className="btn btn-secondary text-sm" onClick={exportCsv}>
              Download CSV
            </button>
          ) : null
        }
      />

      <Status loading={loading} error={error} report={report} />

      {report && (
        <>
          <Section title="Cash flow" sub={`As of ${longDate(report.today)}. A bill is due its company's credit days after it is invoiced, or after check-out if not invoiced.`}>
            <Stats
              items={[
                { label: "Owed to you", value: money(t.receivable), sub: `${t.openStays} bill${t.openStays === 1 ? "" : "s"}` },
                { label: "Overdue", value: money(t.overdue), tone: t.overdue > PENNY ? "danger" : undefined },
                { label: "Due in the next 7 days", value: money(t.dueIn7) },
                { label: "Due in 8–30 days", value: money(t.dueIn30) },
                { label: "Still in house", value: money(t.running), hint: "Bills of guests not yet checked out — they join what is owed at check-out" },
                { label: "Credit held", value: money(t.credit), hint: "Paid by companies but not yet applied to a bill" },
                { label: "Received this month", value: money(t.receivedThisMonth) },
              ]}
            />
          </Section>

          <Section title="By company" sub="Owed split by how far past due. Click a company for its statement.">
            {rows.length === 0 ? (
              <Empty>
                Nothing owed. Stays appear here when a booking for a company or agent is set to Bill to: Company.
              </Empty>
            ) : (
              <TableFrame tall>
                <table className="grid-table">
                  <thead>
                    <tr>
                      <SortTh sorter={sorter} col="name">Company</SortTh>
                      <th className="text-right">Credit days</th>
                      <SortTh sorter={sorter} col="running" className="text-right">In house</SortTh>
                      <SortTh sorter={sorter} col="owed" className="text-right">Owed</SortTh>
                      {report.buckets.map((b) => (
                        <th key={b.id} className="text-right">
                          {b.id === "notDue" ? b.label : `${b.label} late`}
                        </th>
                      ))}
                      <SortTh sorter={sorter} col="credit" className="text-right">Credit</SortTh>
                      <th>Last payment</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {sorter.rows.map((r) => (
                      <tr key={r.id} style={open?.id === r.id ? { background: "var(--accent-soft)" } : undefined}>
                        <td>
                          <button
                            type="button"
                            className="font-medium underline decoration-dotted underline-offset-2"
                            style={{ color: "var(--accent)" }}
                            onClick={() => setOpen(open?.id === r.id ? null : { id: r.id, receive: false })}
                          >
                            {r.name}
                          </button>{" "}
                          <span className="text-xs" style={{ color: "var(--text-muted)" }}>{KIND_LABEL[r.kind]}</span>
                          {r.overLimit && (
                            <span className="chip chip-warn ml-1" title={`Owes ${money(r.exposure)} against a limit of ${money(r.creditLimit)}`}>
                              Over limit
                            </span>
                          )}
                        </td>
                        <td className="text-right tabular-nums">{r.creditDays ?? "–"}</td>
                        <td className="text-right tabular-nums">{r.running > PENNY ? money(r.running) : "–"}</td>
                        <td className="text-right tabular-nums font-medium">{money(r.receivable)}</td>
                        {report.buckets.map((b) => (
                          <td
                            key={b.id}
                            className="text-right tabular-nums"
                            style={{ color: b.id !== "notDue" && r.buckets[b.id] > PENNY ? "var(--danger)" : undefined }}
                          >
                            {r.buckets[b.id] > PENNY ? money(r.buckets[b.id]) : "–"}
                          </td>
                        ))}
                        <td className="text-right tabular-nums">{r.credit > PENNY ? money(r.credit) : "–"}</td>
                        <td>{r.lastReceipt ? `${shortDate(r.lastReceipt.receivedOn)} · ${money(r.lastReceipt.amount)}` : "–"}</td>
                        <td className="text-right">
                          <button
                            type="button"
                            className="btn btn-secondary text-xs"
                            onClick={() => setOpen({ id: r.id, receive: true })}
                          >
                            Receive
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableFrame>
            )}
          </Section>

          {open && (
            <Statement
              key={open.id}
              session={session}
              propertyId={propertyId}
              companyId={open.id}
              startReceiving={open.receive}
              onChanged={reload}
            />
          )}
        </>
      )}
    </div>
  );
}
