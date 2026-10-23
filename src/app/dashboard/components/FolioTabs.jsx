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

/** Add a service to the stay. Its name and price can be changed for this stay only. */
function ServiceDrawer({ folio, extras, reservationId, currency, onClose, onSaved }) {
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
  const [line, setLine] = useState({ extra_id: "", name: "", unit_price: "", quantity: "", stay_date: "" });
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
function PaymentDrawer({ folio, reservationId, currency, onClose, onSaved }) {
  const balance = folio.totals.balance;
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
            type: wallet.type,
            id: wallet.id,
            amount: n,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not pay from the wallet");
      } else {
        await sendFolio(reservationId, "payment", {
          payment: { amount: refund ? -n : n, method, reference },
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

/** Shows the bill as it will print, then issues the invoice and downloads it in one go. */
function InvoiceDrawer({ folio, reservationId, currency, onClose, onSaved, onTakePayment }) {
  const owes = folio.totals.balance > 0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const data = await sendFolio(reservationId, "invoice", {});
      const issued = [...(data.invoices || [])].sort((a, b) =>
        String(b.issued_at).localeCompare(String(a.issued_at))
      )[0];
      if (issued) {
        const a = document.createElement("a");
        a.href = `/api/pms/invoice?id=${issued.id}`;
        a.download = `${issued.invoice_number}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      await onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Drawer
      title="Issue invoice"
      onCancel={onClose}
      onSave={save}
      saveLabel="Issue and download"
      busyLabel="Issuing..."
      busy={busy}
      error={error}
    >
      {owes && (
        <div className="flex flex-wrap items-center gap-2 text-sm" style={{ color: "var(--warn)" }}>
          <span style={{ marginRight: "auto" }}>The guest still owes {money(folio.totals.balance, currency)}.</span>
          <button type="button" className="btn btn-secondary text-sm" disabled={busy} onClick={onTakePayment}>
            Collect payment first
          </button>
        </div>
      )}
      <p className="sub">
        This is what the invoice will say. Once issued it keeps saying it, even if the stay changes later.
      </p>
      <Statement folio={folio} currency={currency} />
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
}) {
  const dialog = useDialog();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [guest, setGuest] = useState(null);
  const [drawer, setDrawer] = useState(null);
  // The named guest whose photo ID is open, uploaded by the desk for them.
  const [idsOpen, setIdsOpen] = useState(null);

  useEffect(() => {
    if (tab === "bill" && INTENT_DRAWER[intent]) setDrawer(INTENT_DRAWER[intent]);
  }, [tab, intent]);

  function closeDrawer() {
    setDrawer(null);
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

  const drawerProps = {
    folio,
    reservationId,
    currency,
    onClose: closeDrawer,
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
            <button type="button" className="btn btn-secondary text-sm" onClick={() => setDrawer("invoice")}>
              Issue invoice
            </button>
          </div>

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

          {folio.invoices.length > 0 && (
            <div className="space-y-1">
              <h4 style={smallHeading}>Invoices</h4>
              {folio.invoices.map((inv) => (
                <div key={inv.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span style={{ fontWeight: 600 }}>{inv.invoice_number}</span>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-faint)" }}>
                    {when(inv.issued_at)}, {money(inv.total_amount, inv.currency)}
                    {inv.void_reason ? `, ${inv.void_reason}` : ""}
                  </span>
                  {inv.voided_at && (
                    <span className="chip chip-off" style={{ fontSize: "0.6rem" }}>
                      Voided
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-1">
                    <a
                      className="btn btn-secondary text-xs"
                      href={`/api/pms/invoice?id=${inv.id}`}
                      download={`${inv.invoice_number}.pdf`}
                    >
                      <Icon name="download" size={14} /> PDF
                    </a>
                    {!inv.voided_at && (
                      <button
                        type="button"
                        className="btn btn-ghost text-xs"
                        disabled={busy}
                        onClick={async () => {
                          const reason = await dialog.prompt({
                            title: "Void this invoice?",
                            message: "It stays on the record, marked void.",
                            label: "Reason",
                            confirmLabel: "Void invoice",
                            danger: true,
                          });
                          if (reason !== null) remove("invoice", inv.id, reason);
                        }}
                      >
                        Void
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Portalled so the drawer sits over the whole booking window, not inside it. */}
      {drawer &&
        createPortal(
          <>
            {drawer === "service" && <ServiceDrawer {...drawerProps} extras={extras} />}
            {drawer === "payment" && <PaymentDrawer {...drawerProps} />}
            {drawer === "invoice" && <InvoiceDrawer {...drawerProps} onTakePayment={() => setDrawer("payment")} />}
            {drawer === "nights" && <NightsDrawer {...drawerProps} onRefresh={onChanged} />}
          </>,
          document.body
        )}
    </div>
  );
}
