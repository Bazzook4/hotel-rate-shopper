"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, formatDateISO, parseDateISO, todayUTC } from "@/lib/date";
import {
  TAX_APPLIES_TO,
  TAX_BASES,
  TAX_SCOPES,
  computeTaxes,
  describeTax,
  inForce,
  indianGstPreset,
} from "@/lib/taxes";

/**
 * Taxes and fees: what is added to a stay on top of the room and extras.
 *
 * Every rule is one row, and a hotel's tax is usually several of them --
 * Indian GST alone is four (CGST and SGST, at two tariff slabs). The preview
 * underneath runs the same calculation the folio does, so a rule can be
 * checked against a made-up stay before any guest is charged by it.
 *
 * A rule that changes is ended and replaced rather than edited in place,
 * because folios are taxed live: editing last year's rate would re-tax last
 * year's open bookings. "End" sets the last night the rule covers.
 */

function money(value) {
  return `₹${(Number(value) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function blank(sortOrder = 10) {
  return {
    name: "",
    calc_type: "percent",
    value: "",
    basis: "per_night",
    applies_to: "room",
    rate_above: "",
    rate_up_to: "",
    guest_scope: "all",
    is_inclusive: false,
    is_compound: false,
    max_nights: "",
    valid_from: "",
    valid_to: "",
    sort_order: sortOrder,
  };
}

/** A saved rule as the editor's inputs hold it: nulls become empty boxes. */
function toDraft(tax) {
  const out = { ...tax };
  for (const k of ["rate_above", "rate_up_to", "max_nights", "valid_from", "valid_to"]) {
    if (out[k] === null || out[k] === undefined) out[k] = "";
  }
  return out;
}

function shift(date, days) {
  return formatDateISO(addDays(parseDateISO(date), days));
}

export default function TaxSetup({ session }) {
  const propertyId = session?.propertyId || null;

  const [taxes, setTaxes] = useState([]);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const today = todayUTC();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = propertyId ? `?propertyId=${propertyId}` : "";
      const res = await fetch(`/api/pms/taxes${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load taxes");
      setTaxes(data.taxes || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(rules) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pms/taxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules, property_id: propertyId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save");
      await load();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove(tax) {
    if (
      !window.confirm(
        `Delete “${tax.name}”? It disappears from every booking not yet invoiced, including past ones. To stop charging it from now on, use End instead.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ id: tax.id });
      if (propertyId) qs.set("propertyId", propertyId);
      const res = await fetch(`/api/pms/taxes?${qs}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not delete");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  /** Stop a rule after last night: it keeps covering the nights before today. */
  function end(tax) {
    const lastNight = shift(today, -1);
    if (
      !window.confirm(
        `End “${tax.name}”? It stays on nights up to ${lastNight} and stops from ${today}.`
      )
    ) {
      return;
    }
    save([{ ...tax, valid_to: lastNight }]);
  }

  async function addGst() {
    if (
      !window.confirm(
        "Add Indian GST for hotel rooms, in force from 22 Sep 2025?\n\n" +
          "Nights up to ₹1,000: nil\n" +
          "Above ₹1,000 up to ₹7,500: CGST 2.5% + SGST 2.5%\n" +
          "Above ₹7,500: CGST 9% + SGST 9%\n\n" +
          "Please confirm the rates with your accountant."
      )
    ) {
      return;
    }
    await save(indianGstPreset());
  }

  const nextOrder = useMemo(
    () => (taxes.reduce((max, t) => Math.max(max, Number(t.sort_order) || 0), 0) || 0) + 10,
    [taxes]
  );

  // ----- preview -------------------------------------------------------
  const [preview, setPreview] = useState({
    rate: 5000,
    nights: 2,
    adults: 2,
    children: 0,
    extras: 0,
    residency: "domestic",
  });

  const previewResult = useMemo(() => {
    const nights = Array.from({ length: Math.max(0, Number(preview.nights) || 0) }, (_, i) => ({
      stay_date: shift(today, i),
      rate: Number(preview.rate) || 0,
    }));
    const extras =
      Number(preview.extras) > 0
        ? [{ unit_price: Number(preview.extras), quantity: 1, kind: "extra", stay_date: today }]
        : [];
    const room = nights.reduce((s, n) => s + n.rate, 0);
    const result = computeTaxes(taxes, {
      nights,
      extras,
      adults: preview.adults,
      children: preview.children,
      residency: preview.residency,
    });
    return { ...result, room, extras: Number(preview.extras) || 0 };
  }, [taxes, preview, today]);

  const setP = (k) => (e) => setPreview((p) => ({ ...p, [k]: e.target.value }));
  const setD = (k) => (e) =>
    setDraft((d) => ({
      ...d,
      [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));

  return (
    <div className="card card-pad space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 style={{ fontWeight: 600 }}>Taxes and fees</h3>
          <p className="sub">
            Added to every booking&apos;s folio and invoice. Combine as many rules
            as the place needs — a percentage, a fixed fee per night or per
            guest, a slab by room tariff, a levy for international guests only.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary text-sm" disabled={busy} onClick={addGst}>
            + Indian GST preset
          </button>
          <button
            className="btn btn-primary text-sm"
            disabled={busy}
            onClick={() => setDraft(blank(nextOrder))}
          >
            + Add a tax
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      {loading && <p className="sub">Loading…</p>}

      {!loading && taxes.length === 0 && (
        <p className="sub">
          No taxes set up — bookings are billed with no tax. Start from the
          Indian GST preset, or add a rule.
        </p>
      )}

      {!loading && taxes.length > 0 && (
        <table className="grid-table w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Tax</th>
              <th className="text-left">Rule</th>
              <th className="text-left">In force</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {taxes.map((t) => {
              const ended = t.valid_to && t.valid_to < today;
              const future = t.valid_from && t.valid_from > today;
              return (
                <tr key={t.id} style={{ opacity: ended ? 0.55 : 1 }}>
                  <td style={{ fontWeight: 600 }}>{t.name}</td>
                  <td style={{ color: "var(--text-muted)" }}>{describeTax(t, money)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {ended ? (
                      <span className="chip chip-off">Ended {t.valid_to}</span>
                    ) : future ? (
                      <span className="chip chip-warn">From {t.valid_from}</span>
                    ) : inForce(t, today) ? (
                      <span className="chip chip-ok">
                        {t.valid_to ? `Until ${t.valid_to}` : "Now"}
                      </span>
                    ) : null}
                  </td>
                  <td className="text-right" style={{ whiteSpace: "nowrap" }}>
                    <button
                      className="btn btn-ghost text-xs"
                      disabled={busy}
                      onClick={() => setDraft(toDraft(t))}
                    >
                      Edit
                    </button>
                    {!ended && (
                      <button
                        className="btn btn-ghost text-xs"
                        disabled={busy}
                        onClick={() => end(t)}
                      >
                        End
                      </button>
                    )}
                    <button
                      className="btn btn-ghost text-xs"
                      disabled={busy}
                      onClick={() => remove(t)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* ---------------- EDITOR ---------------- */}
      {draft && (
        <div className="card card-pad space-y-3">
          <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>
            {draft.id ? `Edit ${draft.name}` : "New tax or fee"}
          </div>

          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
          >
            <div>
              <label className="label">Name on the invoice *</label>
              <input
                className="input"
                value={draft.name}
                onChange={setD("name")}
                placeholder="CGST, City tax…"
              />
            </div>
            <div>
              <label className="label">Type</label>
              <select className="input" value={draft.calc_type} onChange={setD("calc_type")}>
                <option value="percent">Percentage</option>
                <option value="fixed">Fixed amount</option>
              </select>
            </div>
            <div>
              <label className="label">{draft.calc_type === "fixed" ? "Amount (₹)" : "Rate (%)"}</label>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={draft.value}
                onChange={setD("value")}
              />
            </div>
            {draft.calc_type === "fixed" ? (
              <div>
                <label className="label">Charged</label>
                <select className="input" value={draft.basis} onChange={setD("basis")}>
                  {TAX_BASES.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="label">Percentage of</label>
                <select className="input" value={draft.applies_to} onChange={setD("applies_to")}>
                  {TAX_APPLIES_TO.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="label">Who pays</label>
              <select className="input" value={draft.guest_scope} onChange={setD("guest_scope")}>
                {TAX_SCOPES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
          >
            <div>
              <label className="label">Nightly tariff above (₹)</label>
              <input
                className="input"
                type="number"
                min="0"
                value={draft.rate_above}
                onChange={setD("rate_above")}
                placeholder="Any"
              />
            </div>
            <div>
              <label className="label">…up to (₹)</label>
              <input
                className="input"
                type="number"
                min="0"
                value={draft.rate_up_to}
                onChange={setD("rate_up_to")}
                placeholder="Any"
              />
            </div>
            <div>
              <label className="label">Only the first N nights</label>
              <input
                className="input"
                type="number"
                min="1"
                step="1"
                value={draft.max_nights}
                onChange={setD("max_nights")}
                placeholder="All nights"
              />
            </div>
            <div>
              <label className="label">In force from night</label>
              <input className="input" type="date" value={draft.valid_from} onChange={setD("valid_from")} />
            </div>
            <div>
              <label className="label">…to night</label>
              <input className="input" type="date" value={draft.valid_to} onChange={setD("valid_to")} />
            </div>
            <div>
              <label className="label">Order</label>
              <input
                className="input"
                type="number"
                value={draft.sort_order}
                onChange={setD("sort_order")}
              />
            </div>
          </div>

          {draft.calc_type === "percent" && (
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.is_inclusive} onChange={setD("is_inclusive")} />
                Already included in the price
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.is_compound} onChange={setD("is_compound")} />
                Charged on top of the taxes above it
              </label>
            </div>
          )}

          <p className="sub" style={{ fontSize: "0.7rem" }}>
            The tariff band is checked night by night against that night&apos;s
            room rate — that is how GST slabs work. It does not apply to extras.
            Dates are stay nights: to change a rate, end the old rule and add a
            new one from the day it changes, so earlier nights keep the old rate.
          </p>

          <div className="flex gap-2">
            <button
              className="btn btn-primary text-sm"
              disabled={busy || !draft.name.trim() || draft.value === ""}
              onClick={async () => {
                if (await save([draft])) setDraft(null);
              }}
            >
              Save
            </button>
            <button className="btn btn-ghost text-sm" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ---------------- PREVIEW ---------------- */}
      {taxes.length > 0 && (
        <div className="card card-pad space-y-3">
          <div>
            <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>Try it on a stay</div>
            <p className="sub" style={{ fontSize: "0.7rem" }}>
              The same calculation the folio uses, for a stay starting today.
            </p>
          </div>
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))" }}
          >
            <div>
              <label className="label">Rate / night</label>
              <input className="input" type="number" min="0" value={preview.rate} onChange={setP("rate")} />
            </div>
            <div>
              <label className="label">Nights</label>
              <input className="input" type="number" min="1" value={preview.nights} onChange={setP("nights")} />
            </div>
            <div>
              <label className="label">Adults</label>
              <input className="input" type="number" min="1" value={preview.adults} onChange={setP("adults")} />
            </div>
            <div>
              <label className="label">Children</label>
              <input className="input" type="number" min="0" value={preview.children} onChange={setP("children")} />
            </div>
            <div>
              <label className="label">Extras (₹)</label>
              <input className="input" type="number" min="0" value={preview.extras} onChange={setP("extras")} />
            </div>
            <div>
              <label className="label">Guest</label>
              <select className="input" value={preview.residency} onChange={setP("residency")}>
                <option value="domestic">Domestic</option>
                <option value="international">International</option>
              </select>
            </div>
          </div>

          <div className="text-sm space-y-1">
            <div className="flex justify-between">
              <span style={{ color: "var(--text-muted)" }}>Room</span>
              <span>{money(previewResult.room)}</span>
            </div>
            {previewResult.extras > 0 && (
              <div className="flex justify-between">
                <span style={{ color: "var(--text-muted)" }}>Extras</span>
                <span>{money(previewResult.extras)}</span>
              </div>
            )}
            {previewResult.lines.map((l, i) => (
              <div key={`${l.tax_id}-${i}`} className="flex justify-between">
                <span style={{ color: "var(--text-muted)" }}>
                  {l.name}
                  <span style={{ color: "var(--text-faint)", fontSize: "0.7rem" }}>
                    {" "}
                    · {l.detail}
                    {l.inclusive ? " · included" : ""}
                  </span>
                </span>
                <span>{l.inclusive ? `(${money(l.amount)})` : money(l.amount)}</span>
              </div>
            ))}
            {previewResult.lines.length === 0 && (
              <div className="sub" style={{ fontSize: "0.75rem" }}>
                No rule applies to this stay.
              </div>
            )}
            <div
              className="flex justify-between"
              style={{ borderTop: "1px solid var(--border)", paddingTop: "0.25rem", fontWeight: 600 }}
            >
              <span>Guest pays</span>
              <span>{money(previewResult.room + previewResult.extras + previewResult.added)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
