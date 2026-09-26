"use client";

import { useMemo, useState } from "react";
import { todayUTC } from "@/lib/date";

/**
 * Services, grouped by category, each with the taxes it carries.
 *
 * This is what the folio offers when adding a charge to a stay. A price here
 * is today's price: adding a service to a stay copies it, so changing it
 * later never rewrites what an earlier guest was charged. Taxes are not
 * copied -- they are worked out on the folio from what the service carries,
 * which is why a rate change is made by ending a tax, not editing it.
 *
 * The room is a service too, with its price on each night of the stay rather
 * than here. It cannot be retired or re-priced, only named, categorised and
 * taxed.
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
  return `₹${(Number(value) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function blank(categoryId = "") {
  return {
    name: "",
    unit_price: "",
    charge_type: "once",
    kind_of: "extra",
    category_id: categoryId,
    tax_ids: [],
  };
}

export default function ServicesSetup({ propertyId, data, onChanged }) {
  const { categories, services, taxes } = data;

  const [draft, setDraft] = useState(null);
  const [newCategory, setNewCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const today = todayUTC();
  // A tax that has ended is kept on old nights but offered to no new service.
  const liveTaxes = useMemo(
    () => taxes.filter((t) => t.is_active !== false && !(t.valid_to && t.valid_to < today)),
    [taxes, today]
  );
  const taxName = useMemo(() => {
    const m = {};
    for (const t of taxes) m[t.id] = t;
    return m;
  }, [taxes]);

  /** Categories in order, with an Uncategorised bucket when anything needs it. */
  const groups = useMemo(() => {
    const out = categories.map((c) => ({
      id: c.id,
      name: c.name,
      category: c,
      services: services.filter((s) => s.category_id === c.id),
    }));
    const known = new Set(categories.map((c) => c.id));
    const loose = services.filter((s) => !s.category_id || !known.has(s.category_id));
    if (loose.length > 0) out.push({ id: "", name: "Uncategorised", services: loose });
    return out;
  }, [categories, services]);

  async function send(method, payload, qs) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pms/services${qs ? `?${qs}` : ""}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: payload ? JSON.stringify({ ...payload, property_id: propertyId }) : undefined,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "That did not save");
      await onChanged();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const params = (extra) => {
    const qs = new URLSearchParams(extra);
    if (propertyId) qs.set("propertyId", propertyId);
    return qs.toString();
  };

  function edit(service) {
    setDraft({
      id: service.id,
      name: service.name,
      unit_price: service.unit_price,
      charge_type: service.charge_type,
      kind_of: service.kind,
      category_id: service.category_id || "",
      tax_ids: service.tax_ids || [],
      is_room: service.is_room === true,
    });
  }

  async function saveDraft() {
    if (await send("POST", { kind: "service", ...draft })) setDraft(null);
  }

  function retire(service) {
    if (
      !window.confirm(
        `Retire “${service.name}”? It stays on past folios, with its taxes, but is no longer offered.`
      )
    ) {
      return;
    }
    send("DELETE", null, params({ id: service.id }));
  }

  function renameCategory(category) {
    const name = window.prompt("Rename category", category.name);
    if (name && name.trim() && name.trim() !== category.name) {
      send("POST", { kind: "category", id: category.id, name, sort_order: category.sort_order });
    }
  }

  function deleteCategory(category, count) {
    if (
      !window.confirm(
        count > 0
          ? `Delete “${category.name}”? Its ${count} service${count === 1 ? "" : "s"} move to Uncategorised.`
          : `Delete “${category.name}”?`
      )
    ) {
      return;
    }
    send("DELETE", null, params({ id: category.id, kind: "category" }));
  }

  function toggleTax(id) {
    setDraft((d) => ({
      ...d,
      tax_ids: d.tax_ids.includes(id) ? d.tax_ids.filter((t) => t !== id) : [...d.tax_ids, id],
    }));
  }

  const nextCategoryOrder =
    categories.reduce((max, c) => Math.max(max, Number(c.sort_order) || 0), 0) + 10;

  return (
    <div className="card card-pad space-y-4">
      <div>
        <h3 style={{ fontWeight: 600 }}>Services</h3>
        <p className="sub">
          What can be billed on a stay. “Included” services come with the rate
          (breakfast on a BB plan) and show on the folio without being charged.
        </p>
      </div>

      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      {groups.map((group) => (
        <div key={group.id || "loose"} className="space-y-2">
          <div
            className="flex items-center justify-between gap-2"
            style={{ borderBottom: "1px solid var(--border)", paddingBottom: "0.25rem" }}
          >
            <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>
              {group.name}
              <span style={{ fontWeight: 400, color: "var(--text-faint)" }}>
                {" "}
                · {group.services.length} service{group.services.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex gap-1">
              <button
                className="btn btn-ghost text-xs"
                disabled={busy}
                onClick={() => setDraft(blank(group.id))}
              >
                + Service
              </button>
              {group.category && (
                <>
                  <button
                    className="btn btn-ghost text-xs"
                    disabled={busy}
                    onClick={() => renameCategory(group.category)}
                  >
                    Rename
                  </button>
                  <button
                    className="btn btn-ghost text-xs"
                    disabled={busy}
                    onClick={() => deleteCategory(group.category, group.services.length)}
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          </div>

          {group.services.length === 0 ? (
            <p className="sub" style={{ fontSize: "0.75rem" }}>
              No services in this category yet.
            </p>
          ) : (
            <table className="grid-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Service</th>
                  <th className="text-right">Price</th>
                  <th className="text-left">Charged</th>
                  <th className="text-left">Taxes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {group.services.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {s.name}
                      {s.is_room && (
                        <span className="chip chip-off ml-2" style={{ fontSize: "0.6rem" }}>
                          Room nights
                        </span>
                      )}
                      {!s.is_room && s.kind === "inclusion" && (
                        <span className="chip chip-ok ml-2" style={{ fontSize: "0.6rem" }}>
                          Included
                        </span>
                      )}
                    </td>
                    <td className="text-right">
                      {s.is_room ? (
                        <span style={{ color: "var(--text-faint)" }}>Nightly rate</span>
                      ) : (
                        money(s.unit_price)
                      )}
                    </td>
                    <td>{CHARGE_TYPES.find((c) => c.id === s.charge_type)?.label}</td>
                    <td>
                      {s.kind === "inclusion" && !s.is_room ? (
                        <span style={{ color: "var(--text-faint)" }}>Part of the rate</span>
                      ) : (s.tax_ids || []).length === 0 ? (
                        <span style={{ color: "var(--warn)" }}>No tax</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {s.tax_ids.map((id) =>
                            taxName[id] ? (
                              <span key={id} className="chip chip-off" style={{ fontSize: "0.65rem" }}>
                                {taxName[id].name}
                              </span>
                            ) : null
                          )}
                        </div>
                      )}
                    </td>
                    <td className="text-right" style={{ whiteSpace: "nowrap" }}>
                      <button
                        className="btn btn-ghost text-xs"
                        disabled={busy}
                        onClick={() => edit(s)}
                      >
                        Edit
                      </button>
                      {!s.is_room && (
                        <button
                          className="btn btn-ghost text-xs"
                          disabled={busy}
                          onClick={() => retire(s)}
                        >
                          Retire
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}

      {/* ---------------- SERVICE EDITOR ---------------- */}
      {draft && (
        <div className="card card-pad space-y-3">
          <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>
            {draft.id ? `Edit ${draft.name}` : "New service"}
          </div>
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}
          >
            <div>
              <label className="label">Name *</label>
              <input
                className="input"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Breakfast"
              />
            </div>
            <div>
              <label className="label">Category</label>
              <select
                className="input"
                value={draft.category_id}
                onChange={(e) => setDraft({ ...draft, category_id: e.target.value })}
              >
                <option value="">Uncategorised</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            {!draft.is_room && (
              <>
                <div>
                  <label className="label">Price (₹)</label>
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
                    value={draft.kind_of}
                    onChange={(e) => setDraft({ ...draft, kind_of: e.target.value })}
                  >
                    {KINDS.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>

          <div>
            <label className="label">Taxes on this service</label>
            {liveTaxes.length === 0 ? (
              <p className="sub" style={{ fontSize: "0.75rem" }}>
                No taxes set up yet — add them under Setup → Tax Setup.
              </p>
            ) : (
              <div className="flex flex-wrap gap-3 text-sm">
                {liveTaxes.map((t) => (
                  <label key={t.id} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={draft.tax_ids.includes(t.id)}
                      onChange={() => toggleTax(t.id)}
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              className="btn btn-primary text-sm"
              disabled={busy || !draft.name.trim()}
              onClick={saveDraft}
            >
              Save
            </button>
            <button className="btn btn-ghost text-sm" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2" style={{ maxWidth: 420 }}>
        <input
          className="input text-sm"
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          placeholder="New category — e.g. Spa, Laundry"
        />
        <button
          className="btn btn-secondary text-sm"
          disabled={busy || !newCategory.trim()}
          onClick={async () => {
            if (
              await send("POST", {
                kind: "category",
                name: newCategory,
                sort_order: nextCategoryOrder,
              })
            ) {
              setNewCategory("");
            }
          }}
        >
          Add category
        </button>
      </div>
    </div>
  );
}
