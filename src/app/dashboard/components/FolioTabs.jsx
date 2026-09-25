"use client";

import { useState } from "react";

/**
 * The tabs hanging off a booking: guests, extras, payments, invoices.
 *
 * All four write through one endpoint that answers with the whole folio, so
 * the totals shown here can never drift from the rows they were added up
 * from -- there is no local arithmetic to get out of step.
 */

function money(value, currency = "INR") {
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : "₹";
  const n = Number(value) || 0;
  return `${symbol}${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function when(iso) {
  if (!iso) return "—";
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

export default function FolioTabs({ tab, folio, extras, reservationId, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const [guest, setGuest] = useState(null);
  const [line, setLine] = useState({ extra_id: "", name: "", unit_price: "", quantity: 1 });
  const [payment, setPayment] = useState({ amount: "", method: "cash", reference: "" });

  async function post(kind, payload) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pms/folio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, reservationId, ...payload }),
      });
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
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const currency = folio.reservation?.currency || "INR";

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
                {" "}
                · {folio.reservation.adults} Adult
                {folio.reservation.adults === 1 ? "" : "s"} ·{" "}
                {folio.reservation.children} Children
              </span>
            </div>
            <button
              className="btn btn-ghost text-xs"
              onClick={() =>
                setGuest({ first_name: "", last_name: "", email: "", phone: "", gender: "" })
              }
            >
              + Add new guest
            </button>
          </div>

          {folio.guests.length === 0 && !guest && (
            <p className="sub">
              No named guests yet. The booking name is “{folio.reservation.guest_name}”.
            </p>
          )}

          {folio.guests.map((g) => (
            <div
              key={g.id}
              className="card"
              style={{ padding: "0.6rem 0.75rem", display: "flex", gap: "1rem", alignItems: "center" }}
            >
              <span title={g.is_primary ? "Primary guest" : "Guest"}>
                {g.is_primary ? "★" : "☆"}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>
                  {[g.first_name, g.last_name].filter(Boolean).join(" ")}
                </div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-faint)" }}>
                  {[g.email, g.phone].filter(Boolean).join(" · ") || "No contact details"}
                </div>
              </div>
              <button className="btn btn-ghost text-xs" onClick={() => setGuest(g)}>
                Edit
              </button>
              <button
                className="btn btn-ghost text-xs"
                disabled={busy}
                onClick={() => remove("guest", g.id)}
              >
                ✕
              </button>
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
                  <select
                    className="input"
                    value={guest.gender || ""}
                    onChange={(e) => setGuest({ ...guest, gender: e.target.value })}
                  >
                    <option value="">Select gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={guest.is_primary === true}
                  onChange={(e) => setGuest({ ...guest, is_primary: e.target.checked })}
                />
                Primary guest — their name appears on the booking
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

      {/* ---------------- INCLUSIONS / EXTRAS ---------------- */}
      {tab === "inclusions" && (
        <div className="space-y-3">
          {folio.extras.length === 0 && (
            <p className="sub">Nothing added to this stay yet.</p>
          )}

          {folio.extras.length > 0 && (
            <table className="grid-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Item</th>
                  <th className="text-right">Unit</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {folio.extras.map((e) => (
                  <tr key={e.id}>
                    <td>
                      {e.name}
                      {e.kind === "inclusion" && (
                        <span className="chip chip-ok ml-2" style={{ fontSize: "0.6rem" }}>
                          Included
                        </span>
                      )}
                    </td>
                    <td className="text-right">{money(e.unit_price, currency)}</td>
                    <td className="text-right">{Number(e.quantity)}</td>
                    <td className="text-right">
                      {e.kind === "inclusion"
                        ? "—"
                        : money(Number(e.unit_price) * Number(e.quantity), currency)}
                    </td>
                    <td className="text-right">
                      <button
                        className="btn btn-ghost text-xs"
                        disabled={busy}
                        onClick={() => remove("extra", e.id)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="card card-pad space-y-2">
            <div style={{ fontWeight: 600, fontSize: "0.8rem" }}>Add a line</div>
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}
            >
              <div>
                <label className="label">From the list</label>
                <select
                  className="input"
                  value={line.extra_id}
                  onChange={(e) => setLine({ ...line, extra_id: e.target.value })}
                >
                  <option value="">Type one in…</option>
                  {(extras || []).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} — {money(x.unit_price, currency)}
                      {x.charge_type === "per_night" ? "/night" : ""}
                    </option>
                  ))}
                </select>
              </div>
              {!line.extra_id && (
                <>
                  <div>
                    <label className="label">Description</label>
                    <input
                      className="input"
                      value={line.name}
                      onChange={(e) => setLine({ ...line, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">Unit price</label>
                    <input
                      className="input"
                      type="number"
                      value={line.unit_price}
                      onChange={(e) => setLine({ ...line, unit_price: e.target.value })}
                    />
                  </div>
                </>
              )}
              <div>
                <label className="label">Quantity</label>
                <input
                  className="input"
                  type="number"
                  min="1"
                  value={line.quantity}
                  onChange={(e) => setLine({ ...line, quantity: e.target.value })}
                />
              </div>
              <div className="flex items-end">
                <button
                  className="btn btn-primary text-sm w-full"
                  disabled={busy}
                  onClick={async () => {
                    if (await post("extra", { line })) {
                      setLine({ extra_id: "", name: "", unit_price: "", quantity: 1 });
                    }
                  }}
                >
                  Add
                </button>
              </div>
            </div>
            {(extras || []).length === 0 && (
              <p className="sub" style={{ fontSize: "0.7rem" }}>
                No saved items yet — type one in above. A reusable list can be set
                up later.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ---------------- PAYMENTS ---------------- */}
      {tab === "payments" && (
        <div className="space-y-3">
          <div
            className="grid gap-2 text-sm"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))" }}
          >
            {[
              ["Room", folio.totals.room],
              ["Extras", folio.totals.extras],
              ["Total", folio.totals.total],
              ["Paid", folio.totals.paid],
            ].map(([label, value]) => (
              <div key={label} className="card" style={{ padding: "0.5rem 0.65rem" }}>
                <div style={{ fontSize: "0.65rem", color: "var(--text-faint)" }}>{label}</div>
                <div style={{ fontWeight: 600 }}>{money(value, currency)}</div>
              </div>
            ))}
            <div
              className="card"
              style={{
                padding: "0.5rem 0.65rem",
                borderColor: folio.totals.balance > 0 ? "var(--warn)" : undefined,
              }}
            >
              <div style={{ fontSize: "0.65rem", color: "var(--text-faint)" }}>Balance</div>
              <div
                style={{
                  fontWeight: 600,
                  color: folio.totals.balance > 0 ? "var(--warn)" : "var(--text)",
                }}
              >
                {money(folio.totals.balance, currency)}
              </div>
            </div>
          </div>

          {folio.payments.length > 0 && (
            <table className="grid-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Date</th>
                  <th className="text-left">Method</th>
                  <th className="text-left">Reference</th>
                  <th className="text-right">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {folio.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{when(p.paid_at)}</td>
                    <td>{METHODS.find((m) => m.id === p.method)?.label || p.method}</td>
                    <td>{p.reference || "—"}</td>
                    <td
                      className="text-right"
                      style={{ color: Number(p.amount) < 0 ? "var(--danger)" : undefined }}
                    >
                      {money(p.amount, currency)}
                    </td>
                    <td className="text-right">
                      <button
                        className="btn btn-ghost text-xs"
                        disabled={busy}
                        onClick={() => remove("payment", p.id)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="card card-pad space-y-2">
            <div style={{ fontWeight: 600, fontSize: "0.8rem" }}>Record a payment</div>
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}
            >
              <div>
                <label className="label">Amount</label>
                <input
                  className="input"
                  type="number"
                  value={payment.amount}
                  onChange={(e) => setPayment({ ...payment, amount: e.target.value })}
                  placeholder="Negative to refund"
                />
              </div>
              <div>
                <label className="label">Method</label>
                <select
                  className="input"
                  value={payment.method}
                  onChange={(e) => setPayment({ ...payment, method: e.target.value })}
                >
                  {METHODS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Reference</label>
                <input
                  className="input"
                  value={payment.reference}
                  onChange={(e) => setPayment({ ...payment, reference: e.target.value })}
                />
              </div>
              <div className="flex items-end">
                <button
                  className="btn btn-primary text-sm w-full"
                  disabled={busy}
                  onClick={async () => {
                    if (await post("payment", { payment })) {
                      setPayment({ amount: "", method: "cash", reference: "" });
                    }
                  }}
                >
                  Record
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- INVOICES ---------------- */}
      {tab === "invoices" && (
        <div className="space-y-3">
          {folio.invoices.length === 0 && (
            <p className="sub">
              No invoice issued yet. Issuing one freezes the stay, its lines and
              its totals as they stand now.
            </p>
          )}

          {folio.invoices.map((inv) => (
            <div key={inv.id} className="card" style={{ padding: "0.6rem 0.75rem" }}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>
                    {inv.invoice_number}
                    {inv.voided_at && (
                      <span className="chip chip-off ml-2" style={{ fontSize: "0.6rem" }}>
                        Voided
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-faint)" }}>
                    Issued {when(inv.issued_at)} · {money(inv.total_amount, inv.currency)}
                    {inv.void_reason ? ` · ${inv.void_reason}` : ""}
                  </div>
                </div>
                {!inv.voided_at && (
                  <button
                    className="btn btn-ghost text-xs"
                    disabled={busy}
                    onClick={() => {
                      const reason = window.prompt("Why is this invoice being voided?");
                      if (reason !== null) remove("invoice", inv.id, reason);
                    }}
                  >
                    Void
                  </button>
                )}
              </div>
            </div>
          ))}

          <button
            className="btn btn-primary text-sm"
            disabled={busy}
            onClick={() => post("invoice", {})}
          >
            Issue an invoice
          </button>
          <p className="sub" style={{ fontSize: "0.7rem" }}>
            Balance right now: {money(folio.totals.balance, currency)}. An invoice
            keeps saying what it said when issued, even if the stay changes later.
          </p>
        </div>
      )}
    </div>
  );
}
