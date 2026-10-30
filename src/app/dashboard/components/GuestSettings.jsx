"use client";

import { useCallback, useEffect, useState } from "react";
import { Grid, Messages, SaveActions, SetupHeader, Toolbar, isDraft, sendJSON, useGrid } from "./SetupGrid";
import { useDialog } from "../../components/Dialog";
import Icon from "../../components/Icon";

/**
 * Guest tiers and wallet plans: the two short lists the Guests page is set
 * up with. Each is a small setup grid, edited and saved like every other.
 */

export const TIER_TONES = [
  { id: "gold", label: "Gold", style: { background: "var(--warn-soft)", color: "var(--warn)" } },
  { id: "green", label: "Green", style: { background: "var(--accent-soft)", color: "var(--accent-text)" } },
  { id: "blue", label: "Blue", style: { background: "var(--status-booked-soft)", color: "var(--status-booked-text)" } },
  { id: "purple", label: "Purple", style: { background: "var(--tag-comp)", color: "#fff" } },
  { id: "grey", label: "Grey", style: { background: "var(--surface-2)", color: "var(--text-muted)" } },
];
const toneStyle = (tone) => (TIER_TONES.find((t) => t.id === tone) || TIER_TONES[0]).style;

/** A guest's tier, as the badge the desk sees wherever the guest is. */
export function TierBadge({ tier }) {
  if (!tier) return null;
  return (
    <span className="chip" style={toneStyle(tier.tone)} title={tier.notes || undefined}>
      {tier.name}
    </span>
  );
}

/** The property's tiers, loaded once and shared by a page's grids and badges. */
export function useGuestTiers(propertyId) {
  const [tiers, setTiers] = useState([]);
  const load = useCallback(() => {
    const qs = propertyId ? `?propertyId=${propertyId}` : "";
    return fetch(`/api/pms/guestTiers${qs}`)
      .then((r) => (r.ok ? r.json() : { tiers: [] }))
      .then((d) => setTiers(d.tiers || []))
      .catch(() => setTiers([]));
  }, [propertyId]);
  useEffect(() => {
    load();
  }, [load]);
  return { tiers, reload: load };
}

/** A small setup grid over one list, sharing the save and delete wiring. */
function useListGrid({ rows, url, propertyId, onSaved, label }) {
  const dialog = useDialog();
  const grid = useGrid(rows);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setBusy(true);
    setError(null);
    const errors = await grid.save({
      label,
      update: (row, changes) => sendJSON(url, "PATCH", { property_id: propertyId, id: row.id, ...changes }),
      create: (d) => {
        const { id, ...row } = d;
        return sendJSON(url, "POST", { property_id: propertyId, ...row });
      },
    });
    await onSaved();
    setBusy(false);
    if (errors.length) setError(errors.join(". "));
  }

  async function remove(row, message) {
    if (isDraft(row.id)) {
      grid.removeDraft(row.id);
      return;
    }
    if (!(await dialog.confirm({ title: `Delete ${label(row)}?`, message, confirmLabel: "Delete", danger: true }))) return;
    try {
      const qs = new URLSearchParams({ id: row.id });
      if (propertyId) qs.set("propertyId", propertyId);
      await sendJSON(`${url}?${qs}`, "DELETE");
      await onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  return { grid, busy, error, save, remove };
}

export function TiersGrid({ propertyId, tiers, onSaved }) {
  const { grid, busy, error, save, remove } = useListGrid({
    rows: tiers,
    url: "/api/pms/guestTiers",
    propertyId,
    onSaved,
    label: (r) => r.name || "Tier",
  });
  const rows = [...tiers, ...grid.drafts];

  return (
    <div className="space-y-3">
      <SetupHeader section title="Guest tiers" count={tiers.length} sub="Labels you give guests by hand, shown as a badge when they book.">
        <SaveActions count={grid.count} busy={busy} onSave={save} onDiscard={grid.discard} />
      </SetupHeader>
      <Messages error={error} />
      <Toolbar>
        <button type="button" className="btn btn-secondary text-sm" onClick={() => grid.add({ name: "", tone: "gold", sort_order: tiers.length + 1, notes: "" })}>
          <Icon name="plus" size={14} /> Add tier
        </button>
      </Toolbar>
      <Grid>
        <thead>
          <tr>
            <th className="cm-sticky" style={{ minWidth: 160 }}>Name</th>
            <th style={{ width: 120 }}>Colour</th>
            <th style={{ width: 80 }} title="Lower comes first in lists">Order</th>
            <th style={{ minWidth: 240 }}>What it means for the desk</th>
            <th style={{ width: 110 }}>Badge</th>
            <th style={{ width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="cm-empty">No tiers yet. Add Silver, Gold, VIP or whatever your hotel uses.</td>
            </tr>
          )}
          {rows.map((t) => (
            <tr key={t.id} className={isDraft(t.id) ? "cm-new" : undefined}>
              <td className="cm-sticky">{grid.input(t, "name", { placeholder: "e.g. Gold" })}</td>
              <td>{grid.select(t, "tone", TIER_TONES.map(({ id, label }) => ({ id, label })))}</td>
              <td className="cm-num">{grid.input(t, "sort_order", { type: "number" })}</td>
              <td>{grid.input(t, "notes", { placeholder: "e.g. Late checkout, upgrade if free" })}</td>
              <td>
                <TierBadge tier={{ name: grid.value(t, "name") || "Tier", tone: grid.value(t, "tone") }} />
              </td>
              <td>
                <button type="button" className="btn btn-ghost text-xs" aria-label="Delete tier" onClick={() => remove(t, "Guests on this tier keep everything else; they just lose the badge.")}>
                  <Icon name="close" size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </Grid>
    </div>
  );
}

export function WalletPlansGrid({ propertyId, plans, onSaved }) {
  const { grid, busy, error, save, remove } = useListGrid({
    rows: plans,
    url: "/api/pms/walletPlans",
    propertyId,
    onSaved,
    label: (r) => r.name || "Plan",
  });
  const rows = [...plans, ...grid.drafts];

  return (
    <div className="space-y-3">
      <SetupHeader section title="Wallet plans" count={plans.length} sub="Offers for adding money to a wallet, e.g. pay 10,000, get 11,000 to spend on stays and services.">
        <SaveActions count={grid.count} busy={busy} onSave={save} onDiscard={grid.discard} />
      </SetupHeader>
      <Messages error={error} />
      <Toolbar>
        <button type="button" className="btn btn-secondary text-sm" onClick={() => grid.add({ name: "", pay_amount: "", credit: "", is_active: true, notes: "" })}>
          <Icon name="plus" size={14} /> Add plan
        </button>
      </Toolbar>
      <Grid>
        <thead>
          <tr>
            <th className="cm-sticky" style={{ minWidth: 160 }}>Name</th>
            <th style={{ width: 120 }}>Guest pays</th>
            <th style={{ width: 120 }}>Credit given</th>
            <th style={{ width: 90 }}>Bonus</th>
            <th style={{ width: 70 }}>Active</th>
            <th style={{ minWidth: 200 }}>Notes</th>
            <th style={{ width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="cm-empty">No plans yet. Money can still be added in any amount.</td>
            </tr>
          )}
          {rows.map((p) => {
            const pay = Number(grid.value(p, "pay_amount")) || 0;
            const credit = Number(grid.value(p, "credit")) || 0;
            const bonus = pay > 0 && credit >= pay ? Math.round(((credit - pay) / pay) * 1000) / 10 : null;
            return (
              <tr key={p.id} className={isDraft(p.id) ? "cm-new" : grid.value(p, "is_active") === false ? "cm-muted" : undefined}>
                <td className="cm-sticky">{grid.input(p, "name", { placeholder: "e.g. Gold wallet" })}</td>
                <td className="cm-num">{grid.input(p, "pay_amount", { type: "number", min: 0 })}</td>
                <td className="cm-num">{grid.input(p, "credit", { type: "number", min: 0, invalid: pay > 0 && credit > 0 && credit < pay })}</td>
                <td className="cm-num">{bonus == null ? "-" : `${bonus}%`}</td>
                <td style={{ textAlign: "center" }}>{grid.check(p, "is_active")}</td>
                <td>{grid.input(p, "notes")}</td>
                <td>
                  <button type="button" className="btn btn-ghost text-xs" aria-label="Delete plan" onClick={() => remove(p, "Money already added on this plan stays in the wallets.")}>
                    <Icon name="close" size={14} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Grid>
    </div>
  );
}
