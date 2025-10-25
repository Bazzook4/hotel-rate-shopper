"use client";

import { useState, useEffect } from "react";

export default function PricingConfiguration({ hotel, pricingParams, onParamsChange, onCalculate, onEditSetup, loading }) {
  const [factors, setFactors] = useState({
    // Occupancy multipliers
    occupancyLow: 0.9,
    occupancyMedium: 1.0,
    occupancyHigh: 1.2,

    // Seasonality
    peakSeasonStart: "",
    peakSeasonEnd: "",
    peakSeasonMultiplier: 1.3,
    offPeakMultiplier: 0.95,

    // Day of week
    mondayMultiplier: 0.85,
    tuesdayMultiplier: 0.85,
    wednesdayMultiplier: 0.9,
    thursdayMultiplier: 0.95,
    fridayMultiplier: 1.1,
    saturdayMultiplier: 1.15,
    sundayMultiplier: 1.0,

    // Lead time
    leadTime0to3Days: 1.2,
    leadTime4to7Days: 1.1,
    leadTime8to14Days: 1.0,
    leadTime15to30Days: 0.95,
    leadTime31PlusDays: 0.9,

    // Length of stay
    lengthOfStay1Night: 1.0,
    lengthOfStay2to3Nights: 0.98,
    lengthOfStay4to6Nights: 0.95,
    lengthOfStay7PlusNights: 0.9,

    // Competitor pricing
    competitorPricingWeight: 0.3,
  });

  const [saveStatus, setSaveStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (hotel) {
      loadPricingFactors();
    }
  }, [hotel]);

  async function loadPricingFactors() {
    try {
      const res = await fetch(`/api/dynamicPricing/pricingFactors?hotelId=${hotel.hotelId}`);
      const data = await res.json();

      if (res.ok && data.factors) {
        setFactors({ ...factors, ...data.factors });
      }
    } catch (err) {
      console.error("Error loading pricing factors:", err);
    }
  }

  async function handleSaveFactors() {
    try {
      setSaveStatus("saving");
      setError("");

      const res = await fetch("/api/dynamicPricing/pricingFactors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hotelId: hotel.hotelId,
          ...factors,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus(""), 2000);
      } else {
        setError(data.error || "Failed to save pricing factors");
        setSaveStatus("");
      }
    } catch (err) {
      setError("Network error");
      setSaveStatus("");
    }
  }

  function handleFactorChange(key, value) {
    setFactors({ ...factors, [key]: parseFloat(value) || 0 });
  }

  const controlLabel = "text-xs font-semibold uppercase tracking-[0.2em] text-slate-200/70 mb-2";
  const inputClass = "w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/50 focus:bg-white/10 transition-all";
  const sectionClass = "rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 p-6";

  return (
    <div className="space-y-6">
      {/* Hotel Info */}
      <div className={sectionClass}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-xl font-bold text-white mb-2">{hotel.hotelName}</h3>
            <p className="text-slate-400">{hotel.location}</p>
          </div>
          {onEditSetup && (
            <button
              onClick={onEditSetup}
              className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white text-sm font-medium transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit Property Setup
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-4">
          <p className="text-rose-400 text-sm">{error}</p>
        </div>
      )}

      {/* Pricing Parameters */}
      <div className={sectionClass}>
        <h4 className="text-lg font-semibold text-white mb-6">Pricing Parameters</h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className={controlLabel}>Check-in Date</label>
            <input
              type="date"
              value={pricingParams.checkInDate}
              onChange={(e) => onParamsChange({ ...pricingParams, checkInDate: e.target.value })}
              className={inputClass}
            />
          </div>

          <div>
            <label className={controlLabel}>Check-out Date</label>
            <input
              type="date"
              value={pricingParams.checkOutDate}
              onChange={(e) => onParamsChange({ ...pricingParams, checkOutDate: e.target.value })}
              className={inputClass}
            />
          </div>

          <div>
            <label className={controlLabel}>Current Occupancy (%)</label>
            <input
              type="number"
              min="0"
              max="100"
              value={pricingParams.currentOccupancy}
              onChange={(e) => onParamsChange({ ...pricingParams, currentOccupancy: parseInt(e.target.value) || 0 })}
              className={inputClass}
            />
            <div className="mt-2 h-2 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-500 to-indigo-500 transition-all"
                style={{ width: `${pricingParams.currentOccupancy}%` }}
              />
            </div>
          </div>

          <div className="flex items-center">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={pricingParams.includeCompetitors}
                onChange={(e) => onParamsChange({ ...pricingParams, includeCompetitors: e.target.checked })}
                className="w-5 h-5 rounded bg-white/10 border-white/20 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-white text-sm font-medium">Include Competitor Pricing</span>
            </label>
          </div>
        </div>
      </div>

      {/* Occupancy Factors */}
      <div className={sectionClass}>
        <h4 className="text-lg font-semibold text-white mb-4">Occupancy Multipliers</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={controlLabel}>Low (0-30%)</label>
            <input
              type="number"
              step="0.01"
              value={factors.occupancyLow}
              onChange={(e) => handleFactorChange("occupancyLow", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={controlLabel}>Medium (31-70%)</label>
            <input
              type="number"
              step="0.01"
              value={factors.occupancyMedium}
              onChange={(e) => handleFactorChange("occupancyMedium", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={controlLabel}>High (71-100%)</label>
            <input
              type="number"
              step="0.01"
              value={factors.occupancyHigh}
              onChange={(e) => handleFactorChange("occupancyHigh", e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* Seasonality */}
      <div className={sectionClass}>
        <h4 className="text-lg font-semibold text-white mb-4">Seasonality</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={controlLabel}>Peak Season Start</label>
            <input
              type="date"
              value={factors.peakSeasonStart || ""}
              onChange={(e) => setFactors({ ...factors, peakSeasonStart: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={controlLabel}>Peak Season End</label>
            <input
              type="date"
              value={factors.peakSeasonEnd || ""}
              onChange={(e) => setFactors({ ...factors, peakSeasonEnd: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={controlLabel}>Peak Season Multiplier</label>
            <input
              type="number"
              step="0.01"
              value={factors.peakSeasonMultiplier}
              onChange={(e) => handleFactorChange("peakSeasonMultiplier", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={controlLabel}>Off-Peak Multiplier</label>
            <input
              type="number"
              step="0.01"
              value={factors.offPeakMultiplier}
              onChange={(e) => handleFactorChange("offPeakMultiplier", e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* Day of Week */}
      <div className={sectionClass}>
        <h4 className="text-lg font-semibold text-white mb-4">Day of Week Multipliers</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          {["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => (
            <div key={day}>
              <label className={controlLabel}>{day.charAt(0).toUpperCase() + day.slice(1)}</label>
              <input
                type="number"
                step="0.01"
                value={factors[`${day}Multiplier`]}
                onChange={(e) => handleFactorChange(`${day}Multiplier`, e.target.value)}
                className={inputClass}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Lead Time */}
      <div className={sectionClass}>
        <h4 className="text-lg font-semibold text-white mb-4">Lead Time Multipliers</h4>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <label className={controlLabel}>0-3 Days</label>
            <input
              type="number"
              step="0.01"
              value={factors.leadTime0to3Days}
              onChange={(e) => handleFactorChange("leadTime0to3Days", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={controlLabel}>4-7 Days</label>
            <input
              type="number"
              step="0.01"
              value={factors.leadTime4to7Days}
              onChange={(e) => handleFactorChange("leadTime4to7Days", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={controlLabel}>8-14 Days</label>
            <input
              type="number"
              step="0.01"
              value={factors.leadTime8to14Days}
              onChange={(e) => handleFactorChange("leadTime8to14Days", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={controlLabel}>15-30 Days</label>
            <input
              type="number"
              step="0.01"
              value={factors.leadTime15to30Days}
              onChange={(e) => handleFactorChange("leadTime15to30Days", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={controlLabel}>31+ Days</label>
            <input
              type="number"
              step="0.01"
              value={factors.leadTime31PlusDays}
              onChange={(e) => handleFactorChange("leadTime31PlusDays", e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* Length of Stay */}
      <div className={sectionClass}>
        <h4 className="text-lg font-semibold text-white mb-4">Length of Stay Multipliers</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className={controlLabel}>1 Night</label>
            <input
              type="number"
              step="0.01"
              value={factors.lengthOfStay1Night}
              onChange={(e) => handleFactorChange("lengthOfStay1Night", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={controlLabel}>2-3 Nights</label>
            <input
              type="number"
              step="0.01"
              value={factors.lengthOfStay2to3Nights}
              onChange={(e) => handleFactorChange("lengthOfStay2to3Nights", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={controlLabel}>4-6 Nights</label>
            <input
              type="number"
              step="0.01"
              value={factors.lengthOfStay4to6Nights}
              onChange={(e) => handleFactorChange("lengthOfStay4to6Nights", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={controlLabel}>7+ Nights</label>
            <input
              type="number"
              step="0.01"
              value={factors.lengthOfStay7PlusNights}
              onChange={(e) => handleFactorChange("lengthOfStay7PlusNights", e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* Competitor Pricing */}
      <div className={sectionClass}>
        <h4 className="text-lg font-semibold text-white mb-4">Competitor Pricing</h4>
        <div>
          <label className={controlLabel}>Competitor Pricing Weight (0-1)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            max="1"
            value={factors.competitorPricingWeight}
            onChange={(e) => handleFactorChange("competitorPricingWeight", e.target.value)}
            className={inputClass}
          />
          <p className="text-xs text-slate-400 mt-2">
            Higher values give more weight to competitor prices. 0 = ignore competitors, 1 = maximum influence
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-4">
        <button
          onClick={handleSaveFactors}
          disabled={saveStatus === "saving"}
          className="flex-1 px-6 py-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold disabled:opacity-50 transition-all"
        >
          {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved!" : "Save Configuration"}
        </button>

        <button
          onClick={onCalculate}
          disabled={loading}
          className="flex-1 px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-semibold disabled:opacity-50 transition-all"
        >
          {loading ? "Calculating..." : "Calculate Pricing"}
        </button>
      </div>
    </div>
  );
}
