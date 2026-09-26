"use client";

import { Fragment, useMemo, useState } from "react";
import { todayUTC } from "@/lib/date";
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
 * Services, grouped by category, each with the taxes it carries.
 *
 * This is what the folio offers when adding a charge to a stay. A price here
 * is today's price: adding a service to a stay copies it, so changing it
 * later never rewrites what an earlier guest was charged. Taxes are not
 * copied -- they are worked out on the folio from what the service carries,
 * which is why a rate change is made by ending a tax, not editing it.
 *
 * Laid out like the Channel Manager: categories are the grey group rows,
 * services sit under them, and every tax in force is a column of ticks, so
 * which service carries which tax is read straight off the grid.
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

const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));

export default function ServicesSetup({ propertyId, data, onChanged, title, sub }) {
  const { categories, taxes } = data;

  // tax_ids is compared as text by the grid, so it is kept sorted.
  const services = useMemo(
    () => data.services.map((s) => ({ ...s, tax_ids: [...(s.tax_ids || [])].sort() })),
    [data.services]
  );

  const svc = useGrid(services);
  const cat = useGrid(categories);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [filter, setFilter] = useState("");

  const today = todayUTC();
  // A tax that has ended is kept on old nights but offered to no new service.
  const liveTaxes = useMemo(
    () => taxes.filter((t) => t.is_active !== false && !(t.valid_to && t.valid_to < today)),
    [taxes, today]
  );

  const allServices = [...services, ...svc.drafts];
  const term = filter.trim().toLowerCase();

  /** Categories in order, with an Uncategorised bucket when anything needs it. */
  const groups = useMemo(() => {
    const cats = [...categories, ...cat.drafts];
    const known = new Set(categories.map((c) => c.id));
    const inGroup = (id) =>
      allServices.filter((s) => (svc.value(s, "category_id") || "") === id);
    const out = cats.map((c) => ({ id: c.id, category: c, services: inGroup(c.id) }));
    const loose = allServices.filter((s) => {
      const c = svc.value(s, "category_id");
      return !c || !known.has(c);
    });
    if (loose.length > 0) out.push({ id: "", category: null, services: loose });
    return out;
  }, [categories, cat.drafts, allServices, svc]);

  const categoryOptions = [
    { id: "", label: "Uncategorised" },
    ...categories.map((c) => ({ id: c.id, label: cat.value(c, "name") })),
  ];

  function toggleTax(service, taxId) {
    const current = svc.value(service, "tax_ids") || [];
    const next = current.includes(taxId)
      ? current.filter((t) => t !== taxId)
      : [...current, taxId].sort();
    svc.change(service, "tax_ids", next);
  }

  const count = svc.count + cat.count;

  async function saveAll() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const saved = count;
    const nextOrder = () =>
      categories.reduce((max, c) => Math.max(max, Number(c.sort_order) || 0), 0) + 10;

    // Categories first: a service moved into a renamed category should land
    // in it under its new name.
    const catErrors = await cat.save({
      label: (c) => c.name || "New category",
      update: (c, changes, next) => {
        if (!next.name?.trim()) throw new Error("Name is required");
        return sendJSON("/api/pms/services", "POST", {
          kind: "category",
          id: c.id,
          name: next.name,
          sort_order: c.sort_order,
          property_id: propertyId,
        });
      },
      create: (d) => {
        if (!d.name?.trim()) throw new Error("Name is required");
        return sendJSON("/api/pms/services", "POST", {
          kind: "category",
          name: d.name,
          sort_order: nextOrder(),
          property_id: propertyId,
        });
      },
    });

    const toBody = (s) => ({
      kind: "service",
      ...(isDraft(s.id) ? {} : { id: s.id }),
      name: s.name,
      unit_price: s.unit_price,
      charge_type: s.charge_type,
      kind_of: s.kind,
      category_id: s.category_id || null,
      tax_ids: s.tax_ids || [],
      is_room: s.is_room === true,
      property_id: propertyId,
    });
    const svcErrors = await svc.save({
      label: (s) => s.name || "New service",
      update: (s, changes, next) => {
        if (!next.name?.trim()) throw new Error("Name is required");
        return sendJSON("/api/pms/services", "POST", toBody(next));
      },
      create: (d) => {
        if (!d.name?.trim()) throw new Error("Name is required");
        return sendJSON("/api/pms/services", "POST", toBody(d));
      },
    });

    await onChanged();
    setBusy(false);
    const errors = [...catErrors, ...svcErrors];
    if (errors.length) setError(errors.join(" · "));
    else setNotice(`Saved ${saved} change${saved === 1 ? "" : "s"}.`);
  }

  function discard() {
    svc.discard();
    cat.discard();
  }

  async function immediate(method, qs, confirmText) {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams(qs);
      if (propertyId) params.set("propertyId", propertyId);
      await sendJSON(`/api/pms/services?${params}`, method);
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function retire(service) {
    if (isDraft(service.id)) return svc.removeDraft(service.id);
    return immediate(
      "DELETE",
      { id: service.id },
      `Retire “${service.name}”? It stays on past folios, with its taxes, but is no longer offered.`
    );
  }

  function deleteCategory(category, n) {
    if (isDraft(category.id)) return cat.removeDraft(category.id);
    return immediate(
      "DELETE",
      { id: category.id, kind: "category" },
      n > 0
        ? `Delete “${category.name}”? Its ${n} service${n === 1 ? "" : "s"} move to Uncategorised.`
        : `Delete “${category.name}”?`
    );
  }

  const cols = 6 + liveTaxes.length;
  const taxById = byId(taxes);

  return (
    <div className="space-y-4">
      <SetupHeader title={title} count={services.length} sub={sub}>
        <SaveActions count={count} busy={busy} onSave={saveAll} onDiscard={discard} />
      </SetupHeader>

      <Messages error={error} notice={notice} />

      <Toolbar>
        <button
          type="button"
          className="btn btn-secondary text-sm"
          onClick={() => cat.add({ name: "" })}
        >
          + Add category
        </button>
        {liveTaxes.length === 0 && (
          <span className="chip chip-warn">No taxes yet — add them under Tax Setup</span>
        )}
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter services…"
          className="ml-auto input w-56"
        />
      </Toolbar>

      <Grid>
        <thead>
          <tr>
            <th className="cm-sticky" style={{ minWidth: 240 }}>
              Category &amp; service
            </th>
            <th style={{ width: 120 }}>Price (₹)</th>
            <th style={{ width: 120 }}>Charged</th>
            <th style={{ width: 120 }}>Type</th>
            <th style={{ width: 160 }}>Category</th>
            {liveTaxes.map((t) => (
              <th key={t.id} className="text-center" title={`Charge ${t.name} on this service`}>
                {t.name}
              </th>
            ))}
            <th style={{ width: 60 }} />
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const shown = group.services.filter(
              (s) => !term || (svc.value(s, "name") || "").toLowerCase().includes(term)
            );
            if (term && shown.length === 0) return null;
            const c = group.category;
            return (
              <Fragment key={group.id || "loose"}>
                <tr className="cm-group">
                  <td className="cm-sticky" style={{ background: "var(--surface-2)" }}>
                    {c ? (
                      cat.input(c, "name", {
                        placeholder: "Category name — Spa, Laundry…",
                        invalid: !cat.value(c, "name")?.trim(),
                        autoFocus: isDraft(c.id),
                        style: { fontWeight: 600 },
                      })
                    ) : (
                      <span style={{ fontWeight: 600 }}>Uncategorised</span>
                    )}
                    <span className="mt-0.5 block text-xs muted">
                      {group.services.length} service{group.services.length === 1 ? "" : "s"}
                    </span>
                  </td>
                  <td colSpan={cols - 2}>
                    <button
                      type="button"
                      className="btn btn-ghost text-xs"
                      disabled={Boolean(c && isDraft(c.id))}
                      title={c && isDraft(c.id) ? "Save the category first" : undefined}
                      onClick={() =>
                        svc.add({
                          name: "",
                          unit_price: "",
                          charge_type: "once",
                          kind: "extra",
                          category_id: group.id,
                          tax_ids: [],
                        })
                      }
                    >
                      + Service
                    </button>
                  </td>
                  <td className="text-center">
                    {c && (
                      <button
                        type="button"
                        className="btn btn-ghost text-xs"
                        disabled={busy}
                        title="Delete category"
                        onClick={() => deleteCategory(c, group.services.length)}
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>

                {shown.map((s) => {
                  const draft = isDraft(s.id);
                  const included = !s.is_room && svc.value(s, "kind") === "inclusion";
                  const taxIds = svc.value(s, "tax_ids") || [];
                  const taxEdited = svc.edited(s, "tax_ids");
                  return (
                    <tr key={s.id} className={draft ? "cm-new" : undefined}>
                      <td className="cm-sticky" style={{ paddingLeft: 32 }}>
                        <div className="flex items-center gap-2">
                          {svc.input(s, "name", {
                            placeholder: "Breakfast",
                            invalid: !svc.value(s, "name")?.trim(),
                            autoFocus: draft,
                          })}
                          {s.is_room && <span className="chip chip-off">Room nights</span>}
                        </div>
                      </td>
                      <td>
                        {s.is_room ? (
                          <span className="text-xs muted">Nightly rate</span>
                        ) : (
                          svc.input(s, "unit_price", { type: "number", min: 0 })
                        )}
                      </td>
                      <td>
                        {s.is_room ? (
                          <span className="text-xs muted">Per night</span>
                        ) : (
                          svc.select(s, "charge_type", CHARGE_TYPES)
                        )}
                      </td>
                      <td>
                        {s.is_room ? (
                          <span className="text-xs muted">Charged</span>
                        ) : (
                          svc.select(s, "kind", KINDS)
                        )}
                      </td>
                      <td>{svc.select(s, "category_id", categoryOptions)}</td>
                      {liveTaxes.map((t) => (
                        <td key={t.id} className="text-center">
                          {included ? (
                            <span className="faint">—</span>
                          ) : (
                            <input
                              type="checkbox"
                              checked={taxIds.includes(t.id)}
                              onChange={() => toggleTax(s, t.id)}
                              style={
                                taxEdited
                                  ? { outline: "2px solid var(--accent)", outlineOffset: 1 }
                                  : undefined
                              }
                              aria-label={`${t.name} on ${s.name || "new service"}`}
                            />
                          )}
                        </td>
                      ))}
                      <td className="text-center">
                        {!s.is_room && (
                          <button
                            type="button"
                            className="btn btn-ghost text-xs"
                            disabled={busy}
                            title={draft ? "Remove this new row" : "Retire service"}
                            onClick={() => retire(s)}
                          >
                            ✕
                          </button>
                        )}
                        {/* An ended tax still on the service is kept, but
                            shown so it is not a surprise on an old folio. */}
                        {taxIds.some((id) => !liveTaxes.find((t) => t.id === id)) && (
                          <span
                            className="chip chip-off"
                            title={taxIds
                              .filter((id) => !liveTaxes.find((t) => t.id === id))
                              .map((id) => taxById[id]?.name)
                              .filter(Boolean)
                              .join(", ")}
                          >
                            +ended
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {!term && group.services.length === 0 && (
                  <tr>
                    <td colSpan={cols} className="text-xs muted" style={{ paddingLeft: 32 }}>
                      No services in this category yet.
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {groups.length === 0 && (
            <tr>
              <td colSpan={cols} className="cm-empty">
                No services yet. Add a category, then its services.
              </td>
            </tr>
          )}
        </tbody>
      </Grid>

      <p className="sub">
        “Included” services come with the rate (breakfast on a BB plan) and show on
        the folio without being charged or taxed.
      </p>
    </div>
  );
}
