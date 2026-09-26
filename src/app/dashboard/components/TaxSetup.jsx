"use client";

import { useMemo, useState } from "react";
import { addDays, formatDateISO, parseDateISO, todayUTC } from "@/lib/date";
import {
  TAX_BASES,
  TAX_SCOPES,
  computeTaxes,
  describeTax,
  inForce,
  indianGstPreset,
} from "@/lib/taxes";

/**
 * Taxes and fees: the rules services are taxed by.
 *
 * A rule charges nothing on its own -- it applies to the services it is
 * attached to, which can be set here ("charged on") or from each service
 * above. A hotel's tax is usually several rules: Indian GST alone is four
 * (CGST and SGST, at two tariff slabs).
 *
 * The preview runs the same calculation the folio does, on the real services,
 * so a rule can be checked against a made-up stay before any guest is charged
 * by it.
 *
 * A rule that changes is ended and replaced rather than edited in place,
 * because folios are taxed live: editing last year's rate would re-tax last
 * year's open bookings. "End" sets the last night the rule covers.
 */

function money(value) {
  return `₹${(Number(value) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function blank(sortOrder, serviceIds = []) {
  return {
    name: "",
    calc_type: "percent",
    value: "",
    basis: "per_night",
    rate_above: "",
    rate_up_to: "",
    guest_scope: "all",
    is_inclusive: false,
    is_compound: false,
    max_nights: "",
    valid_from: "",
    valid_to: "",
    sort_order: sortOrder,
    service_ids: serviceIds,
  };
}

function shift(date, days) {
  return formatDateISO(addDays(parseDateISO(date), days));
}

export default function TaxSetup({ propertyId, data, onChanged }) {
  const { taxes, services, categories } = data;

  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const today = todayUTC();
  const roomService = services.find((s) => s.is_room) || null;
  // Included services are part of the rate, so they are never taxed alone.
  const taxable = services.filter((s) => s.is_room || s.kind !== "inclusion");

  /** Which services carry each tax, from the services' side of the link. */
  const servicesFor = useMemo(() => {
    const m = {};
    for (const s of services) {
      for (const id of s.tax_ids || []) (m[id] = m[id] || []).push(s);
    }
    return m;
  }, [services]);

  const categoryName = useMemo(() => {
    const m = {};
    for (const c of categories) m[c.id] = c.name;
    return m;
  }, [categories]);

  async function save(rules) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pms/taxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules, property_id: propertyId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not save");
      await onChanged();
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
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not delete");
      await onChanged();
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
        "Add Indian GST for hotel rooms, in force from 22 Sep 2025, charged on the room?\n\n" +
          "Nights up to ₹1,000: nil\n" +
          "Above ₹1,000 up to ₹7,500: CGST 2.5% + SGST 2.5%\n" +
          "Above ₹7,500: CGST 9% + SGST 9%\n\n" +
          "Please confirm the rates with your accountant."
      )
    ) {
      return;
    }
    const attach = roomService ? [roomService.id] : [];
    await save(indianGstPreset().map((r) => ({ ...r, service_ids: attach })));
  }

  const nextOrder =
    taxes.reduce((max, t) => Math.max(max, Number(t.sort_order) || 0), 0) + 10;

  function edit(tax) {
    const out = { ...tax, service_ids: (servicesFor[tax.id] || []).map((s) => s.id) };
    for (const k of ["rate_above", "rate_up_to", "max_nights", "valid_from", "valid_to"]) {
      if (out[k] === null || out[k] === undefined) out[k] = "";
    }
    setDraft(out);
  }

  function toggleService(id) {
    setDraft((d) => ({
      ...d,
      service_ids: d.service_ids.includes(id)
        ? d.service_ids.filter((s) => s !== id)
        : [...d.service_ids, id],
    }));
  }

  // ----- preview -------------------------------------------------------
  const [preview, setPreview] = useState({
    rate: 5000,
    nights: 2,
    adults: 2,
    children: 0,
    serviceId: "",
    serviceAmount: "",
    residency: "domestic",
  });

  const previewResult = useMemo(() => {
    const lines = Array.from({ length: Math.max(0, Number(preview.nights) || 0) }, (_, i) => ({
      service_id: roomService?.id || null,
      date: shift(today, i),
      unit_price: Number(preview.rate) || 0,
      quantity: 1,
    }));
    const extra = Number(preview.serviceAmount) || 0;
    if (preview.serviceId && extra > 0) {
      lines.push({ service_id: preview.serviceId, date: today, unit_price: extra, quantity: 1 });
    }
    const serviceTaxes = {};
    for (const s of services) serviceTaxes[s.id] = s.tax_ids || [];
    const result = computeTaxes(taxes, serviceTaxes, lines, {
      adults: preview.adults,
      children: preview.children,
      residency: preview.residency,
    });
    const subtotal = lines.reduce((s, l) => s + l.unit_price * l.quantity, 0);
    return { ...result, subtotal };
  }, [taxes, services, roomService, preview, today]);

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
            Each rule is charged on the services it is attached to. Combine as
            many as needed — a percentage, a fixed fee per night or per guest,
            a slab by price, a levy for international guests only.
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

      {taxes.length === 0 && (
        <p className="sub">
          No taxes set up — bookings are billed with no tax. Start from the
          Indian GST preset, or add a rule.
        </p>
      )}

      {taxes.length > 0 && (
        <table className="grid-table w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Tax</th>
              <th className="text-left">Rule</th>
              <th className="text-left">Charged on</th>
              <th className="text-left">In force</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {taxes.map((t) => {
              const ended = t.valid_to && t.valid_to < today;
              const future = t.valid_from && t.valid_from > today;
              const on = servicesFor[t.id] || [];
              return (
                <tr key={t.id} style={{ opacity: ended ? 0.55 : 1 }}>
                  <td style={{ fontWeight: 600 }}>{t.name}</td>
                  <td style={{ color: "var(--text-muted)" }}>{describeTax(t, money)}</td>
                  <td>
                    {on.length === 0 ? (
                      <span style={{ color: "var(--warn)" }}>Nothing — charges nothing</span>
                    ) : (
                      on.map((s) => s.name).join(", ")
                    )}
                  </td>
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
                    <button className="btn btn-ghost text-xs" disabled={busy} onClick={() => edit(t)}>
                      Edit
                    </button>
                    {!ended && (
                      <button className="btn btn-ghost text-xs" disabled={busy} onClick={() => end(t)}>
                        End
                      </button>
                    )}
                    <button className="btn btn-ghost text-xs" disabled={busy} onClick={() => remove(t)}>
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
            {draft.calc_type === "fixed" && (
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

          <div>
            <label className="label">Charged on</label>
            <div className="flex flex-wrap gap-3 text-sm">
              {taxable.map((s) => (
                <label key={s.id} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={draft.service_ids.includes(s.id)}
                    onChange={() => toggleService(s.id)}
                  />
                  {s.name}
                  <span style={{ color: "var(--text-faint)", fontSize: "0.7rem" }}>
                    {categoryName[s.category_id] || ""}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
          >
            <div>
              <label className="label">Price above (₹)</label>
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
              <input className="input" type="number" value={draft.sort_order} onChange={setD("sort_order")} />
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
            The price band is checked line by line against the unit price — for
            the room, each night&apos;s rate. That is how GST slabs work. Dates
            are stay nights: to change a rate, end the old rule and add a new one
            from the day it changes, so earlier nights keep the old rate.
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
              <label className="label">Room rate / night</label>
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
              <label className="label">Plus a service</label>
              <select className="input" value={preview.serviceId} onChange={setP("serviceId")}>
                <option value="">None</option>
                {taxable
                  .filter((s) => !s.is_room)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="label">…costing (₹)</label>
              <input
                className="input"
                type="number"
                min="0"
                value={preview.serviceAmount}
                onChange={setP("serviceAmount")}
                disabled={!preview.serviceId}
              />
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
              <span style={{ color: "var(--text-muted)" }}>Services</span>
              <span>{money(previewResult.subtotal)}</span>
            </div>
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
              <span>{money(previewResult.subtotal + previewResult.added)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
