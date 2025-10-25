"use client";

import { useState, useEffect } from "react";
import MealPlanConfig from "./MealPlanConfig";
import RoomTypeCard from "./RoomTypeCard";
import OccupancyConfig from "./OccupancyConfig";
import OccupancyPricingTable from "./OccupancyPricingTable";

export default function PropertySetup({ hotel, roomTypes: initialRoomTypes, ratePlans: initialRatePlans, onRoomTypesChange, onRatePlansChange, onHotelCreated, onCalculate, loading: parentLoading }) {
  const [hotelName, setHotelName] = useState(hotel?.hotelName || "");
  const [location, setLocation] = useState(hotel?.location || "");
  const [roomTypes, setRoomTypes] = useState(initialRoomTypes || []);
  const [ratePlans, setRatePlans] = useState(initialRatePlans || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [activeTab, setActiveTab] = useState("rooms"); // "rooms", "rates", or "occupancy"

  // Sync with parent state
  useEffect(() => {
    if (initialRoomTypes) setRoomTypes(initialRoomTypes);
  }, [initialRoomTypes]);

  useEffect(() => {
    if (initialRatePlans) setRatePlans(initialRatePlans);
  }, [initialRatePlans]);

  const [showAddRoom, setShowAddRoom] = useState(false);
  const [showAddPlan, setShowAddPlan] = useState(false);
  const [newRoom, setNewRoom] = useState({
    roomTypeName: "",
    basePrice: "",
    numberOfRooms: "",
    description: "",
    amenities: [],
  });
  const [newPlan, setNewPlan] = useState({
    planName: "",
    multiplier: "",
    description: "",
  });

  useEffect(() => {
    if (hotel) {
      loadRoomTypes();
      loadRatePlans();
    }
  }, [hotel]);

  async function loadRoomTypes() {
    try {
      const res = await fetch(`/api/dynamicPricing/roomTypes?hotelId=${hotel.hotelId}`);
      const data = await res.json();
      if (res.ok) {
        console.log("Loaded room types:", data.roomTypes);
        // Sort by rank if available, otherwise by creation order
        const sorted = (data.roomTypes || []).sort((a, b) => {
          const rankA = a.rank || 999;
          const rankB = b.rank || 999;
          console.log(`Comparing ${a.roomTypeName} (rank: ${rankA}) vs ${b.roomTypeName} (rank: ${rankB})`);
          return rankA - rankB;
        });
        console.log("Sorted room types:", sorted);
        setRoomTypes(sorted);
      }
    } catch (err) {
      console.error("Error loading room types:", err);
    }
  }

  async function loadRatePlans() {
    try {
      const res = await fetch(`/api/dynamicPricing/ratePlans?hotelId=${hotel.hotelId}`);
      const data = await res.json();
      if (res.ok) {
        setRatePlans(data.ratePlans || []);
      }
    } catch (err) {
      console.error("Error loading rate plans:", err);
    }
  }

  async function handleCreateHotel(e, name = null, loc = null) {
    e.preventDefault();

    const finalName = name || hotelName;
    const finalLocation = loc || location;

    if (!finalName || !finalLocation) {
      setError("Hotel name and location are required");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const res = await fetch("/api/dynamicPricing/hotels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hotelName: finalName,
          location: finalLocation,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        onHotelCreated(data.hotel);
        // Reload the page to show the new hotel
        window.location.reload();
      } else {
        setError(data.error || "Failed to create hotel");
      }
    } catch (err) {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddRoomType(e) {
    e.preventDefault();

    if (!newRoom.roomTypeName || !newRoom.basePrice || !newRoom.numberOfRooms) {
      setError("Room type name, base price, and number of rooms are required");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const res = await fetch("/api/dynamicPricing/roomTypes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hotelId: hotel.hotelId,
          ...newRoom,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        const updatedRoomTypes = [...roomTypes, data.roomType];
        setRoomTypes(updatedRoomTypes);
        onRoomTypesChange?.(updatedRoomTypes);
        setNewRoom({
          roomTypeName: "",
          basePrice: "",
          numberOfRooms: "",
          description: "",
          amenities: [],
        });
        setShowAddRoom(false);
      } else {
        setError(data.error || "Failed to add room type");
      }
    } catch (err) {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteRoomType(roomType) {
    if (!confirm(`Delete ${roomType.roomTypeName}?`)) return;

    try {
      setLoading(true);
      const res = await fetch(`/api/dynamicPricing/roomTypes?recordId=${roomType.id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        const updatedRoomTypes = roomTypes.filter((r) => r.id !== roomType.id);
        setRoomTypes(updatedRoomTypes);
        onRoomTypesChange?.(updatedRoomTypes);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to delete room type");
      }
    } catch (err) {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateRoomType(recordId, updates) {
    try {
      setLoading(true);
      const res = await fetch(`/api/dynamicPricing/roomTypes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordId,
          ...updates,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        // Update the room type in the list
        setRoomTypes(roomTypes.map((r) =>
          r.id === recordId ? { ...r, ...updates } : r
        ));
      } else {
        const data = await res.json();
        throw new Error(data.error || "Failed to update room type");
      }
    } catch (err) {
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveOccupancyPricing(roomType, occupancyPricing) {
    try {
      const res = await fetch(`/api/dynamicPricing/roomTypes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordId: roomType.id,
          occupancyPricing: JSON.stringify(occupancyPricing),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        // Update the room type in the list
        setRoomTypes(roomTypes.map((r) =>
          r.id === roomType.id
            ? { ...r, occupancyPricing }
            : r
        ));
      } else {
        const data = await res.json();
        throw new Error(data.error || "Failed to save occupancy pricing");
      }
    } catch (err) {
      throw err;
    }
  }

  async function handleSaveRoomRankings(newRoomTypes) {
    try {
      console.log("Saving room rankings...");
      setLoading(true);

      // Update each room type with its new rank
      const updatePromises = newRoomTypes.map((room, index) => {
        const rank = index + 1;
        console.log(`Updating ${room.roomTypeName} to rank ${rank} (recordId: ${room.id})`);
        return fetch(`/api/dynamicPricing/roomTypes`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recordId: room.id,
            rank: rank,
          }),
        });
      });

      const responses = await Promise.all(updatePromises);
      console.log("All ranking updates completed");

      // Check responses
      for (const res of responses) {
        const data = await res.json();
        console.log("Update response:", data);
      }

      // Update local state immediately with rank field
      const updatedRoomTypes = newRoomTypes.map((room, index) => ({
        ...room,
        rank: index + 1
      }));

      setRoomTypes(updatedRoomTypes);
      onRoomTypesChange?.(updatedRoomTypes);

      console.log("Room rankings saved successfully!");

    } catch (err) {
      console.error("Failed to save room rankings:", err);
      setError("Failed to save room rankings");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddRatePlan(e) {
    e.preventDefault();

    if (!newPlan.planName || !newPlan.multiplier) {
      setError("Plan name and multiplier are required");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const res = await fetch("/api/dynamicPricing/ratePlans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hotelId: hotel.hotelId,
          ...newPlan,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setRatePlans([...ratePlans, data.ratePlan]);
        setNewPlan({
          planName: "",
          multiplier: "",
          description: "",
        });
        setShowAddPlan(false);
      } else {
        setError(data.error || "Failed to add rate plan");
      }
    } catch (err) {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteRatePlan(ratePlan) {
    if (!confirm(`Delete ${ratePlan.planName}?`)) return;

    try {
      setLoading(true);
      const res = await fetch(`/api/dynamicPricing/ratePlans?recordId=${ratePlan.id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setRatePlans(ratePlans.filter((p) => p.id !== ratePlan.id));
      } else {
        const data = await res.json();
        setError(data.error || "Failed to delete rate plan");
      }
    } catch (err) {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  const controlLabel = "text-xs font-semibold uppercase tracking-[0.2em] text-slate-200/70 mb-2";
  const inputClass = "w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/50 focus:bg-white/10 transition-all";

  if (!hotel) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-8">
          <div className="text-center mb-6">
            <div className="text-5xl mb-4">🏨</div>
            <h3 className="text-2xl font-bold text-white mb-3">Welcome to Dynamic Pricing</h3>
            <p className="text-slate-400 text-sm mb-6">
              {loading ? "Loading your hotel..." : "Let's get started by creating your first hotel property"}
            </p>
          </div>

          {!loading && (
            <>
              <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-4 mb-6">
                <h4 className="text-white font-semibold text-sm mb-3">📋 What you'll set up:</h4>
                <ul className="text-slate-300 text-sm space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-green-400">✓</span>
                    <span><strong>Hotel Details:</strong> Name and location</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-400">✓</span>
                    <span><strong>Room Types:</strong> Different room categories with base prices</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-400">✓</span>
                    <span><strong>Rate Plans:</strong> Meal plans (EP, CP, MAP, AP)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-400">✓</span>
                    <span><strong>Occupancy Pricing:</strong> Pricing for different guest counts</span>
                  </li>
                </ul>
              </div>

              {error && (
                <div className="mb-4 rounded-lg bg-rose-500/10 border border-rose-500/20 p-3">
                  <p className="text-rose-400 text-sm">⚠️ {error}</p>
                </div>
              )}

              <button
                onClick={() => {
                  const name = prompt("Enter Hotel Name:");
                  if (!name) return;
                  const loc = prompt("Enter Location (City, State):");
                  if (!loc) return;
                  handleCreateHotel({ preventDefault: () => {} }, name, loc);
                }}
                className="w-full px-6 py-3 rounded-lg bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-semibold transition-all shadow-lg shadow-indigo-500/20"
              >
                🚀 Create Your First Property
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Hotel Info - Compact Header */}
      <div className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-white">{hotel.hotelName}</h3>
            <p className="text-xs text-slate-400">{hotel.location}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const name = prompt("Enter New Hotel Name:", hotel.hotelName);
                const loc = prompt("Enter New Location:", hotel.location);
                if (name && loc) {
                  setHotelName(name);
                  setLocation(loc);
                  // Auto-save
                  fetch(`/api/dynamicPricing/hotels/${hotel.hotelId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ hotelName: name, location: loc }),
                  }).then(res => {
                    if (res.ok) {
                      window.location.reload();
                    }
                  });
                }
              }}
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-all"
            >
              ✏️ Edit Property
            </button>
            <button
              onClick={() => {
                const name = prompt("Enter Hotel Name for New Property:");
                if (!name) return;
                const loc = prompt("Enter Location:");
                if (!loc) return;
                handleCreateHotel({ preventDefault: () => {} }, name, loc);
              }}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-all"
            >
              + Add New Property
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/10">
        <button
          onClick={() => setActiveTab("rooms")}
          className={`px-4 py-2 text-sm font-medium transition-all ${
            activeTab === "rooms"
              ? "text-white border-b-2 border-indigo-500"
              : "text-slate-400 hover:text-white"
          }`}
        >
          Room Types
        </button>
        <button
          onClick={() => setActiveTab("rates")}
          className={`px-4 py-2 text-sm font-medium transition-all ${
            activeTab === "rates"
              ? "text-white border-b-2 border-indigo-500"
              : "text-slate-400 hover:text-white"
          }`}
        >
          Rate Plans
        </button>
        <button
          onClick={() => setActiveTab("occupancy")}
          className={`px-4 py-2 text-sm font-medium transition-all ${
            activeTab === "occupancy"
              ? "text-white border-b-2 border-indigo-500"
              : "text-slate-400 hover:text-white"
          }`}
        >
          Occupancy Pricing
        </button>
      </div>

      {/* Room Types Tab */}
      {activeTab === "rooms" && (
        <div className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-base font-semibold text-white">Room Types</h4>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  if (confirm('Initialize ranks for all room types based on current order?')) {
                    try {
                      const res = await fetch('/api/dynamicPricing/initializeRanks', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ hotelId: hotel.hotelId }),
                      });
                      const data = await res.json();
                      if (res.ok) {
                        alert(data.message);
                        await loadRoomTypes();
                      } else {
                        alert('Error: ' + data.error);
                      }
                    } catch (err) {
                      alert('Failed to initialize ranks');
                    }
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-yellow-600 hover:bg-yellow-500 text-white text-xs font-medium transition-all"
                title="Initialize ranks for existing rooms"
              >
                🔄 Init Ranks
              </button>
              <button
                onClick={() => setShowAddRoom(!showAddRoom)}
                className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white text-xs font-medium transition-all"
              >
                {showAddRoom ? "Cancel" : "+ Add Room"}
              </button>
            </div>
          </div>

        {error && (
          <div className="mb-3 rounded-lg bg-rose-500/10 border border-rose-500/20 p-3">
            <p className="text-rose-400 text-xs">{error}</p>
          </div>
        )}

        {showAddRoom && (
          <form onSubmit={handleAddRoomType} className="mb-4 p-4 rounded-lg bg-white/5 border border-white/10 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={controlLabel}>Room Type Name</label>
                <input
                  type="text"
                  value={newRoom.roomTypeName}
                  onChange={(e) => setNewRoom({ ...newRoom, roomTypeName: e.target.value })}
                  className={inputClass}
                  placeholder="e.g., Deluxe Suite"
                  required
                />
              </div>

              <div>
                <label className={controlLabel}>Base Price (per night)</label>
                <input
                  type="number"
                  step="0.01"
                  value={newRoom.basePrice}
                  onChange={(e) => setNewRoom({ ...newRoom, basePrice: e.target.value })}
                  className={inputClass}
                  placeholder="150.00"
                  required
                />
              </div>

              <div>
                <label className={controlLabel}>Number of Rooms</label>
                <input
                  type="number"
                  value={newRoom.numberOfRooms}
                  onChange={(e) => setNewRoom({ ...newRoom, numberOfRooms: e.target.value })}
                  className={inputClass}
                  placeholder="10"
                  required
                />
              </div>

              <div>
                <label className={controlLabel}>Description (Optional)</label>
                <input
                  type="text"
                  value={newRoom.description}
                  onChange={(e) => setNewRoom({ ...newRoom, description: e.target.value })}
                  className={inputClass}
                  placeholder="Brief description"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white text-sm font-medium disabled:opacity-50 transition-all"
            >
              {loading ? "Adding..." : "Add Room Type"}
            </button>
          </form>
        )}

        {roomTypes.length === 0 ? (
          <div className="text-center py-6 text-slate-400 text-sm">
            No room types added yet. Add your first room type to continue.
          </div>
        ) : (
          <div className="space-y-2">
            {roomTypes.map((room, index) => (
              <RoomTypeCard
                key={room.id}
                room={room}
                index={index}
                totalRooms={roomTypes.length}
                onUpdate={handleUpdateRoomType}
                onDelete={handleDeleteRoomType}
                onSaveOccupancy={(occupancyPricing) => handleSaveOccupancyPricing(room, occupancyPricing)}
                onRankChange={(newRank) => {
                  const targetIndex = newRank - 1;
                  if (targetIndex >= 0 && targetIndex < roomTypes.length && targetIndex !== index) {
                    const newRoomTypes = [...roomTypes];
                    const [movedRoom] = newRoomTypes.splice(index, 1);
                    newRoomTypes.splice(targetIndex, 0, movedRoom);
                    handleSaveRoomRankings(newRoomTypes);
                  }
                }}
                showOccupancy={false}
              />
            ))}
          </div>
        )}
        </div>
      )}

      {/* Rate Plans Tab */}
      {activeTab === "rates" && (
        <div className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-base font-semibold text-white">Meal Plans / Rate Plans</h4>
          </div>
          <MealPlanConfig
            hotel={hotel}
            ratePlans={ratePlans}
            onPlansUpdated={(plans) => {
              setRatePlans(plans);
              onRatePlansChange?.(plans);
            }}
            loading={loading}
            setLoading={setLoading}
          />
        </div>
      )}

      {/* Occupancy Pricing Tab */}
      {activeTab === "occupancy" && (
        <div className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-4">
          <div className="mb-4">
            <h4 className="text-base font-semibold text-white">Occupancy-Based Pricing</h4>
            <p className="text-xs text-slate-400 mt-1">Set one room as Base (Master) and calculate others using Fixed Price or Multiplier</p>
          </div>

          <OccupancyPricingTable
            roomTypes={roomTypes}
            onSave={handleSaveOccupancyPricing}
          />
        </div>
      )}

      {/* Success Message */}
      {saveSuccess && (
        <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-3">
          <p className="text-green-400 text-sm text-center">✅ All changes saved successfully!</p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3">
        {activeTab === "rooms" && (
          <button
            onClick={() => {
              // All individual saves already happen in real-time
              // This button provides confirmation feedback
              setSaveSuccess(true);
              setTimeout(() => setSaveSuccess(false), 3000);
            }}
            className="flex-1 px-5 py-2.5 rounded-lg bg-green-600 hover:bg-green-500 text-white font-semibold text-sm transition-all"
          >
            💾 Save All Changes
          </button>
        )}
        {roomTypes.length > 0 && (
          <button
            onClick={onCalculate}
            disabled={parentLoading}
            className="flex-1 px-5 py-2.5 rounded-lg bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-semibold text-sm transition-all disabled:opacity-50"
          >
            {parentLoading ? "Calculating..." : "📊 Calculate Pricing"}
          </button>
        )}
      </div>
    </div>
  );
}
