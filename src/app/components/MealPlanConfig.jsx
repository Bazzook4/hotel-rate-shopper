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
    EP: { cost: "", ratio: "", pricing_type: "flat" },
    CP: { cost: "", ratio: "", pricing_type: "flat" },
    MAP: { cost: "", ratio: "", pricing_type: "flat" },
    AP: { cost: "", ratio: "", pricing_type: "flat" },
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

      for (const plan_name of selectedPlans) {
        const pricing_type = mealPlanCosts[plan_name].pricing_type;
        const cost = parseFloat(mealPlanCosts[plan_name].cost) || 0;
        const ratio = parseFloat(mealPlanCosts[plan_name].ratio);

        // Validate based on pricing type
        if (pricing_type === 'flat' && !cost) {
          setError(`Please enter a flat cost for ${plan_name}`);
          return;
        }
        if (pricing_type === 'multiplier' && !ratio) {
          setError(`Please enter a multiplier ratio for ${plan_name}`);
          return;
        }

        const description = mealPlanInfo[plan_name].desc;

        const res = await fetch("/api/dynamicPricing/ratePlans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan_name,
            pricing_type,
            cost_per_adult: pricing_type === 'flat' ? cost : undefined,
            multiplier: pricing_type === 'multiplier' ? ratio : undefined,
            description: `${description} | ${pricing_type === 'flat' ? `₹${cost} per adult` : `${ratio}x multiplier`}`,
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
        EP: { cost: "", ratio: "", pricing_type: "flat" },
        CP: { cost: "", ratio: "", pricing_type: "flat" },
        MAP: { cost: "", ratio: "", pricing_type: "flat" },
        AP: { cost: "", ratio: "", pricing_type: "flat" },
      });
    } catch (err) {
      setError("Network error: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteRatePlan(ratePlan) {
    if (!confirm(`Delete ${ratePlan.plan_name}?`)) return;

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
    const newMultiplier = prompt(`Edit multiplier for ${plan.plan_name}:`, plan.multiplier);
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

  const controlLabel = "text-xs font-semibold uppercase tracking-[0.2em] text-ink/70 mb-2";

  return (
    <div className="rounded-2xl bg-[var(--surface)] backdrop-blur-xl border border-[var(--border)] p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h4 className="h2">Rate Plans / Meal Plans</h4>
          <p className="text-xs muted mt-1">Configure different meal plans with costs or ratios</p>
        </div>
        <button
          onClick={() => setShowAddPlan(!showAddPlan)}
          className="px-4 py-2 rounded-lg from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-ink text-sm font-medium transition-all"
        >
          {showAddPlan ? "Cancel" : "+ Add Meal Plans"}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-[var(--danger-soft)] border border-[var(--danger)] p-4">
          <p className="text-[var(--danger)] text-sm">{error}</p>
        </div>
      )}

      {showAddPlan && (
        <form onSubmit={handleSaveMealPlans} className="mb-6 p-6 rounded-xl bg-[var(--surface)] border border-[var(--border)] space-y-6">
          <div className="space-y-4">
            <label className={controlLabel}>Select Meal Plans</label>

            {Object.keys(mealPlanInfo).map((planKey) => (
              <div key={planKey} className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedMealPlans[planKey]}
                    onChange={(e) => setSelectedMealPlans({ ...selectedMealPlans, [planKey]: e.target.checked })}
                    className="mt-1 w-5 h-5 rounded bg-[var(--surface-2)] border-white/20 text-[var(--accent-text)] focus:ring-[var(--accent)]"
                  />
                  <div className="flex-1">
                    <div className="text-ink font-semibold">{mealPlanInfo[planKey].name}</div>
                    <div className="text-xs muted mt-1">{mealPlanInfo[planKey].desc}</div>

                    {selectedMealPlans[planKey] && (
                      <div className="mt-3 space-y-3">
                        {/* Pricing Type Selection */}
                        <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                          <label className="text-xs muted mb-2 block font-semibold">Pricing Method</label>
                          <div className="flex gap-4">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name={`pricing_type-${planKey}`}
                                value="flat"
                                checked={mealPlanCosts[planKey].pricing_type === 'flat'}
                                onChange={(e) => setMealPlanCosts({
                                  ...mealPlanCosts,
                                  [planKey]: { ...mealPlanCosts[planKey], pricing_type: 'flat' }
                                })}
                                className="w-4 h-4 text-[var(--accent-text)] focus:ring-[var(--accent)]"
                              />
                              <span className="text-sm text-ink">Flat Rate per Adult</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name={`pricing_type-${planKey}`}
                                value="multiplier"
                                checked={mealPlanCosts[planKey].pricing_type === 'multiplier'}
                                onChange={(e) => setMealPlanCosts({
                                  ...mealPlanCosts,
                                  [planKey]: { ...mealPlanCosts[planKey], pricing_type: 'multiplier' }
                                })}
                                className="w-4 h-4 text-[var(--accent-text)] focus:ring-[var(--accent)]"
                              />
                              <span className="text-sm text-ink">Percentage Multiplier</span>
                            </label>
                          </div>
                        </div>

                        {/* Input based on pricing type */}
                        {mealPlanCosts[planKey].pricing_type === 'flat' ? (
                          <div>
                            <label className="text-xs muted mb-1 block">Cost per Adult (₹)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={mealPlanCosts[planKey].cost}
                              onChange={(e) => setMealPlanCosts({
                                ...mealPlanCosts,
                                [planKey]: { ...mealPlanCosts[planKey], cost: e.target.value }
                              })}
                              className="w-full px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-ink text-sm"
                              placeholder={planKey === 'EP' ? '0' : planKey === 'CP' ? '250' : planKey === 'MAP' ? '1000' : '1650'}
                              required
                            />
                            <p className="text-xs muted mt-1">
                              This amount will be added per adult. E.g., ₹250 for 1 adult, ₹500 for 2 adults.
                            </p>
                          </div>
                        ) : (
                          <div>
                            <label className="text-xs muted mb-1 block">Multiplier Ratio</label>
                            <input
                              type="number"
                              step="0.01"
                              value={mealPlanCosts[planKey].ratio}
                              onChange={(e) => setMealPlanCosts({
                                ...mealPlanCosts,
                                [planKey]: { ...mealPlanCosts[planKey], ratio: e.target.value }
                              })}
                              className="w-full px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-ink text-sm"
                              placeholder={planKey === 'EP' ? '1.0' : planKey === 'CP' ? '1.1' : planKey === 'MAP' ? '1.25' : '1.40'}
                              required
                            />
                            <p className="text-xs muted mt-1">
                              Base price will be multiplied by this ratio. E.g., 1.25x = 25% increase.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </label>
              </div>
            ))}
          </div>

          <div className="p-3 rounded-lg bg-[var(--accent-soft)] border border-[var(--accent)]">
            <p className="text-xs text-[var(--accent-text)]">
              <strong>💡 Tip:</strong>
              <br/>• <strong>Flat Rate:</strong> Fixed cost added per adult (e.g., ₹250/adult → Single: +₹250, Double: +₹500)
              <br/>• <strong>Multiplier:</strong> Percentage of base price (e.g., 1.25x → base ₹4000 becomes ₹5000)
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full px-6 py-3 rounded-lg from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-ink font-medium disabled:opacity-50 transition-all"
          >
            {loading ? "Saving..." : "Save Meal Plans"}
          </button>
        </form>
      )}

      {ratePlans.length === 0 ? (
        <div className="text-center py-8 muted">
          <p>No meal plans added yet.</p>
          <p className="text-xs mt-2">Add EP, CP, MAP, or AP plans with custom pricing</p>
        </div>
      ) : (
        <div className="space-y-3">
          {ratePlans.map((plan) => (
            <div
              key={plan.id}
              className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border)] hover:border-white/20 transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h5 className="text-ink font-semibold">🍽️ {plan.plan_name}</h5>
                  </div>
                  <p className="sub mt-2">
                    <span className="muted">Multiplier:</span> <span className="font-semibold text-[var(--accent-text)]">{plan.multiplier}x</span>
                    {plan.multiplier > 1 && (
                      <span className="text-[var(--accent-text)]"> (+{((plan.multiplier - 1) * 100).toFixed(0)}%)</span>
                    )}
                    {plan.multiplier < 1 && (
                      <span className="text-[var(--danger)]"> ({((plan.multiplier - 1) * 100).toFixed(0)}%)</span>
                    )}
                  </p>
                  {plan.description && (
                    <p className="text-xs muted mt-1 italic">{plan.description}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEditRatePlan(plan)}
                    className="px-3 py-1.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent)] text-[var(--accent-text)] text-xs font-medium transition-colors border border-[var(--accent)]"
                  >
                    ✏️ Edit
                  </button>
                  <button
                    onClick={() => handleDeleteRatePlan(plan)}
                    className="px-3 py-1.5 rounded-lg bg-[var(--danger-soft)] hover:bg-[var(--danger-soft)] text-[var(--danger)] text-xs font-medium transition-colors border border-[var(--danger)]"
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
