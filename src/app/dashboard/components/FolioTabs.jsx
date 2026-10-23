"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../../components/Icon";
import { useDialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import Select from "@/app/components/Select";
import DateField from "@/app/components/DateField";
import { countryName, countryOptions, toCountryCode } from "@/lib/countries";
import { CHECKIN_ID_TYPES } from "@/lib/onlineCheckinShared";
import { Drawer, Field } from "./RatePlanSetup";
import GuestIdPhotos from "./GuestIdPhotos";

/**
 * The parts of a booking that hang off its folio: who is staying, and the bill.
 *
 * Everything writes through one endpoint that answers with the whole folio, so
 * the totals shown here can never drift from the rows they were added up
 * from -- there is no local arithmetic to get out of step.
 *
 * The bill is one statement, read top to bottom like the printed folio: the
 * room, each service, the taxes, one total, what was paid, one balance. Every
 * line appears once. Adding a service, taking a payment and issuing an
 * invoice are buttons that open a drawer, not forms left open on the page.
 */

function money(value, currency = "INR") {
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : "₹";
  const n = Number(value) || 0;
  return `${symbol}${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** "Sat 26 Sep" -- a night on the folio, read in the hotel's calendar. */
function nightLabel(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function when(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const METHODS = [
  { id: "cash", label: "Cash" },
  { id: "card", label: "Card" },
  { id: "upi", label: "UPI" },
  { id: "bank_transfer", label: "Bank transfer" },
  { id: "ota", label: "Paid to OTA" },
  { id: "other", label: "Other" },
];

/** Offered only when the guest or their company has a wallet with money in it. */
const WALLET_METHOD = { id: "wallet", label: "Wallet" };

const walletKey = (w) => `${w.type}:${w.id}`;

/** The drawer each job opens, for the jobs the tape chart's menu can ask for. */
const INTENT_DRAWER = { inclusions: "service", payments: "payment", invoices: "invoice" };

const smallHeading = {
  fontSize: "0.7rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--text-muted)",
};

/** One change to the folio. Answers with the whole folio it left behind. */
async function sendFolio(reservationId, kind, payload) {
  const res = await fetch("/api/pms/folio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, reservationId, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "That did not save");
  return data;
}

/**
 * The bill as the guest would read it. With `actions` the rows carry their
 * buttons (night rates, remove a service, void a payment); the invoice
 * preview shows it without them.
 */
function Statement({ folio, currency, actions, busy }) {
  const { nights, totals } = folio;
  const roomNumber = folio.reservation?.rooms?.room_number;
  const roomLabel = [
    roomNumber ? `Room ${roomNumber}` : "Room",
    nights.length > 0 &&
      `${nights.length} night${nights.length === 1 ? "" : "s"} from ${nightLabel(nights[0].stay_date)}`,
  ]
    .filter(Boolean)
    .join(", ");
  const faint = { color: "var(--text-faint)", fontSize: "0.75rem" };
  const cell = actions ? <td /> : null;
  // With separate bills, whose bill each service is on.
  const sharers = folio.sharers || [];
  const sharerName = (e) => {
    if (sharers.length === 0 || (e.kind && e.kind !== "extra")) return null;
    const id = sharers.some((x) => x.id === e.bill_guest_id) ? e.bill_guest_id : primaryOf(sharers);
    return sharers.find((x) => x.id === id)?.name || null;
  };

  return (
    <table className="grid-table w-full text-sm">
      <tbody>
        <tr>
          <td>
            {roomLabel}
            {nights.length > 0 && !folio.nightsMatch && (
              <div style={{ fontSize: "0.7rem", color: "var(--warn)" }}>
                The night rates do not add up to this. Open Night rates to set them.
              </div>
            )}
          </td>
          <td className="text-right">{money(totals.room, currency)}</td>
          {actions && (
            <td className="text-right">
              {nights.length > 0 && (
                <button type="button" className="btn btn-ghost text-xs" disabled={busy} onClick={actions.editNights}>
                  Night rates
                </button>
              )}
            </td>
          )}
        </tr>

        {folio.extras.map((e) => {
          const qty = Number(e.quantity);
          return (
            <tr key={e.id}>
              <td>
                {e.name}
                {qty > 1 ? ` x${qty}` : ""}
                {e.stay_date && <span style={faint}>, {nightLabel(e.stay_date)}</span>}
                {sharerName(e) && <span style={faint}>, bill: {sharerName(e)}</span>}
              </td>
              <td className="text-right">
                {e.kind === "inclusion" ? (
                  <span style={faint}>Included</span>
                ) : (
                  money(Number(e.unit_price) * qty, currency)
                )}
              </td>
              {actions && (
                <td className="text-right">
                  <button
                    type="button"
                    className="btn btn-ghost text-xs"
                    disabled={busy}
                    title={`Remove ${e.name}`}
                    aria-label={`Remove ${e.name}`}
                    onClick={() => actions.removeExtra(e)}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </td>
              )}
            </tr>
          );
        })}

        {(folio.taxes || [])
          .filter((t) => !t.inclusive)
          .map((t, i) => (
            <tr key={`${t.tax_id}-${i}`}>
              <td style={{ color: "var(--text-muted)" }}>
                {t.name}
                {t.detail && <span style={faint}>, {t.detail}</span>}
              </td>
              <td className="text-right">{money(t.amount, currency)}</td>
              {cell}
            </tr>
          ))}

        <tr style={{ fontWeight: 600 }}>
          <td>
            Total
            {(folio.taxes || [])
              .filter((t) => t.inclusive)
              .map((t, i) => (
                <span key={`inc-${t.tax_id}-${i}`} style={{ ...faint, fontWeight: 400 }}>
                  , includes {t.name} {money(t.amount, currency)}
                </span>
              ))}
          </td>
          <td className="text-right">{money(totals.total, currency)}</td>
          {cell}
        </tr>

        {/* A voided payment stays on the bill, struck through, so the desk can
            see what was taken back and why. */}
        {folio.payments.map((p) => {
          const amount = Number(p.amount);
          const method = [...METHODS, WALLET_METHOD].find((m) => m.id === p.method)?.label || p.method;
          return (
            <tr key={p.id} style={p.voided_at ? { color: "var(--text-faint)" } : undefined}>
              <td>
                {amount < 0 ? "Refund" : "Paid"}, {method}
                {p.reference ? `, ${p.reference}` : ""}
                <span style={faint}>, {when(p.paid_at)}</span>
                {sharerName(p) && <span style={faint}>, bill: {sharerName(p)}</span>}
                {p.voided_at && (
                  <span className="chip chip-off ml-2" style={{ fontSize: "0.6rem" }}>
                    Voided{p.void_reason ? `, ${p.void_reason}` : ""}
                  </span>
                )}
              </td>
              <td className="text-right" style={{ textDecoration: p.voided_at ? "line-through" : undefined }}>
                {money(Math.abs(amount), currency)}
              </td>
              {actions && (
                <td className="text-right">
                  {!p.voided_at && (
                    <button
                      type="button"
                      className="btn btn-ghost text-xs"
                      disabled={busy}
                      onClick={() => actions.voidPayment(p)}
                    >
                      Void
                    </button>
                  )}
                </td>
              )}
            </tr>
          );
        })}

        <tr style={{ fontWeight: 600, color: totals.balance > 0 ? "var(--warn)" : "var(--text)" }}>
          <td>{totals.balance < 0 ? "Refund due" : "Balance"}</td>
          <td className="text-right">{money(Math.abs(totals.balance), currency)}</td>
          {cell}
        </tr>
      </tbody>
    </table>
  );
}

/**
 * Whose bill, when guests sharing the room are billed apart: one button per
 * sharer, so the choice is one press and always visible.
 */
function BillPicker({ sharers, bills = [], currency, value, onChange, disabled, label = "Bill for" }) {
  if (!sharers?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      <span className="label" style={{ margin: 0 }}>{label}</span>
      {sharers.map((s) => {
        const b = bills.find((x) => x.id === s.id);
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={value === s.id}
            disabled={disabled}
            className={`btn text-sm ${value === s.id ? "btn-primary" : "btn-secondary"}`}
            onClick={() => onChange(s.id)}
          >
            {s.name}
            {b && (
              <span style={{ fontSize: "0.7rem", opacity: 0.8 }}>
                {b.balance > 0 ? `owes ${money(b.balance, currency)}` : "paid"}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

const primaryOf = (sharers) => (sharers.find((s) => s.isPrimary) || sharers[0])?.id || null;

/**
 * Separate bills for guests sharing the room: each guest's share of the room,
 * who their invoices go to, and what they owe. Offered once two guests are
 * named; one press turns it on.
 */
function SharedBills({ folio, currency, busy, post, propertyId, openFor }) {
  const sharers = folio.sharers || [];
  const bills = folio.bills || [];
  const [companies, setCompanies] = useState([]);
  const [shares, setShares] = useState({});

  useEffect(() => {
    if (sharers.length === 0) return;
    const pid = propertyId || folio.reservation?.property_id;
    fetch(`/api/pms/companies${pid ? `?propertyId=${pid}` : ""}`)
      .then((r) => (r.ok ? r.json() : { companies: [] }))
      .then((d) => setCompanies((d.companies || []).filter((c) => c.is_active)))
      .catch(() => setCompanies([]));
  }, [sharers.length, propertyId, folio.reservation?.property_id]);

  if (sharers.length === 0) return null;
  const set = sharers.filter((s) => s.shareSet);
  const setSum = set.reduce((sum, s) => sum + Number(s.share), 0);
  // What the desk typed, before the server scaled it to 100.
  const typedSum = (folio.guests || []).reduce(
    (sum, g) => sum + (g.room_share != null && g.room_share !== "" ? Number(g.room_share) : 0),
    0
  );
  const typedAll = (folio.guests || []).every((g) => g.room_share != null && g.room_share !== "");
  const typedShare = (id) => {
    const g = (folio.guests || []).find((x) => x.id === id);
    return g?.room_share != null && g.room_share !== "" ? String(Number(g.room_share)) : "";
  };
  const sharesOff = set.length > 0 && setSum >= 0 && (typedSum > 100.001 || (typedAll && Math.abs(typedSum - 100) > 0.001));

  const saveShare = (s) => {
    const raw = shares[s.id];
    if (raw === undefined) return;
    setShares((prev) => {
      const next = { ...prev };
      delete next[s.id];
      return next;
    });
    post("sharer", { guestId: s.id, room_share: raw === "" ? null : Number(raw) });
  };

  const kinds = [
    ["company", "Companies"],
    ["travel_agent", "Travel agents"],
  ];
  const tight = { padding: "0.35rem 0.6rem" };

  return (
    <div className="space-y-1">
      <div className="overflow-x-auto">
        <table className="grid-table w-full text-sm">
          <thead>
            <tr>
              <th>Guest</th>
              <th className="text-right">Share %</th>
              <th>Invoice to</th>
              <th className="text-right hidden sm:table-cell">Total</th>
              <th className="text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {sharers.map((s) => {
              const b = bills.find((x) => x.id === s.id) || {};
              return (
                <tr key={s.id}>
                  <td style={tight}>
                    <div style={{ fontWeight: 500 }}>{s.name}</div>
                    {/* Already set to this guest, so nothing lands on the wrong bill. */}
                    <div className="mt-1 flex flex-wrap gap-1">
                      <button type="button" className="btn btn-secondary text-xs" disabled={busy} onClick={() => openFor("service", s.id)}>
                        <Icon name="plus" size={12} /> Service
                      </button>
                      <button type="button" className="btn btn-secondary text-xs" disabled={busy} onClick={() => openFor("payment", s.id)}>
                        Collect
                      </button>
                    </div>
                  </td>
                  <td className="text-right" style={tight}>
                    <input
                      className="input"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="100"
                      step="0.01"
                      aria-label={`${s.name}'s share of the room, percent`}
                      placeholder={String(Math.round(s.share * 100) / 100)}
                      disabled={busy}
                      value={shares[s.id] ?? typedShare(s.id)}
                      onChange={(e) => setShares((prev) => ({ ...prev, [s.id]: e.target.value }))}
                      onBlur={() => saveShare(s)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          saveShare(s);
                        }
                      }}
                      style={{ maxWidth: 76, textAlign: "right", marginLeft: "auto", padding: "0.3rem 0.5rem" }}
                    />
                  </td>
                  <td style={{ ...tight, minWidth: 150 }}>
                    <Select
                      className="input"
                      value={s.companyId || ""}
                      disabled={busy}
                      onChange={(e) => post("sharer", { guestId: s.id, bill_company_id: e.target.value || null })}
                    >
                      <option value="">Guest pays</option>
                      {kinds.map(([kind, label]) => {
                        const group = companies.filter((c) => c.kind === kind);
                        return group.length ? (
                          <optgroup key={kind} label={label}>
                            {group.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </optgroup>
                        ) : null;
                      })}
                    </Select>
                    {s.companyId && companies.some((c) => c.id === s.companyId && !c.gstin) && (
                      <div style={{ fontSize: "0.7rem", color: "var(--warn)" }}>No GSTIN on record</div>
                    )}
                  </td>
                  <td className="text-right tabular-nums hidden sm:table-cell" style={tight}>
                    {money(b.total || 0, currency)}
                  </td>
                  <td
                    className="text-right tabular-nums"
                    style={{ ...tight, fontWeight: 600, color: b.balance > 0 ? "var(--warn)" : undefined }}
                  >
                    {money(b.balance || 0, currency)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sharesOff ? (
        <p className="text-sm" style={{ color: "var(--warn)" }}>
          The shares you typed add up to {Math.round(typedSum * 100) / 100}%, so they are scaled to 100%:{" "}
          {sharers.map((s) => `${s.name} ${Math.round(s.share * 100) / 100}%`).join(", ")}.
        </p>
      ) : (
        <p style={{ color: "var(--text-faint)", fontSize: "0.75rem" }}>Leave a share blank to split the room evenly.</p>
      )}
    </div>
  );
}

/** Add a service to the stay. Its name and price can be changed for this stay only. */
function ServiceDrawer({ folio, extras, reservationId, currency, onClose, onSaved, forGuest }) {
  // Every charge is a service, so it carries that service's taxes. The room
  // is billed through its nights, never added as a line.
  const sellable = (extras || []).filter((x) => !x.is_room);
  const serviceGroups = Object.entries(
    sellable.reduce((acc, x) => {
      const key = x.service_categories?.name || "Uncategorised";
      (acc[key] = acc[key] || []).push(x);
      return acc;
    }, {})
  );
  const sharers = folio.sharers || [];
  const [line, setLine] = useState({
    extra_id: "",
    name: "",
    unit_price: "",
    quantity: "",
    stay_date: "",
    bill_guest_id: forGuest || primaryOf(sharers),
  });
  const [pricing, setPricing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const chosen = sellable.find((x) => x.id === line.extra_id);

  async function save() {
    if (sellable.length === 0) {
      setError("No services yet. Add them in Setup > Services Setup.");
      return;
    }
    if (!line.extra_id) {
      setError("Choose a service.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendFolio(reservationId, "extra", {
        line: {
          ...line,
          stay_date: line.stay_date || null,
          bill_guest_id: sharers.length ? line.bill_guest_id : undefined,
          unit_price: line.unit_price === "" ? undefined : Number(line.unit_price),
          // A per-night service with the quantity left empty is multiplied
          // out by the server; an explicit number wins.
          quantity: Number(line.quantity) || undefined,
        },
      });
      await onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Drawer title="Add service" onCancel={onClose} onSave={save} saveLabel="Add" busyLabel="Adding..." busy={busy} error={error}>
      {sellable.length === 0 ? (
        <p className="sub">
          No services set up yet. Add them under Setup &gt; Services Setup, and give each its taxes under Tax Setup.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {sharers.length > 0 && (
            <div className="sm:col-span-2">
              <BillPicker
                sharers={sharers}
                bills={folio.bills}
                currency={currency}
                value={line.bill_guest_id}
                disabled={busy}
                onChange={(id) => setLine({ ...line, bill_guest_id: id })}
              />
            </div>
          )}
          <div className="sm:col-span-2">
            <Field label="Service">
              <Select
                className="input"
                autoFocus
                value={line.extra_id}
                onChange={(e) => {
                  const svc = sellable.find((x) => x.id === e.target.value);
                  setLine({
                    ...line,
                    extra_id: e.target.value,
                    name: svc?.name || "",
                    unit_price: svc ? String(svc.unit_price) : "",
                  });
                }}
              >
                <option value="">Choose...</option>
                {serviceGroups.map(([category, items]) => (
                  <optgroup key={category} label={category}>
                    {items.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}: {money(x.unit_price, currency)}
                        {x.charge_type === "per_night" ? "/night" : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Quantity">
            <input
              className="input"
              type="number"
              inputMode="numeric"
              min="1"
              value={line.quantity}
              placeholder={chosen?.charge_type === "per_night" ? "Each night" : "1"}
              onChange={(e) => setLine({ ...line, quantity: e.target.value })}
            />
          </Field>
          <Field label="Night">
            <Select className="input" value={line.stay_date} onChange={(e) => setLine({ ...line, stay_date: e.target.value })}>
              <option value="">Whole stay</option>
              {folio.nights.map((n) => (
                <option key={n.stay_date} value={n.stay_date}>
                  {nightLabel(n.stay_date)}
                </option>
              ))}
            </Select>
          </Field>
          {chosen && !pricing && (
            <div className="sm:col-span-2">
              <button type="button" className="btn btn-ghost text-sm" onClick={() => setPricing(true)}>
                Change the name or price for this stay
              </button>
            </div>
          )}
          {chosen && pricing && (
            <>
              <Field label="Name on the bill">
                <input className="input" value={line.name} onChange={(e) => setLine({ ...line, name: e.target.value })} />
              </Field>
              <Field label="Price each">
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={line.unit_price}
                  onChange={(e) => setLine({ ...line, unit_price: e.target.value })}
                />
              </Field>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}

/**
 * Collect a payment, or give a refund. The amount always starts at what is owed;
 * a refund is its own choice rather than a minus sign. A guest's own wallet,
 * or the company's on the booking, is one more way to pay, up to what it holds.
 */
function PaymentDrawer({ folio, reservationId, currency, onClose, onSaved, forGuest }) {
  // With separate bills a payment pays one guest's bill: the one owing most.
  const sharers = folio.sharers || [];
  const bills = folio.bills || [];
  const [whose, setWhose] = useState(() =>
    bills.length ? forGuest || [...bills].sort((a, b) => b.balance - a.balance)[0].id : null
  );
  const bill = bills.find((b) => b.id === whose) || null;
  const balance = bill ? bill.balance : folio.totals.balance;
  const wallets = (folio.wallets || []).filter((w) => w.balance > 0);
  const owedFor = (isRefund) => Math.max(isRefund ? -balance : balance, 0);
  const [refund, setRefund] = useState(balance < 0);
  const [method, setMethod] = useState("cash");
  const [which, setWhich] = useState(wallets[0] ? walletKey(wallets[0]) : "");
  const [amount, setAmount] = useState(() => (owedFor(balance < 0) > 0 ? String(owedFor(balance < 0)) : ""));
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const wallet = wallets.find((w) => walletKey(w) === which) || wallets[0];
  const methods = refund || wallets.length === 0 ? METHODS : [...METHODS, WALLET_METHOD];
  const owed = owedFor(refund);

  function pickMethod(id, w = wallet) {
    setMethod(id);
    if (id === "wallet" && w) setAmount(String(owed > 0 ? Math.min(w.balance, owed) : w.balance));
  }

  async function save() {
    const n = Number(amount);
    if (!(n > 0)) {
      setError("Enter an amount more than zero.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (method === "wallet") {
        const res = await fetch("/api/pms/wallets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "pay",
            property_id: folio.reservation?.property_id,
            reservationId,
            billGuestId: whose || undefined,
            type: wallet.type,
            id: wallet.id,
            amount: n,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not pay from the wallet");
      } else {
        await sendFolio(reservationId, "payment", {
          payment: { amount: refund ? -n : n, method, reference, bill_guest_id: whose || undefined },
        });
      }
      await onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Drawer
      title={refund ? "Give a refund" : "Collect payment"}
      subtitle={owed > 0 ? `${refund ? "Refund due" : "Owed"}: ${money(owed, currency)}` : "Nothing is owed"}
      onCancel={onClose}
      onSave={save}
      saveLabel={refund ? "Save refund" : `Collect ${money(Number(amount) || 0, currency)}`}
      busy={busy}
      error={error}
    >
      <div className="space-y-4">
        {sharers.length > 0 && (
          <BillPicker
            sharers={sharers}
            bills={bills}
            currency={currency}
            value={whose}
            disabled={busy}
            onChange={(id) => {
              setWhose(id);
              const owes = bills.find((b) => b.id === id)?.balance || 0;
              const due = Math.max(refund ? -owes : owes, 0);
              setAmount(due > 0 ? String(due) : "");
              if (method === "wallet") setMethod("cash");
            }}
          />
        )}
        <Field label="Amount">
          <input
            className="input"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            autoFocus
            max={method === "wallet" && wallet ? Math.min(wallet.balance, owed) : undefined}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>

        <div>
          <span className="label">Method</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Method">
            {methods.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={method === m.id}
                className={`btn text-sm ${method === m.id ? "btn-primary" : "btn-secondary"}`}
                onClick={() => pickMethod(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {method === "wallet" && wallet && (
          <Field
            label="Wallet"
            hint={wallets.map((w) => `${w.name}: ${money(w.balance, currency)}`).join(", ")}
          >
            {wallets.length > 1 ? (
              <Select
                className="input"
                value={which}
                onChange={(e) => {
                  setWhich(e.target.value);
                  pickMethod("wallet", wallets.find((w) => walletKey(w) === e.target.value));
                }}
              >
                {wallets.map((w) => (
                  <option key={walletKey(w)} value={walletKey(w)}>
                    {w.type === "company" ? `${w.name} (company)` : `${w.name} (guest)`}
                  </option>
                ))}
              </Select>
            ) : (
              <div className="input" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
                {wallet.type === "company" ? `${wallet.name} (company)` : `${wallet.name} (guest)`}
              </div>
            )}
          </Field>
        )}

        {method !== "wallet" && method !== "cash" && (
          <Field label="Reference" hint="Optional. A card slip or UPI number.">
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        )}

        <button
          type="button"
          className="btn btn-ghost text-sm"
          onClick={() => {
            const next = !refund;
            setRefund(next);
            if (method === "wallet") setMethod("cash");
            setAmount(owedFor(next) > 0 ? String(owedFor(next)) : "");
          }}
        >
          {refund ? "Collect a payment instead" : "Give a refund instead"}
        </button>
      </div>
    </Drawer>
  );
}

/** A charge as it reads inside its category: just the night, or the service. */
function chargeLabel(c) {
  if (c.key.startsWith("night:")) return nightLabel(c.key.slice(6));
  return `${c.description}${c.quantity > 1 ? ` x${c.quantity}` : ""}`;
}

/**
 * Picks the charges an invoice carries, then issues it and downloads it in
 * one go. Everything not yet invoiced is ticked, so one invoice for the whole
 * bill is still one press. Untick the food to put it on an invoice of its
 * own, or press One invoice per category to issue room and food apart at once.
 */
function InvoiceDrawer({ folio, reservationId, currency, onClose, onSaved, onRefresh, onTakePayment, onIssued, forGuest }) {
  const toast = useToast();
  const sharers = folio.sharers || [];
  const allOpen = (folio.charges || []).filter((c) => !c.invoice);
  // With separate bills an invoice is one guest's: start on the first guest
  // with something left to invoice.
  const [whose, setWhose] = useState(
    () => forGuest || (sharers.find((x) => allOpen.some((c) => c.owner === x.id)) || sharers[0])?.id || null
  );
  const charges = (folio.charges || []).filter((c) => !whose || c.owner === whose);
  const open = charges.filter((c) => !c.invoice);
  const done = charges.filter((c) => c.invoice);
  const [picked, setPicked] = useState(() => new Set(allOpen.map((c) => c.key)));
  const [expanded, setExpanded] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const groups = [];
  for (const c of open) {
    let g = groups.find((x) => x.name === c.category);
    if (!g) groups.push((g = { name: c.category, charges: [] }));
    g.charges.push(c);
  }
  const chosen = open.filter((c) => picked.has(c.key));
  const withTax = (rows) => rows.reduce((s, c) => s + c.amount + c.tax, 0);
  const nothingLeft = open.length === 0 && (charges.length > 0 || Boolean(whose));
  // What the guest being invoiced still owes: their own bill with separate bills.
  const whoseBill = whose ? (folio.bills || []).find((b) => b.id === whose) : null;
  const owesNow = whoseBill ? whoseBill.balance : folio.totals.balance;
  const everything = chosen.length === open.length;

  const toggle = (keys, on) =>
    setPicked((prev) => {
      const next = new Set(prev);
      for (const k of keys) (on ? next.add(k) : next.delete(k));
      return next;
    });

  /** Issues one invoice per set of charges, in turn, and downloads each. */
  async function issue(sets) {
    setBusy(true);
    setError(null);
    const issued = [];
    try {
      for (const { keys, sharerId } of sets) {
        const before = new Set(folio.invoices.map((i) => i.id).concat(issued.map((i) => i.id)));
        const data = await sendFolio(reservationId, "invoice", {
          ...(keys ? { charges: keys } : {}),
          ...(sharerId ? { sharerId } : {}),
        });
        const inv = (data.invoices || []).find((i) => !before.has(i.id));
        if (inv) issued.push(inv);
      }
      toast(`${issued.map((i) => i.invoice_number).join(" and ")} issued`);
      // Shown in the preview on the Invoices tab, not downloaded.
      if (issued[0]) onIssued?.(issued[0].id);
      await onSaved();
    } catch (err) {
      // Whatever was issued before the failure stands; show the bill as it now is.
      await onRefresh();
      setError(
        /already on an invoice/.test(err.message)
          ? "Some of these charges were just invoiced on another screen. The list is updated; check it and issue again."
          : issued.length > 0
            ? `${issued.map((i) => i.invoice_number).join(", ")} issued. ${err.message}`
            : err.message
      );
      setBusy(false);
    }
  }

  const save = () => issue([{ keys: everything ? null : chosen.map((c) => c.key), sharerId: whose }]);
  const perCategory = () => issue(groups.map((g) => ({ keys: g.charges.map((c) => c.key), sharerId: whose })));
  // Every guest's whole bill, each on its own invoice.
  const owing = sharers.filter((x) => allOpen.some((c) => c.owner === x.id));
  const perGuest = () => issue(owing.map((x) => ({ keys: null, sharerId: x.id })));

  const faint = { color: "var(--text-faint)", fontSize: "0.75rem" };
  const doneBy = {};
  for (const c of done) (doneBy[c.invoice] = doneBy[c.invoice] || new Set()).add(c.category);
  const tight = { padding: "0.35rem 0.75rem" };

  return (
    <Drawer
      title="Issue invoice"
      subtitle={
        nothingLeft
          ? "Everything is invoiced"
          : open.length > 0
            ? chosen.length === 0
              ? "Tick at least one charge"
              : `${chosen.length} of ${open.length} charges, invoice total ${money(withTax(chosen), currency)} with tax`
            : null
      }
      onCancel={onClose}
      onSave={save}
      saveLabel="Issue invoice"
      busyLabel="Issuing..."
      cancelLabel={nothingLeft ? "Close" : "Cancel"}
      saveDisabled={nothingLeft || (open.length > 0 && chosen.length === 0)}
      busy={busy}
      error={error}
    >
      {/* Only when invoicing everything: a split leaves the rest owing by design. */}
      {owesNow > 0 && everything && !nothingLeft && (
        <div className="flex flex-wrap items-center gap-2 text-sm" style={{ color: "var(--warn)" }}>
          <span style={{ marginRight: "auto" }}>
            {whoseBill ? whoseBill.name : "The guest"} still owes {money(owesNow, currency)}.
          </span>
          <button type="button" className="btn btn-secondary text-sm" disabled={busy} onClick={() => onTakePayment(whose)}>
            Collect payment first
          </button>
        </div>
      )}

      {sharers.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <div style={{ marginRight: "auto" }}>
            <BillPicker
              sharers={sharers}
              bills={folio.bills}
              currency={currency}
              label="Invoice for"
              value={whose}
              disabled={busy}
              onChange={(id) => {
                setWhose(id);
                setError(null);
              }}
            />
          </div>
          {owing.length > 1 && (
            <button type="button" className="btn btn-secondary text-sm" disabled={busy} onClick={perGuest}>
              One invoice per guest
            </button>
          )}
        </div>
      )}

      {nothingLeft ? (
        <p className="sub">
          {charges.length === 0
            ? "Nothing is on this guest's bill."
            : "Everything on this bill is on an invoice. To change one, close this and void it under Invoices."}
        </p>
      ) : open.length === 0 ? (
        <>
          <p className="sub">Nothing is charged on this stay. The invoice will show a zero bill.</p>
          <Statement folio={folio} currency={currency} />
        </>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="sub" style={{ marginRight: "auto" }}>
              Untick charges to put them on a separate invoice. Issued invoices never change.
            </p>
            {groups.length > 1 && (
              <button type="button" className="btn btn-secondary text-sm" disabled={busy} onClick={perCategory}>
                One invoice per category
              </button>
            )}
          </div>
          <table className="grid-table w-full text-sm">
            <tbody>
              {groups.map((g) => {
                const keys = g.charges.map((c) => c.key);
                const all = keys.every((k) => picked.has(k));
                const some = !all && keys.some((k) => picked.has(k));
                const single = g.charges.length === 1 && g.charges[0].description === g.name;
                // Long lists (a week of nights) fold into the category row.
                const folded = g.charges.length > 3 && !expanded.has(g.name);
                const nights = g.charges.every((c) => c.key.startsWith("night:"));
                return [
                  <tr key={`g-${g.name}`}>
                    <td style={tight}>
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-2" style={{ fontWeight: 600 }}>
                          <input
                            type="checkbox"
                            checked={all}
                            ref={(el) => el && (el.indeterminate = some)}
                            disabled={busy}
                            onChange={(e) => toggle(keys, e.target.checked)}
                          />
                          {g.name}
                          {g.charges.length > 1 && (
                            <span style={faint}>
                              {g.charges.length} {nights ? "nights" : "charges"}
                            </span>
                          )}
                        </label>
                        {g.charges.length > 3 && (
                          <button
                            type="button"
                            className="btn btn-secondary text-xs"
                            disabled={busy}
                            onClick={() =>
                              setExpanded((prev) => {
                                const next = new Set(prev);
                                if (next.has(g.name)) next.delete(g.name);
                                else next.add(g.name);
                                return next;
                              })
                            }
                          >
                            {folded ? (nights ? "Show nights" : "Show all") : "Hide"}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="text-right" style={{ ...tight, fontWeight: 600 }}>
                      {money(withTax(g.charges), currency)}
                    </td>
                  </tr>,
                  ...(single || folded
                    ? []
                    : g.charges.map((c) => (
                        <tr key={c.key}>
                          <td style={{ ...tight, paddingLeft: 32 }}>
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={picked.has(c.key)}
                                disabled={busy}
                                onChange={(e) => toggle([c.key], e.target.checked)}
                              />
                              {chargeLabel(c)}
                            </label>
                          </td>
                          <td className="text-right" style={tight}>
                            {money(c.amount + c.tax, currency)}
                          </td>
                        </tr>
                      ))),
                ];
              })}
            </tbody>
          </table>
          <p style={faint}>Amounts include tax.</p>
        </div>
      )}

      {Object.keys(doneBy).length > 0 && (
        <p className="text-sm">
          <span style={smallHeading}>Already invoiced </span>
          {Object.entries(doneBy)
            .map(([number, cats]) => `${number} (${[...cats].join(", ")})`)
            .join(", ")}
        </p>
      )}
    </Drawer>
  );
}

/** The room charge night by night. The room charge becomes the sum of these. */
function NightsDrawer({ folio, reservationId, currency, onClose, onSaved, onRefresh }) {
  const [rates, setRates] = useState(() =>
    Object.fromEntries(folio.nights.map((n) => [n.stay_date, n.rate == null ? "" : String(n.rate)]))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const sum = Object.values(rates).reduce((s, r) => s + (Number(r) || 0), 0);

  async function save() {
    const changed = folio.nights.filter((n) => rates[n.stay_date] !== (n.rate == null ? "" : String(n.rate)));
    if (changed.length === 0) {
      onClose();
      return;
    }
    if (changed.some((n) => rates[n.stay_date] === "")) {
      setError("Enter a rate for every night.");
      return;
    }
    setBusy(true);
    setError(null);
    let saved = 0;
    try {
      for (const n of changed) {
        await sendFolio(reservationId, "night", { stay_date: n.stay_date, rate: rates[n.stay_date] });
        saved += 1;
      }
      await onSaved();
    } catch (err) {
      // Nights already sent are saved; the bill behind must show them.
      if (saved > 0) await onRefresh();
      setError(saved > 0 ? `${saved} of ${changed.length} nights saved. ${err.message}` : err.message);
      setBusy(false);
    }
  }

  return (
    <Drawer title="Night rates" subtitle={`Room charge ${money(sum, currency)}`} onCancel={onClose} onSave={save} busy={busy} error={error}>
      {!folio.nightsMatch && (
        <p className="text-sm" style={{ color: "var(--warn)" }}>
          The room charge is {money(folio.totals.room, currency)}, which the nights below do not add up to. Saving
          here makes the room charge the total of the nights.
        </p>
      )}
      <table className="grid-table w-full text-sm">
        <tbody>
          {folio.nights.map((n, i) => (
            <tr key={n.stay_date}>
              <td>{nightLabel(n.stay_date)}</td>
              <td className="text-right">
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  autoFocus={i === 0}
                  aria-label={`Rate for ${nightLabel(n.stay_date)}`}
                  value={rates[n.stay_date]}
                  onChange={(e) => setRates((prev) => ({ ...prev, [n.stay_date]: e.target.value }))}
                  style={{ maxWidth: 140, textAlign: "right", marginLeft: "auto" }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Drawer>
  );
}

/**
 * `intent` is the job the booking was opened for -- "inclusions" to add a
 * service, "payments" to take one, "invoices" to issue one -- and opens that
 * job's drawer. `onIntentDone` tells the booking the drawer has closed, so
 * asking for the same job again opens it again.
 */
export default function FolioTabs({
  tab,
  folio,
  extras,
  reservationId,
  intent,
  onIntentDone,
  onChanged,
  canSeeIds = false,
  propertyId = null,
  onTab = null,
}) {
  const dialog = useDialog();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [guest, setGuest] = useState(null);
  const [drawer, setDrawer] = useState(null);
  // The guest a drawer was opened for, from their row of separate bills.
  const [forGuest, setForGuest] = useState(null);
  // The invoice shown in the preview on the Invoices tab.
  const [previewId, setPreviewId] = useState(null);
  // The named guest whose photo ID is open, uploaded by the desk for them.
  const [idsOpen, setIdsOpen] = useState(null);

  useEffect(() => {
    if ((tab === "bill" || tab === "invoices") && INTENT_DRAWER[intent]) setDrawer(INTENT_DRAWER[intent]);
  }, [tab, intent]);

  function closeDrawer() {
    setDrawer(null);
    setForGuest(null);
    onIntentDone?.();
  }

  async function post(kind, payload) {
    setBusy(true);
    setError(null);
    try {
      await sendFolio(reservationId, kind, payload);
      await onChanged();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  /**
   * A service line goes at once, with an Undo that adds it back as it was.
   * An included item came with the rate plan, so it cannot be put back as a
   * charge and goes without one.
   */
  async function removeExtra(e) {
    if (!(await remove("extra", e.id)) || e.kind !== "extra") return;
    toast(`${e.name} removed from the bill`, {
      undo: async () => {
        await sendFolio(reservationId, "extra", {
          line: {
            extra_id: e.extra_id,
            name: e.name,
            unit_price: Number(e.unit_price),
            quantity: Number(e.quantity),
            stay_date: e.stay_date || null,
            bill_guest_id: e.bill_guest_id || undefined,
          },
        });
        await onChanged();
      },
    });
  }

  async function remove(kind, id, reason) {
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ kind, id, reservationId });
      if (reason) qs.set("reason", reason);
      const res = await fetch(`/api/pms/folio?${qs}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "That did not save");
      await onChanged();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const currency = folio.reservation?.currency || "INR";
  const balance = folio.totals?.balance || 0;
  const charges = folio.charges || [];
  const invoicedSome = charges.some((c) => c.invoice);
  const leftOver = invoicedSome ? charges.filter((c) => !c.invoice) : [];
  const allInvoiced = charges.length > 0 && charges.every((c) => c.invoice);
  const standingInvoice = (folio.invoices || []).some((i) => !i.voided_at);
  const openCharges = charges.filter((c) => !c.invoice);
  const canShareFiles =
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [new File([""], "x.pdf", { type: "application/pdf" })] });

  /** Issue every charge not yet invoiced in one press, and show it. */
  async function issueAll() {
    setBusy(true);
    setError(null);
    try {
      const before = new Set(folio.invoices.map((i) => i.id));
      const data = await sendFolio(reservationId, "invoice", {});
      const inv = (data.invoices || []).find((i) => !before.has(i.id));
      await onChanged();
      if (inv) {
        setPreviewId(inv.id);
        toast(`${inv.invoice_number} issued`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  /** Print the PDF from a hidden frame, without leaving the booking. */
  function printInvoice(inv) {
    const url = `/api/pms/invoice?id=${inv.id}&inline=1`;
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    frame.src = url;
    frame.onload = () => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch {
        // Some browsers will not print a PDF from a frame; a tab can.
        window.open(url, "_blank", "noopener");
      }
      setTimeout(() => frame.remove(), 60000);
    };
    document.body.appendChild(frame);
  }

  /** The PDF to the phone's share sheet (WhatsApp, email), or a download. */
  async function shareInvoice(inv) {
    const url = `/api/pms/invoice?id=${inv.id}`;
    if (canShareFiles) {
      try {
        const blob = await (await fetch(url)).blob();
        const file = new File([blob], `${inv.invoice_number}.pdf`, { type: "application/pdf" });
        await navigator.share({ files: [file], title: inv.invoice_number });
        return;
      } catch (err) {
        if (err?.name === "AbortError") return;
      }
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = `${inv.invoice_number}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // The invoice in the preview: the one picked, else the newest standing one.
  const shown =
    (folio.invoices || []).find((i) => i.id === previewId) ||
    (folio.invoices || []).find((i) => !i.voided_at) ||
    (folio.invoices || [])[0] ||
    null;

  const drawerProps = {
    folio,
    reservationId,
    currency,
    onClose: closeDrawer,
    forGuest,
    onSaved: async () => {
      await onChanged();
      closeDrawer();
    },
  };

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      {/* ---------------- GUESTS ---------------- */}
      {tab === "guests" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>
              {folio.reservation.room_types?.room_type_name}
              {folio.reservation.rooms?.room_number
                ? ` : Room ${folio.reservation.rooms.room_number}`
                : ""}
              <span style={{ fontWeight: 400, color: "var(--text-faint)" }}>
                
                , {folio.reservation.adults} Adult
                {folio.reservation.adults === 1 ? "" : "s"},{" "}
                {folio.reservation.children} Children
              </span>
            </div>
            <button
              className="btn btn-secondary text-xs"
              onClick={() => {
                // The first guest named is usually the one the booking is
                // in the name of, so they start filled in.
                const first = folio.guests.length === 0;
                // Titles dropped, and a channel's "KUMAR/RAVI" read as last/first.
                let name = first ? String(folio.reservation.guest_name || "").trim() : "";
                if (name.includes("/")) name = name.split("/").reverse().join(" ");
                name = name.replace(/^(mr|mrs|ms|miss|dr)\.?\s+/i, "");
                const [firstName = "", ...rest] = name.split(/\s+/).filter(Boolean);
                setGuest({
                  first_name: firstName,
                  last_name: rest.join(" "),
                  email: first ? folio.reservation.guest_email || "" : "",
                  phone: first ? folio.reservation.guest_phone || "" : "",
                  is_primary: first,
                  gender: "",
                  nationality: toCountryCode(folio.reservation.guest_country) || "",
                  id_type: "",
                  id_number: "",
                  date_of_birth: "",
                  address: "",
                });
              }}
            >
              <Icon name="plus" size={14} />
              Add guest
            </button>
          </div>

          {folio.guests.length === 0 && !guest && (
            <p className="sub">
              No named guests yet. The booking name is &quot;{folio.reservation.guest_name}&quot;.
            </p>
          )}

          {folio.guests.map((g) => (
            <div key={g.id} className="card" style={{ padding: "0.6rem 0.75rem" }}>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <span title={g.is_primary ? "Primary guest" : "Guest"}>
                <Icon name="star" size={16} filled={g.is_primary} />
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>
                  {[g.first_name, g.last_name].filter(Boolean).join(" ")}
                </div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-faint)" }}>
                  {[g.email, g.phone].filter(Boolean).join(", ") || "No contact details"}
                </div>
                <div style={{ fontSize: "0.7rem", color: g.id_number ? "var(--text-faint)" : "var(--warn)" }}>
                  {g.id_number
                    ? [
                        `${CHECKIN_ID_TYPES.find((t) => t.id === g.id_type)?.label || "ID"} ${g.id_number}`,
                        countryName(g.nationality),
                      ]
                        .filter(Boolean)
                        .join(", ")
                    : "No ID yet, needed for the police report"}
                </div>
              </div>
              {canSeeIds && g.guest_id && (
                <button
                  className={`btn text-xs ${idsOpen === g.id ? "btn-primary" : "btn-ghost"}`}
                  aria-expanded={idsOpen === g.id}
                  onClick={() => setIdsOpen(idsOpen === g.id ? null : g.id)}
                >
                  Photo ID
                </button>
              )}
              <button className="btn btn-ghost text-xs" onClick={() => setGuest(g)}>
                Edit
              </button>
              <button
                className="btn btn-ghost text-xs"
                disabled={busy}
                onClick={() => remove("guest", g.id)}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            {idsOpen === g.id && (
              <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
                <GuestIdPhotos
                  propertyId={propertyId}
                  guest={{ id: g.guest_id, full_name: [g.first_name, g.last_name].filter(Boolean).join(" ") }}
                />
              </div>
            )}
            </div>
          ))}

          {guest && (
            <div className="card card-pad space-y-2">
              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
              >
                <div>
                  <label className="label">First name *</label>
                  <input
                    className="input"
                    value={guest.first_name}
                    onChange={(e) => setGuest({ ...guest, first_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Last name</label>
                  <input
                    className="input"
                    value={guest.last_name || ""}
                    onChange={(e) => setGuest({ ...guest, last_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input
                    className="input"
                    type="email"
                    value={guest.email || ""}
                    onChange={(e) => setGuest({ ...guest, email: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Phone</label>
                  <input
                    className="input"
                    value={guest.phone || ""}
                    onChange={(e) => setGuest({ ...guest, phone: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Gender</label>
                  <Select
                    className="input"
                    value={guest.gender || ""}
                    onChange={(e) => setGuest({ ...guest, gender: e.target.value })}
                  >
                    <option value="">Select gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </Select>
                </div>
                <div>
                  <label className="label">Nationality</label>
                  <Select
                    className="input"
                    value={guest.nationality || ""}
                    onChange={(e) => setGuest({ ...guest, nationality: e.target.value })}
                  >
                    <option value="">Select country</option>
                    {countryOptions().map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="label">ID type</label>
                  <Select
                    className="input"
                    value={guest.id_type || ""}
                    onChange={(e) => setGuest({ ...guest, id_type: e.target.value })}
                  >
                    <option value="">Select ID</option>
                    {CHECKIN_ID_TYPES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="label">ID number</label>
                  <input
                    className="input"
                    value={guest.id_number || ""}
                    autoCapitalize="characters"
                    onChange={(e) => setGuest({ ...guest, id_number: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Date of birth</label>
                  <DateField
                    value={guest.date_of_birth || ""}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setGuest({ ...guest, date_of_birth: e.target.value })}
                    aria-label="Date of birth"
                  />
                </div>
              </div>
              <div>
                <label className="label">Address</label>
                <input
                  className="input w-full"
                  value={guest.address || ""}
                  onChange={(e) => setGuest({ ...guest, address: e.target.value })}
                  placeholder="As on the ID"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={guest.is_primary === true}
                  onChange={(e) => setGuest({ ...guest, is_primary: e.target.checked })}
                />
                Primary guest: their name appears on the booking
              </label>
              <div className="flex gap-2">
                <button
                  className="btn btn-primary text-sm"
                  disabled={busy}
                  onClick={async () => {
                    if (await post("guest", { guest })) setGuest(null);
                  }}
                >
                  Save guest
                </button>
                <button className="btn btn-ghost text-sm" onClick={() => setGuest(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------------- BILL ---------------- */}
      {tab === "bill" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary text-sm" onClick={() => setDrawer("service")}>
              <Icon name="plus" size={14} /> Add service
            </button>
            <button
              type="button"
              className={`btn text-sm ${balance > 0 ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setDrawer("payment")}
            >
              {balance < 0 ? "Give a refund" : "Collect payment"}
            </button>
            {/* Guests sharing the room, each on a bill of their own. Not while an
                invoice stands: it was issued for the bill as it is. */}
            {(folio.sharers?.length > 0 || (folio.guests || []).length >= 2) &&
              (standingInvoice ? (
                <button type="button" className="btn btn-secondary text-sm" onClick={() => onTab?.("invoices")}>
                  {folio.sharers?.length > 0 ? "Separate bills" : "One bill"}: void invoices to change
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary text-sm"
                  disabled={busy}
                  onClick={async () => {
                    const on = !(folio.sharers?.length > 0);
                    if (await post("separate_bills", { on })) {
                      toast(on ? "Each guest now has their own bill" : "Back to one bill for the room");
                    }
                  }}
                >
                  {folio.sharers?.length > 0 ? "One bill for the room" : "Give each guest their own bill"}
                </button>
              ))}
          </div>

          {/* Invoices live on their own tab; say here when something waits there. */}
          {(leftOver.length > 0 || (!standingInvoice && charges.length > 0 && balance <= 0.009)) && (
            <div className="flex flex-wrap items-center gap-2 text-sm" style={{ color: "var(--warn)" }}>
              <span>
                {leftOver.length > 0
                  ? `Not on any invoice yet: ${[...new Set(leftOver.map((c) => c.category))].join(", ")}.`
                  : "Paid in full. The invoice is not issued yet."}
              </span>
              <button type="button" className="btn btn-secondary text-xs" onClick={() => onTab?.("invoices")}>
                Go to Invoices
              </button>
            </div>
          )}

          <SharedBills
            folio={folio}
            currency={currency}
            busy={busy}
            post={post}
            propertyId={propertyId}
            openFor={(kind, id) => {
              setForGuest(id);
              setDrawer(kind);
            }}
          />

          <Statement
            folio={folio}
            currency={currency}
            busy={busy}
            actions={{
              editNights: () => setDrawer("nights"),
              removeExtra,
              voidPayment: async (p) => {
                const reason = await dialog.prompt({
                  title: `Void this ${money(Math.abs(p.amount), currency)} ${Number(p.amount) < 0 ? "refund" : "payment"}?`,
                  message: "It stays on the record, marked void, and stops counting as paid.",
                  label: "Reason",
                  confirmLabel: "Void payment",
                  danger: true,
                });
                if (reason !== null) remove("payment", p.id, reason);
              },
            }}
          />

        </div>
      )}

      {/* ---------------- INVOICES ---------------- */}
      {tab === "invoices" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* With nothing to split, one press issues the whole bill; the
                picker is for splitting. */}
            <button
              type="button"
              className={`btn text-sm ${leftOver.length > 0 || (!standingInvoice && charges.length > 0) ? "btn-primary" : "btn-secondary"}`}
              disabled={busy || allInvoiced}
              onClick={() => (folio.sharers?.length > 0 ? setDrawer("invoice") : issueAll())}
            >
              <Icon name="plus" size={14} /> {leftOver.length > 0 ? "Invoice the rest" : "Issue invoice"}
            </button>
            {!allInvoiced && !(folio.sharers?.length > 0) && openCharges.length > 1 && (
              <button type="button" className="btn btn-secondary text-sm" disabled={busy} onClick={() => setDrawer("invoice")}>
                Split the bill
              </button>
            )}
            <span className="text-sm" style={{ color: leftOver.length > 0 ? "var(--warn)" : "var(--text-faint)" }}>
              {allInvoiced
                ? "Everything is invoiced. Void an invoice to issue it again."
                : leftOver.length > 0
                  ? `Not invoiced: ${[...new Set(leftOver.map((c) => c.category))].join(", ")}, ${money(
                      leftOver.reduce((sum, c) => sum + c.amount + c.tax, 0),
                      currency
                    )}`
                  : folio.invoices.length === 0
                    ? "No invoices yet."
                    : ""}
            </span>
          </div>

          {folio.invoices.length > 0 && (
            <>
              <table className="grid-table w-full text-sm">
                <tbody>
                  {folio.invoices.map((inv) => {
                    const snap = inv.snapshot || {};
                    // Who it is for, always: the company billed, or the guest.
                    const label = [
                      snap.bill_to?.name || snap.guest_name,
                      ...(snap.split ? snap.categories || [] : []),
                    ]
                      .filter(Boolean)
                      .join(", ");
                    const on = shown?.id === inv.id;
                    const pad = { padding: "0.35rem 0.6rem" };
                    return (
                      <tr
                        key={inv.id}
                        onClick={() => setPreviewId(inv.id)}
                        style={{
                          cursor: "pointer",
                          background: on ? "var(--accent-soft)" : undefined,
                          color: inv.voided_at ? "var(--text-faint)" : undefined,
                        }}
                      >
                        <td style={pad}>
                          <span style={{ fontWeight: 600 }}>{inv.invoice_number}</span>
                          {label && <span>, {label}</span>}{" "}
                          <span style={{ fontSize: "0.75rem", color: "var(--text-faint)", whiteSpace: "nowrap" }}>
                            {when(inv.issued_at)}
                          </span>
                          {inv.voided_at && (
                            <span style={{ fontSize: "0.75rem", color: "var(--danger)" }}>
                              {" "}
                              Voided{inv.void_reason ? ` (${inv.void_reason})` : ""}
                            </span>
                          )}
                        </td>
                        <td
                          className="text-right tabular-nums"
                          style={{ ...pad, textDecoration: inv.voided_at ? "line-through" : undefined }}
                        >
                          {money(inv.total_amount, inv.currency)}
                        </td>
                        <td className="text-right" style={pad} onClick={(e) => e.stopPropagation()}>
                          {on ? (
                            <span className="inline-flex flex-wrap justify-end gap-1">
                              <button type="button" className="btn btn-primary text-xs" disabled={busy} onClick={() => printInvoice(inv)}>
                                Print
                              </button>
                              <button type="button" className="btn btn-secondary text-xs" disabled={busy} onClick={() => shareInvoice(inv)}>
                                {canShareFiles ? "Share" : "Download"}
                              </button>
                              {!inv.voided_at && (
                                <button
                                  type="button"
                                  className="btn btn-secondary text-xs"
                                  disabled={busy}
                                  onClick={async () => {
                                    const reason = await dialog.prompt({
                                      title: `Void ${inv.invoice_number}?`,
                                      message: "It stays on the record, marked void, and its charges can go on a new invoice.",
                                      label: "Reason",
                                      confirmLabel: "Void invoice",
                                      danger: true,
                                    });
                                    if (reason !== null && (await remove("invoice", inv.id, reason))) {
                                      toast(`${inv.invoice_number} voided`);
                                    }
                                  }}
                                >
                                  Void
                                </button>
                              )}
                            </span>
                          ) : (
                            <button type="button" className="btn btn-secondary text-xs" onClick={() => setPreviewId(inv.id)}>
                              View
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* The PDF as it will print. Laptop and up only: phones show a
                  PDF in a frame badly or not at all, and use Print or Share. */}
              {shown && (
                <iframe
                  key={`${shown.id}-${shown.voided_at || ""}`}
                  title={`Invoice ${shown.invoice_number}`}
                  tabIndex={-1}
                  src={`/api/pms/invoice?id=${shown.id}&inline=1#view=FitH`}
                  className="hidden w-full md:block"
                  style={{
                    height: "min(70vh, calc(100dvh - 300px))",
                    minHeight: 360,
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    background: "var(--surface-2)",
                  }}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* Portalled so the drawer sits over the whole booking window, not inside it. */}
      {drawer &&
        createPortal(
          <>
            {drawer === "service" && <ServiceDrawer {...drawerProps} extras={extras} />}
            {drawer === "payment" && <PaymentDrawer {...drawerProps} />}
            {drawer === "invoice" && (
              <InvoiceDrawer
                {...drawerProps}
                onRefresh={onChanged}
                onIssued={setPreviewId}
                onTakePayment={(id) => {
                  setForGuest(id || null);
                  setDrawer("payment");
                }}
              />
            )}
            {drawer === "nights" && <NightsDrawer {...drawerProps} onRefresh={onChanged} />}
          </>,
          document.body
        )}
    </div>
  );
}
