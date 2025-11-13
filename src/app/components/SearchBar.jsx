"use client";

import { useMemo, useState } from "react";
import { addDays, formatDateISO, parseDateISO } from "@/lib/date";

export default function SearchBar({ onResult, defaultHotelName }) {
  const today = useMemo(() => new Date(), []);
  const defaultIn = useMemo(() => formatDateISO(today), [today]);
  const defaultOut = useMemo(() => formatDateISO(addDays(today, 1)), [today]);

  // Lock the hotel name to user's property - use defaultHotelName and make it read-only
  const q = defaultHotelName || "Your Hotel";
  const [checkIn, setCheckIn] = useState(defaultIn);
  const [checkOut, setCheckOut] = useState(defaultOut);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [currency, setCurrency] = useState("INR");
  const [loading, setLoading] = useState(false);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
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

  async function onWeeklySearch(e) {
    e.preventDefault();
    setErr("");
    setWeeklyLoading(true);

    try {
      const checkInDate = parseDateISO(checkIn);
      if (!checkInDate) {
        setErr("Invalid check-in date");
        return;
      }

      let successCount = 0;
      let failCount = 0;

      // Search for 7 consecutive days
      for (let i = 0; i < 7; i++) {
        const currentCheckIn = addDays(checkInDate, i);
        const currentCheckOut = addDays(currentCheckIn, 1);

        const requestParams = {
          q,
          check_in_date: formatDateISO(currentCheckIn),
          check_out_date: formatDateISO(currentCheckOut),
          adults: String(adults),
          children: String(children),
          currency,
        };

        try {
          const params = new URLSearchParams(requestParams);
          const res = await fetch(`/api/hotel?${params.toString()}`);
          const json = await res.json();

          if (res.ok) {
            // Save to history
            await fetch("/api/searchHistory", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                query: q,
                params: requestParams,
                payload: json,
              }),
            });
            successCount++;

            // Update UI with the last successful search
            if (i === 6) {
              onResult?.(json, { query: q, params: requestParams });
            }
          } else {
            failCount++;
          }
        } catch (error) {
          console.error(`Failed to search for day ${i + 1}:`, error);
          failCount++;
        }
      }

      if (successCount > 0) {
        setErr(`✓ Saved ${successCount} day${successCount > 1 ? 's' : ''} of rates${failCount > 0 ? ` (${failCount} failed)` : ''}`);
      } else {
        setErr("Failed to save any rates. Please try again.");
      }
    } catch (error) {
      setErr("Weekly search failed");
      console.error("Weekly search error:", error);
    } finally {
      setWeeklyLoading(false);
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
          <span className={controlLabel}>Your Property</span>
          <input
            value={q}
            readOnly
            placeholder="Your Hotel"
            className={`${inputClasses} cursor-not-allowed bg-white/5`}
            title="This is your property. Contact support to change."
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
          disabled={loading || weeklyLoading}
          className="rounded-2xl bg-gradient-to-r from-blue-500/80 to-indigo-500/80 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition hover:from-blue-400 hover:to-indigo-400 disabled:opacity-50 disabled:shadow-none"
        >
          {loading ? "Tracking Rates..." : "Track My Rates"}
        </button>
        <button
          type="button"
          onClick={onWeeklySearch}
          disabled={loading || weeklyLoading}
          className="rounded-2xl bg-gradient-to-r from-purple-500/80 to-pink-500/80 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 transition hover:from-purple-400 hover:to-pink-400 disabled:opacity-50 disabled:shadow-none"
        >
          {weeklyLoading ? "Tracking Week..." : "Track Weekly Rates"}
        </button>
        {err && <span className={`text-xs ${err.includes('✓') ? 'text-green-300' : 'text-rose-300'}`}>{err}</span>}
      </div>
    </form>
  );
}
