"use client";

import { useCallback, useEffect, useState } from "react";
import { plansForRoom, planAppliesToRoom } from "@/lib/ratePlanPricing";

const inputClass =
  "input";

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
  // Each activity is switched on separately.
  const [acts, setActs] = useState({
    ratesOut: false,
    inventoryOut: false,
    reservationsIn: false,
  });
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
      setActs({
        ratesOut: Boolean(json.integration?.rates_out),
        inventoryOut: Boolean(json.integration?.inventory_out),
        reservationsIn: Boolean(json.integration?.reservations_in),
      });

      const map = {};
      for (const row of json.codeMap || []) {
        if (row.rate_plan_id) {
          map[`plan:${row.room_type_id || ""}:${row.rate_plan_id}:${row.occupancy ?? ""}`] = {
            code: row.partner_rateplan_code || "",
            extra_adult: row.extra_adult ?? "",
            no_of_meals: row.no_of_meals ?? "",
          };
        } else if (row.room_type_id) {
          map[`room:${row.room_type_id}`] = { code: row.partner_room_code || "" };
        }
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
      const codeMap = [];

      for (const r of data?.roomTypes || []) {
        codeMap.push({
          room_type_id: r.id,
          partner_room_code: codes[`room:${r.id}`]?.code || "",
        });
      }

      // A rate plan maps once per occupancy, because the partner treats each
      // occupancy as its own rate plan code.
      for (const r of data?.roomTypes || []) {
        for (const p of data?.ratePlans || []) {
          if (!planAppliesToRoom(p, r.id, data?.assignments)) continue;
          for (let occ = 1; occ <= (r.max_adults || 2); occ += 1) {
            const entry = codes[`plan:${r.id}:${p.id}:${occ}`];
            if (!entry?.code) continue;
            codeMap.push({
              room_type_id: r.id,
              rate_plan_id: p.id,
              occupancy: occ,
              partner_rateplan_code: entry.code,
              extra_adult: entry.extra_adult === "" ? null : entry.extra_adult,
              no_of_meals: entry.no_of_meals === "" ? null : entry.no_of_meals,
            });
          }
        }
      }

      const res = await fetch("/api/integrations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hotelCode, enabled, ...acts, codeMap }),
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
          <div className="inline-block h-7 w-7 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" />
          <p className="sub">Loading integrations…</p>
        </div>
      </div>
    );
  }

  const partnerReady = data?.partner?.configured;
  const connected = Boolean(data?.integration?.hotel_code && data?.integration?.enabled);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="h1">Integrations</h2>
        <p className="sub">
          Connect the tools your property already uses.
        </p>
      </div>

      {error && (
        <p className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      {notice && (
        <p className="card px-3 py-2 sub">
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
                  ? "border-[var(--border)] bg-[var(--surface)]"
                  : "border-[var(--border)] bg-[var(--surface-2)]"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-wide faint">
                    {tool.category}
                  </p>
                  <h3 className="h2">{tool.name}</h3>
                </div>
                {isAiosell && connected && (
                  <span className="chip chip-ok">
                    Connected
                  </span>
                )}
              </div>

              <p className="mt-2 text-xs muted">{tool.blurb}</p>

              {tool.available ? (
                <button
                  type="button"
                  onClick={() => setOpen(open === tool.slug ? null : tool.slug)}
                  className="btn btn-secondary mt-3 w-full justify-center"
                >
                  {connected ? "Manage" : "Connect"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  className="mt-3 w-full rounded-xl bg-[var(--surface)] px-3 py-1.5 text-sm faint"
                >
                  Coming soon
                </button>
              )}
            </div>
          );
        })}
      </div>

      {open === "aiosell" && (
        <div className="card card-pad">
          <h3 className="h2 text-sm">Aiosell connection</h3>

          {!partnerReady && (
            <p className="mt-2 rounded-xl border border-[var(--warn)] bg-[var(--warn-soft)] px-3 py-2 text-xs text-[var(--warn)]">
              Aiosell is not yet set up on the platform. Ask your administrator to
              add the API credentials before connecting.
            </p>
          )}

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block label">
              Hotel code
              <input
                value={hotelCode}
                onChange={(e) => setHotelCode(e.target.value)}
                className={`mt-1 ${inputClass}`}
                placeholder="The code Aiosell assigned this property"
              />
            </label>
            <label className="mt-5 flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Connection active
            </label>
          </div>

          <div className="mt-4">
            <p className="text-[11px] uppercase tracking-wide faint">
              Activities
            </p>
            <p className="mb-2 text-xs muted">
              Turn on only what this property should exchange with Aiosell.
            </p>
            <div className="space-y-2">
              {[
                ["ratesOut", "Rate out", "Send our rates to the channel manager", "supports_rates_out"],
                ["inventoryOut", "Inventory out", "Send room availability and restrictions", "supports_inventory_out"],
                ["reservationsIn", "Reservation in", "Receive bookings from the channel manager", "supports_reservations_in"],
              ].map(([key, label, hint, supportKey]) => {
                const supported = data?.partner?.[supportKey] !== false;
                return (
                  <label
                    key={key}
                    className={`flex items-start gap-2 rounded-xl border px-3 py-2 ${
                      supported
                        ? "border-[var(--border)] bg-[var(--surface)]"
                        : "border-[var(--border)] bg-[var(--surface-2)] opacity-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={!supported}
                      checked={supported && acts[key]}
                      onChange={(e) => setActs({ ...acts, [key]: e.target.checked })}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-sm text-ink">{label}</span>
                      <span className="block text-xs muted">
                        {supported ? hint : "Not supported by this partner"}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>

            {acts.reservationsIn && (
              <div className="mt-3 card p-3">
                <p className="text-[11px] uppercase tracking-wide faint">
                  Reservation webhook
                </p>
                <p className="mt-1 text-xs muted">
                  Give this URL to Aiosell. They will post bookings,
                  modifications and cancellations to it.
                </p>
                {data?.webhookUrl ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <code className="flex-1 break-all rounded-lg bg-[var(--surface-2)] px-2 py-1.5 text-xs text-ink">
                      {data.webhookUrl}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(data.webhookUrl);
                        setNotice("Webhook URL copied.");
                      }}
                      className="btn btn-secondary text-xs"
                    >
                      Copy
                    </button>
                  </div>
                ) : (
                  <p className="mt-2 text-xs faint">
                    Save with this activity on and the URL will be generated.
                  </p>
                )}
                <p className="mt-2 text-[10px] faint">
                  Treat it as a password: anyone holding it can post
                  reservations to this property.
                </p>
              </div>
            )}
          </div>

          {(data?.roomTypes?.length > 0 || data?.ratePlans?.length > 0) && (
            <div className="mt-4">
              <p className="text-xs muted">
                Map each room type to its Aiosell room code, then each rate
                plan to the Aiosell rate plan code for every occupancy you
                sell. Aiosell treats each occupancy as a separate rate plan.
              </p>

              {(data.roomTypes || []).map((room) => {
                const maxAdults = room.max_adults || 2;
                const plans = plansForRoom(
                  data.ratePlans,
                  room.id,
                  data.assignments
                );
                return (
                  <div
                    key={room.id}
                    className="mt-3 card p-3"
                  >
                    <div className="grid items-center gap-2 sm:grid-cols-2">
                      <span className="text-sm font-medium text-ink">
                        {room.room_type_name}
                        <span className="ml-2 text-xs faint">
                          up to {maxAdults} adult{maxAdults === 1 ? "" : "s"}
                        </span>
                      </span>
                      <input
                        value={codes[`room:${room.id}`]?.code ?? ""}
                        onChange={(e) =>
                          setCodes({
                            ...codes,
                            [`room:${room.id}`]: { code: e.target.value },
                          })
                        }
                        className={inputClass}
                        placeholder="Aiosell room code, e.g. executive"
                      />
                    </div>

                    {plans.length > 0 && (
                      <div className="mt-3 overflow-x-auto">
                        <table className="grid-table min-w-full text-xs">
                          <thead>
                            <tr className="text-left text-[10px] uppercase tracking-wide faint">
                              <th className="py-1 pr-2">Rate plan</th>
                              <th className="py-1 pr-2">Adults</th>
                              <th className="py-1 pr-2">Aiosell rate plan code</th>
                              <th className="py-1 pr-2">Extra adult</th>
                              <th className="py-1">Meals</th>
                            </tr>
                          </thead>
                          <tbody>
                            {plans.map((plan) =>
                              Array.from({ length: maxAdults }, (_, i) => i + 1).map(
                                (occ) => {
                                  const key = `plan:${room.id}:${plan.id}:${occ}`;
                                  const entry = codes[key] || {};
                                  const set = (field, value) =>
                                    setCodes({
                                      ...codes,
                                      [key]: { ...entry, [field]: value },
                                    });
                                  return (
                                    <tr key={key} className="">
                                      <td className="py-1 pr-2 muted">
                                        {occ === 1 ? plan.plan_name : ""}
                                      </td>
                                      <td className="py-1 pr-2 muted">{occ}</td>
                                      <td className="py-1 pr-2">
                                        <input
                                          value={entry.code ?? ""}
                                          onChange={(e) => set("code", e.target.value)}
                                          className={inputClass}
                                          placeholder={
                                            occ === 1
                                              ? "executive-s-ep"
                                              : occ === 2
                                              ? "executive-d-ep"
                                              : "code"
                                          }
                                        />
                                      </td>
                                      <td className="py-1 pr-2">
                                        <input
                                          type="number"
                                          value={entry.extra_adult ?? ""}
                                          onChange={(e) => set("extra_adult", e.target.value)}
                                          className={inputClass}
                                          placeholder="500"
                                        />
                                      </td>
                                      <td className="py-1">
                                        <input
                                          type="number"
                                          value={entry.no_of_meals ?? ""}
                                          onChange={(e) => set("no_of_meals", e.target.value)}
                                          className={inputClass}
                                          placeholder="0"
                                        />
                                      </td>
                                    </tr>
                                  );
                                }
                              )
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={save}
              className="btn btn-primary"
            >
              {busy ? "Saving…" : "Save connection"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="btn btn-secondary"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
