"use client";

import { useMemo, useState } from "react";
import Icon from "../../components/Icon";
import Select from "@/app/components/Select";
import DateField from "@/app/components/DateField";
import { Fact, Facts } from "@/app/components/Facts";
import { useDialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import { Grid, SaveActions, cellClass, isDraft, sendJSON, useGrid } from "./SetupGrid";
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
import { hotelToday } from "@/lib/hotelTime";

/**
 * Cash & Expenses: where the drawer's cash came from and went, and what the
 * hotel spent its money on.
 *
 * The daily work is at the top: what the drawer should hold, a button to
 * count it, and the list of expenses and cash moved, added to in place and
 * saved together. Below are the period's figures for the owner: expenses by
 * tag, every cash movement, and each count against what was expected.
 *
 * Entries are voided with a reason, never edited or deleted, as payments are.
 */

const NEW_TAG = "__new";

function DrawerCard({ report, money, onCount, busy }) {
  const d = report.drawer;
  return (
    <div className="card card-pad space-y-3">
      <Facts>
        <Fact label="Drawer should hold" tone={d.expected == null ? "warn" : undefined}>
          {d.expected == null ? "Count once to start" : money(d.expected)}
        </Fact>
        <Fact label="Last counted">
          {d.lastCount ? `${money(d.lastCount.counted)}, ${longDate(d.lastCount.at)} ${timeOf(d.lastCount.at)}` : "Never"}
        </Fact>
        {d.lastCount && <Fact label="Cash from guests since">{money(d.sinceCount.fromGuests)}</Fact>}
        {d.lastCount && <Fact label="Cash in and out since">{money(d.sinceCount.moved)}</Fact>}
      </Facts>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary text-sm" onClick={onCount} disabled={busy}>
          Count the cash
        </button>
      </div>
    </div>
  );
}

function EntriesGrid({ report, grid, money, onVoid, onNewTag, onAdd, actions }) {
  // New lines first, where the Add button is, then the newest saved.
  const rows = [...grid.drafts, ...report.entries.filter((e) => !e.voidedAt).slice().reverse()];
  const kinds = Object.entries(report.kinds).map(([id, label]) => ({ id, label }));
  const methods = Object.entries(report.methods).map(([id, label]) => ({ id, label }));
  const tags = [...report.tags.map((t) => ({ id: t, label: t })), { id: NEW_TAG, label: "New tag..." }];
  const COLS = 9;

  return (
    <Section
      title="Expenses and cash moved"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-secondary text-sm" onClick={() => onAdd("expense")}>
            <Icon name="plus" size={14} />
            Add expense
          </button>
          <button type="button" className="btn btn-secondary text-sm" onClick={() => onAdd("to_bank")}>
            <Icon name="plus" size={14} />
            Cash banked, given or added
          </button>
          {actions}
        </div>
      }
    >
      <Grid>
        <thead>
          <tr>
            <th className="cm-sticky" style={{ minWidth: 130 }}>Date</th>
            <th style={{ minWidth: 130 }}>What</th>
            <th style={{ minWidth: 150 }}>Tag</th>
            <th style={{ minWidth: 110 }} className="text-right">Amount</th>
            <th style={{ minWidth: 120 }}>Paid by</th>
            <th style={{ minWidth: 150 }}>Paid to</th>
            <th style={{ minWidth: 100 }}>Bill no.</th>
            <th style={{ minWidth: 140 }}>Notes</th>
            <th style={{ width: 64 }} />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={COLS} className="cm-empty">
                Nothing recorded in this period. Add an expense above.
              </td>
            </tr>
          )}
          {rows.map((e) => {
            if (!isDraft(e.id)) {
              return (
                <tr key={e.id}>
                  <td className="cm-sticky whitespace-nowrap">{longDate(e.date)}</td>
                  <td>{e.kindLabel}</td>
                  <td>{e.tag || "-"}</td>
                  <td className="cm-num tabular-nums">{money(e.amount)}</td>
                  <td>{e.methodLabel}</td>
                  <td>{e.paidTo || "-"}</td>
                  <td>{e.billNumber || "-"}</td>
                  <td title={e.recordedBy ? `Recorded by ${e.recordedBy}` : undefined}>{e.notes || "-"}</td>
                  <td>
                    <button type="button" className="btn btn-ghost text-xs" onClick={() => onVoid(e)}>
                      Void
                    </button>
                  </td>
                </tr>
              );
            }
            const kind = grid.value(e, "kind");
            const isExpense = kind === "expense";
            const amount = grid.value(e, "amount");
            return (
              <tr key={e.id} className="cm-new">
                <td className="cm-sticky">
                  <DateField
                    className={cellClass(false, !grid.value(e, "date"))}
                    value={grid.value(e, "date")}
                    onChange={(ev) => grid.change(e, "date", ev.target.value)}
                    aria-label="Date"
                  />
                </td>
                <td>
                  <Select
                    className={cellClass(false)}
                    value={kind}
                    onChange={(ev) => {
                      grid.change(e, "kind", ev.target.value);
                      if (ev.target.value !== "expense") grid.change(e, "method", "cash");
                    }}
                    aria-label="What"
                  >
                    {kinds.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.label}
                      </option>
                    ))}
                  </Select>
                </td>
                <td>
                  {isExpense ? (
                    <Select
                      className={cellClass(false, !grid.value(e, "tag"))}
                      value={grid.value(e, "tag") || ""}
                      onChange={async (ev) => {
                        if (ev.target.value === NEW_TAG) {
                          const tag = await onNewTag();
                          if (tag) grid.change(e, "tag", tag);
                        } else grid.change(e, "tag", ev.target.value);
                      }}
                      aria-label="Tag"
                    >
                      <option value="">Choose a tag</option>
                      {/* A tag typed in for this line shows even before it is saved. */}
                      {grid.value(e, "tag") && !report.tags.includes(grid.value(e, "tag")) && (
                        <option value={grid.value(e, "tag")}>{grid.value(e, "tag")}</option>
                      )}
                      {tags.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    "-"
                  )}
                </td>
                <td>
                  {grid.input(e, "amount", {
                    inputMode: "decimal",
                    placeholder: "0",
                    invalid: !(Number(amount) > 0),
                    style: { textAlign: "right" },
                  })}
                </td>
                <td>
                  {isExpense ? grid.select(e, "method", methods) : "Cash"}
                </td>
                <td>{grid.input(e, "paidTo", { placeholder: isExpense ? "Shop or person" : "Bank or person" })}</td>
                <td>{grid.input(e, "billNumber")}</td>
                <td>{grid.input(e, "notes")}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-ghost text-xs"
                    onClick={() => grid.removeDraft(e.id)}
                    aria-label="Remove this new line"
                    title="Remove this new line"
                  >
                    <Icon name="close" size={14} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Grid>
    </Section>
  );
}

function ByTag({ report, money }) {
  return (
    <Section title="Expenses by tag" sub="Every expense in the period, whatever it was paid with">
      {report.byTag.length === 0 ? (
        <Empty>No expenses in this period.</Empty>
      ) : (
        <TableFrame>
          <table className="grid-table">
            <thead>
              <tr>
                <th>Tag</th>
                <th className="text-right">Entries</th>
                <th className="text-right">Paid in cash</th>
                <th className="text-right">Paid otherwise</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {report.byTag.map((t) => (
                <tr key={t.tag}>
                  <td className="font-medium">{t.tag}</td>
                  <td className="text-right tabular-nums">{whole.format(t.count)}</td>
                  <td className="text-right tabular-nums">{money(t.cash)}</td>
                  <td className="text-right tabular-nums">{money(t.other)}</td>
                  <td className="text-right font-medium tabular-nums">{money(t.total)}</td>
                </tr>
              ))}
              <tr>
                <td className="font-semibold">Total</td>
                <td />
                <td />
                <td />
                <td className="text-right font-semibold tabular-nums">{money(report.summary.expensesAll)}</td>
              </tr>
            </tbody>
          </table>
        </TableFrame>
      )}
    </Section>
  );
}

function CashLines({ report, money, onOpen }) {
  return (
    <Section title="Every cash movement" sub="Money out is negative">
      {report.lines.length === 0 ? (
        <Empty>No cash moved in this period.</Empty>
      ) : (
        <TableFrame tall>
          <table className="grid-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>What</th>
                <th>Details</th>
                <th>Recorded by</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {report.lines.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap">{longDate(l.date)}</td>
                  <td className="tabular-nums">{timeOf(l.at)}</td>
                  <td>{l.what}</td>
                  <td>
                    {l.reservationId ? (
                      <BookingLink reference={l.detail} reservationId={l.reservationId} tab="payments" onOpen={onOpen} />
                    ) : (
                      l.detail || "-"
                    )}
                  </td>
                  <td>{l.by || "-"}</td>
                  <td className="text-right tabular-nums" style={{ color: l.amount < 0 ? "var(--danger)" : undefined }}>
                    {money(l.amount)}
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

function Counts({ report, money }) {
  return (
    <Section title="Cash counts" sub="Each count against what the drawer should have held at that moment">
      {report.counts.length === 0 ? (
        <Empty>No counts in this period.</Empty>
      ) : (
        <TableFrame>
          <table className="grid-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Counted by</th>
                <th className="text-right">Should be</th>
                <th className="text-right">Counted</th>
                <th className="text-right">Short or over</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {report.counts.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap">{longDate(c.at)}</td>
                  <td className="tabular-nums">{timeOf(c.at)}</td>
                  <td>{c.by || "-"}</td>
                  <td className="text-right tabular-nums">{c.expected == null ? "First count" : money(c.expected)}</td>
                  <td className="text-right tabular-nums">{money(c.counted)}</td>
                  <td
                    className="text-right font-medium tabular-nums"
                    style={{ color: c.difference < -0.009 ? "var(--danger)" : c.difference > 0.009 ? "var(--warn)" : undefined }}
                  >
                    {c.difference == null ? "-" : Math.abs(c.difference) < 0.01 ? "Matches" : `${c.difference < 0 ? "Short" : "Over"} ${money(Math.abs(c.difference))}`}
                  </td>
                  <td>{c.notes || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}
    </Section>
  );
}

function Voided({ report, money }) {
  const rows = report.entries.filter((e) => e.voidedAt);
  if (rows.length === 0) return null;
  return (
    <Section title="Voided entries" sub="Not counted in any figure above">
      <TableFrame>
        <table className="grid-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>What</th>
              <th>Tag</th>
              <th>Voided</th>
              <th>By</th>
              <th>Reason</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap">{longDate(e.date)}</td>
                <td>{e.kindLabel}</td>
                <td>{e.tag || "-"}</td>
                <td className="whitespace-nowrap">{longDate(e.voidedAt)}</td>
                <td>{e.voidedBy || "-"}</td>
                <td>{e.voidReason || "-"}</td>
                <td className="text-right tabular-nums" style={{ textDecoration: "line-through" }}>
                  {money(e.amount)}
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
  r.push(["Cash and expenses", report.start, report.end]);
  r.push([]);
  r.push(["Cash from guests", report.summary.fromGuests]);
  r.push(["Cash refunds", report.summary.refunds]);
  r.push(["Cash added", report.summary.added]);
  r.push(["Expenses paid in cash", report.summary.expensesCash]);
  r.push(["Paid into bank", report.summary.toBank]);
  r.push(["Given to owner", report.summary.toOwner]);
  r.push(["Net change in cash", report.summary.net]);
  r.push([]);
  r.push(["Tag", "Entries", "Paid in cash", "Paid otherwise", "Total"]);
  for (const t of report.byTag) r.push([t.tag, t.count, t.cash, t.other, t.total]);
  r.push([]);
  r.push(["Date", "What", "Tag", "Amount", "Paid by", "Paid to", "Bill no.", "Notes", "Recorded by", "Voided at", "Voided by", "Void reason"]);
  for (const e of report.entries) {
    r.push([e.date, e.kindLabel, e.tag, e.amount, e.methodLabel, e.paidTo, e.billNumber, e.notes, e.recordedBy, e.voidedAt || "", e.voidedBy || "", e.voidReason || ""]);
  }
  r.push([]);
  r.push(["Date", "Time", "What", "Details", "Recorded by", "Amount"]);
  for (const l of report.lines) r.push([l.date, timeOf(l.at), l.what, l.detail, l.by, l.amount]);
  downloadCsv(`cash-and-expenses-${report.start}-to-${report.end}.csv`, r);
}

export default function CashBook({ session }) {
  const propertyId = session?.propertyId || null;
  const dialog = useDialog();
  const toast = useToast();
  const period = usePeriod("mtd");
  const { report, loading, error, reload } = useReport("/api/cashbook", period.valid ? period.range : null, propertyId);
  const { openBooking, modal } = useBookingOpener(session, reload);
  const money = useMemo(() => moneyFormatter(report?.currency, { decimals: 2 }), [report?.currency]);
  const grid = useGrid(report?.entries || []);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");

  const ready = report?.ready;
  const s = report?.summary;

  function addLine(kind) {
    grid.add({
      kind,
      date: hotelToday(),
      tag: "",
      amount: "",
      method: "cash",
      paidTo: "",
      billNumber: "",
      notes: "",
    });
  }

  // Lines the server would refuse, counted before anything is sent.
  const unfinished = grid.drafts.filter((d) => !(Number(d.amount) > 0) || !d.date || (d.kind === "expense" && !d.tag)).length;

  async function saveAll() {
    if (unfinished) {
      setSaveError(`${unfinished} new line${unfinished === 1 ? " needs" : "s need"} a date, an amount above zero and, for an expense, a tag.`);
      return;
    }
    setBusy(true);
    setSaveError("");
    const n = grid.drafts.length;
    const errors = await grid.save({
      label: (d) => `${report.kinds[d.kind] || "Line"} ${d.amount || ""}`.trim(),
      update: async () => {},
      create: ({ id, ...entry }) => sendJSON("/api/cashbook", "POST", { propertyId, entry }),
    });
    setBusy(false);
    reload();
    if (errors.length) setSaveError(errors.join(". "));
    else toast(`Saved ${n} line${n === 1 ? "" : "s"}.`);
  }

  async function voidEntry(e) {
    const reason = await dialog.prompt({
      title: `Void this ${e.kindLabel.toLowerCase()} of ${money(e.amount)}?`,
      message: "It stays on the list, struck through, and counts in no figure.",
      label: "Why is it being voided?",
      confirmLabel: "Void",
      danger: true,
    });
    if (!reason) return;
    try {
      await sendJSON("/api/cashbook", "PATCH", { propertyId, id: e.id, reason });
      toast("Voided.");
      reload();
    } catch (err) {
      toast(err.message, { tone: "error" });
    }
  }

  async function newTag() {
    const tag = await dialog.prompt({ title: "New tag", label: "Name the tag", placeholder: "For example: Garden" });
    return tag ? tag.slice(0, 60) : null;
  }

  async function countCash() {
    // The figure it should be is shown only after the count, so the count
    // is of the cash, not a copy of the screen.
    const answer = await dialog.prompt({
      title: "Count the cash in the drawer",
      message:
        report.drawer.expected == null
          ? "This first count becomes the starting cash. Every count after it is checked against what the drawer should hold."
          : "Count the notes and coins, then enter the total.",
      label: "Cash counted",
      placeholder: "0",
      inputMode: "decimal",
      confirmLabel: "Save count",
    });
    if (answer == null) return;
    const cleaned = String(answer).replace(/[,\s]/g, "").replace(/^(Rs\.?|INR)/i, "");
    const counted = Number(cleaned);
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned) || !Number.isFinite(counted)) {
      toast("Enter the cash counted as a number, like 12500.", { tone: "error" });
      return;
    }
    setBusy(true);
    try {
      const res = await sendJSON("/api/cashbook", "POST", { propertyId, count: { counted } });
      const diff = res.difference;
      toast(
        diff == null
          ? `Starting cash set to ${money(counted)}.`
          : Math.abs(diff) < 0.01
            ? "The drawer matches."
            : `The drawer is ${diff < 0 ? "short" : "over"} by ${money(Math.abs(diff))}.`,
        { tone: diff != null && diff <= -0.01 ? "error" : "info" }
      );
      reload();
    } catch (err) {
      toast(err.message, { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cash & Expenses"
        blurb="What the drawer should hold, and every expense."
        actions={
          <button type="button" className="btn btn-secondary text-sm" onClick={() => report && ready && exportCsv(report)} disabled={!ready || loading}>
            <Icon name="download" size={14} />
            Download CSV
          </button>
        }
      />

      {saveError && (
        <div className="card card-pad text-sm" style={{ color: "var(--danger)" }}>
          {saveError}
        </div>
      )}

      <Status loading={loading} error={error} report={report} />

      {report && !ready && <div className="card card-pad text-sm">{report.message}</div>}

      {ready && <DrawerCard report={report} money={money} onCount={countCash} busy={busy} />}

      <div className="card card-pad">
        <PeriodPicker id="cashbook" label="Between" {...period} />
        {!period.valid && (
          <p className="mt-3 text-sm" style={{ color: "var(--danger)" }}>
            The end date is before the start date.
          </p>
        )}
      </div>

      {ready && (
        <div className="space-y-5" style={{ opacity: loading ? 0.55 : 1, transition: "opacity 0.15s" }}>
          <EntriesGrid
            report={report}
            grid={grid}
            money={money}
            onVoid={voidEntry}
            onNewTag={newTag}
            onAdd={addLine}
            actions={<SaveActions count={grid.drafts.length} busy={busy} onSave={saveAll} onDiscard={grid.discard} />}
          />
          <div className="card card-pad">
            <Stats
              items={[
                { label: "Cash from guests", value: money(s.fromGuests) },
                { label: "Cash refunds", value: money(s.refunds) },
                { label: "Cash added", value: money(s.added) },
                { label: "Expenses paid in cash", value: money(s.expensesCash) },
                { label: "Paid into bank", value: money(s.toBank) },
                { label: "Given to owner", value: money(s.toOwner) },
                { label: "Net change in cash", value: money(s.net) },
                { label: "All expenses", value: money(s.expensesAll), hint: "Including those paid by UPI, card or bank" },
              ]}
            />
          </div>
          <ByTag report={report} money={money} />
          <Counts report={report} money={money} />
          <CashLines report={report} money={money} onOpen={openBooking} />
          <Voided report={report} money={money} />
        </div>
      )}

      {modal}
    </div>
  );
}
