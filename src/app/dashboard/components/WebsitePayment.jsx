"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/money";
import { PAYMENT_STATUS_LABEL } from "@/lib/bookingEngineShared";
import { useToast } from "../../components/Toast";
import { useDialog } from "../../components/Dialog";

/**
 * A website booking's payment, above the booking's tabs: how the guest chose
 * to pay and where it stands. When the guest says they paid by UPI, the desk
 * checks its bank and presses Payment received, which puts the payment on
 * the bill for the amount in the box (voided there like any other if it was
 * a mistake; it asks first, since it is money), or Not found,
 * which asks the guest to call. Nothing shows for a booking not made on the
 * website.
 */
export default function WebsitePayment({ reservationId, onChanged }) {
  const [online, setOnline] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const toast = useToast();
  const dialog = useDialog();

  useEffect(() => {
    let cancelled = false;
    setOnline(null);
    if (!reservationId) return undefined;
    fetch(`/api/pms/onlineBooking?reservationId=${reservationId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled) return;
        setOnline(json?.online || null);
        if (json?.online) setAmount(String(Number(json.online.amount) || ""));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [reservationId]);

  if (!online) return null;

  const money = (v) => formatMoney(v, { currency: online.currency, decimals: 2 });

  async function check(outcome) {
    const paid = Number(amount);
    if (outcome === "received") {
      if (!(paid > 0)) {
        setError("Enter the amount you see in your bank.");
        return;
      }
      const yes = await dialog.confirm({
        title: `Add ${money(paid)} UPI payment to the bill?`,
        message: online.guest_reference
          ? `Only if you see it in your bank. UPI ref ${online.guest_reference}.`
          : "Only if you see it in your bank. The guest gave no UPI reference.",
        confirmLabel: "Add payment",
        cancelLabel: "Not yet",
      });
      if (!yes) return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/pms/onlineBooking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId, outcome, amount: outcome === "received" ? paid : undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "That did not save.");
      setOnline(json.online);
      toast(outcome === "received" ? "Payment received and added to the bill" : "Marked not found. The guest is asked to call you.");
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const status = online.payment_status;
  const canCheck = online.pay_by === "upi" && ["awaiting", "guest_paid", "not_received"].includes(status);
  const tone =
    status === "guest_paid" ? "var(--warn)" : status === "not_received" ? "var(--danger)" : "var(--text-muted)";

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded px-3 py-2 text-sm"
      style={{ border: "1px solid var(--border)", background: "var(--surface-2)" }}
    >
      <span style={{ color: "var(--text)" }}>
        Website booking, {online.pay_by === "upi" ? "UPI" : "pays at the hotel"}
      </span>
      <span className="font-medium" style={{ color: tone }}>
        {PAYMENT_STATUS_LABEL[status] || status}
      </span>
      {online.pay_by === "upi" && status !== "received" && (
        <span style={{ color: "var(--text-muted)" }}>
          {online.guest_reference ? `UPI ref ${online.guest_reference}` : "No UPI ref given"}
        </span>
      )}
      {canCheck && (
        <span className="flex items-center gap-2 sm:ml-auto">
          <label className="flex items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
            Amount
            <input
              className="input"
              style={{ width: "7rem" }}
              inputMode="decimal"
              value={amount}
              disabled={busy}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              aria-label="Amount received"
            />
          </label>
          <button type="button" className="btn btn-primary text-xs" disabled={busy} onClick={() => check("received")}>
            Payment received
          </button>
          {status !== "not_received" && (
            <button type="button" className="btn btn-ghost text-xs" disabled={busy} onClick={() => check("not_received")}>
              Not found
            </button>
          )}
        </span>
      )}
      {error && (
        <span className="w-full text-xs" style={{ color: "var(--danger)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
