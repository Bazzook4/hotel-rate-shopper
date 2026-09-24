/**
 * v2 module registry. v1 (at "/") keeps its own module ids untouched;
 * these are additive so both can be granted independently per user.
 */
export const V2_MODULES = [
  { id: "cm", label: "Channel Manager", icon: "🔗" },
  { id: "compshopper", label: "Comp Shopper", icon: "📊" },
  { id: "parity", label: "Rate Parity", icon: "🧭" },
  { id: "location", label: "Search by Location", icon: "📍" },
  { id: "pricing", label: "Dynamic Pricing", icon: "💰" },
];

export function visibleModules(session) {
  const all = [...V2_MODULES];
  if (session?.role === "Admin") {
    return [...all, { id: "users", label: "Manage Users", icon: "👥" }];
  }
  const granted = session?.modules || [];
  if (granted.length === 0) return all;
  return all.filter((m) => granted.includes(m.id));
}
