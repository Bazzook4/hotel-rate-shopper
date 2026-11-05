"use client";

import { useState } from "react";
import Select from "@/app/components/Select";
import DateField from "@/app/components/DateField";
import { useDialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import { Drawer, Field } from "./RatePlanSetup";
import { Empty, PeriodPicker, Section, Stats, Status, TableFrame, longDate, moneyFormatter, usePeriod, useReport, whole } from "./reportKit";
import { sendJSON } from "./SetupGrid";
import { hotelToday } from "@/lib/hotelTime";

/**
 * Purchases, inside Cash & Expenses: what the hotel buys and uses up, what
 * is left, and which items to buy again. A purchase with a cost is also an
 * expense in the cash book, so money is entered once.
 */

const KIND_HELP = {
  consumable: "Used up by guests, like soap. Goes down by itself for every guest night.",
  longlife: "Lasts months, like towels. Counted, and replaced after a while.",
  asset: "Bought once, like a TV or geyser. Reminds you when it is due for replacement.",
};

function StatusText({ item }) {
  if (item.status === "low") return <span style={{ color: "var(--danger)", fontWeight: 600 }}>Buy again</span>;
  if (item.status === "old") return <span style={{ color: "var(--warn-text, var(--danger))", fontWeight: 600 }}>Replace</span>;
  return <span className="faint">OK</span>;
}

function ItemForm({ propertyId, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ name: "", kind: "consumable", unit: "pcs", onHand: "", perGuestNight: "", useBasis: "stay", reorderLevel: "", replaceAfterMonths: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch) => setF((p) => ({ ...p, ...patch }));
  const asset = f.kind === "asset";

  async function save() {
    setBusy(true);
    setError("");
    try {
      await sendJSON("/api/purchases", "POST", { propertyId, item: f });
      toast("Item added.");
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer title="Add an item" subtitle={KIND_HELP[f.kind]} onCancel={onClose} onSave={save} saveLabel="Add item" busy={busy} error={error} width={520}>
      <div className="space-y-4">
        <Field label="Name">
          <input className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Soap, bath towel, TV" />
        </Field>
        <Field label="Type">
          <Select className="input" value={f.kind} onChange={(e) => set({ kind: e.target.value })}>
            <option value="consumable">Consumable</option>
            <option value="longlife">Long-life</option>
            <option value="asset">Asset</option>
          </Select>
        </Field>
        {!asset && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="In stock now">
              <input className="input" inputMode="decimal" value={f.onHand} onChange={(e) => set({ onHand: e.target.value })} placeholder="0" />
            </Field>
            <Field label="Counted in">
              <input className="input" value={f.unit} onChange={(e) => set({ unit: e.target.value })} placeholder="pcs, bottles, sets" />
            </Field>
            <Field label="Given out" hint={f.useBasis === "stay" ? "Once at check-in, however many nights they stay." : "Again every night they stay."}>
              <Select className="input" value={f.useBasis} onChange={(e) => set({ useBasis: e.target.value })}>
                <option value="stay">Once per guest, at check-in</option>
                <option value="night">Every night, per guest</option>
              </Select>
            </Field>
            <Field label="How many per guest" hint="2 guests and 1 each means 2 used. Leave 0 if guests do not use it.">
              <input className="input" inputMode="decimal" value={f.perGuestNight} onChange={(e) => set({ perGuestNight: e.target.value })} placeholder="0" />
            </Field>
            <Field label="Remind me to buy at" hint="When stock falls to this number.">
              <input className="input" inputMode="decimal" value={f.reorderLevel} onChange={(e) => set({ reorderLevel: e.target.value })} placeholder="0" />
            </Field>
          </div>
        )}
        {f.kind !== "consumable" && (
          <Field label="Replace after (months)" hint="Counted from the last purchase. Leave empty if it has no set life.">
            <input className="input" inputMode="numeric" value={f.replaceAfterMonths} onChange={(e) => set({ replaceAfterMonths: e.target.value })} placeholder="12" />
          </Field>
        )}
      </div>
    </Drawer>
  );
}

const MOVE_TITLE = { purchase: "Bought", count: "Count the stock", used: "Took some out" };
const MOVE_HELP = {
  purchase: "Adds to stock. A cost is also saved as an expense in Cash & Expenses.",
  count: "Enter what is on the shelf now. Stock restarts from this number.",
  used: "For damaged, lost or given away. Guest use is taken off by itself.",
};

function MoveForm({ propertyId, item, kind, methods, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ qty: "", date: hotelToday(), cost: "", method: "cash", supplier: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch) => setF((p) => ({ ...p, ...patch }));

  async function save() {
    setBusy(true);
    setError("");
    try {
      await sendJSON("/api/purchases", "POST", { propertyId, move: { ...f, kind, itemId: item.id } });
      toast("Saved.");
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer title={`${MOVE_TITLE[kind]}: ${item.name}`} subtitle={MOVE_HELP[kind]} onCancel={onClose} onSave={save} saveLabel="Save" busy={busy} error={error} width={480}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={kind === "count" ? "Counted" : "How many"}>
            <input className="input" inputMode="decimal" value={f.qty} onChange={(e) => set({ qty: e.target.value })} placeholder="0" />
          </Field>
          <Field label="Date">
            <DateField className="input" value={f.date} onChange={(e) => set({ date: e.target.value })} />
          </Field>
        </div>
        {kind === "purchase" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Total cost" hint="Leave empty to save no expense.">
                <input className="input" inputMode="decimal" value={f.cost} onChange={(e) => set({ cost: e.target.value })} placeholder="0" />
              </Field>
              <Field label="Paid by">
                <Select className="input" value={f.method} onChange={(e) => set({ method: e.target.value })}>
                  {Object.entries(methods).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Bought from">
              <input className="input" value={f.supplier} onChange={(e) => set({ supplier: e.target.value })} placeholder="Shop or person" />
            </Field>
          </>
        )}
        <Field label="Notes">
          <input className="input" value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      </div>
    </Drawer>
  );
}

function UsageReport({ propertyId, money }) {
  const period = usePeriod("mtd");
  const { report, loading, error } = useReport("/api/purchases/usage", period.valid ? period.range : null, propertyId);
  if (report && !report.ready) return null;
  return (
    <Section title="Usage report" sub="What was used, bought and spent in the period. Guest use is worked out from the guests and nights stayed.">
      <div className="card card-pad mb-3">
        <PeriodPicker id="purchases" label="Between" {...period} />
      </div>
      <Status loading={loading} error={error} report={report} />
      {report?.ready && (
        <div style={{ opacity: loading ? 0.55 : 1 }} className="space-y-4">
          <Stats
            items={[
              { label: "Guest nights", value: whole.format(report.guestNights) },
              { label: "Spent on purchases", value: money(report.spent) },
              { label: "Spent per guest night", value: report.guestNights ? money(report.spent / report.guestNights) : "-" },
            ]}
          />
          {report.items.length === 0 ? (
            <Empty>No items yet.</Empty>
          ) : (
            <TableFrame>
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Type</th>
                    <th className="text-right">Used by guests</th>
                    <th className="text-right">Took out</th>
                    <th className="text-right">Bought</th>
                    <th className="text-right">Spent</th>
                  </tr>
                </thead>
                <tbody>
                  {report.items.map((i) => (
                    <tr key={i.id}>
                      <td className="font-medium">{i.name}</td>
                      <td>{i.kindLabel}</td>
                      <td className="text-right tabular-nums">{i.byGuests ? `${i.byGuests} ${i.unit}` : "-"}</td>
                      <td className="text-right tabular-nums">{i.takenOut ? `${i.takenOut} ${i.unit}` : "-"}</td>
                      <td className="text-right tabular-nums">{i.bought ? `${i.bought} ${i.unit}` : "-"}</td>
                      <td className="text-right tabular-nums">{i.spent ? money(i.spent) : "-"}</td>
                    </tr>
                  ))}
                  <tr className="grid-total">
                    <td className="font-semibold">Total</td>
                    <td colSpan={4} />
                    <td className="text-right font-semibold tabular-nums">{money(report.spent)}</td>
                  </tr>
                </tbody>
              </table>
            </TableFrame>
          )}
        </div>
      )}
    </Section>
  );
}

export default function Purchases({ propertyId, currency, methods, onChanged }) {
  const dialog = useDialog();
  const toast = useToast();
  const { report, loading, error, reload } = useReport("/api/purchases", {}, propertyId);
  const money = moneyFormatter(currency, { decimals: 2 });
  const [panel, setPanel] = useState(null);

  const done = () => {
    setPanel(null);
    reload();
    onChanged?.();
  };

  async function remove(item) {
    const ok = await dialog.confirm({ title: `Take ${item.name} off the list?`, message: "Its history is kept.", confirmLabel: "Take off" });
    if (!ok) return;
    try {
      await sendJSON("/api/purchases", "PATCH", { propertyId, archive: item.id });
      reload();
    } catch (err) {
      toast(err.message, { tone: "error" });
    }
  }

  async function cancelLine(m) {
    const ok = await dialog.confirm({ title: "Cancel this line?", message: m.cost ? "The expense it saved is cancelled too." : "Stock goes back as it was.", confirmLabel: "Cancel line", danger: true });
    if (!ok) return;
    try {
      await sendJSON("/api/purchases", "PATCH", { propertyId, voidMove: m.id });
      reload();
      onChanged?.();
    } catch (err) {
      toast(err.message, { tone: "error" });
    }
  }

  return (
    <div className="space-y-5">
      <Status loading={loading} error={error} report={report} />
      {report && !report.ready && <div className="card card-pad text-sm">{report.message}</div>}
      {report?.ready && (
        <Section
          title="Purchases and stock"
          sub="Items to buy again are marked. Guest use comes off by itself, by the number of guests."
          actions={
            <button type="button" className="btn btn-primary text-sm" onClick={() => setPanel({ add: true })}>
              Add item
            </button>
          }
        >
          {report.items.length === 0 ? (
            <Empty>No items yet. Add soap, towels or anything you buy again and again.</Empty>
          ) : (
            <TableFrame>
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Type</th>
                    <th className="text-right">In stock</th>
                    <th className="text-right">Buy again at</th>
                    <th>Last bought</th>
                    <th>Replace by</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {report.items.map((i) => (
                    <tr key={i.id}>
                      <td className="font-medium">{i.name}</td>
                      <td>{i.kindLabel}</td>
                      <td className="text-right tabular-nums">
                        {i.onHand == null ? "-" : `${i.onHand} ${i.unit}`}
                        {i.daysLeft != null && <div className="text-xs faint">about {i.daysLeft} days left</div>}
                      </td>
                      <td className="text-right tabular-nums">{i.kind === "asset" ? "-" : i.reorderLevel}</td>
                      <td className="whitespace-nowrap">{longDate(i.boughtOn)}</td>
                      <td className="whitespace-nowrap">{i.replaceOn ? longDate(i.replaceOn) : "-"}</td>
                      <td>
                        <StatusText item={i} />
                      </td>
                      <td className="whitespace-nowrap text-right">
                        <button type="button" className="btn btn-secondary text-xs" onClick={() => setPanel({ item: i, kind: "purchase" })}>
                          Bought
                        </button>{" "}
                        {i.kind !== "asset" && (
                          <>
                            <button type="button" className="btn btn-secondary text-xs" onClick={() => setPanel({ item: i, kind: "count" })}>
                              Count
                            </button>{" "}
                            <button type="button" className="btn btn-secondary text-xs" onClick={() => setPanel({ item: i, kind: "used" })}>
                              Took out
                            </button>{" "}
                          </>
                        )}
                        <button type="button" className="btn btn-ghost text-xs" onClick={() => setPanel({ history: i })}>
                          History
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          )}
        </Section>
      )}

      {report?.ready && <UsageReport propertyId={propertyId} money={money} />}

      {panel?.add && <ItemForm propertyId={propertyId} onClose={() => setPanel(null)} onSaved={done} />}
      {panel?.item && <MoveForm propertyId={propertyId} item={panel.item} kind={panel.kind} methods={methods} onClose={() => setPanel(null)} onSaved={done} />}
      {panel?.history && (
        <Drawer title={panel.history.name} subtitle="Latest lines first." onCancel={() => setPanel(null)} cancelLabel="Close" width={560}>
          <div className="space-y-4">
            {panel.history.history.length === 0 && <Empty>Nothing recorded yet.</Empty>}
            {panel.history.history.length > 0 && (
              <TableFrame>
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>What</th>
                      <th className="text-right">How many</th>
                      <th className="text-right">Cost</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {panel.history.history.map((m) => (
                      <tr key={m.id}>
                        <td className="whitespace-nowrap">{longDate(m.date)}</td>
                        <td>{{ purchase: "Bought", count: "Counted", used: "Took out" }[m.kind]}{m.supplier ? `, ${m.supplier}` : ""}</td>
                        <td className="text-right tabular-nums">{m.qty}</td>
                        <td className="text-right tabular-nums">{m.cost == null ? "-" : money(m.cost)}</td>
                        <td>
                          <button type="button" className="btn btn-ghost text-xs" onClick={() => { setPanel(null); cancelLine(m); }}>
                            Cancel
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableFrame>
            )}
            <button type="button" className="btn btn-ghost text-sm" onClick={() => { const i = panel.history; setPanel(null); remove(i); }}>
              Take this item off the list
            </button>
          </div>
        </Drawer>
      )}
    </div>
  );
}
