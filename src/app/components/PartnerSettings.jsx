"use client";

import { useCallback, useEffect, useState } from "react";

const inputClass =
  "input mt-1";

/**
 * Channel manager partner credentials: the contract between this software
 * and the provider. Super admin only; the same credentials serve every
 * property, so hoteliers never see or set them.
 */
export default function PartnerSettings() {
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/partners");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not load partners");
      setPartners(json.partners || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(partner) {
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch("/api/partners", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partner),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Save failed");
      setNotice(`${partner.name} updated.`);
      setForm(null);
      await load();
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="py-6 text-center sub">Loading partners…</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="h1">Partners</h2>
        <p className="sub">
          API credentials between this platform and each channel manager. These
          are shared across every property; hotels set only their own codes.
        </p>
      </div>

      {error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}
      {notice && (
        <p className="card px-3 py-2 sub">
          {notice}
        </p>
      )}

      {partners.map((p) =>
        form?.id === p.id ? (
          <div key={p.id} className="card card-pad">
            <h3 className="mb-3 h2 text-sm">{p.name}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block label">
                Base URL
                <input
                  value={form.base_url ?? ""}
                  onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                  className={inputClass}
                  placeholder="https://live.aiosell.com/api/v2/cm"
                />
              </label>
              <label className="block label">
                Partner ID (the pms slug)
                <input
                  value={form.partner_id ?? ""}
                  onChange={(e) => setForm({ ...form, partner_id: e.target.value })}
                  className={inputClass}
                  placeholder="sample-pms"
                />
              </label>
              <label className="block label">
                Rates path
                <input
                  value={form.rates_url ?? ""}
                  onChange={(e) => setForm({ ...form, rates_url: e.target.value })}
                  className={inputClass}
                  placeholder="/update-rates/{pms}"
                />
              </label>
              <label className="block label">
                Inventory path
                <input
                  value={form.inventory_url ?? ""}
                  onChange={(e) => setForm({ ...form, inventory_url: e.target.value })}
                  className={inputClass}
                  placeholder="/update/{pms}"
                />
              </label>
              <label className="block label">
                API username
                <input
                  value={form.api_username ?? ""}
                  onChange={(e) => setForm({ ...form, api_username: e.target.value })}
                  className={inputClass}
                  autoComplete="off"
                />
              </label>
              <label className="block label">
                API password
                <input
                  type="password"
                  value={form.api_password ?? ""}
                  onChange={(e) => setForm({ ...form, api_password: e.target.value })}
                  className={inputClass}
                  placeholder={p.has_password ? "•••••• (unchanged)" : "Set a password"}
                  autoComplete="new-password"
                />
                <span className="mt-1 block text-[10px] faint">
                  Leave blank to keep the current password.
                </span>
              </label>
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={Boolean(form.enabled)}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              Enabled
            </label>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => save(form)}
                className="btn btn-primary"
              >
                {busy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setForm(null)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-2 card px-4 py-3"
          >
            <div>
              <span className="text-sm text-ink">{p.name}</span>
              <span className="ml-2 text-xs muted">
                {p.enabled ? "Enabled" : "Disabled"}
                {p.partner_id ? ` · ${p.partner_id}` : ""}
                {p.api_username ? ` · ${p.api_username}` : " · no credentials"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setForm({ ...p, api_password: "" });
                setNotice("");
              }}
              className="btn btn-secondary text-xs"
            >
              Configure
            </button>
          </div>
        )
      )}

      {partners.length === 0 && (
        <p className="py-6 text-center sub">No partners yet.</p>
      )}
    </div>
  );
}
