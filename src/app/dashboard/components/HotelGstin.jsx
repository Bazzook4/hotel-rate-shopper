"use client";

import { useEffect, useState } from "react";

/**
 * The hotel's own GSTIN, on one line of Tax Setup.
 *
 * Printed on every invoice. An invoice to a company needs it: without the
 * issuer's GSTIN the company cannot claim the GST it paid.
 */
export default function HotelGstin({ propertyId }) {
  const [stored, setStored] = useState(null);
  const [value, setValue] = useState("");
  const [id, setId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let live = true;
    fetch("/api/properties")
      .then((r) => (r.ok ? r.json() : { properties: [] }))
      .then((d) => {
        if (!live) return;
        const p = (d.properties || []).find((x) => !propertyId || x.id === propertyId) || null;
        setId(p?.id || null);
        setStored(p?.gstin || "");
        setValue(p?.gstin || "");
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
        body: JSON.stringify({ id, gstin: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save the GSTIN");
      setStored(data.property?.gstin ?? value.toUpperCase());
      setValue(data.property?.gstin ?? value.toUpperCase());
      setMessage({ ok: true, text: "Saved." });
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (!id) return null;
  const changed = value.trim().toUpperCase() !== String(stored || "");

  return (
    <div className="card p-3 flex flex-wrap items-center gap-2">
      <label className="label" htmlFor="hotel-gstin" style={{ margin: 0 }}>
        Hotel GSTIN
      </label>
      <input
        id="hotel-gstin"
        className="input w-48"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. 29ABCDE1234F1Z5"
        maxLength={20}
      />
      <button type="button" className="btn btn-primary text-sm" disabled={busy || !changed} onClick={save}>
        {busy ? "Saving..." : "Save"}
      </button>
      <span className="text-xs" style={{ color: message && !message.ok ? "var(--danger)" : "var(--text-muted)" }}>
        {message?.text || "Printed on every invoice. A company needs it to claim GST input credit."}
      </span>
    </div>
  );
}
