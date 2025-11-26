"use client";

import { useState } from "react";

export default function WeeklyPricingTable({ hotel, roomTypes, weeklyPrices, pricingParams }) {
  const [copyStatus, setCopyStatus] = useState("");

  async function handleCopyTable() {
    try {
      const text = formatTableAsText();
      await navigator.clipboard.writeText(text);
      setCopyStatus("Copied!");
      setTimeout(() => setCopyStatus(""), 2000);
    } catch (err) {
      setCopyStatus("Failed to copy");
      setTimeout(() => setCopyStatus(""), 2000);
    }
  }

  function formatTableAsText() {
    let text = `WEEKLY PRICING RECOMMENDATIONS - ${hotel.hotelName}\n`;
    text += `Location: ${hotel.location}\n`;
    text += `Check-in Date: ${pricingParams.checkInDate}\n`;
    text += `Current Occupancy: ${pricingParams.currentOccupancy}%\n\n`;

    // Header
    text += `Room Category\tMeal Plan\tOccupancy\tMonday\tTuesday\tWednesday\tThursday\tFriday\tSaturday\tSunday\n`;

    // Rows
    roomTypes.forEach((room, index) => {
      const prices = weeklyPrices[index];
      text += `${room.room_type_name}\t`;
      text += `EP\t`; // Default meal plan
      text += `Single\t`; // Default occupancy
      text += `${prices.Monday.toFixed(2)}\t`;
      text += `${prices.Tuesday.toFixed(2)}\t`;
      text += `${prices.Wednesday.toFixed(2)}\t`;
      text += `${prices.Thursday.toFixed(2)}\t`;
      text += `${prices.Friday.toFixed(2)}\t`;
      text += `${prices.Saturday.toFixed(2)}\t`;
      text += `${prices.Sunday.toFixed(2)}\n`;
    });

    return text;
  }

  return (
    <div className="space-y-4">
      {/* Header with copy button */}
      <div className="flex items-center justify-between">
        <h4 className="text-lg font-semibold text-white">Weekly Pricing Table</h4>
        <button
          onClick={handleCopyTable}
          className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm font-medium transition-all flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          {copyStatus || "Copy Table"}
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-300">
                Room Category
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-300">
                Meal Plan
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-300">
                Occupancy
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-300">
                Monday
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-300">
                Tuesday
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-300">
                Wednesday
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-300">
                Thursday
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-300">
                Friday
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-300">
                Saturday
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-300">
                Sunday
              </th>
            </tr>
          </thead>
          <tbody>
            {roomTypes.map((room, index) => {
              const prices = weeklyPrices[index];
              return (
                <tr key={room.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3 text-white font-medium">{room.room_type_name}</td>
                  <td className="px-4 py-3 text-slate-300">EP</td>
                  <td className="px-4 py-3 text-slate-300">Single</td>
                  <td className="px-4 py-3 text-right text-white font-mono">{prices.Monday.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-white font-mono">{prices.Tuesday.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-white font-mono">{prices.Wednesday.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-white font-mono">{prices.Thursday.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-white font-mono">{prices.Friday.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-white font-mono">{prices.Saturday.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-white font-mono">{prices.Sunday.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="text-xs text-slate-400">
        <p>* EP = European Plan (Room Only)</p>
        <p>* Prices shown are AI-recommended rates based on current occupancy, seasonality, and market conditions</p>
      </div>
    </div>
  );
}
