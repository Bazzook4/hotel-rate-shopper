/**
 * Dashboard module registry.
 *
 * Module ids are stored per user in the user_modules table. The previous
 * dashboard (now at /v1) used its own ids, so a user carried over from it
 * may hold grants like "ratetracker" or "disparity" that name modules which
 * no longer exist here.
 */
export const MODULES = [
  { id: "cm", label: "Channel Manager", icon: "🔗" },
  { id: "compshopper", label: "Comp Shopper", icon: "📊" },
  { id: "parity", label: "Rate Parity", icon: "🧭" },
  { id: "location", label: "Search by Location", icon: "📍" },
  { id: "pricing", label: "Dynamic Pricing", icon: "💰" },
  { id: "setup", label: "Property Setup", icon: "⚙️" },
  { id: "integrations", label: "Integrations", icon: "🔌" },
];

/** Old dashboard ids that map onto a module here. */
const LEGACY_ALIASES = {
  disparity: "parity",
  ratetracker: "compshopper",
  compare: "compshopper",
};

export function visibleModules(session) {
  // Property Setup edits room types and rate plans, which drive what gets
  // pushed to channels, so it is shown only to users who may actually use it.
  // The API enforces this too -- this just avoids offering a tab that 403s.
  const canSetup = session?.canManageSetup === true;
  const all = MODULES.filter(
    (m) => !["setup", "integrations"].includes(m.id) || canSetup
  );

  if (session?.canManageUsers === true) {
    return [...all, { id: "users", label: "Manage Users", icon: "👥" }];
  }

  const granted = session?.modules || [];
  if (granted.length === 0) return all;

  // Translate any legacy ids before filtering, so a user whose grants predate
  // this dashboard still sees the modules those grants correspond to.
  const effective = new Set(granted.map((id) => LEGACY_ALIASES[id] || id));

  const visible = all.filter((m) => effective.has(m.id));

  // A user holding only ids that no longer map to anything would otherwise be
  // left with an empty sidebar and no way to work; show the full set instead.
  return visible.length > 0 ? visible : all;
}
