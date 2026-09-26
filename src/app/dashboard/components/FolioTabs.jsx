"use client";

import { useState } from "react";

/**
 * The tabs hanging off a booking: guests, inclusions, payments, invoices.
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
  const [line, setLine] = useState({
    extra_id: "",
    name: "",
    unit_price: "",
    quantity: "",
    stay_date: "",
  });
  const [payment, setPayment] = useState({ amount: "", method: "cash", reference: "" });

  // Night rates being edited, keyed by date. A night is saved when its box
  // loses focus, and only if the figure actually changed.
  const [nightEdits, setNightEdits] = useState({});

  async function saveNight(stay_date) {
    const draft = nightEdits[stay_date];
    if (draft === undefined) return;
    const current = folio.nights.find((n) => n.stay_date === stay_date)?.rate;
    if (draft !== "" && Number(draft) === Number(current)) {
      setNightEdits(({ [stay_date]: _, ...rest }) => rest);
      return;
    }
    if (await post("night", { stay_date, rate: draft })) {
      setNightEdits(({ [stay_date]: _, ...rest }) => rest);
    }
  }

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

  // Every charge is a service, so it carries that service's taxes. The room
  // is billed through the nights above, never added as a line.
  const sellable = (extras || []).filter((x) => !x.is_room);
  const serviceGroups = Object.entries(
    sellable.reduce((acc, x) => {
      const key = x.service_categories?.name || "Uncategorised";
      (acc[key] = acc[key] || []).push(x);
      return acc;
    }, {})
  );

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

      {/* ---------------- INCLUSIONS: NIGHTS, SERVICES, HOW IT ADDS UP ---------------- */}
      {tab === "inclusions" && (
        <div className="space-y-3">
          <div style={{ fontWeight: 600, fontSize: "0.8rem" }}>
            Room charges, night by night
          </div>

          {folio.nights.length === 0 && (
            <p className="sub">This stay has no nights recorded.</p>
          )}

          {folio.nights.length > 0 && (
            <table className="grid-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Night</th>
                  <th className="text-left">Services that night</th>
                  <th className="text-right">Room rate</th>
                </tr>
              </thead>
              <tbody>
                {folio.nights.map((n) => {
                  const dated = folio.extras.filter((e) => e.stay_date === n.stay_date);
                  const draft = nightEdits[n.stay_date];
                  return (
                    <tr key={n.stay_date}>
                      <td>{nightLabel(n.stay_date)}</td>
                      <td style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
                        {dated.length > 0
                          ? dated
                              .map((e) =>
                                e.kind === "inclusion"
                                  ? `${e.name} (included)`
                                  : `${e.name} ${money(Number(e.unit_price) * Number(e.quantity), currency)}`
                              )
                              .join(", ")
                          : "—"}
                      </td>
                      <td className="text-right">
                        <input
                          className="input text-sm"
                          type="number"
                          min="0"
                          step="0.01"
                          disabled={busy}
                          value={draft !== undefined ? draft : n.rate ?? ""}
                          placeholder="—"
                          onChange={(e) =>
                            setNightEdits((prev) => ({ ...prev, [n.stay_date]: e.target.value }))
                          }
                          onBlur={() => saveNight(n.stay_date)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                          }}
                          style={{ maxWidth: 120, textAlign: "right", marginLeft: "auto" }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {folio.nights.length > 0 && !folio.nightsMatch && (
            <p className="sub" style={{ fontSize: "0.7rem", color: "var(--warn)" }}>
              The nights do not add up to the room charge of{" "}
              {money(folio.totals.room, currency)} — it was recorded as one figure.
              Setting any night&apos;s rate makes the room charge the sum of the
              nights.
            </p>
          )}

          <div className="card card-pad space-y-1 text-sm">
            <div style={{ fontWeight: 600, fontSize: "0.8rem", marginBottom: "0.25rem" }}>
              How the total adds up
            </div>
            {/* By category: the room is one service among the others. */}
            {(folio.categories || []).map((c) => (
              <div key={c.name} className="flex justify-between">
                <span style={{ color: "var(--text-muted)" }}>
                  {c.name}
                  {c.tax > 0 && (
                    <span style={{ color: "var(--text-faint)", fontSize: "0.7rem" }}>
                      {" "}
                      · incl. {money(c.tax, currency)} tax
                    </span>
                  )}
                </span>
                <span>{money(c.amount + c.tax, currency)}</span>
              </div>
            ))}
            <div
              style={{ fontSize: "0.7rem", color: "var(--text-faint)", paddingTop: "0.25rem" }}
            >
              Taxes
            </div>
            {(folio.taxes || [])
              .filter((t) => !t.inclusive)
              .map((t, i) => (
                <div key={`${t.tax_id}-${i}`} className="flex justify-between">
                  <span style={{ color: "var(--text-muted)" }}>
                    {t.name}
                    <span style={{ color: "var(--text-faint)", fontSize: "0.7rem" }}>
                      {" "}
                      · {t.detail}
                    </span>
                  </span>
                  <span>{money(t.amount, currency)}</span>
                </div>
              ))}
            <div
              className="flex justify-between"
              style={{ borderTop: "1px solid var(--border)", paddingTop: "0.25rem", fontWeight: 600 }}
            >
              <span>Total</span>
              <span>{money(folio.totals.total, currency)}</span>
            </div>
            {(folio.taxes || [])
              .filter((t) => t.inclusive)
              .map((t, i) => (
                <div
                  key={`inc-${t.tax_id}-${i}`}
                  className="flex justify-between"
                  style={{ fontSize: "0.75rem", color: "var(--text-faint)" }}
                >
                  <span>Includes {t.name}</span>
                  <span>{money(t.amount, currency)}</span>
                </div>
              ))}
            <div className="flex justify-between">
              <span style={{ color: "var(--text-muted)" }}>Paid</span>
              <span>− {money(folio.totals.paid, currency)}</span>
            </div>
            <div
              className="flex justify-between"
              style={{
                fontWeight: 600,
                color: folio.totals.balance > 0 ? "var(--warn)" : "var(--text)",
              }}
            >
              <span>Balance</span>
              <span>{money(folio.totals.balance, currency)}</span>
            </div>
          </div>

          <div style={{ fontWeight: 600, fontSize: "0.8rem", paddingTop: "0.25rem" }}>
            Services added to this stay
          </div>

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
                      {e.stay_date && (
                        <span style={{ color: "var(--text-faint)", fontSize: "0.7rem" }}>
                          {" "}
                          · {nightLabel(e.stay_date)}
                        </span>
                      )}
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
                <label className="label">Service *</label>
                <select
                  className="input"
                  value={line.extra_id}
                  onChange={(e) => {
                    // Picking a service fills its name and price, which the
                    // desk can still change for this one stay.
                    const svc = sellable.find((x) => x.id === e.target.value);
                    setLine({
                      ...line,
                      extra_id: e.target.value,
                      name: svc?.name || "",
                      unit_price: svc ? String(svc.unit_price) : "",
                    });
                  }}
                >
                  <option value="">Choose…</option>
                  {serviceGroups.map(([category, items]) => (
                    <optgroup key={category} label={category}>
                      {items.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name} — {money(x.unit_price, currency)}
                          {x.charge_type === "per_night" ? "/night" : ""}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Description</label>
                <input
                  className="input"
                  value={line.name}
                  disabled={!line.extra_id}
                  onChange={(e) => setLine({ ...line, name: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Unit price</label>
                <input
                  className="input"
                  type="number"
                  value={line.unit_price}
                  disabled={!line.extra_id}
                  onChange={(e) => setLine({ ...line, unit_price: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Quantity</label>
                <input
                  className="input"
                  type="number"
                  min="1"
                  value={line.quantity}
                  placeholder={
                    sellable.find((x) => x.id === line.extra_id)?.charge_type === "per_night"
                      ? "Each night"
                      : "1"
                  }
                  onChange={(e) => setLine({ ...line, quantity: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Night</label>
                <select
                  className="input"
                  value={line.stay_date}
                  onChange={(e) => setLine({ ...line, stay_date: e.target.value })}
                >
                  <option value="">Whole stay</option>
                  {folio.nights.map((n) => (
                    <option key={n.stay_date} value={n.stay_date}>
                      {nightLabel(n.stay_date)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <button
                  className="btn btn-primary text-sm w-full"
                  disabled={busy || !line.extra_id}
                  onClick={async () => {
                    const payload = {
                      ...line,
                      stay_date: line.stay_date || null,
                      unit_price: line.unit_price === "" ? undefined : Number(line.unit_price),
                      // A per-night service with the quantity left at 1 is
                      // multiplied out by the server; an explicit number wins.
                      quantity: Number(line.quantity) || undefined,
                    };
                    if (await post("extra", { line: payload })) {
                      setLine({ extra_id: "", name: "", unit_price: "", quantity: "", stay_date: "" });
                    }
                  }}
                >
                  Add
                </button>
              </div>
            </div>
            {sellable.length === 0 && (
              <p className="sub" style={{ fontSize: "0.7rem" }}>
                No services set up yet. Add them under Setup → Services Setup,
                and give each its taxes under Tax Setup.
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
              ["Tax", folio.totals.tax || 0],
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
                <div className="flex items-center gap-1">
                  <a
                    className="btn btn-secondary text-xs"
                    href={`/api/pms/invoice?id=${inv.id}`}
                    download={`${inv.invoice_number}.pdf`}
                  >
                    ↓ PDF
                  </a>
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
