"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, formatDateISO, parseDateISO } from "@/lib/date";

export default function CompSetEditor({ value, onChange }) {
  // each entry: { name, check_in_date, check_out_date, adults, children, currency }
  const today = useMemo(() => new Date(), []);
  const defaultIn = useMemo(() => formatDateISO(today), [today]);
  const defaultOut = useMemo(() => formatDateISO(addDays(today, 1)), [today]);

  const defaultRows = useMemo(
    () => [
      {
        name: "Your Hotel",
        check_in_date: defaultIn,
        check_out_date: defaultOut,
        adults: 2,
        children: 0,
        currency: "INR",
      },
      {
        name: "Competitor 1",
        check_in_date: defaultIn,
        check_out_date: defaultOut,
        adults: 2,
        children: 0,
        currency: "INR",
      },
    ],
    [defaultIn, defaultOut]
  );

  const initialRows = useMemo(() => {
    const base = Array.isArray(value) && value.length > 0 ? value : defaultRows;
    return base.map((row) => ({
      ...row,
      check_in_date: row.check_in_date || defaultIn,
      check_out_date: row.check_out_date || defaultOut,
      adults: row.adults != null ? row.adults : 2,
      children: row.children != null ? row.children : 0,
      currency: row.currency || "INR",
    }));
  }, [value, defaultRows, defaultIn, defaultOut]);

  const [rows, setRows] = useState(initialRows);

  useEffect(() => {
    onChange?.(rows);
  }, [rows, onChange]);

  function update(i, patch) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        name: "",
        check_in_date: defaultIn,
        check_out_date: defaultOut,
        adults: 2,
        children: 0,
        currency: "INR",
      },
    ]);
  }
  function remove(i) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  const inputClass =
    "w-full rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-slate-100 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-400/60 backdrop-blur-sm";

  return (
    <div className="space-y-5 rounded-3xl border border-white/10 bg-white/5 p-5 md:p-6 backdrop-blur-xl shadow-[0_16px_40px_rgba(15,23,42,0.35)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-xl font-semibold text-white">Comp Set</h3>
          <p className="text-xs text-slate-200/70">
            Keep your primary property first; additional rows become competitors in comparisons.
          </p>
        </div>
        <button
          onClick={addRow}
          type="button"
          className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-500/80 to-indigo-500/80 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition hover:from-blue-400 hover:to-indigo-400"
        >
          + Add Hotel
        </button>
      </div>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div
            key={i}
            className="grid grid-cols-1 gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-md md:grid-cols-6"
          >
            <input
              className={inputClass}
              placeholder="Hotel / Query"
              value={r.name}
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <input
              type="date"
              className={inputClass}
              value={r.check_in_date}
              onChange={(e) => {
                const value = e.target.value;
                const parsed = parseDateISO(value);
                const patch = { check_in_date: value };
                if (parsed) {
                  const next = formatDateISO(addDays(parsed, 1));
                  patch.check_out_date = next;
                }
                update(i, patch);
              }}
            />
            <input
              type="date"
              className={inputClass}
              value={r.check_out_date}
              onChange={(e) => update(i, { check_out_date: e.target.value })}
            />
            <input
              type="number"
              min={1}
              className={inputClass}
              value={r.adults}
              onChange={(e) => update(i, { adults: Number(e.target.value) })}
            />
            <input
              type="number"
              min={0}
              className={inputClass}
              value={r.children}
              onChange={(e) => update(i, { children: Number(e.target.value) })}
            />
            <div className="flex items-center gap-2">
              <input
                className={inputClass}
                value={r.currency}
                onChange={(e) => update(i, { currency: e.target.value })}
              />
              <button
                onClick={() => remove(i)}
                type="button"
                className="inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/10 px-2 py-2 text-sm text-slate-200/80 transition hover:border-rose-300/40 hover:bg-rose-500/20 hover:text-white"
                aria-label="Remove hotel"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-200/70">
        Tip: dates start at today/tomorrow for quick comps—adjust per property if needed.
      </p>
    </div>
  );
}
