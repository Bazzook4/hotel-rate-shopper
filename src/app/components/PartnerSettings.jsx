"use client";

import { useCallback, useEffect, useState } from "react";

const inputClass =
  "mt-1 w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-white/30";

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
    return <p className="py-6 text-center text-sm text-slate-400">Loading partners…</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold text-white">Partners</h2>
        <p className="text-sm text-slate-300/80">
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
        <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200">
          {notice}
        </p>
      )}

      {partners.map((p) =>
        form?.id === p.id ? (
          <div key={p.id} className="rounded-2xl border border-white/15 bg-white/5 p-4">
            <h3 className="mb-3 text-sm font-semibold text-white">{p.name}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-[11px] text-slate-400">
                Base URL
                <input
                  value={form.base_url ?? ""}
                  onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                  className={inputClass}
                  placeholder="https://live.aiosell.com/api/v2/cm"
                />
              </label>
              <label className="block text-[11px] text-slate-400">
                Partner ID (the pms slug)
                <input
                  value={form.partner_id ?? ""}
                  onChange={(e) => setForm({ ...form, partner_id: e.target.value })}
                  className={inputClass}
                  placeholder="sample-pms"
                />
              </label>
              <label className="block text-[11px] text-slate-400">
                Rates path
                <input
                  value={form.rates_url ?? ""}
                  onChange={(e) => setForm({ ...form, rates_url: e.target.value })}
                  className={inputClass}
                  placeholder="/update-rates/{pms}"
                />
              </label>
              <label className="block text-[11px] text-slate-400">
                Inventory path
                <input
                  value={form.inventory_url ?? ""}
                  onChange={(e) => setForm({ ...form, inventory_url: e.target.value })}
                  className={inputClass}
                  placeholder="/update/{pms}"
                />
              </label>
              <label className="block text-[11px] text-slate-400">
                API username
                <input
                  value={form.api_username ?? ""}
                  onChange={(e) => setForm({ ...form, api_username: e.target.value })}
                  className={inputClass}
                  autoComplete="off"
                />
              </label>
              <label className="block text-[11px] text-slate-400">
                API password
                <input
                  type="password"
                  value={form.api_password ?? ""}
                  onChange={(e) => setForm({ ...form, api_password: e.target.value })}
                  className={inputClass}
                  placeholder={p.has_password ? "•••••• (unchanged)" : "Set a password"}
                  autoComplete="new-password"
                />
                <span className="mt-1 block text-[10px] text-slate-500">
                  Leave blank to keep the current password.
                </span>
              </label>
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm text-white">
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
                className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-100 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setForm(null)}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
          >
            <div>
              <span className="text-sm text-white">{p.name}</span>
              <span className="ml-2 text-xs text-slate-400">
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
              className="rounded-lg bg-white/10 px-2.5 py-1 text-xs text-white hover:bg-white/20"
            >
              Configure
            </button>
          </div>
        )
      )}

      {partners.length === 0 && (
        <p className="py-6 text-center text-sm text-slate-400">No partners yet.</p>
      )}
    </div>
  );
}
