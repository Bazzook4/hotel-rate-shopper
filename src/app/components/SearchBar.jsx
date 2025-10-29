"use client";

import { useMemo, useState } from "react";
import { addDays, formatDateISO, parseDateISO } from "@/lib/date";

export default function SearchBar({ onResult, defaultHotelName }) {
  const today = useMemo(() => new Date(), []);
  const defaultIn = useMemo(() => formatDateISO(today), [today]);
  const defaultOut = useMemo(() => formatDateISO(addDays(today, 1)), [today]);

  const [q, setQ] = useState(defaultHotelName || "Your Hotel");
  const [checkIn, setCheckIn] = useState(defaultIn);
  const [checkOut, setCheckOut] = useState(defaultOut);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [currency, setCurrency] = useState("INR");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function onSearch(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const requestParams = {
        q,
        check_in_date: checkIn,
        check_out_date: checkOut,
        adults: String(adults),
        children: String(children),
        currency,
      };

      const params = new URLSearchParams(requestParams);

      const res = await fetch(`/api/hotel?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        setErr(json?.error || "Failed to fetch");
      } else {
        onResult?.(json, { query: q, params: requestParams });
      }
    } catch {
      setErr("Network error");
    } finally {
      setLoading(false);
    }
  }

  const controlLabel = "text-xs font-semibold uppercase tracking-[0.2em] text-slate-200/70";
  const inputClasses =
    "rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-slate-100 placeholder-slate-300/70 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-400/60 backdrop-blur-sm";

  return (
    <form
      onSubmit={onSearch}
      className="rounded-3xl border border-white/10 bg-white/5 p-5 md:p-6 backdrop-blur-xl shadow-[0_16px_40px_rgba(15,23,42,0.35)] space-y-5"
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="flex flex-col gap-2">
          <span className={controlLabel}>Hotel / Query</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Your Hotel"
            className={inputClasses}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <span className={controlLabel}>Check-in</span>
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
            <span className={controlLabel}>Check-out</span>
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
            <span className={controlLabel}>Adults</span>
            <input
              type="number"
              min={1}
              value={adults}
              onChange={(e) => setAdults(Number(e.target.value))}
              className={inputClasses}
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className={controlLabel}>Children</span>
            <input
              type="number"
              min={0}
              value={children}
              onChange={(e) => setChildren(Number(e.target.value))}
              className={inputClasses}
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className={controlLabel}>Currency</span>
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
          className="rounded-2xl bg-gradient-to-r from-blue-500/80 to-indigo-500/80 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition hover:from-blue-400 hover:to-indigo-400 disabled:opacity-50 disabled:shadow-none"
        >
          {loading ? "Searching..." : "Run Search"}
        </button>
        {err && <span className="text-xs text-rose-300">{err}</span>}
      </div>
    </form>
  );
}
