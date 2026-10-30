"use client";

import { useEffect, useState } from "react";

/**
 * The hotel's registered name and GSTIN, with a switch for showing them.
 *
 * Printed on invoices. An invoice to a company needs both: without the
 * issuer's registered name and GSTIN the company cannot claim the GST it paid.
 */
export default function HotelGstin({ propertyId }) {
  const [stored, setStored] = useState(null);
  const [legalName, setLegalName] = useState("");
  const [gstin, setGstin] = useState("");
  const [show, setShow] = useState(true);
  const [id, setId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  function apply(p) {
    const next = { legalName: p?.legal_name || "", gstin: p?.gstin || "", show: p?.invoice_show_tax_id !== false };
    setStored(next);
    setLegalName(next.legalName);
    setGstin(next.gstin);
    setShow(next.show);
  }

  useEffect(() => {
    let live = true;
    fetch("/api/properties")
      .then((r) => (r.ok ? r.json() : { properties: [] }))
      .then((d) => {
        if (!live) return;
        const p = (d.properties || []).find((x) => !propertyId || x.id === propertyId) || null;
        setId(p?.id || null);
        apply(p);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [propertyId]);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/properties/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, legal_name: legalName, gstin, invoice_show_tax_id: show }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save");
      apply(data.property);
      setMessage({ ok: true, text: "Saved." });
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (!id) return null;
  const changed =
    legalName.trim() !== stored.legalName ||
    gstin.trim().toUpperCase() !== stored.gstin ||
    show !== stored.show;

  return (
    <div className="card p-3 flex flex-wrap items-center gap-2">
      <label className="label" htmlFor="hotel-legal-name" style={{ margin: 0 }}>
        Registered company name
      </label>
      <input
        id="hotel-legal-name"
        className="input w-64"
        value={legalName}
        onChange={(e) => setLegalName(e.target.value)}
        placeholder="Name on your GST certificate"
        maxLength={150}
      />
      <label className="label" htmlFor="hotel-gstin" style={{ margin: 0 }}>
        Hotel GSTIN
      </label>
      <input
        id="hotel-gstin"
        className="input w-48"
        value={gstin}
        onChange={(e) => setGstin(e.target.value)}
        placeholder="e.g. 29ABCDE1234F1Z5"
        maxLength={20}
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
        Show both on invoices
      </label>
      <button type="button" className="btn btn-primary text-sm" disabled={busy || !changed} onClick={save}>
        {busy ? "Saving..." : "Save"}
      </button>
      <span className="text-xs" style={{ color: message && !message.ok ? "var(--danger)" : "var(--text-muted)" }}>
        {message?.text || "A company needs both to claim GST input credit."}
      </span>
    </div>
  );
}
