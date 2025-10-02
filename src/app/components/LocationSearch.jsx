"use client";

import { useMemo, useState } from "react";
import { addDays, formatDateISO, parseDateISO } from "@/lib/date";

export default function LocationSearch({ onResult }) {
  const today = useMemo(() => new Date(), []);
  const defaultIn = useMemo(() => formatDateISO(today), [today]);
  const defaultOut = useMemo(() => formatDateISO(addDays(today, 1)), [today]);

  // ── form state ────────────────────────────────────────────────────────────────
  const [location, setLocation] = useState("Darjeeling");
  const [checkIn, setCheckIn] = useState(defaultIn);
  const [checkOut, setCheckOut] = useState(defaultOut);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [currency, setCurrency] = useState("INR");
  const [minStars, setMinStars] = useState(0); // 0 = Any
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function onSearch(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const params = new URLSearchParams({
        q: location,
        check_in_date: checkIn,
        check_out_date: checkOut,
        adults: String(adults),
        children: String(children),
        currency,
      });

      // hit the location endpoint (we called it /api/hotels)
      const res = await fetch(`/api/hotel?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        setErr(json?.error || "Failed to fetch");
      } else {
        // hand back both the data and the chosen filter
        onResult?.({ data: json, minStars });
      }
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
    <form
      onSubmit={onSearch}
      className="rounded-3xl border border-white/10 bg-white/5 p-5 md:p-6 backdrop-blur-xl shadow-[0_16px_40px_rgba(15,23,42,0.35)] space-y-5"
    >
      <div className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-[0.4em] text-slate-200/60">Location Explorer</span>
        <p className="text-sm text-slate-200/80">
          Search by city or area, then refine by star rating to surface standout deals.
        </p>
      </div>

      {/* Row 1 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="flex flex-col gap-2 md:col-span-2">
          <span className={labelClass}>Location (city/area)</span>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Darjeeling"
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
      </div>

      {/* Row 2 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="grid grid-cols-4 gap-3 md:col-span-2">
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
          <div className="flex flex-col gap-2">
            <span className={labelClass}>Min stars</span>
            <select
              value={minStars}
              onChange={(e) => setMinStars(Number(e.target.value))}
              className={`${inputClasses} appearance-none pr-8`}
            >
              <option value={0}>Any</option>
              <option value={1}>1★+</option>
              <option value={2}>2★+</option>
              <option value={3}>3★+</option>
              <option value={4}>4★+</option>
              <option value={5}>5★</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={loading}
          className="rounded-2xl bg-gradient-to-r from-emerald-400/80 to-teal-500/80 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:from-emerald-400 hover:to-teal-400 disabled:opacity-50 disabled:shadow-none"
        >
          {loading ? "Searching..." : "Search by Location"}
        </button>
        {err && <span className="text-xs text-rose-300">{err}</span>}
      </div>
    </form>
  );
}
