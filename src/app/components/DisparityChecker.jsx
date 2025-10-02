"use client";

import { useMemo, useState } from "react";
import { addDays, formatDateISO, parseDateISO } from "@/lib/date";

function pctDiff(from, to) {
  if (from == null || to == null || from <= 0) return null;
  return ((to - from) / from) * 100;
}

function PriceRow({ row, lowest }) {
  const diffPct = pctDiff(lowest, row.price);
  const isLowest = row.price === lowest;

  let badgeClass =
    "text-xs px-2 py-0.5 rounded-full border border-transparent";
  let badgeText = "";

  if (isLowest) {
    badgeClass += " bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
    badgeText = "Best";
  } else if (diffPct != null && diffPct >= 8) {
    badgeClass += " bg-rose-500/20 text-rose-300 border-rose-500/30";
    badgeText = "High";
  } else if (diffPct != null && diffPct >= 3) {
    badgeClass += " bg-amber-500/20 text-amber-300 border-amber-500/30";
    badgeText = "Slightly High";
  }

  return (
    <tr className="border-t border-white/10 text-slate-200/80">
      <td className="p-3">
        <div className="flex items-center gap-2">
          {row.logo && (
            <img src={row.logo} alt="" className="h-4 w-4 rounded-full border border-white/20" />
          )}
          <span className="text-sm font-medium text-white">{row.source}</span>
        </div>
      </td>
      <td className="p-3 text-sm">
        {row.remarks?.join(" · ") || <span className="text-slate-400/70">—</span>}
      </td>
      <td className="p-3 text-right text-sm font-semibold text-white">
        {row.priceText ?? (row.price != null ? `₹${row.price}` : "—")}
      </td>
      <td className="p-3 text-right text-sm">
        {diffPct == null || isLowest ? (
          isLowest ? <span className="text-emerald-300">—</span> : "—"
        ) : (
          <span className={diffPct >= 0 ? "text-rose-300" : "text-emerald-300"}>
            {diffPct >= 0 ? "+" : ""}
            {diffPct.toFixed(1)}%
          </span>
        )}
      </td>
      <td className="p-3 text-right">
        {badgeText ? <span className={badgeClass}>{badgeText}</span> : null}
      </td>
      <td className="p-3 text-right">
        {row.link ? (
          <a
            href={row.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold text-sky-300 transition hover:text-sky-200"
          >
            View →
          </a>
        ) : (
          <span className="text-sm text-slate-400/70">—</span>
        )}
      </td>
    </tr>
  );
}

export default function DisparityChecker() {
  // sensible defaults
  const today = useMemo(() => new Date(), []);
  const defaultIn = useMemo(() => formatDateISO(today), [today]);
  const defaultOut = useMemo(() => formatDateISO(addDays(today, 1)), [today]);

  // form state
  const [q, setQ] = useState("Muscatel Springburn");
  const [checkIn, setCheckIn] = useState(defaultIn);
  const [checkOut, setCheckOut] = useState(defaultOut);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [currency, setCurrency] = useState("INR");

  // results
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [hotel, setHotel] = useState(null); // full JSON
  const [rows, setRows] = useState([]);     // unified OTA rows
  const [stats, setStats] = useState(null); // disparity summary

  async function onSearch(e) {
    e?.preventDefault();
    setErr("");
    setLoading(true);
    setHotel(null);
    setRows([]);
    setStats(null);

    try {
      const params = new URLSearchParams({
        q,
        check_in_date: checkIn,
        check_out_date: checkOut,
        adults: String(adults),
        children: String(children),
        currency,
      });

      const res = await fetch(`/api/hotel?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        setErr(json?.error || "Failed to fetch");
        return;
      }

      // expect property details with `prices` and `featured_prices`
      const prices = Array.isArray(json?.prices) ? json.prices : [];
      const featured = Array.isArray(json?.featured_prices) ? json.featured_prices : [];

      // normalize into unified rows
      const toRow = (p) => ({
        source: p.source ?? p.platform ?? "Unknown",
        logo: p.logo ?? p.source_icon ?? null,
        link: p.link ?? null,
        remarks: p.remarks ?? null,
        price:
          typeof p?.rate_per_night?.extracted_lowest === "number"
            ? p.rate_per_night.extracted_lowest
            : typeof p?.total_rate?.extracted_lowest === "number"
            ? p.total_rate.extracted_lowest
            : typeof p?.extracted_price === "number"
            ? p.extracted_price
            : null,
        priceText:
          p?.rate_per_night?.lowest ??
          p?.total_rate?.lowest ??
          p?.price ??
          null,
      });

      // de-dup by source, prefer a concrete numeric price
      const map = new Map();
      [...prices.map(toRow), ...featured.map(toRow)].forEach((r) => {
        const key = r.source;
        if (!key) return;
        const existing = map.get(key);
        if (!existing) map.set(key, r);
        else {
          const choose =
            existing.price == null && r.price != null
              ? r
              : existing.price != null && r.price != null
              ? (r.price < existing.price ? r : existing) // keep lower
              : existing.price != null
              ? existing
              : r;
          map.set(key, choose);
        }
      });

      const list = [...map.values()].filter((r) => r.price != null);
      const lowest = list.reduce((acc, r) => (acc == null ? r.price : Math.min(acc, r.price)), null);
      const highest = list.reduce((acc, r) => (acc == null ? r.price : Math.max(acc, r.price)), null);
      const disparityPct = lowest != null && highest != null ? pctDiff(lowest, highest) : null;

      list.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));

      setHotel(json);
      setRows(list);
      setStats({
        count: list.length,
        lowest,
        highest,
        disparityPct,
      });
    } catch {
      setErr("Network error");
    } finally {
      setLoading(false);
    }
  }

  const labelClass = "text-xs font-semibold uppercase tracking-[0.2em] text-slate-200/70";
  const inputClasses =
    "rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-slate-100 placeholder-slate-300/70 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-400/60 backdrop-blur-sm";

  return (
    <div className="space-y-5">
      <form
        onSubmit={onSearch}
        className="rounded-3xl border border-white/10 bg-white/5 p-5 md:p-6 backdrop-blur-xl shadow-[0_16px_40px_rgba(15,23,42,0.35)] space-y-5"
      >
        <div className="flex flex-col gap-2 text-sm text-slate-200/80">
          <span className="text-xs uppercase tracking-[0.4em] text-slate-200/60">Disparity Audit</span>
          <p>
            Enter a single property and compare OTA positioning across your selected dates.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-2">
            <span className={labelClass}>Hotel name / query</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ramada Darjeeling Gandhi Road"
              className={inputClasses}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <span className={labelClass}>Check-in</span>
              <input
                type="date"
                value={checkIn}
                onChange={(e) => {
                  const value = e.target.value;
                  setCheckIn(value);
                  const parsed = parseDateISO(value);
                  if (parsed) {
                    setCheckOut(formatDateISO(addDays(parsed, 1)));
                  }
                }}
                className={inputClasses}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <span className={labelClass}>Check-out</span>
              <input
                type="date"
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
                className={inputClasses}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-2">
              <span className={labelClass}>Adults</span>
              <input
                type="number"
                min={1}
                value={adults}
                onChange={(e) => setAdults(Number(e.target.value))}
                className={inputClasses}
              />
            </div>
            <div className="flex flex-col gap-2">
              <span className={labelClass}>Children</span>
              <input
                type="number"
                min={0}
                value={children}
                onChange={(e) => setChildren(Number(e.target.value))}
                className={inputClasses}
              />
            </div>
            <div className="flex flex-col gap-2">
              <span className={labelClass}>Currency</span>
              <input
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className={inputClasses}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="submit"
            disabled={loading}
            className="rounded-2xl bg-gradient-to-r from-blue-500/80 to-cyan-500/80 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition hover:from-blue-400 hover:to-cyan-400 disabled:opacity-50 disabled:shadow-none"
          >
            {loading ? "Checking..." : "Check Disparity"}
          </button>
          {err && <span className="text-xs text-rose-300">{err}</span>}
        </div>
      </form>

      {/* summary */}
      {stats && (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl shadow-[0_12px_32px_rgba(15,23,42,0.3)]">
          <div className="flex flex-wrap items-center gap-6 text-sm text-slate-200/80">
            <div>
              <span className="text-slate-300/70">OTAs</span>{" "}
              <span className="text-slate-100 font-semibold">{stats.count}</span>
            </div>
            <div>
              <span className="text-slate-300/70">Lowest</span>{" "}
              <span className="text-emerald-300 font-semibold">
                {stats.lowest != null ? `₹${stats.lowest}` : "—"}
              </span>
            </div>
            <div>
              <span className="text-slate-300/70">Highest</span>{" "}
              <span className="text-rose-300 font-semibold">
                {stats.highest != null ? `₹${stats.highest}` : "—"}
              </span>
            </div>
            <div>
              <span className="text-slate-300/70">Spread</span>{" "}
              <span className="text-slate-100 font-semibold">
                {stats.disparityPct != null ? `${stats.disparityPct.toFixed(1)}%` : "—"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* table */}
      {rows.length > 0 && (
        <div className="overflow-auto rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-[0_12px_32px_rgba(15,23,42,0.3)]">
          <table className="min-w-full text-sm text-slate-100">
            <thead className="bg-white/5 text-slate-200/80">
              <tr>
                <th className="p-3 text-left font-medium">Channel</th>
                <th className="p-3 text-left font-medium">Remarks</th>
                <th className="p-3 text-right font-medium">Price</th>
                <th className="p-3 text-right font-medium">Δ vs Lowest</th>
                <th className="p-3 text-right font-medium">Flag</th>
                <th className="p-3 text-right font-medium">Link</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <PriceRow key={r.source} row={r} lowest={stats?.lowest ?? null} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* tiny note */}
      <p className="text-xs text-slate-400/80">
        Notes: We de-dupe channels and prefer rows with numeric prices. "Best / High" badges
        are based on % difference from the lowest price (≥3% = Slightly High, ≥8% = High).
      </p>
    </div>
  );
}
