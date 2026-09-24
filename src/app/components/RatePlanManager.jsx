"use client";

import { useState, useEffect, useMemo } from "react";

export default function RatePlanManager({ hotel, roomTypes, ratePlans, onComplete, onBack }) {
  const [ratePlanRows, setRatePlanRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Generate initial rate plan rows based on room types, occupancy, and meal plans
  useEffect(() => {
    if (roomTypes.length > 0) {
      generateRatePlanRows();
    }
  }, [roomTypes, ratePlans]);

  function generateRatePlanRows() {
    const rows = [];
    let rowId = 1;

    roomTypes.forEach((room) => {
      const occupancy_pricing = room.occupancy_pricing || {};
      const adultPricing = occupancy_pricing.adultPricing || {};
      const numAdults = occupancy_pricing.numAdultOptions || 0;

      // If no occupancy pricing defined, create basic row
      if (numAdults === 0) {
        ratePlans.forEach((plan) => {
          rows.push({
            id: rowId++,
            roomType: room.room_type_name,
            room_type_id: room.id,
            occupancy: "Standard",
            occupancyType: "standard",
            mealPlan: plan.plan_name,
            mealPlanId: plan.id,
            numMeals: 0,
            baseRate: room.base_price,
            additionalCost: 0,
            totalRate: room.base_price * plan.multiplier,
            ratio: plan.multiplier,
            isActive: true,
          });
        });
      } else {
        // Create rows for each adult occupancy level
        for (let adultCount = 1; adultCount <= numAdults; adultCount++) {
          const occupancyLabel = getOccupancyLabel(adultCount);
          const base_price = adultPricing[adultCount] || room.base_price;

          ratePlans.forEach((plan) => {
            // Calculate meal cost based on plan name
            const mealCost = getMealCostFromPlan(plan.plan_name);

            rows.push({
              id: rowId++,
              roomType: room.room_type_name,
              room_type_id: room.id,
              occupancy: occupancyLabel,
              occupancyType: adultCount === 1 ? "Single (S)" : adultCount === 2 ? "Double (D)" : `${adultCount} Adults`,
              mealPlan: plan.plan_name,
              mealPlanId: plan.id,
              numMeals: getMealCount(plan.plan_name, adultCount),
              baseRate: base_price,
              additionalCost: mealCost * adultCount,
              totalRate: base_price + (mealCost * adultCount),
              ratio: 1.0,
              isActive: true,
            });
          });
        }
      }
    });

    setRatePlanRows(rows);
  }

  function getOccupancyLabel(count) {
    const labels = {
      1: "Single (S)",
      2: "Double (D)",
      3: "Triple (T)",
      4: "Quad (Q)",
    };
    return labels[count] || `${count} Adults`;
  }

  function getMealCostFromPlan(plan_name) {
    const costs = {
      "EP": 0,
      "CP": 350,
      "MAP": 1000,
      "AP": 1650,
    };
    return costs[plan_name] || 0;
  }

  function getMealCount(plan_name, adultCount) {
    const mealCounts = {
      "EP": 0,
      "CP": 1,
      "MAP": 2,
      "AP": 3,
    };
    return (mealCounts[plan_name] || 0) * adultCount;
  }

  function handleRowChange(rowId, field, value) {
    setRatePlanRows(ratePlanRows.map(row => {
      if (row.id === rowId) {
        const updatedRow = { ...row, [field]: value };

        // Recalculate total rate based on changes
        if (field === "baseRate" || field === "additionalCost") {
          updatedRow.totalRate = parseFloat(updatedRow.baseRate || 0) + parseFloat(updatedRow.additionalCost || 0);
        } else if (field === "ratio") {
          updatedRow.totalRate = updatedRow.baseRate * parseFloat(value || 1);
        }

        return updatedRow;
      }
      return row;
    }));
  }

  function addRow() {
    const newRow = {
      id: Math.max(...ratePlanRows.map(r => r.id), 0) + 1,
      roomType: roomTypes[0]?.room_type_name || "",
      room_type_id: roomTypes[0]?.id || "",
      occupancy: "Single (S)",
      occupancyType: "Single (S)",
      mealPlan: ratePlans[0]?.plan_name || "EP",
      mealPlanId: ratePlans[0]?.id || "",
      numMeals: 0,
      baseRate: roomTypes[0]?.base_price || 0,
      additionalCost: 0,
      totalRate: roomTypes[0]?.base_price || 0,
      ratio: 1.0,
      isActive: true,
    };
    setRatePlanRows([...ratePlanRows, newRow]);
  }

  function deleteRow(rowId) {
    setRatePlanRows(ratePlanRows.filter(row => row.id !== rowId));
  }

  function duplicateRow(rowId) {
    const rowToDuplicate = ratePlanRows.find(row => row.id === rowId);
    if (rowToDuplicate) {
      const newRow = {
        ...rowToDuplicate,
        id: Math.max(...ratePlanRows.map(r => r.id), 0) + 1,
      };
      setRatePlanRows([...ratePlanRows, newRow]);
    }
  }

  async function handleSave() {
    try {
      setLoading(true);
      setError("");

      // Here you would save the rate plan configuration to your backend
      // For now, we'll just show a success message
      console.log("Saving rate plans:", ratePlanRows);

      alert("Rate plans saved successfully!");
      onComplete && onComplete(ratePlanRows);
    } catch (err) {
      setError("Failed to save rate plans: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  const activeRows = ratePlanRows.filter(row => row.isActive);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-2xl bg-[var(--surface)] backdrop-blur-xl border border-[var(--border)] p-6">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-xl font-bold text-ink">📋 Configure Rate Plans</h3>
            <p className="sub mt-1">
              Fine-tune pricing for all combinations of room types, occupancy, and meal plans
            </p>
            <p className="text-xs faint mt-2">
              Hotel: <span className="text-ink font-medium">{hotel.hotelName}</span> •
              {roomTypes.length} room types • {ratePlans.length} meal plans • {activeRows.length} rate plan variations
            </p>
          </div>
          <button
            onClick={onBack}
            className="px-4 py-2 rounded-lg bg-[var(--surface)] hover:bg-[var(--surface-2)] border border-[var(--border)] muted text-sm font-medium transition-all"
          >
            ← Back to Setup
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-[var(--danger-soft)] border border-[var(--danger)] p-4">
          <p className="text-[var(--danger)] text-sm">⚠️ {error}</p>
        </div>
      )}

      {/* Rate Plans Table */}
      <div className="rounded-2xl bg-[var(--surface)] backdrop-blur-xl border border-[var(--border)] overflow-hidden">
        <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
          <h4 className="text-ink font-semibold">Rate Plans (in increasing order of intended rack rates)</h4>
          <button
            onClick={addRow}
            className="px-3 py-1.5 rounded-lg bg-[var(--accent)] hover:bg-green-500 text-ink text-xs font-medium transition-all"
          >
            + Add Row
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[var(--surface)] border-b border-[var(--border)]">
              <tr>
                <th className="px-3 py-3 text-left text-xs font-semibold muted uppercase tracking-wider">✓</th>
                <th className="px-3 py-3 text-left text-xs font-semibold muted uppercase tracking-wider">Actions</th>
                <th className="px-3 py-3 text-left text-xs font-semibold muted uppercase tracking-wider">Room</th>
                <th className="px-3 py-3 text-left text-xs font-semibold muted uppercase tracking-wider">Occupancy</th>
                <th className="px-3 py-3 text-left text-xs font-semibold muted uppercase tracking-wider">ID</th>
                <th className="px-3 py-3 text-left text-xs font-semibold muted uppercase tracking-wider"># Meals</th>
                <th className="px-3 py-3 text-left text-xs font-semibold muted uppercase tracking-wider">Base Rate</th>
                <th className="px-3 py-3 text-center text-xs font-semibold muted uppercase tracking-wider">+</th>
                <th className="px-3 py-3 text-left text-xs font-semibold muted uppercase tracking-wider">Add. Cost</th>
                <th className="px-3 py-3 text-center text-xs font-semibold muted uppercase tracking-wider">=</th>
                <th className="px-3 py-3 text-left text-xs font-semibold muted uppercase tracking-wider">Total</th>
                <th className="px-3 py-3 text-left text-xs font-semibold muted uppercase tracking-wider">Ratio</th>
                <th className="px-3 py-3 text-left text-xs font-semibold muted uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {ratePlanRows.map((row) => (
                <tr key={row.id} className="hover:bg-[var(--surface)] transition-colors">
                  {/* Active Checkbox */}
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={row.isActive}
                      onChange={(e) => handleRowChange(row.id, "isActive", e.target.checked)}
                      className="w-4 h-4 rounded bg-[var(--surface-2)] border-white/20 text-[var(--accent-text)] focus:ring-[var(--accent)]"
                    />
                  </td>

                  {/* Actions (Add/Remove) */}
                  <td className="px-3 py-3">
                    <div className="flex gap-1">
                      <button
                        onClick={() => duplicateRow(row.id)}
                        className="p-1 rounded bg-[var(--accent)] hover:bg-green-500 text-ink text-xs"
                        title="Duplicate row"
                      >
                        +
                      </button>
                      <button
                        onClick={() => deleteRow(row.id)}
                        className="btn btn-danger text-xs p-1"
                        title="Delete row"
                      >
                        −
                      </button>
                    </div>
                  </td>

                  {/* Room Type */}
                  <td className="px-3 py-3">
                    <select
                      value={row.roomType}
                      onChange={(e) => {
                        const selectedRoom = roomTypes.find(r => r.room_type_name === e.target.value);
                        handleRowChange(row.id, "roomType", e.target.value);
                        handleRowChange(row.id, "room_type_id", selectedRoom?.id || "");
                        handleRowChange(row.id, "baseRate", selectedRoom?.base_price || 0);
                      }}
                      className="w-full px-2 py-1.5 rounded bg-[var(--surface-2)] border border-white/20 text-ink text-sm focus:outline-none focus:border-[var(--accent)]"
                    >
                      {roomTypes.map((room) => (
                        <option key={room.id} value={room.room_type_name}>
                          {room.room_type_name}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Occupancy */}
                  <td className="px-3 py-3">
                    <select
                      value={row.occupancyType}
                      onChange={(e) => handleRowChange(row.id, "occupancyType", e.target.value)}
                      className="w-full px-2 py-1.5 rounded bg-[var(--surface-2)] border border-white/20 text-ink text-sm focus:outline-none focus:border-[var(--accent)]"
                    >
                      <option value="Single (S)">Single (S)</option>
                      <option value="Double (D)">Double (D)</option>
                      <option value="Triple (T)">Triple (T)</option>
                      <option value="Quad (Q)">Quad (Q)</option>
                    </select>
                  </td>

                  {/* Meal Plan ID */}
                  <td className="px-3 py-3">
                    <select
                      value={row.mealPlan}
                      onChange={(e) => {
                        handleRowChange(row.id, "mealPlan", e.target.value);
                        const numMeals = getMealCount(e.target.value, 1);
                        handleRowChange(row.id, "numMeals", numMeals);
                      }}
                      className="w-24 px-2 py-1.5 rounded bg-[var(--surface-2)] border border-white/20 text-ink text-sm focus:outline-none focus:border-[var(--accent)]"
                    >
                      {ratePlans.map((plan) => (
                        <option key={plan.id} value={plan.plan_name}>
                          {plan.plan_name}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Number of Meals */}
                  <td className="px-3 py-3">
                    <input
                      type="number"
                      value={row.numMeals}
                      onChange={(e) => handleRowChange(row.id, "numMeals", e.target.value)}
                      className="w-20 px-2 py-1.5 rounded bg-[var(--surface-2)] border border-white/20 text-ink text-sm text-center focus:outline-none focus:border-[var(--accent)]"
                    />
                  </td>

                  {/* Base Rate (Master) */}
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1">
                      <span className="text-[var(--accent-text)] text-xs px-1.5 py-0.5 rounded bg-[var(--accent-soft)] border border-[var(--accent)]">Master</span>
                      <input
                        type="number"
                        value={row.baseRate}
                        onChange={(e) => handleRowChange(row.id, "baseRate", e.target.value)}
                        className="w-24 px-2 py-1.5 rounded bg-[var(--surface-2)] border border-white/20 text-ink text-sm text-right focus:outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                  </td>

                  {/* Plus sign */}
                  <td className="px-3 py-3 text-center muted">+</td>

                  {/* Additional Cost */}
                  <td className="px-3 py-3">
                    <input
                      type="number"
                      value={row.additionalCost}
                      onChange={(e) => handleRowChange(row.id, "additionalCost", e.target.value)}
                      className="w-24 px-2 py-1.5 rounded bg-[var(--surface-2)] border border-white/20 text-ink text-sm text-right focus:outline-none focus:border-[var(--accent)]"
                    />
                  </td>

                  {/* Equals sign */}
                  <td className="px-3 py-3 text-center muted">=</td>

                  {/* Total Rate */}
                  <td className="px-3 py-3">
                    <div className="px-2 py-1.5 rounded bg-[var(--accent)] border border-[var(--accent)] text-[var(--accent-text)] text-sm text-right font-semibold">
                      {Math.round(row.totalRate)}
                    </div>
                  </td>

                  {/* Ratio */}
                  <td className="px-3 py-3">
                    <input
                      type="number"
                      step="0.01"
                      value={row.ratio}
                      onChange={(e) => handleRowChange(row.id, "ratio", e.target.value)}
                      className="w-20 px-2 py-1.5 rounded bg-[var(--surface-2)] border border-white/20 text-ink text-sm text-center focus:outline-none focus:border-[var(--accent)]"
                    />
                  </td>

                  {/* Row Actions */}
                  <td className="px-3 py-3">
                    <div className="flex gap-1">
                      <button
                        onClick={() => duplicateRow(row.id)}
                        className="p-1.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent)] text-ink text-xs"
                        title="Duplicate"
                      >
                        ⬆
                      </button>
                      <button
                        onClick={() => duplicateRow(row.id)}
                        className="p-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-ink text-xs"
                        title="Copy"
                      >
                        ⬇
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 justify-end">
        <button
          onClick={() => setRatePlanRows([])}
          className="px-4 py-2 rounded-lg bg-[var(--surface)] hover:bg-[var(--surface-2)] border border-[var(--border)] muted text-sm font-medium transition-all"
        >
          Reset All
        </button>
        <button
          onClick={handleSave}
          disabled={loading || ratePlanRows.length === 0}
          className="px-6 py-2 rounded-lg from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-ink font-semibold disabled:opacity-50 transition-all"
        >
          {loading ? "💾 Saving..." : "✅ Save Rate Plans & Continue"}
        </button>
      </div>
    </div>
  );
}
