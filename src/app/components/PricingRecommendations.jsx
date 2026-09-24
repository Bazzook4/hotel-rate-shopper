"use client";

import { useState, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip, Legend, ResponsiveContainer } from 'recharts';
import Tooltip from './Tooltip';

export default function PricingRecommendations({
  data,
  pricingParams,
  onParamsChange,
  onRecalculate,
  comparisons,
  onSaveComparison,
  onRemoveComparison,
  loading
}) {
  const [viewMode, setViewMode] = useState("pricing"); // "pricing" or "comparison"const [pricingMode, setPricingMode] = useState("simple"); // "simple" or "advanced"const [dynamicExtraRates, setDynamicExtraRates] = useState(false); // Default: OFF - Extra rates stay fixed
  const [copyStatus, setCopyStatus] = useState({});
  const [roomNameDisplay, setRoomNameDisplay] = useState("abbreviation"); // "full" or "abbreviation"const { hotel, roomTypes, recommendations, metrics, ratePlans } = data;

  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  // Get all meal plans (rate plans) and sort them in the correct order
  const mealPlanOrder = ['EP', 'CP', 'MAP', 'AP'];
  const mealPlans = (ratePlans || [
    { plan_name: 'EP', multiplier: 1.0 },
    { plan_name: 'CP', multiplier: 1.1 },
    { plan_name: 'MAP', multiplier: 1.25 },
  ]).sort((a, b) => {
    const indexA = mealPlanOrder.indexOf(a.plan_name);
    const indexB = mealPlanOrder.indexOf(b.plan_name);
    // If not found in the order array, put at the end
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });

  // Calculate prices for the table
  const calculateTablePrices = useMemo(() => {
    if (!roomTypes || !recommendations) return [];

    const tableData = [];

    // Sort room types by rank first
    const sortedRoomTypes = [...roomTypes].sort((a, b) => {
      const rankA = a.rank || 999;
      const rankB = b.rank || 999;
      return rankA - rankB;
    });

    sortedRoomTypes.forEach((room, roomIndex) => {
      // Find the original index in the recommendations array
      const originalIndex = roomTypes.findIndex(r => r.id === room.id);
      const rec = recommendations[originalIndex];
      const baseRecommended = rec.recommendedPrice;

      // Parse occupancy pricing if it's a JSON string
      let occupancyPricing = room.occupancy_pricing;
      if (typeof occupancyPricing === 'string') {
        try {
          occupancyPricing = JSON.parse(occupancyPricing);
        } catch (e) {
          console.error('Failed to parse occupancy_pricing for room:', room.room_type_name, e);
          occupancyPricing = null;
        }
      }

      // Get occupancy pricing if available
      let occupancyTypes = [];

      // Determine the maximum number of adults to show
      const max_adultsValue = room.max_adults || 0;
      const hasOccupancyPricing = occupancyPricing?.adultPricing && Object.keys(occupancyPricing.adultPricing).length > 0;

      // For EP: all occupancies should use the same base rate
      // For CP/MAP/AP: meal costs will be added later based on number of adults
      // Base rate = highest configured occupancy price (e.g., if you configure up to 4 adults, use that as base)

      if (hasOccupancyPricing) {
        // Use configured occupancy pricing, but extend to max_adults if needed
        const configuredAdults = Object.keys(occupancyPricing.adultPricing).map(Number).sort((a, b) => a - b);
        const maxConfigured = configuredAdults.length > 0 ? Math.max(...configuredAdults) : 0;

        // Determine how many adult occupancies to show (use the larger of max_adults or configured)
        const maxToShow = Math.max(max_adultsValue, maxConfigured, 2); // At least show Single and Double

        // Get the highest configured price - this becomes the "base" for unconfigured occupancies
        // This ensures that Triple/Quad don't fall back to a lower base price
        const highestConfiguredPrice = maxConfigured > 0
          ? occupancyPricing.adultPricing[maxConfigured]
          : room.base_price;

        // Generate occupancy types up to maxToShow
        const missingOccupancies = [];

        for (let i = 1; i <= maxToShow; i++) {
          const configuredPrice = occupancyPricing.adultPricing[i];

          // Track which occupancies are missing configured prices
          if (configuredPrice === undefined) {
            missingOccupancies.push(`×${i}`);
          }

          // Use configured price if available, otherwise use the highest configured price
          // This ensures unconfigured occupancies use the max capacity rate
          const finalPrice = configuredPrice !== undefined ? configuredPrice : highestConfiguredPrice;

          occupancyTypes.push({
            type: ` ×${i}`,
            base_price: finalPrice
          });
        }

        // Warn if some occupancies are using fallback prices
        if (missingOccupancies.length > 0) {
          console.warn(`[${room.room_type_name}] Missing occupancy pricing for: ${missingOccupancies.join(', ')}. Using highest configured price (₹${highestConfiguredPrice}) as fallback. Please configure prices in Occupancy Pricing tab.`);
        }
      } else if (max_adultsValue && max_adultsValue > 0) {
        // Use max_adults to generate occupancy types
        for (let i = 1; i <= max_adultsValue; i++) {
          occupancyTypes.push({
            type: ` ×${i}`,
            base_price: room.base_price
          });
        }
      } else {
        // Default to ×1 and ×2
        occupancyTypes = [
          { type: ' ×1', base_price: room.base_price },
          { type: ' ×2', base_price: room.base_price }
        ];
      }

      // Add extra adult/child if configured
      if (occupancyPricing?.extraAdult) {
        occupancyTypes.push({
          type: ' Extra',
          base_price: occupancyPricing.extraAdult
        });
      }
      if (occupancyPricing?.extraChild) {
        occupancyTypes.push({
          type: ' Extra',
          base_price: occupancyPricing.extraChild
        });
      }

      // For each meal plan
      mealPlans.forEach(mealPlan => {
        // For each occupancy type
        occupancyTypes.forEach(occupancy => {
          const row = {
            roomCategory: room.room_type_name,
            mealPlan: mealPlan.plan_name,
            occupancy: occupancy.type,
            prices: {}
          };

          // Calculate price for each day of the week
          weekdays.forEach(day => {
            const originalBasePrice = occupancy.base_price;
            let base_price = originalBasePrice;

            // STEP 1: Apply dynamic pricing multipliers to BASE PRICE ONLY
            // (multipliers should NOT affect meal costs - those are fixed operational costs)
            const isExtraRate = occupancy.type === ' Extra' || occupancy.type === ' Extra';
            if (!isExtraRate || dynamicExtraRates) {
              base_price *= pricingParams.demandMultiplier || 1.0;
              base_price *= pricingParams.seasonalMultiplier || 1.0;
              base_price *= pricingParams.lastMinuteMultiplier || 1.0;
              base_price *= pricingParams.weekday_multipliers?.[day] || 1.0;
              base_price += (pricingParams.competitorAdjustment || 0);
            }

            // STEP 2: Calculate meal costs (based on number of adults)
            let mealCost = 0;
            if (mealPlan.plan_name !== 'EP') {
              // Extract number of adults from occupancy type
              let numAdults = 1;
              if (occupancy.type === 'Single') numAdults = 1;
              else if (occupancy.type === 'Double') numAdults = 2;
              else if (occupancy.type === 'Triple') numAdults = 3;
              else if (occupancy.type === 'Quad') numAdults = 4;
              else {
                // Extract number from "X Adults" format
                const match = occupancy.type.match(/(\d+)\s+Adults?/);
                if (match) numAdults = parseInt(match[1]);
              }

              // For CP, MAP, AP: calculate meal cost per adult based on pricing type
              // NO LEGACY SUPPORT - pricing_type MUST be configured
              let mealCostPerAdult = 0;

              if (!mealPlan.pricing_type) {
                console.error(`[${mealPlan.plan_name}] ERROR: Rate plan missing pricing_type. Please reconfigure in Rate Plans tab.`);
                mealCostPerAdult = 0;
              } else if (mealPlan.pricing_type === 'flat') {
                // Flat rate: add fixed cost per adult
                if (mealPlan.cost_per_adult === undefined || mealPlan.cost_per_adult === null) {
                  console.error(`[${mealPlan.plan_name}] ERROR: Flat pricing selected but cost_per_adult is missing`);
                  mealCostPerAdult = 0;
                } else {
                  mealCostPerAdult = mealPlan.cost_per_adult;
                }
              } else if (mealPlan.pricing_type === 'multiplier') {
                // Multiplier: calculate as percentage of ORIGINAL base price (before dynamic multipliers)
                if (!mealPlan.multiplier) {
                  console.error(`[${mealPlan.plan_name}] ERROR: Multiplier pricing selected but multiplier is missing`);
                  mealCostPerAdult = 0;
                } else {
                  mealCostPerAdult = originalBasePrice * (mealPlan.multiplier - 1);
                }
              }

              // Total meal cost for all adults
              mealCost = mealCostPerAdult * numAdults;
            }

            // STEP 3: Final price = adjusted base price + meal costs
            const price = base_price + mealCost;

            // Debug logging for Triple and Quad
            if ((occupancy.type === 'Triple' || occupancy.type === 'Quad') && day === 'Monday') {
              console.log(`[${room.room_type_name}] ${occupancy.type} - ${mealPlan.plan_name}:`, {
                originalBase: originalBasePrice,
                adjustedBase: base_price,
                mealCost: mealCost,
                finalPrice: price,
                isExtraRate,
                demandMult: pricingParams.demandMultiplier,
                seasonalMult: pricingParams.seasonalMultiplier,
                weekdayMult: pricingParams.weekday_multipliers?.[day]
              });
            }

            row.prices[day] = price;
          });

          tableData.push(row);
        });
      });
    });

    return tableData;
  }, [roomTypes, recommendations, mealPlans, pricingParams, weekdays]);

  // Prepare chart data - aggregate average prices per day across all rooms/plans
  const chartData = useMemo(() => {
    if (!calculateTablePrices || calculateTablePrices.length === 0) return [];

    // Create a data point for each day of the week
    return weekdays.map(day => {
      const dataPoint = { day: day.substring(0, 3) };

      // Group prices by room type for this day
      const roomPrices = {};

      calculateTablePrices.forEach(row => {
        const roomKey = row.roomCategory;

        // Only include EP (base rates) to avoid duplication and show cleaner trends
        if (row.mealPlan === 'EP' && row.occupancy === ' ×2') {
          if (!roomPrices[roomKey]) {
            roomPrices[roomKey] = [];
          }
          roomPrices[roomKey].push(row.prices[day]);
        }
      });

      // Add average price for each room type
      Object.keys(roomPrices).forEach(roomKey => {
        const prices = roomPrices[roomKey];
        const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
        dataPoint[roomKey] = Math.round(avgPrice);
      });

      return dataPoint;
    });
  }, [calculateTablePrices, weekdays]);

  // Get unique room types for chart legend
  const chartRoomTypes = useMemo(() => {
    if (!roomTypes) return [];
    return [...roomTypes].sort((a, b) => (a.rank || 999) - (b.rank || 999)).map(r => r.room_type_name);
  }, [roomTypes]);

  // Color palette for chart lines
  const colorPalette = [
    '#818cf8', // indigo
    '#34d399', // emerald
    '#fbbf24', // amber
    '#f472b6', // pink
    '#60a5fa', // blue
    '#a78bfa', // violet
    '#fb923c', // orange
  ];

  // Dense B2B layout - minimal padding/margins for max space utilization
  const sectionClass = "rounded-lg bg-[var(--surface)] backdrop-blur-xl border border-[var(--border)] p-3";

  // Helper function to get room abbreviation
  function getRoomAbbreviation(roomName) {
    // Get first letters of each word, max 3-4 chars
    const words = roomName.split(' ');
    if (words.length === 1) {
      return roomName.substring(0, 3).toUpperCase();
    }
    return words.map(w => w[0]).join('').toUpperCase().substring(0, 4);
  }

  function displayRoomName(roomName) {
    return roomNameDisplay === "abbreviation" ? getRoomAbbreviation(roomName) : roomName;
  }

  function updateWeekdayMultiplier(day, value) {
    // Allow empty string during typing, otherwise parse the value
    const numValue = value === '' ? 1.0 : parseFloat(value);
    onParamsChange({
      ...pricingParams,
      weekday_multipliers: {
        ...pricingParams.weekday_multipliers,
        [day]: isNaN(numValue) ? 1.0 : numValue
      }
    });
  }

  async function copyRowToClipboard(row, rowIndex) {
    const text = `${row.roomCategory} - ${row.mealPlan} - ${row.occupancy}\n` +
      weekdays.map(day => `${day}: ${row.prices[day].toFixed(2)}`).join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus({ [rowIndex]: 'Copied!' });
      setTimeout(() => setCopyStatus({}), 2000);
    } catch (err) {
      setCopyStatus({ [rowIndex]: 'Failed' });
      setTimeout(() => setCopyStatus({}), 2000);
    }
  }

  async function copyEntireTableToClipboard() {
    // Only copy rates - no headers, no room names, just numbers
    const rows = calculateTablePrices.map(row => {
      const prices = weekdays.map(day => row.prices[day].toFixed(0)).join('\t');
      return prices;
    });

    const tableText = rows.join('\n');

    try {
      await navigator.clipboard.writeText(tableText);
      setCopyStatus({ 'table': 'Rates Copied!' });
      setTimeout(() => setCopyStatus({}), 2000);
    } catch (err) {
      setCopyStatus({ 'table': 'Failed' });
      setTimeout(() => setCopyStatus({}), 2000);
    }
  }

  // Simple Mode preset functions
  function applyDemandPreset(level) {
    const presets = {
      'very-low': 0.5,
      'low': 0.7,
      'normal': 1.0,
      'high': 1.5,
      'very-high': 2.0,
      'extreme': 2.5
    };
    onParamsChange({ ...pricingParams, demandMultiplier: presets[level] });
  }

  function applySeasonalPreset(season) {
    const presets = {
      'off-season': 0.6,
      'low': 0.8,
      'regular': 1.0,
      'high': 1.5,
      'peak': 2.0,
      'super-peak': 3.0,
      'ultra-peak': 4.0
    };
    onParamsChange({ ...pricingParams, seasonalMultiplier: presets[season] });
  }

  function applyCompetitorPreset(strategy) {
    const presets = {
      'heavy-undercut': -1000,
      'undercut': -500,
      'slight-undercut': -200,
      'match': 0,
      'slight-premium': 200,
      'premium': 500,
      'heavy-premium': 1000
    };
    onParamsChange({ ...pricingParams, competitorAdjustment: presets[strategy] });
  }

  function applyDayDemandLevel(day, level) {
    const levelMultipliers = {
      'very-low': 0.7,
      'low': 0.85,
      'normal': 1.0,
      'high': 1.2,
      'very-high': 1.5,
      'peak': 2.0
    };
    updateWeekdayMultiplier(day, levelMultipliers[level].toString());
  }

  function applyWeekdayPreset(pattern) {
    let multipliers = {};

    if (pattern === 'flat') {
      // All days same
      weekdays.forEach(day => { multipliers[day] = 1.0; });
    } else if (pattern === 'weekend') {
      // Higher on Fri/Sat/Sun
      weekdays.forEach(day => {
        if (day === 'Friday' || day === 'Saturday' || day === 'Sunday') {
          multipliers[day] = 1.2;
        } else {
          multipliers[day] = 1.0;
        }
      });
    }

    onParamsChange({ ...pricingParams, weekday_multipliers: multipliers });
  }

  return (
    <div className="space-y-2">
      {/* Compact Header */}
      <div className="flex items-center justify-between py-0.5">
        <div>
          <h3 className="text-base font-bold text-ink">{hotel.hotelName}</h3>
          <p className="muted text-[10px]">{hotel.location}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onSaveComparison}
            className="px-2.5 py-1 rounded-lg bg-[var(--accent)] hover:bg-green-500 text-ink text-[10px] font-medium transition-all flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>Save
          </button>
        </div>
      </div>

      {/* View Mode Toggle */}
      <div className="flex gap-1 p-0.5 bg-[var(--surface)] rounded-lg border border-[var(--border)] w-fit">
        <button
          onClick={() => setViewMode("pricing")}
          className={`px-3 py-1 rounded text-[10px] font-medium transition-all ${
            viewMode === "pricing"
              ? "bg-[var(--accent)] text-ink"
              : "muted hover:text-ink"
          }`}
        >Pricing
        </button>
        <button
          onClick={() => setViewMode("comparison")}
          className={`px-3 py-1 rounded text-[10px] font-medium transition-all ${
            viewMode === "comparison"
              ? "bg-[var(--accent)] text-ink"
              : "muted hover:text-ink"
          }`}
        >Compare ({comparisons.length})
        </button>
      </div>

      {viewMode === "pricing" && (
        <>
          {/* UNIFIED PRICING DASHBOARD - 2 Columns, 4 Rows Grid */}
          <div className={sectionClass}>
            <div className="flex justify-between items-center mb-2">
              <h4 className="h2 text-sm">Pricing Dashboard</h4>
              <div className="flex items-center gap-2">
                {/* Simple/Advanced Mode Toggle */}
                <div className="flex gap-1 p-0.5 bg-[var(--surface)] rounded-lg border border-[var(--border)]">
                  <button
                    onClick={() => setPricingMode("simple")}
                    className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
                      pricingMode === "simple"
                        ? "bg-[var(--accent)] text-ink"
                        : "muted hover:text-ink"
                    }`}
                  >Simple
                  </button>
                  <button
                    onClick={() => setPricingMode("advanced")}
                    className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
                      pricingMode === "advanced"
                        ? "bg-[var(--accent)] text-ink"
                        : "muted hover:text-ink"
                    }`}
                  >Advanced
                  </button>
                </div>

                {/* Dynamic Extra Rates Toggle */}
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <span className="text-[10px] muted">Dynamic Extra</span>
                  <div className="relative">
                    <input
                      type="checkbox"checked={dynamicExtraRates}
                      onChange={(e) => setDynamicExtraRates(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-[var(--surface-2)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--accent)]"></div>
                  </div>
                </label>
              </div>
            </div>

            {/* 2-COLUMN, 4-ROW GRID LAYOUT */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">

              {/* ROW 1-2 LEFT: Weekly Price Trend Chart (spans 2 rows) */}
              <div className="lg:row-span-2">
                <h5 className="text-xs font-semibold muted mb-1">Weekly Price Trend</h5>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                      <XAxis dataKey="day" stroke="#94a3b8" style={{ fontSize: '10px' }} />
                      <YAxis stroke="#94a3b8" style={{ fontSize: '10px' }} tickFormatter={(value) => `₹${value}`} />
                      <ChartTooltip
                        contentStyle={{
                          backgroundColor: 'rgba(15, 23, 42, 0.95)',
                          border: '1px solid rgba(255,255,255,0.2)',
                          borderRadius: '8px',
                          color: '#fff',
                          fontSize: '10px'
                        }}
                        formatter={(value) => [`₹${value}`, '']}
                        labelStyle={{ color: '#94a3b8', fontSize: '10px' }}
                      />
                      <Legend wrapperStyle={{ fontSize: '10px', color: '#94a3b8' }} />
                      {[chartRoomTypes[0]].filter(Boolean).map((roomType) => (
                        <Line
                          key={roomType}
                          type="monotone"dataKey={roomType}
                          stroke={colorPalette[0]}
                          strokeWidth={2}
                          dot={{ fill: colorPalette[0], r: 3 }}
                          activeDot={{ r: 5 }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-[9px] muted text-center mt-1">
                  {chartRoomTypes[0]} - Double Occupancy ( ×2) EP rates
                </p>
              </div>

              {/* ROW 1 RIGHT: Competitor Adjustment Controller */}
              <div className="p-2 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                <h5 className="text-xs font-semibold text-ink mb-1">Competitor Adjustment</h5>

                {pricingMode === "simple" ? (
                  <div className="space-y-0.5">
                    {[
                      { key: 'undercut', label: 'Undercut', emoji: '', amount: -500 },
                      { key: 'match', label: 'Match', emoji: '', amount: 0 },
                      { key: 'premium', label: 'Premium', emoji: '', amount: 500 },
                      { key: 'heavy-premium', label: 'Heavy', emoji: '', amount: 1000 }
                    ].map(option => (
                      <button
                        key={option.key}
                        onClick={() => applyCompetitorPreset(option.key)}
                        className={`w-full p-1.5 rounded border transition-all flex items-center gap-2 ${
                          pricingParams.competitorAdjustment === option.amount
                            ? 'bg-[var(--accent)] border-[var(--accent)] text-ink'
                            : 'bg-[var(--surface)] border-[var(--border)] muted hover:bg-[var(--surface-2)]'
                        }`}
                      >
                        <span className="text-base">{option.emoji}</span>
                        <span className="text-[10px] font-semibold flex-1 text-left">{option.label}</span>
                        <span className="text-[9px] text-[var(--accent-text)] font-mono">
                          {option.amount > 0 ? '+₹' : option.amount < 0 ? '₹' : '₹'}{option.amount}
                        </span>
                      </button>
                    ))}
                    <input
                      type="number"step="1"value={pricingParams.competitorAdjustment}
                      onChange={(e) => onParamsChange({ ...pricingParams, competitorAdjustment: parseFloat(e.target.value) || 0 })}
                      className="w-full px-2 py-1 rounded bg-[var(--surface-2)] border border-white/20 text-ink text-[10px] text-center focus:outline-none focus:border-[var(--accent)]"placeholder="Custom amount (₹)"
                    />
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-center mb-2">
                      <label className="text-xs muted">Fixed Amount</label>
                      <input
                        type="number"step="10"value={pricingParams.competitorAdjustment}
                        onChange={(e) => onParamsChange({ ...pricingParams, competitorAdjustment: parseFloat(e.target.value) || 0 })}
                        className="w-24 px-2 py-1 rounded-lg bg-[var(--surface-2)] border border-white/20 text-ink text-sm text-right focus:outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                    <input
                      type="range"min="-1000"max="1000"step="50"value={pricingParams.competitorAdjustment}
                      onChange={(e) => onParamsChange({ ...pricingParams, competitorAdjustment: parseFloat(e.target.value) })}
                      className="w-full h-2 bg-[var(--surface-2)] rounded-lg appearance-none cursor-pointer slider"
                    />
                    <div className="flex justify-between text-xs muted mt-1">
                      <span>-₹1000</span>
                      <span>₹0</span>
                      <span>+₹1000</span>
                    </div>
                  </>
                )}
              </div>

              {/* ROW 2 RIGHT: Last Minute Multiplier Controller */}
              <div className="p-2 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                <h5 className="text-xs font-semibold text-ink mb-1">⏰ Last Minute</h5>

                {pricingMode === "simple" ? (
                  <div className="space-y-0.5">
                    {[
                      { key: 'discount', label: 'Discount', emoji: '', multiplier: 0.7 },
                      { key: 'standard', label: 'Standard', emoji: '', multiplier: 1.0 },
                      { key: 'premium', label: 'Premium', emoji: '', multiplier: 1.3 },
                      { key: 'high', label: 'High', emoji: '', multiplier: 1.5 }
                    ].map(option => (
                      <button
                        key={option.key}
                        onClick={() => onParamsChange({ ...pricingParams, lastMinuteMultiplier: option.multiplier })}
                        className={`w-full p-1.5 rounded border transition-all flex items-center gap-2 ${
                          pricingParams.lastMinuteMultiplier === option.multiplier
                            ? 'bg-[var(--accent)] border-[var(--accent)] text-ink'
                            : 'bg-[var(--surface)] border-[var(--border)] muted hover:bg-[var(--surface-2)]'
                        }`}
                      >
                        <span className="text-base">{option.emoji}</span>
                        <span className="text-[10px] font-semibold flex-1 text-left">{option.label}</span>
                        <span className="text-[9px] text-[var(--accent-text)] font-mono">{option.multiplier}x</span>
                      </button>
                    ))}
                    <input
                      type="number"step="0.01"min="0"value={pricingParams.lastMinuteMultiplier}
                      onChange={(e) => onParamsChange({ ...pricingParams, lastMinuteMultiplier: parseFloat(e.target.value) || 1.0 })}
                      className="w-full px-2 py-1 rounded bg-[var(--surface-2)] border border-white/20 text-ink text-[10px] text-center focus:outline-none focus:border-[var(--accent)]"placeholder="Custom multiplier"
                    />
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-center mb-2">
                      <label className="text-xs muted">Multiplier</label>
                      <input
                        type="number"step="0.1"min="0"value={pricingParams.lastMinuteMultiplier}
                        onChange={(e) => onParamsChange({ ...pricingParams, lastMinuteMultiplier: parseFloat(e.target.value) || 1.0 })}
                        className="w-24 px-2 py-1 rounded-lg bg-[var(--surface-2)] border border-white/20 text-ink text-sm text-right focus:outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                    <input
                      type="range"min="0.5"max="2.0"step="0.1"value={pricingParams.lastMinuteMultiplier}
                      onChange={(e) => onParamsChange({ ...pricingParams, lastMinuteMultiplier: parseFloat(e.target.value) })}
                      className="w-full h-2 bg-[var(--surface-2)] rounded-lg appearance-none cursor-pointer slider"
                    />
                    <div className="flex justify-between text-xs muted mt-1">
                      <span>0.5x</span>
                      <span>1.0x</span>
                      <span>2.0x</span>
                    </div>
                  </>
                )}
              </div>

              {/* ROW 3 FULL WIDTH: Weekly Multipliers Controller */}
              <div className="lg:col-span-2 p-2 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                <h5 className="text-xs font-semibold text-ink mb-1">Weekly Multipliers</h5>
                <div className="grid grid-cols-7 gap-1">
                  {weekdays.map(day => (
                    <div key={day} className="text-center">
                      <div className="text-[9px] muted mb-0.5 font-medium">{day.slice(0, 3)}</div>
                      <input
                        type="number"step="0.1"min="0"value={pricingParams.weekday_multipliers?.[day] || 1.0}
                        onChange={(e) => updateWeekdayMultiplier(day, e.target.value)}
                        className="w-full px-0.5 py-0.5 rounded bg-[var(--surface-2)] border border-white/20 text-ink text-[10px] text-center focus:outline-none focus:border-[var(--accent)]"
                      />
                      <div className="text-[8px] muted mt-0.5">
                        {(pricingParams.weekday_multipliers?.[day] || 1.0).toFixed(1)}x
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ROW 4 LEFT: Demand Factor Controller */}
              <div className="p-2 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                <h5 className="text-xs font-semibold text-ink mb-1">Demand Factor</h5>

                {pricingMode === "simple" ? (
                  <div className="space-y-0.5">
                    {[
                      { key: 'low', label: 'Low', emoji: '', multiplier: 0.7 },
                      { key: 'normal', label: 'Normal', emoji: '', multiplier: 1.0 },
                      { key: 'high', label: 'High', emoji: '', multiplier: 1.5 },
                      { key: 'very-high', label: 'Very High', emoji: '', multiplier: 2.0 },
                      { key: 'extreme', label: 'Extreme', emoji: '', multiplier: 2.5 }
                    ].map(option => (
                      <button
                        key={option.key}
                        onClick={() => applyDemandPreset(option.key)}
                        className={`w-full p-1.5 rounded border transition-all flex items-center gap-2 ${
                          pricingParams.demandMultiplier === option.multiplier
                            ? 'bg-[var(--accent)] border-[var(--accent)] text-ink'
                            : 'bg-[var(--surface)] border-[var(--border)] muted hover:bg-[var(--surface-2)]'
                        }`}
                      >
                        <span className="text-base">{option.emoji}</span>
                        <span className="text-[10px] font-semibold flex-1 text-left">{option.label}</span>
                        <span className="text-[9px] text-[var(--accent-text)] font-mono">{option.multiplier}x</span>
                      </button>
                    ))}
                    <input
                      type="number"step="0.01"min="0"value={pricingParams.demandMultiplier}
                      onChange={(e) => onParamsChange({ ...pricingParams, demandMultiplier: parseFloat(e.target.value) || 1.0 })}
                      className="w-full px-2 py-1 rounded bg-[var(--surface-2)] border border-white/20 text-ink text-[10px] text-center focus:outline-none focus:border-[var(--accent)]"placeholder="Custom multiplier"
                    />
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-center mb-2">
                      <label className="text-xs muted">Multiplier</label>
                      <input
                        type="number"step="0.1"min="0"value={pricingParams.demandMultiplier}
                        onChange={(e) => onParamsChange({ ...pricingParams, demandMultiplier: parseFloat(e.target.value) || 1.0 })}
                        className="w-24 px-2 py-1 rounded-lg bg-[var(--surface-2)] border border-white/20 text-ink text-sm text-right focus:outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                    <input
                      type="range"min="0.5"max="2.5"step="0.1"value={pricingParams.demandMultiplier}
                      onChange={(e) => onParamsChange({ ...pricingParams, demandMultiplier: parseFloat(e.target.value) })}
                      className="w-full h-2 bg-[var(--surface-2)] rounded-lg appearance-none cursor-pointer slider"
                    />
                    <div className="flex justify-between text-xs muted mt-1">
                      <span>0.5x</span>
                      <span>1.5x</span>
                      <span>2.5x</span>
                    </div>
                  </>
                )}
              </div>

              {/* ROW 4 RIGHT: Seasonal Factor Controller */}
              <div className="p-2 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                <h5 className="text-xs font-semibold text-ink mb-1">Seasonal Factor</h5>

                {pricingMode === "simple" ? (
                  <div className="space-y-0.5">
                    {[
                      { key: 'low', label: 'Low', emoji: '', multiplier: 0.8 },
                      { key: 'regular', label: 'Regular', emoji: '', multiplier: 1.0 },
                      { key: 'high', label: 'High', emoji: '', multiplier: 1.5 },
                      { key: 'peak', label: 'Peak', emoji: '', multiplier: 2.0 },
                      { key: 'ultra-peak', label: 'Ultra Peak', emoji: '', multiplier: 4.0 }
                    ].map(option => (
                      <button
                        key={option.key}
                        onClick={() => applySeasonalPreset(option.key)}
                        className={`w-full p-1.5 rounded border transition-all flex items-center gap-2 ${
                          pricingParams.seasonalMultiplier === option.multiplier
                            ? 'bg-[var(--accent)] border-[var(--accent)] text-ink'
                            : 'bg-[var(--surface)] border-[var(--border)] muted hover:bg-[var(--surface-2)]'
                        }`}
                      >
                        <span className="text-base">{option.emoji}</span>
                        <span className="text-[10px] font-semibold flex-1 text-left">{option.label}</span>
                        <span className="text-[9px] text-[var(--accent-text)] font-mono">{option.multiplier}x</span>
                      </button>
                    ))}
                    <input
                      type="number"step="0.01"min="0"value={pricingParams.seasonalMultiplier}
                      onChange={(e) => onParamsChange({ ...pricingParams, seasonalMultiplier: parseFloat(e.target.value) || 1.0 })}
                      className="w-full px-2 py-1 rounded bg-[var(--surface-2)] border border-white/20 text-ink text-[10px] text-center focus:outline-none focus:border-[var(--accent)]"placeholder="Custom multiplier"
                    />
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-center mb-2">
                      <label className="text-xs muted">Multiplier</label>
                      <input
                        type="number"step="0.1"min="0"value={pricingParams.seasonalMultiplier}
                        onChange={(e) => onParamsChange({ ...pricingParams, seasonalMultiplier: parseFloat(e.target.value) || 1.0 })}
                        className="w-24 px-2 py-1 rounded-lg bg-[var(--surface-2)] border border-white/20 text-ink text-sm text-right focus:outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                    <input
                      type="range"min="0.6"max="4.0"step="0.1"value={pricingParams.seasonalMultiplier}
                      onChange={(e) => onParamsChange({ ...pricingParams, seasonalMultiplier: parseFloat(e.target.value) })}
                      className="w-full h-2 bg-[var(--surface-2)] rounded-lg appearance-none cursor-pointer slider"
                    />
                    <div className="flex justify-between text-xs muted mt-1">
                      <span>0.6x</span>
                      <span>2.0x</span>
                      <span>4.0x</span>
                    </div>
                  </>
                )}
              </div>

            </div>
          </div>

          {/* Pricing Table */}
          <div id="pricing-table" className={sectionClass}>
            <div className="flex items-center justify-between mb-4">
              <h4 className="h2">Weekly Pricing Table</h4>
              <div className="flex items-center gap-3">
                <select
                  value={roomNameDisplay}
                  onChange={(e) => setRoomNameDisplay(e.target.value)}
                  className="px-3 py-1.5 rounded-lg bg-[var(--surface-2)] border border-white/20 text-ink text-xs font-medium focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value="abbreviation">Abbreviations</option>
                  <option value="full">Full Names</option>
                </select>
                <button
                  onClick={copyEntireTableToClipboard}
                  className="btn btn-primary text-sm"
                >
                  {copyStatus['table'] ? (
                    <span className="text-sm">{copyStatus['table']}</span>
                  ) : (
                    <>Copy All Rates</>
                  )}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/20">
                    <th className="text-center py-2 px-2 muted font-semibold text-xs w-10"></th>
                    <th className="text-left py-2 px-3 muted font-semibold text-xs">Room</th>
                    <th className="text-left py-2 px-3 muted font-semibold text-xs">Plan</th>
                    <th className="text-left py-2 px-3 muted font-semibold text-xs">Occ</th>
                    {weekdays.map(day => (
                      <th key={day} className="text-right py-2 px-3 muted font-semibold text-xs">{day.substring(0, 3)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {calculateTablePrices.map((row, index) => (
                    <tr key={index} className="border-b border-[var(--border)] hover:bg-[var(--surface)] transition-colors group">
                      <td className="py-3 px-2 text-center">
                        <button
                          onClick={() => copyRowToClipboard(row, index)}
                          className="p-1.5 rounded hover:bg-[var(--surface-2)] muted hover:text-ink transition-all opacity-0 group-hover:opacity-100"title="Copy row"
                        >
                          {copyStatus[index] ? (
                            <span className="text-xs text-[var(--accent-text)]">{copyStatus[index]}</span>
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          )}
                        </button>
                      </td>
                      <td className="py-2 px-3 text-ink text-sm">{displayRoomName(row.roomCategory)}</td>
                      <td className="py-2 px-3 text-ink text-sm">{row.mealPlan}</td>
                      <td className="py-2 px-3 text-ink text-sm">{row.occupancy}</td>
                      {weekdays.map(day => (
                        <td key={day} className="py-2 px-3 text-right text-ink font-mono text-sm">
                          {row.prices[day].toFixed(2)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {viewMode === "comparison" && (
        <div className={sectionClass}>
          <div className="flex justify-between items-center mb-6">
            <h4 className="h2">Saved Comparisons</h4>
            {comparisons.length > 0 && (
              <button
                onClick={() => comparisons.forEach(c => onRemoveComparison(c.id))}
                className="text-sm text-[var(--danger)] hover:text-[var(--danger)]"
              >Clear All
              </button>
            )}
          </div>

          {comparisons.length === 0 ? (
            <div className="text-center py-12">
              <p className="muted mb-4">No saved comparisons yet</p>
              <p className="text-sm faint">Adjust the pricing factors and click "Save for Comparison" to compare different scenarios
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {comparisons.map((comparison, idx) => (
                <div key={comparison.id} className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border)]">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h5 className="text-ink font-semibold">Scenario {idx + 1}</h5>
                      <p className="text-xs faint mt-1">Saved {new Date(comparison.timestamp).toLocaleString()}
                      </p>
                    </div>
                    <button
                      onClick={() => onRemoveComparison(comparison.id)}
                      className="text-[var(--danger)] hover:text-[var(--danger)]"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
                    <div>
                      <span className="muted">Demand:</span>
                      <span className="text-ink ml-2">{comparison.params.demandMultiplier.toFixed(2)}x</span>
                    </div>
                    <div>
                      <span className="muted">Seasonal:</span>
                      <span className="text-ink ml-2">{comparison.params.seasonalMultiplier.toFixed(2)}x</span>
                    </div>
                    <div>
                      <span className="muted">Competitor:</span>
                      <span className="text-ink ml-2">
                        {comparison.params.competitorAdjustment > 0 ? '+' : ''}${comparison.params.competitorAdjustment}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {comparison.results.roomTypes.map((room, roomIdx) => {
                      const rec = comparison.results.recommendations[roomIdx];
                      return (
                        <div key={room.id} className="p-3 rounded-lg bg-[var(--surface)]">
                          <div className="text-xs muted mb-1">{room.room_type_name}</div>
                          <div className="text-lg font-bold text-ink">
                            ${rec.recommendedPrice.toFixed(2)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
