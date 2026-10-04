"use client";

import { useCallback, useState } from "react";
import { useDialog } from "../../components/Dialog";

/**
 * Check-in and check-out as one shared action, so the Today page, the
 * reservations list, the calendar and the booking window all behave alike.
 *
 * Check-in with no room assigned offers the free, clean rooms of the booked
 * type with the first already chosen, rather than asking the desk to type a
 * number. Check-out with money still owed offers to take it in the same
 * step, so a guest is not let go with a balance by accident -- while still
 * allowing it for a stay billed to a company or settled elsewhere.
 */

function money(value, currency) {
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : !currency || currency === "INR" ? "₹" : `${currency} `;
  return `${symbol}${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

const METHODS = [
  { id: "cash", label: "Cash" },
  { id: "card", label: "Card" },
  { id: "upi", label: "UPI" },
  { id: "bank_transfer", label: "Bank transfer" },
  { id: "ota", label: "Paid to OTA" },
  { id: "other", label: "Other" },
];

async function postStatus(id, status, roomId) {
  const res = await fetch("/api/pms/reservations/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, status, ...(roomId ? { room_id: roomId } : {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not update the booking");
  return data;
}

/** The balance-due step of a check-out: take the money, or go ahead without it. */
function SettleDialog({ request, onDone }) {
  const { guest, balance, currency } = request;
  const [amount, setAmount] = useState(String(balance));
  const [method, setMethod] = useState("cash");
  const paid = Number(amount);
  const valid = Number.isFinite(paid) && paid > 0;

  return (
    // Stops the click here: rendered inside the booking window, it would
    // otherwise reach that window's backdrop and close it too.
    <div
      className="dialog-backdrop"
      onClick={(e) => {
        e.stopPropagation();
        onDone(null);
      }}
    >
      <form
        className="dialog card"
        role="dialog"
        aria-modal="true"
        aria-label="Balance due"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onDone({ amount: paid, method });
        }}
      >
        <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
          {guest} owes {money(balance, currency)}
        </h3>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          Take the payment and check out together.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="label">Amount</label>
            <input
              className="input w-full"
              type="number"
              min="0"
              step="any"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Paid by</label>
            <select className="input w-full" value={method} onChange={(e) => setMethod(e.target.value)}>
              {METHODS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-ghost text-sm" onClick={() => onDone(null)}>
            Cancel
          </button>
          <button type="button" className="btn btn-secondary text-sm" onClick={() => onDone({ skip: true })}>
            Check out unpaid
          </button>
          <button type="submit" className="btn btn-primary text-sm" disabled={!valid}>
            Collect {valid ? money(paid, currency) : ""} &amp; check out
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * `{ checkIn, checkOut, settleDialog }`. Both actions resolve to the status
 * route's answer (for its inventory warning), or null if the desk backed
 * out, and throw with a message written for the desk when refused.
 * `settleDialog` must be rendered by the caller.
 */
export function useFrontDesk(propertyId) {
  const dialog = useDialog();
  const [settle, setSettle] = useState(null);

  const checkIn = useCallback(
    async (r) => {
      if (r.room_id) return postStatus(r.id, "in_house");

      const qs = new URLSearchParams({
        checkIn: r.check_in,
        checkOut: r.check_out,
        ignoreReservationId: r.id,
      });
      if (propertyId) qs.set("propertyId", propertyId);
      const res = await fetch(`/api/pms/rooms?${qs}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load the rooms");

      const ofType = (data.rooms || []).filter((x) => x.room_type_id === r.room_type_id && x.is_active);
      if (!ofType.length) throw new Error("No rooms of that type have been set up yet — add them under Setup → Rooms first.");
      const free = ofType.filter((x) => !x.taken);
      if (!free.length) throw new Error(`Every room of that type is taken or out of order for ${r.guest_name}'s stay.`);
      // A dirty room is free but not ready, so it is not offered.
      const ready = free.filter((x) => x.housekeeping !== "dirty");
      if (!ready.length) {
        throw new Error(
          `Every free room of that type is dirty (${free.map((x) => x.room_number).join(", ")}) — mark one clean first.`
        );
      }

      const roomId = await dialog.choose({
        title: `Check in ${r.guest_name}`,
        label: "Room",
        options: ready.map((x) => ({ value: x.id, label: `Room ${x.room_number}` })),
        confirmLabel: "Check in",
      });
      if (!roomId) return null;
      return postStatus(r.id, "in_house", roomId);
    },
    [propertyId, dialog]
  );

  const checkOut = useCallback(async (r) => {
    const res = await fetch(`/api/pms/folio?reservationId=${r.id}`);
    const folio = await res.json().catch(() => ({}));
    const balance = res.ok ? Number(folio?.totals?.balance) || 0 : 0;

    if (balance > 0) {
      const answer = await new Promise((resolve) =>
        setSettle({ guest: r.guest_name, balance, currency: r.currency, resolve })
      );
      setSettle(null);
      if (!answer) return null;
      if (!answer.skip) {
        const pay = await fetch("/api/pms/folio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "payment",
            reservationId: r.id,
            payment: { amount: answer.amount, method: answer.method, reference: "" },
          }),
        });
        const paid = await pay.json().catch(() => ({}));
        if (!pay.ok) throw new Error(paid.error || "The payment did not save, so the guest is still checked in.");
      }
    }
    return postStatus(r.id, "checked_out");
  }, []);

  const settleDialog = settle ? <SettleDialog request={settle} onDone={settle.resolve} /> : null;

  return { checkIn, checkOut, settleDialog };
}

/**
 * A WhatsApp link that opens a chat with the guest, the confirmation already
 * written. Guests in India expect it there, and the desk was copying it out
 * by hand. A ten-digit number with no country code is taken as the hotel's
 * own country's (only India's code is known here; elsewhere the number must
 * be stored with its +code). Null when there is no usable number.
 */
export function whatsappLink(r, { propertyName, countryCode, balance } = {}) {
  const raw = String(r?.guest_phone || "").trim();
  let digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (!raw.startsWith("+") && digits.length === 10 && (!countryCode || countryCode === "IN")) {
    digits = `91${digits}`;
  }
  if (digits.length < 8) return null;

  const day = (iso) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  const nights = Math.round((new Date(`${r.check_out}T00:00:00Z`) - new Date(`${r.check_in}T00:00:00Z`)) / 86400000);
  const lines = [
    `Dear ${r.guest_name},`,
    "",
    `Your booking at ${propertyName || "our hotel"} is confirmed.`,
    `Booking: ${r.reference}`,
    `Check-in: ${day(r.check_in)}`,
    `Check-out: ${day(r.check_out)} (${nights} night${nights === 1 ? "" : "s"})`,
    r.room_types?.room_type_name ? `Room: ${r.room_types.room_type_name}` : null,
    `Guests: ${r.adults} adult${r.adults === 1 ? "" : "s"}${r.children ? `, ${r.children} child${r.children === 1 ? "" : "ren"}` : ""}`,
    r.total_amount != null ? `Total: ${money(r.total_amount, r.currency)}` : null,
    balance > 0 ? `To pay: ${money(balance, r.currency)}` : null,
    "",
    "We look forward to welcoming you.",
  ].filter((l) => l !== null);
  return `https://wa.me/${digits}?text=${encodeURIComponent(lines.join("\n"))}`;
}
