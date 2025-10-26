"use client";

import { useState, useEffect, useMemo } from "react";
import { formatDateISO, addDays } from "@/lib/date";
import PropertySetup from "./PropertySetup";
import PricingRecommendations from "./PricingRecommendations";

export default function DynamicPricing() {
  const [step, setStep] = useState("setup"); // setup, results
  const [roomTypes, setRoomTypes] = useState([]);
  const [ratePlans, setRatePlans] = useState([]);
  const [hotel, setHotel] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [comparisons, setComparisons] = useState([]);

  const today = useMemo(() => new Date(), []);
  const defaultCheckIn = useMemo(() => formatDateISO(addDays(today, 7)), [today]);
  const defaultCheckOut = useMemo(() => formatDateISO(addDays(today, 8)), [today]);

  const [pricingParams, setPricingParams] = useState({
    checkInDate: defaultCheckIn,
    checkOutDate: defaultCheckOut,
    currentOccupancy: 60,
    demandMultiplier: 1.0,
    competitorAdjustment: 0,
    seasonalMultiplier: 1.0,
    weekdayMultipliers: {
      Monday: 1.0,
      Tuesday: 1.0,
      Wednesday: 1.0,
      Thursday: 1.0,
      Friday: 1.0,
      Saturday: 1.2,
      Sunday: 1.2,
    },
  });

  const [pricingResults, setPricingResults] = useState(null);

  useEffect(() => {
    loadHotel();
  }, []);

  async function loadHotel() {
    try {
      setLoading(true);
      const res = await fetch("/api/dynamicPricing/hotels");
      const data = await res.json();
      if (res.ok && data.hotels?.length > 0) {
        const firstHotel = data.hotels[0];
        setHotel(firstHotel);
        loadRoomTypesAndRatePlans(firstHotel.hotelId);
      }
    } catch (err) {
      setError("Network error loading hotel");
    } finally {
      setLoading(false);
    }
  }

  function handleHotelCreated(newHotel) {
    setHotel(newHotel);
    // Load room types and rate plans for the new hotel
    if (newHotel?.hotelId) {
      loadRoomTypesAndRatePlans(newHotel.hotelId);
    }
  }

  async function loadRoomTypesAndRatePlans(hotelId) {
    try {
      const [roomTypesRes, ratePlansRes] = await Promise.all([
        fetch(`/api/dynamicPricing/roomTypes?hotelId=${hotelId}`),
        fetch(`/api/dynamicPricing/ratePlans?hotelId=${hotelId}`)
      ]);

      if (roomTypesRes.ok) {
        const roomTypesData = await roomTypesRes.json();
        setRoomTypes(roomTypesData.roomTypes || []);
      }

      if (ratePlansRes.ok) {
        const ratePlansData = await ratePlansRes.json();
        setRatePlans(ratePlansData.ratePlans || []);
      }
    } catch (err) {
      console.error("Error loading room types and rate plans:", err);
    }
  }

  function handleBackToSetup() {
    setStep("setup");
    setPricingResults(null);
  }

  async function calculatePricing() {
    if (!hotel) return;

    try {
      setLoading(true);
      setError("");

      const res = await fetch("/api/dynamicPricing/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hotelId: hotel.hotelId,
          ...pricingParams,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setPricingResults(data);
        setStep("results");
      } else {
        setError(data.error || "Failed to calculate pricing");
      }
    } catch (err) {
      setError("Network error calculating pricing");
    } finally {
      setLoading(false);
    }
  }

  function handleSaveComparison() {
    if (pricingResults) {
      setComparisons([...comparisons, {
        id: Date.now(),
        params: { ...pricingParams },
        results: { ...pricingResults },
        timestamp: new Date().toISOString(),
      }]);
    }
  }

  function handleRemoveComparison(id) {
    setComparisons(comparisons.filter(c => c.id !== id));
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">
            Dynamic Pricing Engine
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Configure your hotel and calculate optimal pricing with real-time factors
          </p>
        </div>

        {step === "results" && (
          <button
            onClick={handleBackToSetup}
            className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm font-medium transition-colors"
          >
            Back to Setup
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-4">
          <p className="text-rose-400 text-sm">{error}</p>
        </div>
      )}

      {/* Step Navigation */}
      <div className="flex items-center gap-2 p-4 rounded-xl bg-white/5 border border-white/10">
        <div className={`flex-1 text-center py-2 rounded-lg text-sm font-medium transition-colors ${
          step === "setup" ? "bg-indigo-500/20 text-indigo-300" : "text-slate-400"
        }`}>
          1. Hotel Setup
        </div>
        <div className={`flex-1 text-center py-2 rounded-lg text-sm font-medium transition-colors ${
          step === "results" ? "bg-indigo-500/20 text-indigo-300" : "text-slate-400"
        }`}>
          2. Calculate & Compare
        </div>
      </div>

      {/* Content based on step */}
      {step === "setup" && (
        <PropertySetup
          hotel={hotel}
          roomTypes={roomTypes}
          ratePlans={ratePlans}
          onRoomTypesChange={setRoomTypes}
          onRatePlansChange={setRatePlans}
          onHotelCreated={handleHotelCreated}
          onCalculate={calculatePricing}
          loading={loading}
        />
      )}

      {step === "results" && pricingResults && (
        <PricingRecommendations
          data={pricingResults}
          pricingParams={pricingParams}
          onParamsChange={setPricingParams}
          onRecalculate={calculatePricing}
          comparisons={comparisons}
          onSaveComparison={handleSaveComparison}
          onRemoveComparison={handleRemoveComparison}
          loading={loading}
        />
      )}
    </div>
  );
}
