"use client";

import { useCallback, useState } from "react";
import { useDialog } from "../../components/Dialog";
import { useEscape } from "../../components/useEscape";
import { dayUseLabel, dayUseWindowLabel } from "@/lib/dayUse";
import Select from "@/app/components/Select";

/**
 * Check-in and check-out as one shared action, so the Today page, the
 * reservations list, the calendar and the booking window all behave alike.
 *
 * Check-in with no room assigned offers the free rooms of the booked type,
 * clean ones first with the first already chosen, rather than asking the desk
 * to type a number. A room marked dirty can still be taken in the same step:
 * nobody may have tapped Clean, and a guest at the desk should not wait on
 * it. The check-in then marks it clean under the desk's name. Check-out with money still owed offers to take it in the same
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

async function postStatus(id, status, roomId, { markClean = false } = {}) {
  const res = await fetch("/api/pms/reservations/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id,
      status,
      tz: new Date().getTimezoneOffset(),
      ...(roomId ? { room_id: roomId } : {}),
      ...(markClean ? { mark_clean: true } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not update the booking");
  return data;
}

/** The room a booking is already in, for its housekeeping status; null if it cannot be read. */
async function roomOf(r, propertyId) {
  try {
    const res = await fetch(`/api/pms/rooms${propertyId ? `?propertyId=${propertyId}` : ""}`);
    const data = await res.json();
    return (data.rooms || []).find((x) => x.id === r.room_id) || null;
  } catch {
    return null;
  }
}

/**
 * A walk-in's start: tonight on the desk's own clock, one night, booked as a
 * walk-in. The booking form then picks a free clean room and makes "Save and
 * check in" its main button.
 */
export function walkInPrefill(date) {
  const d = date ? new Date(`${date}T00:00:00`) : new Date();
  const iso = (x) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return { source: "walkin", check_in: iso(d), check_out: iso(next) };
}

/** The balance-due step of a check-out: take the money, or go ahead without it. */
function SettleDialog({ request, onDone }) {
  const { guest, balance, currency } = request;
  const [amount, setAmount] = useState(String(balance));
  const [method, setMethod] = useState("cash");
  const paid = Number(amount);
  const valid = Number.isFinite(paid) && paid > 0;
  useEscape(() => onDone(null));

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
            <Select className="input w-full" value={method} onChange={(e) => setMethod(e.target.value)}>
              {METHODS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
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
    async (r, { roomSeenDirty = false } = {}) => {
      if (r.room_id) {
        // Picked in the booking form, whose list already said "dirty": no second question.
        if (roomSeenDirty) return postStatus(r.id, "in_house", null, { markClean: true });
        const askToClean = async (number) => {
          const ok = await dialog.confirm({
            title: number ? `Room ${number} is marked dirty` : "The room is marked dirty",
            message: "If it is ready, check the guest in. The room is marked clean under your name.",
            confirmLabel: "Check in and mark clean",
          });
          return ok ? postStatus(r.id, "in_house", null, { markClean: true }) : null;
        };
        const room = await roomOf(r, propertyId);
        if (room?.housekeeping === "dirty") return askToClean(room.room_number);
        try {
          return await postStatus(r.id, "in_house");
        } catch (err) {
          // The room could not be read first, and the server found it dirty.
          if (!room && /marked dirty/.test(err.message)) return askToClean(null);
          throw err;
        }
      }

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
      if (!ofType.length) throw new Error("No rooms of that type have been set up yet. Add them under Setup > Rooms first.");
      const free = ofType.filter((x) => !x.taken);
      if (!free.length) throw new Error(`Every room of that type is taken or out of order for ${r.guest_name}'s stay.`);
      // Clean rooms first; a dirty one says so, and taking it marks it clean.
      const dirty = (x) => x.housekeeping === "dirty";
      const offered = [...free.filter((x) => !dirty(x)), ...free.filter(dirty)];

      const roomId = await dialog.choose({
        title: `Check in ${r.guest_name}`,
        label: "Room",
        options: offered.map((x) => ({
          value: x.id,
          label: dirty(x) ? `Room ${x.room_number}, dirty, marked clean on check-in` : `Room ${x.room_number}`,
        })),
        confirmLabel: "Check in",
      });
      if (!roomId) return null;
      return postStatus(r.id, "in_house", roomId, { markClean: dirty(offered.find((x) => x.id === roomId)) });
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
 * The guest's number as WhatsApp wants it. A ten-digit number with no
 * country code is taken as the hotel's own country's (only India's code is
 * known here; elsewhere the number must be stored with its +code). Null when
 * there is no usable number.
 */
function whatsappNumber(phone, countryCode) {
  const raw = String(phone || "").trim();
  let digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (!raw.startsWith("+") && digits.length === 10 && (!countryCode || countryCode === "IN")) {
    digits = `91${digits}`;
  }
  return digits.length < 8 ? null : digits;
}

const day = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

/**
 * A WhatsApp link that opens a chat with the guest, the confirmation already
 * written. Guests in India expect it there, and the desk was copying it out
 * by hand. With `checkinUrl`, the guest's online check-in link goes at the
 * end. Null when there is no usable number.
 */
export function whatsappLink(r, { propertyName, countryCode, balance, checkinUrl } = {}) {
  const digits = whatsappNumber(r?.guest_phone, countryCode);
  if (!digits) return null;
  const nights = Math.round((new Date(`${r.check_out}T00:00:00Z`) - new Date(`${r.check_in}T00:00:00Z`)) / 86400000);
  const lines = [
    `Dear ${r.guest_name},`,
    "",
    `Your booking at ${propertyName || "our hotel"} is confirmed.`,
    `Booking: ${r.reference}`,
    ...(r.stay_kind === "day_use"
      ? [
          `Day use: ${day(r.check_in)}, ${
            dayUseWindowLabel(r) || `${dayUseLabel(r.day_use_hours)} from check-in`
          }`,
        ]
      : [
          `Check-in: ${day(r.check_in)}`,
          `Check-out: ${day(r.check_out)} (${nights} night${nights === 1 ? "" : "s"})`,
        ]),
    r.room_types?.room_type_name ? `Room: ${r.room_types.room_type_name}` : null,
    `Guests: ${r.adults} adult${r.adults === 1 ? "" : "s"}${r.children ? `, ${r.children} child${r.children === 1 ? "" : "ren"}` : ""}`,
    r.total_amount != null ? `Total: ${money(r.total_amount, r.currency)}` : null,
    balance > 0 ? `To pay: ${money(balance, r.currency)}` : null,
    ...(checkinUrl ? ["", "Save time at check-in: fill in your details and upload your ID here:", checkinUrl] : []),
    "",
    "We look forward to welcoming you.",
  ].filter((l) => l !== null);
  return `https://wa.me/${digits}?text=${encodeURIComponent(lines.join("\n"))}`;
}

/** A WhatsApp chat with the guest, the online check-in link already written. */
export function whatsappCheckinLink(r, { propertyName, countryCode, url }) {
  const digits = whatsappNumber(r?.guest_phone, countryCode);
  if (!digits) return null;
  const lines = [
    `Dear ${r.guest_name},`,
    "",
    `Save time when you arrive at ${propertyName || "our hotel"} on ${day(r.check_in)}: please fill in your details and upload a photo of your ID before you come.`,
    "",
    url,
    "",
    `Booking: ${r.reference}`,
  ];
  return `https://wa.me/${digits}?text=${encodeURIComponent(lines.join("\n"))}`;
}
