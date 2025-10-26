"use client";

import { useState, useEffect as React_useEffect } from "react";
import OccupancyConfig from "./OccupancyConfig";

const React = { useEffect: React_useEffect };

export default function RoomTypeCard({ room, index, totalRooms, onUpdate, onDelete, onSaveOccupancy, onRankChange, showOccupancy = true }) {
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rankInput, setRankInput] = useState((index + 1).toString());

  const [editData, setEditData] = useState({
    roomTypeName: room.roomTypeName,
    basePrice: room.basePrice,
    numberOfRooms: room.numberOfRooms,
    maxAdults: room.maxAdults || 2,
    description: room.description || "",
  });

  async function handleSave() {
    if (!editData.roomTypeName || !editData.basePrice || !editData.numberOfRooms) {
      setError("Room name, base price, and number of rooms are required");
      return;
    }

    try {
      setLoading(true);
      setError("");
      await onUpdate(room.id, editData);
      setIsEditing(false);
    } catch (err) {
      setError("Failed to update: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleCancel() {
    setEditData({
      roomTypeName: room.roomTypeName,
      basePrice: room.basePrice,
      numberOfRooms: room.numberOfRooms,
      maxAdults: room.maxAdults || 2,
      description: room.description || "",
    });
    setIsEditing(false);
    setError("");
  }

  const inputClass = "w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-indigo-500";

  function handleRankChange(e) {
    const value = e.target.value;
    setRankInput(value);
    const numValue = parseInt(value);
    if (!isNaN(numValue) && numValue >= 1 && numValue <= totalRooms) {
      onRankChange(numValue);
    }
  }

  // Update rank input when index changes
  React.useEffect(() => {
    setRankInput((index + 1).toString());
  }, [index]);

  return (
    <div className="p-3 rounded-lg bg-white/5 border border-white/10 hover:border-white/20 transition-all">
      {error && (
        <div className="mb-3 rounded-lg bg-rose-500/10 border border-rose-500/20 p-3">
          <p className="text-rose-400 text-xs">⚠️ {error}</p>
        </div>
      )}

      {!isEditing ? (
        <>
          {/* View Mode - Compact */}
          <div className="flex items-center justify-between gap-3">
            {/* Rank Input */}
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max={totalRooms}
                value={rankInput}
                onChange={handleRankChange}
                className="w-12 px-2 py-1 rounded bg-white/10 border border-white/20 text-white text-sm text-center focus:outline-none focus:border-indigo-500"
                title="Rank"
              />
            </div>

            {/* Room Info - Compact */}
            <div className="flex-1 flex items-center gap-4">
              <h5 className="text-white font-semibold text-sm">🏠 {room.roomTypeName}</h5>
              <span className="text-xs text-slate-400">
                ₹{room.basePrice} • {room.numberOfRooms} rooms • Max {room.maxAdults || 2} adults
              </span>
              {room.description && (
                <span className="text-xs text-slate-500 italic truncate max-w-xs">{room.description}</span>
              )}
            </div>

            {/* Action Buttons - Compact */}
            <div className="flex gap-1">
              <button
                onClick={() => setIsEditing(true)}
                className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-all"
                title="Edit"
              >
                ✏️
              </button>
              <button
                onClick={() => onDelete(room)}
                className="px-2 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-medium transition-colors border border-rose-500/20"
                title="Delete"
              >
                🗑️
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Edit Mode */}
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-2">
              <h5 className="text-white font-semibold text-sm">✏️ Editing Room Type</h5>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-300 mb-1">Room Type Name *</label>
                <input
                  type="text"
                  value={editData.roomTypeName}
                  onChange={(e) => setEditData({ ...editData, roomTypeName: e.target.value })}
                  className={inputClass}
                  placeholder="e.g., Deluxe Suite"
                  required
                />
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">Base Price (₹) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={editData.basePrice}
                  onChange={(e) => setEditData({ ...editData, basePrice: e.target.value })}
                  className={inputClass}
                  placeholder="3500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">Number of Rooms *</label>
                <input
                  type="number"
                  value={editData.numberOfRooms}
                  onChange={(e) => setEditData({ ...editData, numberOfRooms: e.target.value })}
                  className={inputClass}
                  placeholder="10"
                  required
                />
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">Max Adults *</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={editData.maxAdults}
                  onChange={(e) => setEditData({ ...editData, maxAdults: e.target.value })}
                  className={inputClass}
                  placeholder="2"
                  required
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs text-slate-300 mb-1">Description (Optional)</label>
                <input
                  type="text"
                  value={editData.description}
                  onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                  className={inputClass}
                  placeholder="Brief description"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSave}
                disabled={loading}
                className="flex-1 px-4 py-2 rounded-lg bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white text-sm font-medium disabled:opacity-50 transition-all shadow-lg shadow-green-500/20"
              >
                {loading ? "💾 Saving..." : "✅ Save Changes"}
              </button>
              <button
                onClick={handleCancel}
                disabled={loading}
                className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-sm font-medium transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}

      {/* Occupancy Configuration - Conditional */}
      {!isEditing && showOccupancy && (
        <OccupancyConfig
          roomType={room}
          onSave={onSaveOccupancy}
        />
      )}
    </div>
  );
}
