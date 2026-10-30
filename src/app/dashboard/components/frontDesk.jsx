"use client";

import { useCallback, useRef, useState } from "react";
import { useEscape } from "../../components/useEscape";
import { dayUseLabel, dayUseWindowLabel } from "@/lib/dayUse";
import { addDays, formatDateISO } from "@/lib/date";
import { hotelToday } from "@/lib/hotelTime";
import Select from "@/app/components/Select";
import { countryOptions, toCountryCode } from "@/lib/countries";
import { CHECKIN_ID_TYPES } from "@/lib/onlineCheckinShared";
import { shrink } from "./GuestIdPhotos";
import Icon from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { useDialog } from "../../components/Dialog";
import { formatMoney } from "@/lib/money";
import { DISCOUNT_REASONS } from "@/lib/discounts";

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
 *
 * Check-in also asks for each adult's ID, which the police report needs,
 * in the same popup as the room. When the room is set and every adult on
 * the booking already has an ID, there is no popup at all.
 */

function money(value, currency) {
  return formatMoney(value, { currency, decimals: 2 });
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
 * A walk-in's start: tonight on the hotel's own clock, one night, booked as a
 * walk-in. The booking form then picks a free clean room and makes "Save and
 * check in" its main button.
 */
export function walkInPrefill(date) {
  const checkIn = date || hotelToday();
  return { source: "walkin", check_in: checkIn, check_out: formatDateISO(addDays(checkIn, 1)) };
}

/** At most this many adults are asked for in the popup; more go on the Guests tab. */
const MAX_ID_LINES = 4;

const fullName = (g) => [g.first_name, g.last_name].filter(Boolean).join(" ");

function splitName(full) {
  const parts = String(full || "").trim().split(/\s+/);
  return { first_name: parts[0] || "", last_name: parts.slice(1).join(" ") || null };
}

/**
 * Who should be named on the booking, one line per adult: the named guests
 * as they are, then the booker if nobody is named (with their saved ID, for
 * a returning guest), then blank lines for the other adults.
 */
/** The ID most guests of a country show: Aadhaar for India, a passport for anyone else. */
function usualId(nationality) {
  if (!nationality) return "";
  return nationality === "IN" ? "aadhaar" : "passport";
}

async function idLines(r) {
  const res = await fetch(`/api/pms/folio?reservationId=${r.id}`);
  const folio = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  const stay = folio.reservation || r;
  const named = folio.guests || [];
  const home = stay.guest_residency === "international" ? "" : toCountryCode(stay.guest_country) || "IN";
  const wanted = Math.min(Math.max(Number(stay.adults) || 1, 1), MAX_ID_LINES);

  let booker = null;
  if (!named.length && stay.guest_id) {
    const g = await fetch(`/api/pms/guests?id=${stay.guest_id}${stay.property_id ? `&propertyId=${stay.property_id}` : ""}`)
      .then((x) => (x.ok ? x.json() : null))
      .catch(() => null);
    booker = g?.guest || null;
  }

  const lines = named.slice(0, Math.max(wanted, named.length)).map((g) => {
    const nationality = g.nationality || (g.is_primary ? toCountryCode(stay.guest_country) : "") || home;
    return {
      existing: g,
      name: fullName(g),
      id_type: g.id_type || usualId(nationality),
      id_number: g.id_number || "",
      nationality,
      files: [],
    };
  });
  if (!lines.length) {
    lines.push({
      existing: null,
      primary: true,
      name: stay.guest_name || "",
      id_type: booker?.id_type || usualId(toCountryCode(booker?.country) || home),
      id_number: booker?.id_number || "",
      nationality: toCountryCode(booker?.country) || home,
      files: [],
    });
  }
  while (lines.length < wanted) {
    lines.push({ existing: null, name: "", id_type: usualId(home), id_number: "", nationality: home, files: [] });
  }
  const complete = lines.every((l) => l.name.trim() && l.id_number.trim());
  return { lines, complete };
}

/**
 * Save the lines the desk filled or changed as named guests on the booking,
 * then upload any ID photos taken for them onto their guest records.
 */
async function saveIdLines(reservationId, before, after, propertyId) {
  const hasPrimary = before.some((l) => l.existing?.is_primary);
  for (const [i, l] of after.entries()) {
    const was = before[i];
    const changed = ["name", "id_type", "id_number", "nationality"].some((k) => String(l[k] || "") !== String(was[k] || ""));
    const photos = l.files?.length > 0;
    let guestId = l.existing?.guest_id || null;
    if (!l.name.trim()) continue;
    // A line nobody touched is left as it is: a named guest unchanged, or
    // the booker line with no ID, rather than naming them with nothing new.
    // A photo taken for them still needs them on the guest list.
    const skip = l.existing ? !changed && (guestId || !photos) : !l.id_number.trim() && !changed && !photos;
    if (skip) {
      if (photos && guestId) await uploadIdPhotos(guestId, l, propertyId);
      continue;
    }
    const guest = {
      ...(l.existing || {}),
      ...splitName(l.name),
      id_type: l.id_type || null,
      id_number: l.id_number.trim() || null,
      nationality: l.nationality || null,
    };
    if (!l.existing) guest.is_primary = Boolean(l.primary) && !hasPrimary;
    delete guest.guests;
    const known = new Set(after.map((x) => x.existing?.id).filter(Boolean));
    const res = await fetch("/api/pms/folio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "guest", reservationId, guest }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `The details for ${l.name} did not save, so the guest is not checked in yet.`);
    if (!photos) continue;
    // The answer is the whole folio: this line is the row it updated, or
    // the one row that is new.
    const saved = (data.guests || []).find((g) => (l.existing ? g.id === l.existing.id : !known.has(g.id)));
    if (saved && !l.existing) l.existing = saved;
    guestId = saved?.guest_id || guestId;
    if (!guestId) throw new Error(`${l.name} could not be put on the guest list, so their ID photo was not saved. Check in without the photo and add it on the Guests tab.`);
    await uploadIdPhotos(guestId, l, propertyId);
  }
}

/** The ID photos taken in the popup, onto the guest's record. */
async function uploadIdPhotos(guestId, line, propertyId) {
  for (const file of line.files) {
    const form = new FormData();
    form.set("guest_id", guestId);
    if (propertyId) form.set("property_id", propertyId);
    form.set("file", file);
    const res = await fetch("/api/pms/guests/photos", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${line.name}'s ID photo did not upload (${data.error || "try again"}), so the guest is not checked in yet.`);
  }
  line.files = [];
}

/**
 * The check-in popup: the room, if one is still to be picked or is dirty,
 * and each adult's name and ID. Blanks are allowed, since a guest at the
 * desk should not wait on a missing ID; the police report shows them.
 */
function CheckInDialog({ request, onDone }) {
  const { guest, rooms, roomNote, lines: start, canSeeIds } = request;
  const [roomId, setRoomId] = useState(rooms?.[0]?.value || "");
  const [lines, setLines] = useState(start || []);
  const countries = countryOptions();
  useEscape(() => onDone(null));
  const set = (i, k, v) =>
    setLines((ls) =>
      ls.map((l, j) => {
        if (j !== i) return l;
        // A new nationality moves an ID type nobody picked to that country's usual one.
        if (k === "nationality" && (!l.id_type || l.id_type === usualId(l.nationality))) {
          return { ...l, nationality: v, id_type: usualId(v) };
        }
        return { ...l, [k]: v };
      })
    );
  const missing = lines.filter((l) => !l.id_number.trim()).length;
  // One file box for every line: it remembers which line asked.
  const fileRef = useRef(null);
  const [photoFor, setPhotoFor] = useState(null);
  const [shrinking, setShrinking] = useState(false);
  const pickPhotos = async (e) => {
    const picked = [...(e.target.files || [])];
    e.target.value = "";
    if (photoFor == null || !picked.length) return;
    setShrinking(true);
    const files = await Promise.all(picked.map(shrink));
    setShrinking(false);
    setLines((ls) => ls.map((l, j) => (j === photoFor ? { ...l, files: [...(l.files || []), ...files].slice(0, 6) } : l)));
  };

  return (
    <div
      className="side-panel-backdrop"
      // Over any panel already open, as the old check-in box was.
      style={{ zIndex: 95 }}
      onClick={(e) => {
        e.stopPropagation();
        onDone(null);
      }}
    >
      <form
        className="side-panel flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label={`Check in ${guest}`}
        style={{ maxWidth: lines.length ? 760 : 440 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (rooms && !roomId) return;
          onDone({ roomId, lines });
        }}
      >
        <div
          className="side-panel-head flex items-center justify-between gap-3"
          style={{ padding: "0.85rem 1.1rem", background: "var(--accent-strong)", color: "#fff", fontWeight: 600, fontSize: "0.9rem" }}
        >
          <h3>Check in {guest}</h3>
          <button type="button" className="head-close" onClick={() => onDone(null)} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="card-pad flex-1">
        {roomNote && (
          <p className="mt-1 text-sm" style={{ color: "var(--warn)" }}>
            {roomNote}
          </p>
        )}
        {rooms && (
          <div className="mt-3" style={{ maxWidth: 360 }}>
            <label className="label">Room</label>
            <Select className="input w-full" value={roomId} onChange={(e) => setRoomId(e.target.value)} autoFocus>
              {rooms.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        )}
        {lines.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              ID for the police report. Leave it blank to add later.
            </p>
            <div className="table-frame overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
              <table className="grid-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: 170 }}>Name</th>
                    <th style={{ minWidth: 140 }}>ID type</th>
                    <th style={{ minWidth: 150 }}>ID number</th>
                    <th style={{ minWidth: 150 }}>Nationality</th>
                    {canSeeIds && <th style={{ minWidth: 110 }}>Photo of ID</th>}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          className="input w-full"
                          value={l.name}
                          placeholder={i === 0 ? "Guest name" : `Adult ${i + 1}`}
                          onChange={(e) => set(i, "name", e.target.value)}
                          aria-label={`Name of adult ${i + 1}`}
                        />
                      </td>
                      <td>
                        <Select className="input w-full" value={l.id_type} onChange={(e) => set(i, "id_type", e.target.value)} aria-label="ID type">
                          <option value="">Select ID</option>
                          {CHECKIN_ID_TYPES.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.label}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td>
                        <input
                          className="input w-full"
                          value={l.id_number}
                          autoCapitalize="characters"
                          autoFocus={!rooms && i === lines.findIndex((x) => !x.id_number.trim())}
                          onChange={(e) => set(i, "id_number", e.target.value)}
                          aria-label={`ID number of adult ${i + 1}`}
                        />
                      </td>
                      <td>
                        <Select className="input w-full" value={l.nationality} onChange={(e) => set(i, "nationality", e.target.value)} aria-label="Nationality">
                          <option value="">Select country</option>
                          {countries.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.name}
                            </option>
                          ))}
                        </Select>
                      </td>
                      {canSeeIds && (
                        <td>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              className="btn btn-secondary text-xs"
                              disabled={shrinking || !l.name.trim()}
                              title={l.name.trim() ? "Take a photo or pick a file, front and back if the ID has both" : "Type the name first"}
                              onClick={() => {
                                setPhotoFor(i);
                                fileRef.current?.click();
                              }}
                            >
                              {l.files?.length ? `${l.files.length} added` : "Add"}
                            </button>
                            {l.files?.length > 0 && (
                              <button
                                type="button"
                                className="btn btn-ghost text-xs"
                                aria-label={`Remove the ID photos for adult ${i + 1}`}
                                title="Remove these photos"
                                onClick={() => set(i, "files", [])}
                              >
                                <Icon name="close" size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canSeeIds && (
              <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={pickPhotos} />
            )}
            {lines.some((l) => l.id_type === "passport" && (!l.nationality || l.nationality === "IN")) && (
              <p className="text-xs" style={{ color: "var(--warn)" }}>
                A passport holder&apos;s nationality decides whether a Form C is needed. Check it is right.
              </p>
            )}
          </div>
        )}
        </div>
        <div className="side-panel-foot flex flex-wrap justify-end gap-2" style={{ padding: "0.75rem 1.1rem" }}>
          <button type="button" className="btn btn-ghost text-sm" onClick={() => onDone(null)}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary text-sm" disabled={rooms && !roomId}>
            {missing && lines.length ? `Check in, ${missing} ID${missing === 1 ? "" : "s"} to add later` : "Check in"}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * The balance-due step of a check-out: take the money, or take it off as a
 * discount. A guest is not let go owing, except on a stay billed to a company,
 * whose bill goes to the city ledger instead.
 */
function SettleDialog({ request, onDone }) {
  const { guest, currency, company, canDiscount } = request;
  // What is still owed: a part discount lowers it and sends the desk back to payment.
  const [balance, setBalance] = useState(request.balance);
  const [amount, setAmount] = useState(String(request.balance));
  const [method, setMethod] = useState("cash");
  const [mode, setMode] = useState("pay");
  const [off, setOff] = useState(String(request.balance));
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const paid = Number(amount);
  const valid = Number.isFinite(paid) && paid >= balance;
  const short = Number.isFinite(paid) && paid > 0 && paid < balance;
  const offN = Number(off);
  const offValid = Number.isFinite(offN) && offN > 0 && offN <= balance && reason && (reason !== "other" || note.trim());
  useEscape(() => onDone(null));

  async function giveDiscount() {
    setBusy(true);
    setError(null);
    try {
      await request.giveDiscount({ amount: offN, reason, note: note.trim() });
      if (offN >= balance) return onDone({ discounted: true });
      const left = Number((balance - offN).toFixed(2));
      setBalance(left);
      setAmount(String(left));
      setMode("pay");
      setBusy(false);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

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
          if (mode === "pay" && valid) onDone({ amount: paid, method });
          if (mode === "discount" && offValid && !busy) giveDiscount();
        }}
      >
        <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
          {guest} owes {money(balance, currency)}
        </h3>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          {mode === "pay"
            ? "Take the payment and check out together."
            : "Take some or all of it off the bill, then check out."}
        </p>
        {mode === "pay" ? (
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
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="label">Amount off</label>
              <input
                className="input w-full"
                type="number"
                min="0"
                max={balance}
                step="any"
                autoFocus
                value={off}
                onChange={(e) => setOff(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Reason</label>
              <Select className="input w-full" value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">Pick a reason</option>
                {DISCOUNT_REASONS.filter((r) => r.id !== "promotion").map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="col-span-2">
              <label className="label">Note{reason === "other" ? "" : " (optional)"}</label>
              <input className="input w-full" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
        )}
        {mode === "pay" && short && (
          <p className="mt-2 text-sm" style={{ color: "var(--danger, #b91c1c)" }}>
            {money(balance - paid, currency)} would still be owed. Collect all of it{canDiscount ? ", or give a discount for the rest" : ""}.
          </p>
        )}
        {error && (
          <p className="mt-2 text-sm" style={{ color: "var(--danger, #b91c1c)" }}>
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-ghost text-sm" onClick={() => onDone(null)}>
            Cancel
          </button>
          {mode === "pay" && canDiscount && (
            <button type="button" className="btn btn-secondary text-sm" onClick={() => setMode("discount")}>
              Give a discount
            </button>
          )}
          {mode === "discount" && (
            <button type="button" className="btn btn-secondary text-sm" onClick={() => setMode("pay")}>
              Back to payment
            </button>
          )}
          {mode === "pay" && company && (
            <button type="button" className="btn btn-secondary text-sm" onClick={() => onDone({ skip: true })}>
              Bill to company
            </button>
          )}
          {mode === "pay" ? (
            <button type="submit" className="btn btn-primary text-sm" disabled={!valid}>
              Collect {valid ? money(paid, currency) : ""} &amp; check out
            </button>
          ) : (
            <button type="submit" className="btn btn-primary text-sm" disabled={!offValid || busy}>
              {busy ? "Saving..." : `Take ${offValid ? money(offN, currency) : ""} off & check out`}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/**
 * An issued invoice's PDF in a tab of its own, where the browser's viewer
 * prints or shares it. Printing it from a hidden frame came out blank. Call
 * it from a click, or the browser blocks the tab.
 */
export function printInvoicePdf(invoiceId) {
  window.open(`/api/pms/invoice?id=${invoiceId}&inline=1&print=1`, "_blank");
}

async function folioPost(body) {
  const res = await fetch("/api/pms/folio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "The invoice could not be issued.");
  return data;
}

/**
 * The guest's invoice as they leave: whatever is not yet invoiced is issued
 * now (one invoice per guest when the room keeps separate bills), then every
 * standing invoice of the stay is opened in a tab of its own, where it can
 * be printed or shared.
 *
 * Called straight from the click: the first tab is opened before anything
 * is awaited, or the browser blocks it as a popup.
 */
async function issueAndPrintInvoices(reservationId) {
  const tab = window.open("", "_blank");
  try {
    return await issueAndOpen(reservationId, tab);
  } catch (err) {
    tab?.close();
    throw err;
  }
}

/** Issue whatever is not yet on an invoice, and answer with the invoices that stand. */
async function issueInvoices(reservationId) {
  const res = await fetch(`/api/pms/folio?reservationId=${reservationId}`);
  let folio = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(folio.error || "The bill could not be read.");
  const open = (folio.charges || []).filter((c) => !c.invoice);
  const live = () => (folio.invoices || []).filter((i) => !i.voided_at);
  if ((folio.sharers || []).length > 0) {
    for (const x of folio.sharers.filter((x) => open.some((c) => c.owner === x.id))) {
      folio = await folioPost({ kind: "invoice", reservationId, sharerId: x.id });
    }
  } else if (open.length > 0 || live().length === 0) {
    folio = await folioPost({ kind: "invoice", reservationId });
  }
  return live();
}

/** Open each invoice's PDF, the first in a tab opened while the click still counted. */
function openInvoices(invoices) {
  invoices.forEach((inv) => window.open(`/api/pms/invoice?id=${inv.id}&inline=1&print=1`, "_blank"));
}

async function issueAndOpen(reservationId, tab) {
  const res = await fetch(`/api/pms/folio?reservationId=${reservationId}`);
  let folio = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(folio.error || "The bill could not be read.");

  const open = (folio.charges || []).filter((c) => !c.invoice);
  const live = () => (folio.invoices || []).filter((i) => !i.voided_at);
  if ((folio.sharers || []).length > 0) {
    for (const x of folio.sharers.filter((x) => open.some((c) => c.owner === x.id))) {
      folio = await folioPost({ kind: "invoice", reservationId, sharerId: x.id });
    }
  } else if (open.length > 0 || live().length === 0) {
    // A stay with nothing charged (complimentary) still gets its one invoice.
    folio = await folioPost({ kind: "invoice", reservationId });
  }

  const invoices = live();
  invoices.forEach((inv, i) => {
    const url = `/api/pms/invoice?id=${inv.id}&inline=1&print=1`;
    if (i === 0 && tab) tab.location.href = url;
    else window.open(url, "_blank");
  });
  if (invoices.length === 0) tab?.close();
  return invoices.length;
}

/**
 * `{ checkIn, checkOut, printBill, settleDialog }`. Both actions resolve to the status
 * route's answer (for its inventory warning), or null if the desk backed
 * out, and throw with a message written for the desk when refused.
 * `settleDialog` must be rendered by the caller.
 */
/**
 * `canSeeIds` is whether this user has the Guests page, which ID photos
 * need; without it the popup asks for ID numbers only.
 */
export function useFrontDesk(propertyId, { canSeeIds = false } = {}) {
  const toast = useToast();
  const dialog = useDialog();
  const [settle, setSettle] = useState(null);

  const [checkInAsk, setCheckInAsk] = useState(null);

  /** The popup, as a promise of `{ roomId, lines }`, or null if the desk backed out. */
  const askCheckIn = useCallback(async (request) => {
    const answer = await new Promise((resolve) => setCheckInAsk({ ...request, resolve }));
    setCheckInAsk(null);
    return answer;
  }, []);

  const checkInStep = useCallback(
    async (r, { roomSeenDirty = false } = {}) => {
      // Who is on the booking and whose ID is missing. If this cannot be
      // read, check-in still goes ahead; the police report shows the gap.
      const ids = await idLines(r).catch(() => null);
      const lines = ids && !ids.complete ? ids.lines : [];

      const finish = async (answer, roomId, markClean) => {
        if (answer?.lines?.length) await saveIdLines(r.id, ids.lines, answer.lines, propertyId || r.property_id);
        return postStatus(r.id, "in_house", roomId, { markClean });
      };

      if (r.room_id) {
        // Picked in the booking form, whose list already said "dirty": no second question.
        let dirty = false;
        let number = null;
        if (!roomSeenDirty) {
          const room = await roomOf(r, propertyId);
          dirty = room?.housekeeping === "dirty";
          number = room?.room_number || null;
        }
        if (!dirty && !lines.length) {
          try {
            return await postStatus(r.id, "in_house", null, { markClean: roomSeenDirty });
          } catch (err) {
            // The room could not be read first, and the server found it dirty.
            if (!/marked dirty/.test(err.message)) throw err;
            dirty = true;
          }
        }
        const answer = await askCheckIn({
          guest: r.guest_name,
          rooms: null,
          roomNote: dirty
            ? `${number ? `Room ${number}` : "The room"} is marked dirty. If it is ready, check the guest in and it is marked clean under your name.`
            : null,
          lines,
          canSeeIds,
        });
        if (!answer) return null;
        return finish(answer, null, dirty || roomSeenDirty);
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
      const isDirty = (x) => x.housekeeping === "dirty";
      const offered = [...free.filter((x) => !isDirty(x)), ...free.filter(isDirty)];

      const answer = await askCheckIn({
        guest: r.guest_name,
        rooms: offered.map((x) => ({
          value: x.id,
          label: isDirty(x) ? `Room ${x.room_number} (dirty, will be marked clean)` : `Room ${x.room_number}`,
        })),
        lines,
        canSeeIds,
      });
      if (!answer?.roomId) return null;
      return finish(answer, answer.roomId, isDirty(offered.find((x) => x.id === answer.roomId)));
    },
    [propertyId, askCheckIn, canSeeIds]
  );

  // A check-in on the wrong guest is put back with Undo, not a phone call.
  const checkIn = useCallback(
    async (r, opts) => {
      const done = await checkInStep(r, opts);
      if (done) {
        toast(`${r.guest_name || "Guest"} checked in`, {
          undo: async () => {
            await postStatus(r.id, "confirmed");
          },
        });
      }
      return done;
    },
    [checkInStep, toast]
  );

  const checkOut = useCallback(async (r) => {
    // Leaving before the last booked night: the stay is cut to today first,
    // so the rest goes back on sale and the balance below is the real one.
    const today = hotelToday();
    if (r.stay_kind !== "day_use" && today > r.check_in && today < r.check_out) {
      const pricing = await dialog.choose({
        title: `${r.guest_name || "Guest"} is leaving early`,
        message: "The nights not used go back on sale.",
        label: "What should the bill show?",
        options: [
          { value: "keep", label: "Full booking amount" },
          { value: "adjust", label: "Only the nights stayed" },
        ],
        confirmLabel: "Next",
      });
      if (!pricing) return null;
      const cut = await fetch("/api/pms/reservations/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: r.id,
          property_id: r.property_id,
          check_in: r.check_in,
          check_out: today,
          pricing,
        }),
      });
      const cutData = await cut.json().catch(() => ({}));
      if (!cut.ok) throw new Error(cutData.error || "Could not shorten the stay, so the guest is still checked in.");
    }

    const res = await fetch(`/api/pms/folio?reservationId=${r.id}`);
    const folio = await res.json().catch(() => ({}));
    const balance = res.ok ? Number(folio?.totals?.balance) || 0 : 0;

    if (balance > 0) {
      // A discount replaces the booking's one discount, so it is offered only
      // when there is none, or it is an amount off the final bill that this
      // adds to. A percent or before-tax discount is changed on the Bill tab.
      const prior = folio.discount;
      const canDiscount =
        !prior || (prior.kind === "amount" && prior.timing === "after_tax");
      let given = prior?.value || 0;
      const giveDiscount = async ({ amount, reason, note }) => {
        const value = Number((given + amount).toFixed(2));
        await folioPost({
          kind: "discount",
          reservationId: r.id,
          discount: { kind: "amount", value, timing: "after_tax", reason: prior?.reason || reason, note: prior?.note || note },
        });
        given = value;
      };
      const answer = await new Promise((resolve) =>
        setSettle({
          guest: r.guest_name,
          balance,
          currency: r.currency,
          company: folio?.reservation?.bill_to === "company",
          canDiscount,
          giveDiscount,
          resolve,
        })
      );
      setSettle(null);
      if (!answer) return null;
      if (!answer.skip && !answer.discounted) {
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
    const done = await postStatus(r.id, "checked_out");
    // Checking out issues the bill, so a guest never leaves without one even
    // when nobody reaches the Print button. The guest is usually still at the
    // desk, so the button waits a full minute.
    let invoices = [];
    try {
      invoices = await issueInvoices(r.id);
    } catch {
      // Issued from the Bill tab instead; Night Audit lists it until then.
    }
    toast(`${r.guest_name || "Guest"} checked out${invoices.length ? ". Bill issued." : ""}`, {
      duration: 60000,
      action: {
        label: "Print bill",
        busyLabel: "Opening...",
        run: () => (invoices.length ? openInvoices(invoices) : issueAndPrintInvoices(r.id)),
      },
    });
    return done;
  }, [toast, dialog]);

  // One element for the caller to render, whichever popup is open.
  const settleDialog = settle ? (
    <SettleDialog request={settle} onDone={settle.resolve} />
  ) : checkInAsk ? (
    <CheckInDialog request={checkInAsk} onDone={checkInAsk.resolve} />
  ) : null;

  /** Issue what is not yet invoiced and open the bill to print. Call it from a click. */
  const printBill = useCallback(
    async (r) => {
      try {
        const n = await issueAndPrintInvoices(r.id);
        if (!n) toast("There is no bill to print for this booking.");
      } catch (err) {
        toast(err.message || "The bill could not be opened.");
      }
    },
    [toast]
  );

  return { checkIn, checkOut, printBill, settleDialog };
}

/**
 * The guest's number as WhatsApp wants it. A ten-digit number with no
 * country code is taken as the hotel's own country's (only India's code is
 * known here; elsewhere the number must be stored with its +code). Null when
 * there is no usable number.
 */
export function whatsappNumber(phone, countryCode) {
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
