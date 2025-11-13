"use client";

import { useState } from "react";

function SavedSearchRow({ entry, onRefresh, onDelete, isRefreshing, isDeleting }) {
  const [expanded, setExpanded] = useState(false);

  if (!entry?.payload) {
    return (
      <tr>
        <td colSpan="7" className="px-4 py-3 text-center text-sm text-slate-300/70">
          No data available for this search.
        </td>
      </tr>
    );
  }

  const data = entry.payload;
  const params = entry.params || {};

  // Format search date
  const searchDate = entry.snapshotDate
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(entry.snapshotDate))
    : "Unknown";

  // Format check-in/out dates
  const checkInDate = params.check_in_date
    ? new Date(params.check_in_date).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "";

  const checkOutDate = params.check_out_date
    ? new Date(params.check_out_date).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "";

  // Calculate nights
  let nights = 0;
  if (params.check_in_date && params.check_out_date) {
    const checkIn = new Date(params.check_in_date);
    const checkOut = new Date(params.check_out_date);
    nights = Math.round((checkOut - checkIn) / (1000 * 60 * 60 * 24));
  }

  // Format guests
  const guestInfo = `${params.adults || "2"}A${
    params.children && params.children !== "0" ? `, ${params.children}C` : ""
  }`;

  // Extract and sort all OTA prices
  const allPrices = [];

  // Add sponsored prices
  (data.featured_prices || []).forEach((p) => {
    if (p?.rate_per_night?.extracted_lowest) {
      allPrices.push({
        source: p.source,
        price: p.rate_per_night.extracted_lowest,
        display: p.rate_per_night.lowest,
        link: p.link,
        logo: p.logo,
        isSponsored: true,
      });
    }
  });

  // Add organic prices
  (data.prices || []).forEach((p) => {
    if (p?.rate_per_night?.extracted_lowest) {
      allPrices.push({
        source: p.source,
        price: p.rate_per_night.extracted_lowest,
        display: p.rate_per_night.lowest,
        link: p.link,
        logo: p.logo,
        isSponsored: false,
      });
    }
  });

  // Sort by price (lowest first)
  allPrices.sort((a, b) => a.price - b.price);

  const displayCount = 4;
  const visiblePrices = expanded ? allPrices : allPrices.slice(0, displayCount);
  const hiddenCount = allPrices.length - displayCount;

  return (
    <>
      <tr className="border-b border-white/10 transition hover:bg-white/5">
        {/* Search Date/Time */}
        <td className="px-4 py-3 text-sm text-slate-200">
          <div className="font-medium">{searchDate}</div>
        </td>

        {/* Hotel Name */}
        <td className="px-4 py-3 text-sm">
          <div className="font-medium text-white">{entry.query || data.name || "Unknown"}</div>
          {data.overall_rating && (
            <div className="mt-0.5 text-xs text-slate-300/70">
              ⭐ {data.overall_rating} ({data.reviews || 0})
            </div>
          )}
        </td>

        {/* Check-in */}
        <td className="px-4 py-3 text-sm text-slate-200">
          <div>{checkInDate}</div>
          {nights > 0 && <div className="text-xs text-slate-300/70">({nights}n)</div>}
        </td>

        {/* Check-out */}
        <td className="px-4 py-3 text-sm text-slate-200">{checkOutDate}</td>

        {/* Guests */}
        <td className="px-4 py-3 text-sm text-slate-200">
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs">
            {guestInfo}
          </span>
        </td>

        {/* OTA Prices */}
        <td className="px-4 py-3 text-sm">
          {allPrices.length > 0 ? (
            <div className="space-y-1.5">
              {visiblePrices.map((p, idx) => (
                <div key={idx} className="flex items-center justify-between gap-2">
                  <a
                    href={p.link}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-slate-200 transition hover:text-white"
                  >
                    {p.logo && (
                      <img src={p.logo} alt={p.source} className="h-4 w-4 rounded" />
                    )}
                    <span className="text-xs">{p.source}:</span>
                  </a>
                  <span
                    className={`font-semibold ${
                      idx === 0
                        ? "text-green-300"
                        : p.isSponsored
                        ? "text-amber-200"
                        : "text-slate-100"
                    }`}
                  >
                    {p.display}
                  </span>
                </div>
              ))}
              {hiddenCount > 0 && (
                <button
                  type="button"
                  onClick={() => setExpanded(!expanded)}
                  className="text-xs text-blue-300 transition hover:text-blue-200"
                >
                  {expanded ? "▲ Show less" : `▼ +${hiddenCount} more OTAs`}
                </button>
              )}
            </div>
          ) : (
            <span className="text-xs text-slate-300/70">No prices</span>
          )}
        </td>

        {/* Actions */}
        <td className="px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onRefresh(entry)}
              disabled={isRefreshing}
              className="rounded-lg border border-blue-400/40 px-3 py-1 text-xs text-blue-200 transition hover:border-blue-300 hover:bg-blue-400/10 disabled:opacity-50"
              title="Refresh prices"
            >
              {isRefreshing ? "⏳" : "🔄"}
            </button>
            <button
              type="button"
              onClick={() => onDelete(entry)}
              disabled={isDeleting}
              className="rounded-lg border border-rose-400/40 px-3 py-1 text-xs text-rose-200 transition hover:border-rose-300 hover:bg-rose-400/10 disabled:opacity-50"
              title="Delete search"
            >
              {isDeleting ? "⏳" : "🗑️"}
            </button>
          </div>
        </td>
      </tr>
    </>
  );
}

export default function SavedSearchTable({ history, onRefresh, onDelete, refreshingId, deletingId }) {
  if (!history || history.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-slate-200/70">
        No rate history yet. Track your property rates to get started.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl">
      <table className="w-full">
        <thead>
          <tr className="border-b border-white/15 bg-white/5">
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-200/70">
              Tracked On
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-200/70">
              Property
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-200/70">
              Check-in
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-200/70">
              Check-out
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-200/70">
              Guests
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-200/70">
              OTA Prices
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-200/70">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {history.map((entry) => {
            const isRefreshing = refreshingId === entry.id;
            const isDeleting = deletingId === entry.id;
            return (
              <SavedSearchRow
                key={entry.id}
                entry={entry}
                onRefresh={onRefresh}
                onDelete={onDelete}
                isRefreshing={isRefreshing}
                isDeleting={isDeleting}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
