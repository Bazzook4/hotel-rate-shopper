"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The menu of extras and inclusions the property sells.
 *
 * This is what the folio's Inclusions tab offers when adding a line to a stay.
 * Without it that dropdown is empty and every charge has to be typed in by
 * hand, which is fine once and tedious by the hundredth breakfast.
 *
 * A price here is today's price. Adding an item to a stay copies it, so
 * changing it later never rewrites what an earlier guest was charged.
 */

const CHARGE_TYPES = [
  { id: "once", label: "One-off" },
  { id: "per_night", label: "Per night" },
];

const KINDS = [
  { id: "extra", label: "Charged" },
  { id: "inclusion", label: "Included" },
];

function money(value) {
  return `₹${(Number(value) || 0).toLocaleString("en-IN")}`;
}

function blank() {
  return { name: "", unit_price: "", charge_type: "once", kind: "extra" };
}

export default function ExtrasSetup({ session }) {
  const propertyId = session?.propertyId || null;

  const [extras, setExtras] = useState([]);
  const [draft, setDraft] = useState(blank());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = propertyId ? `?propertyId=${propertyId}` : "";
      const res = await fetch(`/api/pms/extras${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load the list");
      setExtras(data.extras || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(item) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pms/extras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...item, property_id: propertyId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save the item");
      setDraft(blank());
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function retire(item) {
    if (
      !window.confirm(
        `Retire “${item.name}”? It stays on past folios but is no longer offered.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pms/extras?id=${item.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not retire the item");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad space-y-4">
      <div>
        <h3 style={{ fontWeight: 600 }}>Extras and inclusions</h3>
        <p className="sub">
          What can be added to a stay — breakfast, an airport pickup, a late
          checkout. “Included” items show on the folio without being charged.
        </p>
      </div>

      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      {loading && <p className="sub">Loading…</p>}

      {!loading && extras.length > 0 && (
        <table className="grid-table w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Item</th>
              <th className="text-right">Price</th>
              <th className="text-left">Charged</th>
              <th className="text-left">Type</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {extras.map((x) => (
              <tr key={x.id}>
                <td>{x.name}</td>
                <td className="text-right">{money(x.unit_price)}</td>
                <td>
                  {CHARGE_TYPES.find((c) => c.id === x.charge_type)?.label}
                </td>
                <td>
                  <span
                    className={`chip ${x.kind === "inclusion" ? "chip-ok" : "chip-off"}`}
                  >
                    {KINDS.find((k) => k.id === x.kind)?.label}
                  </span>
                </td>
                <td className="text-right">
                  <button
                    className="btn btn-ghost text-xs"
                    disabled={busy}
                    onClick={() => retire(x)}
                  >
                    Retire
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!loading && extras.length === 0 && (
        <p className="sub">
          Nothing on the list yet. Anything added here shows up in the
          Inclusions tab when working on a booking.
        </p>
      )}

      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}
      >
        <div>
          <label className="label">Item</label>
          <input
            className="input"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Breakfast"
          />
        </div>
        <div>
          <label className="label">Price</label>
          <input
            className="input"
            type="number"
            min="0"
            value={draft.unit_price}
            onChange={(e) => setDraft({ ...draft, unit_price: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Charged</label>
          <select
            className="input"
            value={draft.charge_type}
            onChange={(e) => setDraft({ ...draft, charge_type: e.target.value })}
          >
            {CHARGE_TYPES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Type</label>
          <select
            className="input"
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
          >
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button
            className="btn btn-primary text-sm w-full"
            disabled={busy || !draft.name.trim()}
            onClick={() => save(draft)}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
