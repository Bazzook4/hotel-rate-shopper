"use client";

import { useState } from "react";

export default function MealPlanConfig({ property, ratePlans, onPlansUpdated, loading, setLoading }) {
  const [showAddPlan, setShowAddPlan] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);
  const [selectedMealPlans, setSelectedMealPlans] = useState({
    EP: false,
    CP: false,
    MAP: false,
    AP: false,
  });
  const [mealPlanCosts, setMealPlanCosts] = useState({
    EP: { cost: "", ratio: "" },
    CP: { cost: "", ratio: "" },
    MAP: { cost: "", ratio: "" },
    AP: { cost: "", ratio: "" },
  });
  const [error, setError] = useState("");

  const mealPlanInfo = {
    EP: { name: "EP (European Plan)", desc: "Room only - No meals included" },
    CP: { name: "CP (Continental Plan)", desc: "Room + Breakfast" },
    MAP: { name: "MAP (Modified American Plan)", desc: "Room + Breakfast + Dinner" },
    AP: { name: "AP (American Plan)", desc: "Room + All Meals (Breakfast, Lunch, Dinner)" },
  };

  async function handleSaveMealPlans(e) {
    e.preventDefault();

    const selectedPlans = Object.keys(selectedMealPlans).filter(key => selectedMealPlans[key]);

    if (selectedPlans.length === 0) {
      setError("Please select at least one meal plan");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const newPlans = [];

      for (const planName of selectedPlans) {
        const cost = parseFloat(mealPlanCosts[planName].cost) || 0;
        const ratio = parseFloat(mealPlanCosts[planName].ratio);

        // Calculate multiplier: use ratio if provided, otherwise calculate from cost
        let multiplier = 1.0;
        if (ratio && ratio > 0) {
          multiplier = ratio;
        } else if (cost > 0) {
          // For cost-based, we'll store the cost and calculate multiplier per room type later
          multiplier = 1.0 + (cost / 1000); // Just a placeholder, actual calculation happens in pricing
        }

        const description = mealPlanInfo[planName].desc;

        const res = await fetch("/api/dynamicPricing/ratePlans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planName,
            multiplier,
            description: `${description} | Cost: ₹${cost || 0}${ratio ? ` | Ratio: ${ratio}` : ''}`,
          }),
        });

        const data = await res.json();
        if (res.ok) {
          newPlans.push(data.ratePlan);
        }
      }

      onPlansUpdated([...ratePlans, ...newPlans]);
      setShowAddPlan(false);

      // Reset form
      setSelectedMealPlans({ EP: false, CP: false, MAP: false, AP: false });
      setMealPlanCosts({
        EP: { cost: "", ratio: "" },
        CP: { cost: "", ratio: "" },
        MAP: { cost: "", ratio: "" },
        AP: { cost: "", ratio: "" },
      });
    } catch (err) {
      setError("Network error: " + err.message);
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
        onPlansUpdated(ratePlans.filter((p) => p.id !== ratePlan.id));
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

  async function handleEditRatePlan(plan) {
    const newMultiplier = prompt(`Edit multiplier for ${plan.planName}:`, plan.multiplier);
    if (!newMultiplier || newMultiplier === plan.multiplier.toString()) return;

    try {
      setLoading(true);
      const res = await fetch(`/api/dynamicPricing/ratePlans`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordId: plan.id,
          multiplier: parseFloat(newMultiplier),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        onPlansUpdated(ratePlans.map((p) => p.id === plan.id ? data.ratePlan : p));
      } else {
        const data = await res.json();
        setError(data.error || "Failed to update rate plan");
      }
    } catch (err) {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  const controlLabel = "text-xs font-semibold uppercase tracking-[0.2em] text-slate-200/70 mb-2";

  return (
    <div className="rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h4 className="text-lg font-semibold text-white">Rate Plans / Meal Plans</h4>
          <p className="text-xs text-slate-400 mt-1">Configure different meal plans with costs or ratios</p>
        </div>
        <button
          onClick={() => setShowAddPlan(!showAddPlan)}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white text-sm font-medium transition-all"
        >
          {showAddPlan ? "Cancel" : "+ Add Meal Plans"}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-rose-500/10 border border-rose-500/20 p-4">
          <p className="text-rose-400 text-sm">{error}</p>
        </div>
      )}

      {showAddPlan && (
        <form onSubmit={handleSaveMealPlans} className="mb-6 p-6 rounded-xl bg-white/5 border border-white/10 space-y-6">
          <div className="space-y-4">
            <label className={controlLabel}>Select Meal Plans</label>

            {Object.keys(mealPlanInfo).map((planKey) => (
              <div key={planKey} className="p-4 rounded-lg bg-white/5 border border-white/10">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedMealPlans[planKey]}
                    onChange={(e) => setSelectedMealPlans({ ...selectedMealPlans, [planKey]: e.target.checked })}
                    className="mt-1 w-5 h-5 rounded bg-white/10 border-white/20 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div className="flex-1">
                    <div className="text-white font-semibold">{mealPlanInfo[planKey].name}</div>
                    <div className="text-xs text-slate-400 mt-1">{mealPlanInfo[planKey].desc}</div>

                    {selectedMealPlans[planKey] && (
                      <div className="grid grid-cols-2 gap-3 mt-3">
                        <div>
                          <label className="text-xs text-slate-300 mb-1 block">Additional Cost (INR)</label>
                          <input
                            type="number"
                            step="0.01"
                            value={mealPlanCosts[planKey].cost}
                            onChange={(e) => setMealPlanCosts({
                              ...mealPlanCosts,
                              [planKey]: { ...mealPlanCosts[planKey], cost: e.target.value }
                            })}
                            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm"
                            placeholder={planKey === 'EP' ? '0' : planKey === 'CP' ? '350' : planKey === 'MAP' ? '1000' : '1650'}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-slate-300 mb-1 block">Ratio (Optional)</label>
                          <input
                            type="number"
                            step="0.01"
                            value={mealPlanCosts[planKey].ratio}
                            onChange={(e) => setMealPlanCosts({
                              ...mealPlanCosts,
                              [planKey]: { ...mealPlanCosts[planKey], ratio: e.target.value }
                            })}
                            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm"
                            placeholder={planKey === 'EP' ? '1.0' : planKey === 'CP' ? '1.12' : planKey === 'MAP' ? '1.25' : '1.40'}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </label>
              </div>
            ))}
          </div>

          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <p className="text-xs text-blue-300">
              <strong>Note:</strong> Specify either cost in INR or a ratio multiplier (or both).
              If ratio is provided, it takes priority. Otherwise, cost will be added to base room price.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full px-6 py-3 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-medium disabled:opacity-50 transition-all"
          >
            {loading ? "Saving..." : "Save Meal Plans"}
          </button>
        </form>
      )}

      {ratePlans.length === 0 ? (
        <div className="text-center py-8 text-slate-400">
          <p>No meal plans added yet.</p>
          <p className="text-xs mt-2">Add EP, CP, MAP, or AP plans with custom pricing</p>
        </div>
      ) : (
        <div className="space-y-3">
          {ratePlans.map((plan) => (
            <div
              key={plan.id}
              className="p-4 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h5 className="text-white font-semibold">🍽️ {plan.planName}</h5>
                  </div>
                  <p className="text-sm text-slate-300 mt-2">
                    <span className="text-slate-400">Multiplier:</span> <span className="font-semibold text-indigo-400">{plan.multiplier}x</span>
                    {plan.multiplier > 1 && (
                      <span className="text-green-400"> (+{((plan.multiplier - 1) * 100).toFixed(0)}%)</span>
                    )}
                    {plan.multiplier < 1 && (
                      <span className="text-rose-400"> ({((plan.multiplier - 1) * 100).toFixed(0)}%)</span>
                    )}
                  </p>
                  {plan.description && (
                    <p className="text-xs text-slate-400 mt-1 italic">{plan.description}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEditRatePlan(plan)}
                    className="px-3 py-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 text-xs font-medium transition-colors border border-indigo-500/20"
                  >
                    ✏️ Edit
                  </button>
                  <button
                    onClick={() => handleDeleteRatePlan(plan)}
                    className="px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-medium transition-colors border border-rose-500/20"
                  >
                    🗑️ Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
