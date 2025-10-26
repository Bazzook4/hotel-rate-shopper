"use client";

import { useState, useEffect } from "react";

export default function OccupancyPricingTable({ roomTypes, onSave }) {
  const [pricingMode, setPricingMode] = useState("occupancy"); // "flat_room", "occupancy", or "per_adult"
  const [baseRoomId, setBaseRoomId] = useState(null);
  const [occupancyData, setOccupancyData] = useState({});
  const [loading, setLoading] = useState(false);

  // Initialize data from existing room types
  useEffect(() => {
    if (roomTypes && roomTypes.length > 0) {
      const initialData = {};

      roomTypes.forEach(room => {
        // Preserve existing occupancy pricing data
        const existingPricing = room.occupancyPricing || {};

        initialData[room.id] = {
          isBase: existingPricing.isBase || false,
          pricingMode: existingPricing.pricingMode || 'room',
          numAdultOptions: existingPricing.numAdultOptions || 2,
          adultPricing: existingPricing.adultPricing || {
            1: room.basePrice || 0,
            2: room.basePrice || 0,
          },
          perAdultRate: existingPricing.perAdultRate || 0,
          extraAdult: existingPricing.extraAdult || 0,
          extraChild: existingPricing.extraChild || 0,
          calcType: existingPricing.calcType || 'manual', // 'manual', 'fixed', 'ratio'
          fixedAdjustment: existingPricing.fixedAdjustment || {},
          ratioMultiplier: existingPricing.ratioMultiplier || {},
        };

        if (existingPricing.isBase) {
          setBaseRoomId(room.id);
        }
      });

      setOccupancyData(initialData);

      // If no base room is set, set the first room as base
      if (!baseRoomId && roomTypes.length > 0) {
        const firstRoom = roomTypes[0].id;
        setBaseRoomId(firstRoom);
        initialData[firstRoom].isBase = true;
      }
    }
  }, [roomTypes]);

  const getOccupancyLabel = (num) => {
    const labels = {
      1: "Single (S)",
      2: "Double (D)",
      3: "Triple (T)",
      4: "Quad (Q)",
    };
    return labels[num] || `${num} Adults`;
  };

  function handleSetBaseRoom(roomId) {
    setBaseRoomId(roomId);
    setOccupancyData(prev => {
      const updated = { ...prev };
      Object.keys(updated).forEach(id => {
        updated[id].isBase = id === roomId;
      });
      return updated;
    });
  }

  function handlePriceChange(roomId, adultCount, value) {
    setOccupancyData(prev => ({
      ...prev,
      [roomId]: {
        ...prev[roomId],
        adultPricing: {
          ...prev[roomId].adultPricing,
          [adultCount]: parseFloat(value) || 0,
        },
      },
    }));
  }

  function handlePerAdultRateChange(roomId, value) {
    setOccupancyData(prev => ({
      ...prev,
      [roomId]: {
        ...prev[roomId],
        perAdultRate: parseFloat(value) || 0,
      },
    }));
  }

  function handleExtraChange(roomId, type, value) {
    setOccupancyData(prev => ({
      ...prev,
      [roomId]: {
        ...prev[roomId],
        [type]: parseFloat(value) || 0,
      },
    }));
  }

  function handleCalcTypeChange(roomId, adultCount, calcType) {
    setOccupancyData(prev => ({
      ...prev,
      [roomId]: {
        ...prev[roomId],
        calcType: {
          ...prev[roomId].calcType,
          [adultCount]: calcType,
        },
      },
    }));
  }

  function handleFixedAdjustmentChange(roomId, adultCount, value) {
    setOccupancyData(prev => ({
      ...prev,
      [roomId]: {
        ...prev[roomId],
        fixedAdjustment: {
          ...prev[roomId].fixedAdjustment,
          [adultCount]: parseFloat(value) || 0,
        },
      },
    }));
  }

  function handleRatioChange(roomId, adultCount, value) {
    setOccupancyData(prev => ({
      ...prev,
      [roomId]: {
        ...prev[roomId],
        ratioMultiplier: {
          ...prev[roomId].ratioMultiplier,
          [adultCount]: parseFloat(value) || 1,
        },
      },
    }));
  }

  function calculateFinalPrice(roomId, adultCount) {
    const roomData = occupancyData[roomId];
    if (!roomData) return 0;

    // If this is the base room or manual entry, return the direct price
    if (roomData.isBase || !roomData.calcType || roomData.calcType === 'manual') {
      if (pricingMode === 'per_adult') {
        return roomData.perAdultRate * adultCount;
      }
      return roomData.adultPricing[adultCount] || 0;
    }

    // If using fixed adjustment
    if (roomData.calcType[adultCount] === 'fixed') {
      const basePrice = occupancyData[baseRoomId]?.adultPricing[adultCount] || 0;
      const adjustment = roomData.fixedAdjustment[adultCount] || 0;
      return basePrice + adjustment;
    }

    // If using ratio
    if (roomData.calcType[adultCount] === 'ratio') {
      const basePrice = occupancyData[baseRoomId]?.adultPricing[adultCount] || 0;
      const ratio = roomData.ratioMultiplier[adultCount] || 1;
      return basePrice * ratio;
    }

    return roomData.adultPricing[adultCount] || 0;
  }

  async function handleSaveAll() {
    setLoading(true);
    try {
      const savePromises = roomTypes.map(room => {
        const roomData = occupancyData[room.id];

        // Calculate final prices for all occupancy types
        const finalAdultPricing = {};
        const numAdults = roomData.numAdultOptions || 2;

        if (pricingMode === 'flat_room') {
          // For flat room mode, use the same rate for all occupancy types
          const flatRate = calculateFinalPrice(room.id, 1);
          for (let i = 1; i <= numAdults; i++) {
            finalAdultPricing[i] = flatRate;
          }
        } else {
          // For occupancy-based and per-adult mode, calculate separately
          for (let i = 1; i <= numAdults; i++) {
            finalAdultPricing[i] = calculateFinalPrice(room.id, i);
          }
        }

        const dataToSave = {
          ...roomData,
          pricingMode,
          adultPricing: finalAdultPricing, // Save the calculated final prices
          extraAdult: roomData.extraAdult || 0,
          extraChild: roomData.extraChild || 0,
        };
        console.log(`Saving occupancy pricing for ${room.roomTypeName}:`, dataToSave);
        return onSave(room, dataToSave);
      });

      await Promise.all(savePromises);
      alert('Occupancy pricing saved successfully!');
    } catch (err) {
      alert('Failed to save: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!roomTypes || roomTypes.length === 0) {
    return (
      <div className="text-center py-6 text-slate-400 text-sm">
        No room types available. Add room types first in the Room Types tab.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Pricing Mode Toggle */}
      <div className="p-4 rounded-lg bg-white/5 border border-white/10">
        <label className="text-sm font-semibold text-white block mb-3">Pricing Mode:</label>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="flex items-start gap-2 cursor-pointer p-3 rounded-lg border border-white/10 hover:bg-white/5 transition-all">
            <input
              type="radio"
              name="pricingMode"
              value="flat_room"
              checked={pricingMode === "flat_room"}
              onChange={(e) => setPricingMode(e.target.value)}
              className="w-4 h-4 mt-0.5"
            />
            <div>
              <div className="text-white text-sm font-medium">Flat Room Rate</div>
              <div className="text-xs text-slate-400 mt-1">One price per room (any occupancy)</div>
              <div className="text-xs text-green-400 mt-1">Example: Executive = ₹5000</div>
            </div>
          </label>
          <label className="flex items-start gap-2 cursor-pointer p-3 rounded-lg border border-white/10 hover:bg-white/5 transition-all">
            <input
              type="radio"
              name="pricingMode"
              value="occupancy"
              checked={pricingMode === "occupancy"}
              onChange={(e) => setPricingMode(e.target.value)}
              className="w-4 h-4 mt-0.5"
            />
            <div>
              <div className="text-white text-sm font-medium">Occupancy-Based</div>
              <div className="text-xs text-slate-400 mt-1">Different rate per occupancy type</div>
              <div className="text-xs text-green-400 mt-1">Example: Single=₹2000, Double=₹2500</div>
            </div>
          </label>
          <label className="flex items-start gap-2 cursor-pointer p-3 rounded-lg border border-white/10 hover:bg-white/5 transition-all">
            <input
              type="radio"
              name="pricingMode"
              value="per_adult"
              checked={pricingMode === "per_adult"}
              onChange={(e) => setPricingMode(e.target.value)}
              className="w-4 h-4 mt-0.5"
            />
            <div>
              <div className="text-white text-sm font-medium">Per Adult Rate</div>
              <div className="text-xs text-slate-400 mt-1">Rate per person × number of adults</div>
              <div className="text-xs text-green-400 mt-1">Example: ₹1000/adult × 2 = ₹2000</div>
            </div>
          </label>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-white/20">
              <th className="text-left py-3 px-3 text-slate-300 font-semibold text-xs">Room</th>
              <th className="text-center py-3 px-3 text-slate-300 font-semibold text-xs">Base</th>
              <th className="text-left py-3 px-3 text-slate-300 font-semibold text-xs">Occupancy</th>
              <th className="text-left py-3 px-3 text-slate-300 font-semibold text-xs">
                {pricingMode === 'per_adult' ? 'Rate per Adult' : 'Room Rate'}
              </th>
              <th className="text-left py-3 px-3 text-slate-300 font-semibold text-xs">Calc Type</th>
              <th className="text-left py-3 px-3 text-slate-300 font-semibold text-xs">Adjustment/Ratio</th>
              <th className="text-left py-3 px-3 text-slate-300 font-semibold text-xs">Final Price</th>
            </tr>
          </thead>
          <tbody>
            {roomTypes.map((room) => {
              const roomData = occupancyData[room.id];
              if (!roomData) return null;

              const isBaseRoom = roomData.isBase;
              const numAdults = roomData.numAdultOptions || 2;

              // If flat_room mode, show only one row per room
              if (pricingMode === 'flat_room') {
                return (
                  <tr key={room.id} className="border-b border-white/10 hover:bg-white/5">
                    <td className="py-2 px-3 text-white text-sm">{room.roomTypeName}</td>
                    <td className="py-2 px-3 text-center">
                      <input
                        type="radio"
                        name="baseRoom"
                        checked={isBaseRoom}
                        onChange={() => handleSetBaseRoom(room.id)}
                        className="w-4 h-4"
                      />
                    </td>
                    <td className="py-2 px-3 text-white text-sm">Any</td>
                    <td className="py-2 px-3">
                      {isBaseRoom ? (
                        <div className="flex items-center gap-1">
                          <span className="px-2 py-0.5 rounded bg-green-600 text-white text-xs font-semibold">Master</span>
                          <input
                            type="number"
                            value={roomData.adultPricing[1] || 0}
                            onChange={(e) => handlePriceChange(room.id, 1, e.target.value)}
                            className="w-24 px-2 py-1 rounded bg-white/10 border border-white/20 text-white text-sm text-right"
                            placeholder="5000"
                          />
                        </div>
                      ) : (
                        <input
                          type="number"
                          value={roomData.adultPricing[1] || 0}
                          onChange={(e) => handlePriceChange(room.id, 1, e.target.value)}
                          className="w-24 px-2 py-1 rounded bg-white/10 border border-white/20 text-white text-sm text-right"
                          placeholder="5000"
                        />
                      )}
                    </td>
                    <td className="py-2 px-3">
                      {!isBaseRoom && (
                        <select
                          value={roomData.calcType?.[1] || 'manual'}
                          onChange={(e) => handleCalcTypeChange(room.id, 1, e.target.value)}
                          className="px-2 py-1 rounded bg-white/10 border border-white/20 text-white text-xs"
                        >
                          <option value="manual">Manual</option>
                          <option value="fixed">Fixed +/-</option>
                          <option value="ratio">Ratio</option>
                        </select>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      {!isBaseRoom && roomData.calcType?.[1] === 'fixed' && (
                        <div className="flex items-center gap-1">
                          <span className="text-slate-400 text-xs">+</span>
                          <input
                            type="number"
                            value={roomData.fixedAdjustment?.[1] || 0}
                            onChange={(e) => handleFixedAdjustmentChange(room.id, 1, e.target.value)}
                            className="w-20 px-2 py-1 rounded bg-white/10 border border-white/20 text-white text-sm text-right"
                            placeholder="500"
                          />
                        </div>
                      )}
                      {!isBaseRoom && roomData.calcType?.[1] === 'ratio' && (
                        <div className="flex items-center gap-1">
                          <span className="text-slate-400 text-xs">×</span>
                          <input
                            type="number"
                            step="0.1"
                            value={roomData.ratioMultiplier?.[1] || 1}
                            onChange={(e) => handleRatioChange(room.id, 1, e.target.value)}
                            className="w-20 px-2 py-1 rounded bg-white/10 border border-white/20 text-white text-sm text-right"
                            placeholder="1.2"
                          />
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-3 text-white text-sm font-semibold">
                      ₹{calculateFinalPrice(room.id, 1).toFixed(0)}
                    </td>
                  </tr>
                );
              }

              // If per_adult mode, show only one row
              if (pricingMode === 'per_adult') {
                return (
                  <tr key={room.id} className="border-b border-white/10 hover:bg-white/5">
                    <td className="py-2 px-3 text-white text-sm">{room.roomTypeName}</td>
                    <td className="py-2 px-3 text-center">
                      <input
                        type="radio"
                        name="baseRoom"
                        checked={isBaseRoom}
                        onChange={() => handleSetBaseRoom(room.id)}
                        className="w-4 h-4"
                      />
                    </td>
                    <td className="py-2 px-3 text-white text-sm">Per Adult</td>
                    <td className="py-2 px-3">
                      {isBaseRoom ? (
                        <input
                          type="number"
                          value={roomData.perAdultRate}
                          onChange={(e) => handlePerAdultRateChange(room.id, e.target.value)}
                          className="w-24 px-2 py-1 rounded bg-white/10 border border-white/20 text-white text-sm text-right"
                          placeholder="1000"
                        />
                      ) : (
                        <span className="text-white text-sm">Calculated</span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      {!isBaseRoom && (
                        <select
                          value={roomData.calcType || 'manual'}
                          onChange={(e) => handleCalcTypeChange(room.id, 'all', e.target.value)}
                          className="px-2 py-1 rounded bg-white/10 border border-white/20 text-white text-xs"
                        >
                          <option value="manual">Manual</option>
                          <option value="fixed">Fixed +/-</option>
                          <option value="ratio">Ratio</option>
                        </select>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      {!isBaseRoom && roomData.calcType === 'fixed' && (
                        <input
                          type="number"
                          value={roomData.fixedAdjustment['all'] || 0}
                          onChange={(e) => handleFixedAdjustmentChange(room.id, 'all', e.target.value)}
                          className="w-20 px-2 py-1 rounded bg-white/10 border border-white/20 text-white text-sm text-right"
                          placeholder="+500"
                        />
                      )}
                      {!isBaseRoom && roomData.calcType === 'ratio' && (
                        <input
                          type="number"
                          step="0.1"
                          value={roomData.ratioMultiplier['all'] || 1}
                          onChange={(e) => handleRatioChange(room.id, 'all', e.target.value)}
                          className="w-20 px-2 py-1 rounded bg-white/10 border border-white/20 text-white text-sm text-right"
                          placeholder="1.2"
                        />
                      )}
                    </td>
                    <td className="py-2 px-3 text-white text-sm font-semibold">
                      ₹{roomData.perAdultRate || 0}
                    </td>
                  </tr>
                );
              }

              // Room level mode - show rows for each occupancy type
              return Array.from({ length: numAdults }, (_, i) => i + 1).map((adultCount) => (
                <tr key={`${room.id}-${adultCount}`} className="border-b border-white/10 hover:bg-white/5">
                  {adultCount === 1 && (
                    <td rowSpan={numAdults} className="py-2 px-3 text-white text-sm border-r border-white/10">
                      {room.roomTypeName}
                    </td>
                  )}
                  {adultCount === 1 && (
                    <td rowSpan={numAdults} className="py-2 px-3 text-center border-r border-white/10">
                      <input
                        type="radio"
                        name="baseRoom"
                        checked={isBaseRoom}
                        onChange={() => handleSetBaseRoom(room.id)}
                        className="w-4 h-4"
                      />
                    </td>
                  )}
                  <td className="py-2 px-3 text-white text-sm">{getOccupancyLabel(adultCount)}</td>
                  <td className="py-2 px-3">
                    {isBaseRoom ? (
                      <div className="flex items-center gap-1">
                        <span className="px-2 py-0.5 rounded bg-green-600 text-white text-xs font-semibold">Master</span>
                        <input
                          type="number"
                          value={roomData.adultPricing[adultCount] || 0}
                          onChange={(e) => handlePriceChange(room.id, adultCount, e.target.value)}
                          className="w-24 px-2 py-1 rounded bg-white/10 border border-white/20 text-white text-sm text-right"
                        />
                      </div>
                    ) : (
                      <input
                        type="number"
                        value={roomData.adultPricing[adultCount] || 0}
                        onChange={(e) => handlePriceChange(room.id, adultCount, e.target.value)}
                        className="w-24 px-2 py-1 rounded bg-white/10 border border-white/20 text-white text-sm text-right"
                      />
                    )}
                  </td>
                  <td className="py-2 px-3">
                    {!isBaseRoom && (
                      <select
                        value={roomData.calcType?.[adultCount] || 'manual'}
                        onChange={(e) => handleCalcTypeChange(room.id, adultCount, e.target.value)}
                        className="px-2 py-1 rounded bg-white/10 border border-white/20 text-white text-xs"
                      >
                        <option value="manual">Manual</option>
                        <option value="fixed">Fixed +/-</option>
                        <option value="ratio">Ratio</option>
                      </select>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    {!isBaseRoom && roomData.calcType?.[adultCount] === 'fixed' && (
                      <div className="flex items-center gap-1">
                        <span className="text-slate-400 text-xs">+</span>
                        <input
                          type="number"
                          value={roomData.fixedAdjustment?.[adultCount] || 0}
                          onChange={(e) => handleFixedAdjustmentChange(room.id, adultCount, e.target.value)}
                          className="w-20 px-2 py-1 rounded bg-white/10 border border-white/20 text-white text-sm text-right"
                          placeholder="500"
                        />
                      </div>
                    )}
                    {!isBaseRoom && roomData.calcType?.[adultCount] === 'ratio' && (
                      <div className="flex items-center gap-1">
                        <span className="text-slate-400 text-xs">×</span>
                        <input
                          type="number"
                          step="0.1"
                          value={roomData.ratioMultiplier?.[adultCount] || 1}
                          onChange={(e) => handleRatioChange(room.id, adultCount, e.target.value)}
                          className="w-20 px-2 py-1 rounded bg-white/10 border border-white/20 text-white text-sm text-right"
                          placeholder="1.2"
                        />
                      </div>
                    )}
                  </td>
                  <td className="py-2 px-3 text-white text-sm font-semibold">
                    ₹{calculateFinalPrice(room.id, adultCount).toFixed(0)}
                  </td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>

      {/* Extra Charges Section */}
      <div className="p-4 rounded-lg bg-white/5 border border-white/10">
        <h5 className="text-sm font-semibold text-white mb-3">Extra Charges (Optional)</h5>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {roomTypes.map(room => {
            const roomData = occupancyData[room.id];
            if (!roomData) return null;

            return (
              <div key={room.id} className="space-y-2">
                <div className="text-xs text-slate-400 font-semibold">{room.roomTypeName}</div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-xs text-slate-300 block mb-1">Extra Adult</label>
                    <input
                      type="number"
                      value={roomData.extraAdult || ''}
                      onChange={(e) => handleExtraChange(room.id, 'extraAdult', e.target.value)}
                      className="w-full px-2 py-1 rounded bg-white/10 border border-white/20 text-white text-sm"
                      placeholder="800"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-slate-300 block mb-1">Extra Child</label>
                    <input
                      type="number"
                      value={roomData.extraChild || ''}
                      onChange={(e) => handleExtraChange(room.id, 'extraChild', e.target.value)}
                      className="w-full px-2 py-1 rounded bg-white/10 border border-white/20 text-white text-sm"
                      placeholder="500"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSaveAll}
          disabled={loading}
          className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-semibold text-sm transition-all disabled:opacity-50"
        >
          {loading ? 'Saving...' : '💾 Save All Occupancy Pricing'}
        </button>
      </div>
    </div>
  );
}
