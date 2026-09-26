"use client";

import { useMemo, useState } from "react";
import { addDays, formatDateISO, parseDateISO, todayUTC } from "@/lib/date";
import {
  TAX_BASES,
  TAX_SCOPES,
  computeTaxes,
  inForce,
  indianGstPreset,
} from "@/lib/taxes";
import {
  Grid,
  Messages,
  SaveActions,
  SetupHeader,
  Toolbar,
  isDraft,
  sendJSON,
  useGrid,
} from "./SetupGrid";

/**
 * Taxes and fees: the rules services are taxed by.
 *
 * A rule charges nothing on its own -- it applies to the services it is
 * attached to, which can be set here ("charged on") or from each service on
 * the Services Setup page. A hotel's tax is usually several rules: Indian GST
 * alone is four (CGST and SGST, at two tariff slabs).
 *
 * One row per rule, edited in place and saved together, the way the Channel
 * Manager grid works. The preview runs the same calculation the folio does,
 * on the real services and on the edits not yet saved, so a rule can be
 * checked against a made-up stay before any guest is charged by it.
 *
 * A rule that changes should be ended and replaced rather than edited in
 * place, because folios are taxed live: editing last year's rate would re-tax
 * last year's open bookings. "End" sets the last night the rule covers.
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

const CALC_TYPES = [
  { id: "percent", label: "%" },
  { id: "fixed", label: "₹ fixed" },
];

/** Inputs hand back text; the tax maths wants numbers or nulls. */
function numeric(t) {
  const n = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
  return {
    ...t,
    value: Number(t.value) || 0,
    rate_above: n(t.rate_above),
    rate_up_to: n(t.rate_up_to),
    max_nights: n(t.max_nights),
    valid_from: t.valid_from || null,
    valid_to: t.valid_to || null,
  };
}

export default function TaxSetup({ propertyId, data, onChanged, title, sub }) {
  const { taxes: storedTaxes, services, categories } = data;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const today = todayUTC();
  const roomService = services.find((s) => s.is_room) || null;
  // Included services are part of the rate, so they are never taxed alone.
  const taxable = services.filter((s) => s.is_room || s.kind !== "inclusion");

  /** Each rule with the services it is charged on, read from the services. */
  const taxes = useMemo(() => {
    const on = {};
    for (const s of services) {
      for (const id of s.tax_ids || []) (on[id] = on[id] || []).push(s.id);
    }
    return storedTaxes.map((t) => {
      const out = { ...t, service_ids: (on[t.id] || []).sort() };
      for (const k of ["rate_above", "rate_up_to", "max_nights", "valid_from", "valid_to"]) {
        if (out[k] === null || out[k] === undefined) out[k] = "";
      }
      return out;
    });
  }, [storedTaxes, services]);

  const grid = useGrid(taxes);

  const categoryName = useMemo(() => {
    const m = {};
    for (const c of categories) m[c.id] = c.name;
    return m;
  }, [categories]);

  async function saveAll() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const saved = grid.count;
    const send = (rule) =>
      sendJSON("/api/pms/taxes", "POST", {
        rules: [{ ...rule, ...(isDraft(rule.id) ? { id: undefined } : {}) }],
        property_id: propertyId,
      });
    const errors = await grid.save({
      label: (t) => t.name || "New tax",
      update: (t, changes, next) => send(next),
      create: (d) => send(d),
    });
    await onChanged();
    setBusy(false);
    if (errors.length) setError(errors.join(" · "));
    else setNotice(`Saved ${saved} change${saved === 1 ? "" : "s"}.`);
  }

  async function immediate(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function remove(tax) {
    if (isDraft(tax.id)) return grid.removeDraft(tax.id);
    if (
      !window.confirm(
        `Delete “${tax.name}”? It disappears from every booking not yet invoiced, including past ones. To stop charging it from now on, use End instead.`
      )
    ) {
      return undefined;
    }
    return immediate(() => {
      const qs = new URLSearchParams({ id: tax.id });
      if (propertyId) qs.set("propertyId", propertyId);
      return sendJSON(`/api/pms/taxes?${qs}`, "DELETE");
    });
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
    immediate(() =>
      sendJSON("/api/pms/taxes", "POST", {
        rules: [{ ...tax, valid_to: lastNight }],
        property_id: propertyId,
      })
    );
  }

  function addGst() {
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
    immediate(() =>
      sendJSON("/api/pms/taxes", "POST", {
        rules: indianGstPreset().map((r) => ({ ...r, service_ids: attach })),
        property_id: propertyId,
      })
    );
  }

  const nextOrder =
    [...taxes, ...grid.drafts].reduce((max, t) => Math.max(max, Number(t.sort_order) || 0), 0) +
    10;

  function toggleService(tax, id) {
    const current = grid.value(tax, "service_ids") || [];
    grid.change(
      tax,
      "service_ids",
      current.includes(id) ? current.filter((s) => s !== id) : [...current, id].sort()
    );
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

  // The preview taxes by the grid as it stands, saved or not.
  const liveRows = [...taxes.map((t) => grid.merged(t)), ...grid.drafts].filter(
    (t) => t.name?.trim() && t.value !== ""
  );
  const liveKey = JSON.stringify(liveRows);

  const previewResult = useMemo(() => {
    const rules = JSON.parse(liveKey).map(numeric);
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
    for (const s of services) serviceTaxes[s.id] = [];
    for (const r of rules) {
      for (const sid of r.service_ids || []) (serviceTaxes[sid] = serviceTaxes[sid] || []).push(r.id);
    }
    const result = computeTaxes(rules, serviceTaxes, lines, {
      adults: preview.adults,
      children: preview.children,
      residency: preview.residency,
    });
    const subtotal = lines.reduce((sum, l) => sum + l.unit_price * l.quantity, 0);
    return { ...result, subtotal };
  }, [liveKey, services, roomService, preview, today]);

  const setP = (k) => (e) => setPreview((p) => ({ ...p, [k]: e.target.value }));

  const rows = [...taxes, ...grid.drafts];

  return (
    <div className="space-y-4">
      <SetupHeader title={title} count={storedTaxes.length} sub={sub}>
        <SaveActions count={grid.count} busy={busy} onSave={saveAll} onDiscard={grid.discard} />
      </SetupHeader>

      <Messages error={error} notice={notice} />

      <Toolbar>
        <button
          type="button"
          className="btn btn-secondary text-sm"
          onClick={() => grid.add(blank(nextOrder))}
        >
          + Add a tax
        </button>
        <button type="button" className="btn btn-secondary text-sm" disabled={busy} onClick={addGst}>
          + Indian GST preset
        </button>
        <span className="ml-auto text-xs muted">
          Price bands are checked against each line&apos;s unit price — for the room,
          each night&apos;s rate. To change a rate, End the old rule and add a new one.
        </span>
      </Toolbar>

      <Grid>
        <thead>
          <tr>
            <th className="cm-sticky" style={{ minWidth: 160 }}>
              Tax (as invoiced)
            </th>
            <th>Type</th>
            <th>Rate</th>
            <th>Charged</th>
            <th>Who pays</th>
            <th title="Applies when the unit price is above this">Price above</th>
            <th title="…and up to this">Up to</th>
            <th title="Only the first N nights">First N nights</th>
            <th>From night</th>
            <th>To night</th>
            <th title="Already included in the price">Incl.</th>
            <th title="Charged on top of the taxes above it">Compound</th>
            <th style={{ minWidth: 200 }}>Charged on</th>
            <th title="Order the rules are applied in">Order</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const draft = isDraft(t.id);
            const m = draft ? t : grid.merged(t);
            const percent = m.calc_type !== "fixed";
            const ended = !draft && t.valid_to && t.valid_to < today;
            const future = m.valid_from && m.valid_from > today;
            const on = m.service_ids || [];
            const onEdited = grid.edited(t, "service_ids");
            return (
              <tr
                key={t.id}
                className={draft ? "cm-new" : ended ? "cm-muted" : undefined}
              >
                <td className="cm-sticky">
                  {grid.input(t, "name", {
                    placeholder: "CGST, City tax…",
                    invalid: !m.name?.trim(),
                    autoFocus: draft,
                    style: { fontWeight: 600 },
                  })}
                </td>
                <td style={{ minWidth: 90 }}>{grid.select(t, "calc_type", CALC_TYPES)}</td>
                <td style={{ minWidth: 90 }}>
                  {grid.input(t, "value", {
                    type: "number",
                    min: 0,
                    step: "0.01",
                    invalid: m.value === "",
                  })}
                </td>
                <td style={{ minWidth: 190 }}>
                  {percent ? (
                    <span className="text-xs muted">On the price</span>
                  ) : (
                    grid.select(t, "basis", TAX_BASES)
                  )}
                </td>
                <td style={{ minWidth: 170 }}>{grid.select(t, "guest_scope", TAX_SCOPES)}</td>
                <td style={{ minWidth: 100 }}>
                  {grid.input(t, "rate_above", { type: "number", min: 0, placeholder: "Any" })}
                </td>
                <td style={{ minWidth: 100 }}>
                  {grid.input(t, "rate_up_to", { type: "number", min: 0, placeholder: "Any" })}
                </td>
                <td style={{ minWidth: 90 }}>
                  {grid.input(t, "max_nights", { type: "number", min: 1, placeholder: "All" })}
                </td>
                <td>{grid.input(t, "valid_from", { type: "date" })}</td>
                <td>{grid.input(t, "valid_to", { type: "date" })}</td>
                <td className="text-center">
                  {percent ? grid.check(t, "is_inclusive") : <span className="faint">—</span>}
                </td>
                <td className="text-center">
                  {percent ? grid.check(t, "is_compound") : <span className="faint">—</span>}
                </td>
                <td>
                  <div
                    className="flex flex-wrap gap-1"
                    style={
                      onEdited
                        ? { outline: "1px solid var(--accent)", borderRadius: 4, padding: 2 }
                        : undefined
                    }
                  >
                    {taxable.map((s) => {
                      const active = on.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => toggleService(t, s.id)}
                          className={`chip ${active ? "chip-ok" : "chip-off"}`}
                          style={{ opacity: active ? 1 : 0.6, cursor: "pointer" }}
                          title={categoryName[s.category_id] || undefined}
                        >
                          {active ? "✓ " : ""}
                          {s.name}
                        </button>
                      );
                    })}
                    {on.length === 0 && (
                      <span className="text-xs" style={{ color: "var(--warn)" }}>
                        Nothing — charges nothing
                      </span>
                    )}
                  </div>
                </td>
                <td style={{ minWidth: 70 }}>{grid.input(t, "sort_order", { type: "number" })}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {draft ? (
                    <span className="chip chip-warn">New</span>
                  ) : ended ? (
                    <span className="chip chip-off">Ended {t.valid_to}</span>
                  ) : future ? (
                    <span className="chip chip-warn">From {m.valid_from}</span>
                  ) : inForce(t, today) ? (
                    <span className="chip chip-ok">{t.valid_to ? `Until ${t.valid_to}` : "Now"}</span>
                  ) : null}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {!draft && !ended && (
                    <button
                      type="button"
                      className="btn btn-ghost text-xs"
                      disabled={busy}
                      onClick={() => end(t)}
                      title="Stop charging from today"
                    >
                      End
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost text-xs"
                    disabled={busy}
                    onClick={() => remove(t)}
                    title={draft ? "Remove this new row" : "Delete tax"}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={16} className="cm-empty">
                No taxes set up — bookings are billed with no tax. Start from the
                Indian GST preset, or add a rule.
              </td>
            </tr>
          )}
        </tbody>
      </Grid>

      {/* ---------------- PREVIEW ---------------- */}
      {rows.length > 0 && (
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
