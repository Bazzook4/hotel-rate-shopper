"use client";

import { useCallback, useEffect, useState } from "react";
import { useDialog } from "../../components/Dialog";
import Select from "@/app/components/Select";
import DateField from "@/app/components/DateField";
import { hotelToday } from "@/lib/hotelTime";
import { formatMoney } from "@/lib/money";

/**
 * One wallet: what it holds, adding money (on a plan, or any amount with
 * bonus credit), adjusting by hand, and its passbook.
 *
 * Shared by the Guests page (a guest's wallet) and anywhere else a wallet is
 * opened. A company's money usually comes in through the City Ledger's
 * Receive payment, which pays bills straight away; this panel is for a guest
 * or for a deposit with nothing to pay yet.
 */

const METHODS = [
  { id: "cash", label: "Cash" },
  { id: "upi", label: "UPI" },
  { id: "card", label: "Card" },
  { id: "bank_transfer", label: "Bank transfer" },
  { id: "other", label: "Other / cheque" },
];
const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.id, m.label]));

export const inr = (v) =>
  formatMoney(v);


async function send(method, body) {
  const res = await fetch("/api/pms/wallets", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

/** The wallet plans, loaded once per page. */
export function useWalletPlans(propertyId) {
  const [plans, setPlans] = useState([]);
  const load = useCallback(() => {
    const qs = propertyId ? `?propertyId=${propertyId}` : "";
    return fetch(`/api/pms/walletPlans${qs}`)
      .then((r) => (r.ok ? r.json() : { plans: [] }))
      .then((d) => setPlans(d.plans || []))
      .catch(() => setPlans([]));
  }, [propertyId]);
  useEffect(() => {
    load();
  }, [load]);
  return { plans, reload: load };
}

export default function WalletPanel({ owner, propertyId, plans = [], onChanged, onOpenBooking }) {
  const dialog = useDialog();
  const [wallet, setWallet] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [mode, setMode] = useState(null); // "topup" | "adjust"
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ plan_id: "", cash_amount: "", credit: "", method: "cash", reference: "", received_on: hotelToday(), notes: "" });
  const [adjust, setAdjust] = useState({ credit: "", notes: "" });

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ type: owner.type, id: owner.id });
      if (propertyId) qs.set("propertyId", propertyId);
      const res = await fetch(`/api/pms/wallets?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load the wallet");
      setWallet(data);
    } catch (err) {
      setError(err.message);
    }
  }, [owner.type, owner.id, propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  const activePlans = plans.filter((p) => p.is_active);
  const plan = activePlans.find((p) => p.id === form.plan_id) || null;

  async function done(message) {
    setNotice(message);
    setError(null);
    setMode(null);
    await load();
    onChanged?.();
  }

  async function topUp() {
    setBusy(true);
    setError(null);
    try {
      await send("POST", { action: "topup", property_id: propertyId, type: owner.type, id: owner.id, ...form });
      const paid = plan ? plan.pay_amount : form.cash_amount;
      const credit = plan ? plan.credit : form.credit || form.cash_amount;
      await done(`Added ${inr(credit)} for ${inr(paid)} paid.`);
      setForm((f) => ({ ...f, plan_id: "", cash_amount: "", credit: "", reference: "", notes: "" }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveAdjust() {
    setBusy(true);
    setError(null);
    try {
      await send("POST", { action: "adjust", property_id: propertyId, type: owner.type, id: owner.id, ...adjust });
      await done("Wallet adjusted.");
      setAdjust({ credit: "", notes: "" });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function voidEntry(e) {
    const reason = await dialog.prompt({
      title: `Void this ${e.kind === "topup" ? "top-up" : "adjustment"} of ${inr(e.credit)}?`,
      message:
        "It stays on record, struck through. If its credit was already spent, the most recent bills paid from this wallet will owe that money again.",
      placeholder: "Reason",
      confirmLabel: "Void",
      danger: true,
    });
    if (reason == null) return;
    try {
      const r = await send("PATCH", { action: "void", property_id: propertyId, id: e.id, reason });
      await done(
        r.undone?.length
          ? `Voided. These bills owe again: ${r.undone.map((u) => `${u.booking} ${inr(u.amount)}`).join(", ")}.`
          : "Voided."
      );
    } catch (err) {
      setError(err.message);
    }
  }

  const cell = { padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--border)" };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">
          <strong>{owner.name}</strong>: wallet holds{" "}
          <strong style={{ color: "var(--accent-text)" }}>{wallet ? inr(wallet.balance) : "..."}</strong>
          {wallet && wallet.credit > 0 && (
            <span className="sub">, {inr(wallet.cash)} paid in, {inr(wallet.credit)} credit given, {inr(wallet.spent)} spent</span>
          )}
        </span>
        <div className="ml-auto flex gap-2">
          <button type="button" className={mode === "topup" ? "btn btn-primary text-xs" : "btn btn-secondary text-xs"} onClick={() => setMode(mode === "topup" ? null : "topup")}>
            + Add money
          </button>
          <button type="button" className="btn btn-ghost text-xs" onClick={() => setMode(mode === "adjust" ? null : "adjust")}>
            Adjust
          </button>
        </div>
      </div>

      {mode === "topup" && (
        <div className="flex flex-wrap items-end gap-2">
          <label>
            <span className="label">Plan</span>
            <Select className="input" style={{ width: "auto" }} value={form.plan_id} onChange={(e) => setForm({ ...form, plan_id: e.target.value })}>
              <option value="">Any amount</option>
              {activePlans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}: pay {inr(p.pay_amount)}, get {inr(p.credit)}
                </option>
              ))}
            </Select>
          </label>
          {!plan && (
            <>
              <label>
                <span className="label">Paid</span>
                <input className="input" type="number" min="0" style={{ width: 110 }} value={form.cash_amount} onChange={(e) => setForm({ ...form, cash_amount: e.target.value })} />
              </label>
              <label title="What the wallet can spend. Leave blank for the same as paid; more gives bonus credit.">
                <span className="label">Credit given</span>
                <input className="input" type="number" min="0" style={{ width: 110 }} value={form.credit} placeholder={form.cash_amount || "same"} onChange={(e) => setForm({ ...form, credit: e.target.value })} />
              </label>
            </>
          )}
          <label>
            <span className="label">Method</span>
            <Select className="input" style={{ width: "auto" }} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
              {METHODS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
          </label>
          <label>
            <span className="label">Reference</span>
            <input className="input" style={{ width: 130 }} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          </label>
          <label>
            <span className="label">Received on</span>
            <DateField className="input" max={hotelToday()} value={form.received_on} onChange={(e) => setForm({ ...form, received_on: e.target.value })} />
          </label>
          <button type="button" className="btn btn-primary text-sm" disabled={busy || (!plan && !(Number(form.cash_amount) > 0))} onClick={topUp}>
            {busy ? "Adding..." : plan ? `Take ${inr(plan.pay_amount)}` : "Add"}
          </button>
        </div>
      )}

      {mode === "adjust" && (
        <div className="flex flex-wrap items-end gap-2">
          <label title="Positive adds credit, negative takes it off. No money changes hands.">
            <span className="label">Add or take off</span>
            <input className="input" type="number" style={{ width: 120 }} value={adjust.credit} placeholder="e.g. 500 or -500" onChange={(e) => setAdjust({ ...adjust, credit: e.target.value })} />
          </label>
          <label style={{ flex: 1, minWidth: 180 }}>
            <span className="label">Reason</span>
            <input className="input" value={adjust.notes} onChange={(e) => setAdjust({ ...adjust, notes: e.target.value })} placeholder="e.g. goodwill for the AC fault" />
          </label>
          <button type="button" className="btn btn-primary text-sm" disabled={busy} onClick={saveAdjust}>
            Save
          </button>
        </div>
      )}

      {error && <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
      {notice && !error && <p className="text-sm" style={{ color: "var(--accent-text)" }}>{notice}</p>}

      {wallet?.entries?.length > 0 && (
        <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
          <tbody>
            {wallet.entries.map((e) => (
              <tr key={`${e.kind}-${e.id}`} style={e.voided ? { textDecoration: "line-through", color: "var(--text-faint)" } : undefined}>
                <td style={{ ...cell, whiteSpace: "nowrap" }}>{e.on}</td>
                <td style={cell}>
                  {e.kind === "topup" && (
                    <>
                      Added{e.plan ? ` on ${e.plan}` : ""}: {inr(e.cash)} paid by {METHOD_LABEL[e.method] || e.method}
                      {e.reference ? ` (${e.reference})` : ""}
                    </>
                  )}
                  {e.kind === "adjust" && <>Adjusted: {e.notes}</>}
                  {e.kind === "spend" && (
                    <>
                      Paid{" "}
                      {onOpenBooking && e.reservationId ? (
                        <button type="button" className="underline" style={{ color: "var(--accent)" }} onClick={() => onOpenBooking(e.reservationId)}>
                          {e.booking}
                        </button>
                      ) : (
                        e.booking
                      )}
                      {e.guestName ? `, ${e.guestName}` : ""}
                    </>
                  )}
                  {e.voided && e.voidReason ? `, voided: ${e.voidReason}` : ""}
                </td>
                <td style={{ ...cell, textAlign: "right", whiteSpace: "nowrap", color: e.credit < 0 ? "var(--danger)" : "var(--accent-text)" }}>
                  {e.credit < 0 ? "−" : "+"}
                  {inr(Math.abs(e.credit))}
                </td>
                <td style={{ ...cell, textAlign: "right", width: 50 }}>
                  {!e.voided && e.kind !== "spend" && (
                    <button type="button" className="btn btn-ghost text-xs" onClick={() => voidEntry(e)}>
                      Void
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
