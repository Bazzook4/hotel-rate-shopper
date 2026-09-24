"use client";

import { useState } from "react";

export default function OccupancyConfig({ roomType, onSave }) {
  const [showConfig, setShowConfig] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Step 1: Ask how many adult capacity options they want to define
  const [numAdultOptions, setNumAdultOptions] = useState(
    roomType?.occupancy_pricing?.numAdultOptions || ""
  );

  // Step 2: Collect pricing for each adult count
  const [adultPricing, setAdultPricing] = useState(
    roomType?.occupancy_pricing?.adultPricing || {}
  );

  // Extra charges
  const [extraAdult, setExtraAdult] = useState(
    roomType?.occupancy_pricing?.extraAdult || ""
  );
  const [extraChild, setExtraChild] = useState(
    roomType?.occupancy_pricing?.extraChild || ""
  );

  async function handleSave(e) {
    e.preventDefault();

    if (!numAdultOptions || numAdultOptions < 1) {
      setError("Please specify how many adult capacity options you want to define");
      return;
    }

    // Validate that ALL adult counts have prices set (not just some)
    const missingPrices = [];
    for (let i = 1; i <= parseInt(numAdultOptions); i++) {
      const price = adultPricing[i];
      if (!price || parseFloat(price) <= 0) {
        const labels = ['Single', 'Double', 'Triple', 'Quad'];
        const label = i <= 4 ? labels[i - 1] : `${i} Adults`;
        missingPrices.push(label);
      }
    }

    if (missingPrices.length > 0) {
      setError(`Please set prices for all adult counts: ${missingPrices.join(', ')}`);
      return;
    }

    try {
      setLoading(true);
      setError("");

      // Format the data
      const formattedPricing = {
        numAdultOptions: parseInt(numAdultOptions),
        adultPricing: {},
      };

      // Add adult pricing
      Object.keys(adultPricing).forEach(key => {
        const value = parseFloat(adultPricing[key]);
        if (value > 0) {
          formattedPricing.adultPricing[key] = value;
        }
      });

      // Add extra charges if provided
      if (extraAdult && parseFloat(extraAdult) > 0) {
        formattedPricing.extraAdult = parseFloat(extraAdult);
      }
      if (extraChild && parseFloat(extraChild) > 0) {
        formattedPricing.extraChild = parseFloat(extraChild);
      }

      await onSave(formattedPricing);
      setShowConfig(false);
    } catch (err) {
      setError("Failed to save: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleCancel() {
    setShowConfig(false);
    setError("");
    // Reset to saved values
    setNumAdultOptions(roomType?.occupancy_pricing?.numAdultOptions || "");
    setAdultPricing(roomType?.occupancy_pricing?.adultPricing || {});
    setExtraAdult(roomType?.occupancy_pricing?.extraAdult || "");
    setExtraChild(roomType?.occupancy_pricing?.extraChild || "");
  }

  function handleNumAdultOptionsChange(value) {
    setNumAdultOptions(value);
    // Initialize pricing object for the number of adults
    const newPricing = {};
    for (let i = 1; i <= parseInt(value); i++) {
      newPricing[i] = adultPricing[i] || "";
    }
    setAdultPricing(newPricing);
  }

  const hasExistingPricing = roomType?.occupancy_pricing?.numAdultOptions;
  const numAdultsNum = parseInt(numAdultOptions) || 0;

  // Helper to get occupancy label
  const getOccupancyLabel = (num) => {
    const labels = {
      1: "Single (1 Adult)",
      2: "Double (2 Adults)",
      3: "Triple (3 Adults)",
      4: "Quad (4 Adults)",
    };
    return labels[num] || `${num} Adults`;
  };

  return (
    <div className="mt-3 p-4 rounded-lg bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-[var(--accent)]">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h5 className="h2 text-sm flex items-center gap-2">
            👥 Occupancy Pricing
          </h5>
          <p className="text-xs muted mt-0.5">
            {hasExistingPricing
              ? `${roomType.occupancy_pricing.numAdultOptions} adult occupancy options configured`
              : "Define pricing for different adult counts"
            }
          </p>
        </div>
        {!showConfig && (
          <button
            type="button"
            onClick={() => setShowConfig(true)}
            className="px-3 py-1.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent)] text-ink text-xs font-medium transition-all shadow-lg shadow-indigo-500/20"
          >
            {hasExistingPricing ? "✏️ Edit" : "⚙️ Configure"}
          </button>
        )}
      </div>

      {/* Show existing pricing summary when not editing */}
      {hasExistingPricing && !showConfig && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {Object.entries(roomType.occupancy_pricing.adultPricing || {}).map(([adults, price]) => (
              <div key={adults} className="p-2 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                <div className="text-xs muted">{getOccupancyLabel(parseInt(adults))}</div>
                <div className="text-ink font-semibold">₹{price}</div>
              </div>
            ))}
          </div>
          {(roomType.occupancy_pricing.extraAdult || roomType.occupancy_pricing.extraChild) && (
            <div className="pt-2 ">
              <div className="text-xs muted mb-2">Extra Charges:</div>
              <div className="grid grid-cols-2 gap-2">
                {roomType.occupancy_pricing.extraAdult && (
                  <div className="p-2 rounded-lg bg-[var(--warn-soft)] border border-[var(--warn)]">
                    <div className="text-xs text-[var(--warn)]">Extra Adult</div>
                    <div className="text-ink font-semibold">+₹{roomType.occupancy_pricing.extraAdult}</div>
                  </div>
                )}
                {roomType.occupancy_pricing.extraChild && (
                  <div className="p-2 rounded-lg bg-[var(--accent-soft)] border border-[var(--accent)]">
                    <div className="text-xs text-[var(--accent-text)]">Extra Child</div>
                    <div className="text-ink font-semibold">+₹{roomType.occupancy_pricing.extraChild}</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Configuration form */}
      {showConfig && (
        <form onSubmit={handleSave} className="mt-4 space-y-4">
          {error && (
            <div className="rounded-lg bg-[var(--danger-soft)] border border-[var(--danger)] p-3">
              <p className="text-[var(--danger)] text-xs">⚠️ {error}</p>
            </div>
          )}

          {/* Step 1: How many adult capacity options */}
          <div className="p-4 rounded-lg bg-[var(--surface-2)] border border-white/20">
            <label className="block">
              <div className="text-ink font-medium text-sm mb-2">
                🛏️ How many adults can this room accommodate?
              </div>
              <p className="text-xs muted mb-3">
                Enter the maximum number of adults. We'll ask for pricing for 1 adult, 2 adults, etc. up to your maximum.
              </p>
              <input
                type="number"
                min="1"
                max="10"
                value={numAdultOptions}
                onChange={(e) => handleNumAdultOptionsChange(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg bg-[var(--surface-2)] border border-white/20 text-ink text-sm focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]"
                placeholder="e.g., 3 (for single, double, triple)"
                required
              />
            </label>
          </div>

          {/* Step 2: Show pricing fields for each adult count */}
          {numAdultsNum > 0 && (
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--accent-text)]">
                💰 Set Price For Each Occupancy Level
              </div>

              {Array.from({ length: numAdultsNum }, (_, i) => i + 1).map((adultCount) => (
                <div key={adultCount} className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                  <label className="block">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <div className="text-ink font-medium text-sm">
                          {"🧍".repeat(adultCount)} {getOccupancyLabel(adultCount)}
                        </div>
                        <div className="text-xs muted">Price for {adultCount} adult{adultCount > 1 ? 's' : ''}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="muted text-sm">₹</span>
                      <input
                        type="number"
                        step="0.01"
                        value={adultPricing[adultCount] || ""}
                        onChange={(e) => setAdultPricing({
                          ...adultPricing,
                          [adultCount]: e.target.value
                        })}
                        className="flex-1 px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-ink text-sm placeholder:faint focus:outline-none focus:border-[var(--accent)]"
                        placeholder={adultCount === 1 ? "2500" : adultCount === 2 ? "3500" : adultCount === 3 ? "4500" : ""}
                      />
                    </div>
                  </label>
                </div>
              ))}

              {/* Extra charges section */}
              <div className="pt-2 ">
                <div className="text-xs font-semibold uppercase tracking-wider muted mb-3">
                  ➕ Extra Charges (Optional)
                </div>

                <div className="space-y-3">
                  {/* Extra Adult */}
                  <div className="p-3 rounded-lg bg-[var(--warn-soft)] border border-[var(--warn)]">
                    <label className="block">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <div className="text-ink font-medium text-sm">➕ Extra Adult Charge</div>
                          <div className="text-xs text-[var(--warn)]">
                            Additional charge per extra adult beyond defined capacity
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="muted text-sm">+₹</span>
                        <input
                          type="number"
                          step="0.01"
                          value={extraAdult}
                          onChange={(e) => setExtraAdult(e.target.value)}
                          className="flex-1 px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-ink text-sm placeholder:faint focus:outline-none focus:border-amber-500"
                          placeholder="800"
                        />
                      </div>
                    </label>
                  </div>

                  {/* Extra Child */}
                  <div className="p-3 rounded-lg bg-[var(--accent-soft)] border border-[var(--accent)]">
                    <label className="block">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <div className="text-ink font-medium text-sm">👶 Extra Child Charge</div>
                          <div className="text-xs text-[var(--accent-text)]">Additional charge per child</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="muted text-sm">+₹</span>
                        <input
                          type="number"
                          step="0.01"
                          value={extraChild}
                          onChange={(e) => setExtraChild(e.target.value)}
                          className="flex-1 px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-ink text-sm placeholder:faint focus:outline-none focus:border-[var(--accent)]"
                          placeholder="500"
                        />
                      </div>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={loading || !numAdultOptions}
              className="flex-1 px-4 py-2.5 rounded-lg from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-ink text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-500/20"
            >
              {loading ? "💾 Saving..." : "✅ Save Occupancy Pricing"}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={loading}
              className="px-4 py-2.5 rounded-lg bg-[var(--surface)] hover:bg-[var(--surface-2)] border border-[var(--border)] muted text-sm font-medium transition-all"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
