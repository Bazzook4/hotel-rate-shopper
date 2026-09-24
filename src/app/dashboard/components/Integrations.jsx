"use client";

import { useCallback, useEffect, useState } from "react";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-slate-900/60 px-2 py-1.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-white/30";

/** Tools a property can connect to. Aiosell is live; the rest are planned. */
const CATALOGUE = [
  {
    slug: "aiosell",
    name: "Aiosell",
    category: "Channel Manager",
    blurb: "Push rates and inventory to Booking.com, MakeMyTrip, Agoda and more.",
    available: true,
  },
  { slug: "staah", name: "STAAH", category: "Channel Manager", blurb: "Channel management and booking engine.", available: false },
  { slug: "ezee", name: "eZee", category: "Channel Manager", blurb: "Distribution and PMS integration.", available: false },
  { slug: "siteminder", name: "SiteMinder", category: "Channel Manager", blurb: "Global distribution platform.", available: false },
];

export default function Integrations({ session }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);
  const [hotelCode, setHotelCode] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [codes, setCodes] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/integrations");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not load integrations");
      setData(json);
      setHotelCode(json.integration?.hotel_code || "");
      setEnabled(Boolean(json.integration?.enabled));

      const map = {};
      for (const row of json.codeMap || []) {
        if (row.rate_plan_id) map[`plan:${row.rate_plan_id}`] = row.partner_rateplan_code || "";
        else if (row.room_type_id) map[`room:${row.room_type_id}`] = row.partner_room_code || "";
      }
      setCodes(map);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setBusy(true);
    setNotice("");
    try {
      const codeMap = [
        ...(data?.roomTypes || []).map((r) => ({
          room_type_id: r.id,
          partner_room_code: codes[`room:${r.id}`] || "",
        })),
        ...(data?.ratePlans || []).map((p) => ({
          rate_plan_id: p.id,
          partner_rateplan_code: codes[`plan:${p.id}`] || "",
        })),
      ];

      const res = await fetch("/api/integrations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hotelCode, enabled, codeMap }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Save failed");
      setNotice("Connection saved.");
      await load();
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="space-y-3 text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-white" />
          <p className="text-sm text-slate-400">Loading integrations…</p>
        </div>
      </div>
    );
  }

  const partnerReady = data?.partner?.configured;
  const connected = Boolean(data?.integration?.hotel_code && data?.integration?.enabled);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-3xl font-semibold text-white">Integrations</h2>
        <p className="text-sm text-slate-300/80">
          Connect the tools your property already uses.
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CATALOGUE.map((tool) => {
          const isAiosell = tool.slug === "aiosell";
          return (
            <div
              key={tool.slug}
              className={`rounded-2xl border p-4 ${
                tool.available
                  ? "border-white/10 bg-white/5"
                  : "border-white/5 bg-white/[0.02]"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    {tool.category}
                  </p>
                  <h3 className="text-lg font-semibold text-white">{tool.name}</h3>
                </div>
                {isAiosell && connected && (
                  <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] text-green-300 ring-1 ring-green-500/30">
                    Connected
                  </span>
                )}
              </div>

              <p className="mt-2 text-xs text-slate-400">{tool.blurb}</p>

              {tool.available ? (
                <button
                  type="button"
                  onClick={() => setOpen(open === tool.slug ? null : tool.slug)}
                  className="mt-3 w-full rounded-xl bg-white px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-100"
                >
                  {connected ? "Manage" : "Connect"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  className="mt-3 w-full rounded-xl bg-white/5 px-3 py-1.5 text-sm text-slate-500"
                >
                  Coming soon
                </button>
              )}
            </div>
          );
        })}
      </div>

      {open === "aiosell" && (
        <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
          <h3 className="text-sm font-semibold text-white">Aiosell connection</h3>

          {!partnerReady && (
            <p className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              Aiosell is not yet set up on the platform. Ask your administrator to
              add the API credentials before connecting.
            </p>
          )}

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-[11px] text-slate-400">
              Hotel code
              <input
                value={hotelCode}
                onChange={(e) => setHotelCode(e.target.value)}
                className={`mt-1 ${inputClass}`}
                placeholder="The code Aiosell assigned this property"
              />
            </label>
            <label className="mt-5 flex items-center gap-2 text-sm text-white">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Send rates and inventory to Aiosell
            </label>
          </div>

          {(data?.roomTypes?.length > 0 || data?.ratePlans?.length > 0) && (
            <div className="mt-4">
              <p className="text-xs text-slate-400">
                Map each of your room types and rate plans to its Aiosell code.
              </p>

              {data.roomTypes.length > 0 && (
                <div className="mt-2">
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">
                    Room types
                  </p>
                  <div className="space-y-2">
                    {data.roomTypes.map((r) => (
                      <div key={r.id} className="grid grid-cols-2 items-center gap-2">
                        <span className="text-sm text-slate-200">{r.room_type_name}</span>
                        <input
                          value={codes[`room:${r.id}`] ?? ""}
                          onChange={(e) =>
                            setCodes({ ...codes, [`room:${r.id}`]: e.target.value })
                          }
                          className={inputClass}
                          placeholder="Aiosell room code"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.ratePlans.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">
                    Rate plans
                  </p>
                  <div className="space-y-2">
                    {data.ratePlans.map((p) => (
                      <div key={p.id} className="grid grid-cols-2 items-center gap-2">
                        <span className="text-sm text-slate-200">{p.plan_name}</span>
                        <input
                          value={codes[`plan:${p.id}`] ?? ""}
                          onChange={(e) =>
                            setCodes({ ...codes, [`plan:${p.id}`]: e.target.value })
                          }
                          className={inputClass}
                          placeholder="Aiosell rateplan code"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={save}
              className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-100 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save connection"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
