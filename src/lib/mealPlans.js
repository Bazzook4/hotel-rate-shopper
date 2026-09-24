/**
 * Meal plan codes, as the industry uses them.
 *
 * Refundability is a separate flag rather than eight codes, because NR CP is
 * the same meal basis as CP sold on stricter terms. The display name is
 * derived, so a plan is always labelled consistently.
 */
export const MEAL_PLANS = [
  { code: "EP", label: "EP", name: "European Plan", meals: 0, hint: "Room only" },
  { code: "CP", label: "CP", name: "Continental Plan", meals: 1, hint: "Breakfast" },
  { code: "MAP", label: "MAP", name: "Modified American Plan", meals: 2, hint: "Breakfast + 1 meal" },
  { code: "AP", label: "AP", name: "American Plan", meals: 3, hint: "All meals" },
];

export const MEAL_PLAN_CODES = MEAL_PLANS.map((m) => m.code);

export function mealPlan(code) {
  return MEAL_PLANS.find((m) => m.code === code) || null;
}

/** "CP" + refundable false -> "NR CP" */
export function planLabel({ meal_plan, refundable } = {}) {
  if (!meal_plan) return "—";
  return refundable === false ? `NR ${meal_plan}` : meal_plan;
}

/** The full set a property might sell, in the order they are usually listed. */
export function allPlanLabels() {
  return [
    ...MEAL_PLAN_CODES,
    ...MEAL_PLAN_CODES.map((c) => `NR ${c}`),
  ];
}

/** Meals implied by the code, for the Aiosell no_of_meals field. */
export function mealsFor(code) {
  return mealPlan(code)?.meals ?? 0;
}
