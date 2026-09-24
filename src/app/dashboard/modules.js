/**
 * Dashboard navigation registry.
 *
 * Navigation is two levels: an area across the top, and that area's pages down
 * the left. A page id is what `active` holds and what the dashboard switches
 * on, so page ids stay stable even when an area is renamed or a page moves
 * between areas.
 *
 * Module ids are also stored per user in the user_modules table. The previous
 * dashboard used its own ids, so a user carried over from it may hold grants
 * like "ratetracker" or "disparity" that name modules which no longer exist
 * here.
 */

export const AREAS = [
  {
    id: "frontoffice",
    label: "Front Office",
    pages: [
      { id: "calendar", label: "Calendar", icon: "calendar" },
      { id: "reservations", label: "Reservations", icon: "list" },
    ],
  },
  {
    id: "distribution",
    label: "Distribution",
    pages: [
      { id: "cm", label: "Rates & Inventory", icon: "channel" },
      { id: "integrations", label: "Integrations", icon: "plug" },
      { id: "workflow", label: "Workflow", icon: "refresh" },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    pages: [
      { id: "parity", label: "Rate Parity", icon: "compass" },
      { id: "compshopper", label: "Competitor Shopper", icon: "chart" },
      { id: "location", label: "Search by Location", icon: "pin" },
      { id: "pricing", label: "Dynamic Pricing", icon: "tag" },
    ],
  },
  {
    id: "setup",
    label: "Setup",
    pages: [
      { id: "users", label: "Users", icon: "users" },
      { id: "setup", label: "Property Setup", icon: "building" },
      { id: "rooms", label: "Room Setup", icon: "bed" },
      { id: "rateplans", label: "Rate Plan Setup", icon: "money" },
    ],
  },
];

/** Every page across every area, flattened. */
export const MODULES = AREAS.flatMap((a) =>
  a.pages.map((p) => ({ ...p, area: a.id }))
);

/** Old dashboard ids that map onto a page here. */
const LEGACY_ALIASES = {
  disparity: "parity",
  ratetracker: "compshopper",
  compare: "compshopper",
};

/**
 * Pages that configure the property itself, rather than using it. These are
 * shown only to users who may actually change setup -- the API enforces this
 * too, so this just avoids offering a page that 403s.
 */
const SETUP_PAGES = new Set(["setup", "rooms", "rateplans", "integrations"]);

/** Pages only an admin may see at all. */
const ADMIN_PAGES = new Set(["users"]);

/**
 * Pages with no implementation yet. They stay in the navigation on purpose --
 * they are the agreed shape of the product -- but are marked so the UI can
 * label them rather than letting a user think the page is broken.
 */
export const PLACEHOLDER_PAGES = new Set([
  "calendar",
  "reservations",
  "workflow",
  "compshopper",
  "location",
]);

/**
 * The pages this session may see, grouped by area.
 *
 * Areas with no visible pages are dropped, so a user who may not configure
 * anything never sees an empty Setup tab.
 */
export function visibleAreas(session) {
  const canSetup = session?.canManageSetup === true;
  const canUsers = session?.canManageUsers === true;

  const granted = session?.modules || [];
  // Translate any legacy ids before filtering, so a user whose grants predate
  // this dashboard still sees the pages those grants correspond to.
  const effective = new Set(granted.map((id) => LEGACY_ALIASES[id] || id));

  const areas = AREAS.map((area) => {
    const pages = area.pages.filter((p) => {
      if (ADMIN_PAGES.has(p.id) && !canUsers) return false;
      if (SETUP_PAGES.has(p.id) && !canSetup) return false;
      // No explicit grants means full access; the roles above still apply.
      if (effective.size === 0) return true;
      return effective.has(p.id);
    });
    return { ...area, pages };
  }).filter((a) => a.pages.length > 0);

  // A user holding only ids that no longer map to anything would otherwise be
  // left with an empty dashboard and no way to work; show what their role
  // allows instead.
  if (areas.length === 0) {
    return AREAS.map((area) => ({
      ...area,
      pages: area.pages.filter((p) => {
        if (ADMIN_PAGES.has(p.id) && !canUsers) return false;
        if (SETUP_PAGES.has(p.id) && !canSetup) return false;
        return true;
      }),
    })).filter((a) => a.pages.length > 0);
  }

  return areas;
}

/** The area containing a page id, for restoring the top bar from `active`. */
export function areaForPage(areas, pageId) {
  return areas.find((a) => a.pages.some((p) => p.id === pageId)) || areas[0];
}

/** Kept for callers that still expect a flat list of visible pages. */
export function visibleModules(session) {
  return visibleAreas(session).flatMap((a) => a.pages);
}
