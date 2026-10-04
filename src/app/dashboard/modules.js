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
    id: "home",
    label: "Home",
    pages: [{ id: "today", label: "Today", icon: "home" }],
  },
  {
    id: "frontoffice",
    label: "Front Office",
    pages: [
      { id: "calendar", label: "Calendar", icon: "calendar" },
      { id: "reservations", label: "Reservations", icon: "list" },
      { id: "housekeeping", label: "Housekeeping", icon: "check" },
    ],
  },
  {
    id: "distribution",
    label: "Distribution",
    pages: [
      { id: "cm", label: "Rates & Inventory", icon: "channel" },
      { id: "integrations", label: "Integrations", icon: "plug" },
      { id: "logs", label: "Activity Log", icon: "list" },
      { id: "workflow", label: "Workflow", icon: "refresh" },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    pages: [
      { id: "parity", label: "Rate Parity", icon: "compass" },
      { id: "compshopper", label: "Competitor Shopper", icon: "chart" },
      { id: "pricing", label: "Dynamic Pricing", icon: "tag" },
      { id: "events", label: "Events", icon: "calendar" },
    ],
  },
  {
    // Looking back at what happened, apart from Insights, which looks at the
    // market to decide what to charge next.
    id: "reports",
    label: "Reports",
    pages: [
      { id: "performance", label: "Booking Performance", icon: "trend" },
      { id: "nightaudit", label: "Night Audit", icon: "moon" },
      { id: "invoicing", label: "Invoicing", icon: "file" },
      { id: "payments", label: "Payments", icon: "money" },
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
      // Ids are what user grants are stored against, so a page keeps its id
      // when its label changes: "pmssetup" is the room number page.
      { id: "pmssetup", label: "Room Number Setup", icon: "bed" },
      { id: "servicesetup", label: "Services Setup", icon: "list" },
      { id: "taxsetup", label: "Tax Setup", icon: "money" },
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
  // Search by Location was folded into Competitor Shopper, which finds
  // nearby hotels from the property's own listing. A user still holding the
  // old grant keeps access to what it was for.
  location: "compshopper",
};

/** Grants as current page ids: legacy ids translated, duplicates dropped. */
export function normaliseGrants(granted) {
  return [...new Set((granted || []).map((id) => LEGACY_ALIASES[id] || id))];
}

/**
 * Whether a user's rights include a page. Nothing granted means nothing:
 * rights are given, never assumed. Shared with the API routes so a page the
 * menu hides cannot still be reached by calling its API.
 */
export function grantsInclude(granted, pageId) {
  return normaliseGrants(granted).includes(pageId);
}

/**
 * Pages that configure the property itself, rather than using it. Granting
 * any of them to a PropertyUser also lets them change setup, which the API
 * checks separately.
 */
export const SETUP_PAGES = new Set([
  "setup",
  "rooms",
  "rateplans",
  "pmssetup",
  "servicesetup",
  "taxsetup",
  "integrations",
]);

/**
 * Pages that go with a role rather than a grant: every admin manages their
 * users, and nobody else does.
 */
const ADMIN_PAGES = new Set(["users"]);

/**
 * Pages everyone with any access has. The home page is a summary of the other
 * pages, each part shown only to whoever holds the page it summarises, so it
 * grants nothing of its own and is never ticked.
 */
const EVERYONE_PAGES = new Set(["today"]);

/**
 * Pages with no implementation yet. They stay in the navigation on purpose --
 * they are the agreed shape of the product -- but are marked so the UI can
 * label them rather than letting a user think the page is broken.
 */
export const PLACEHOLDER_PAGES = new Set([]);

/** Pages a right can be given for, in navigation order. */
export const GRANTABLE_MODULES = MODULES.filter(
  (m) => !ADMIN_PAGES.has(m.id) && !PLACEHOLDER_PAGES.has(m.id) && !EVERYONE_PAGES.has(m.id)
);

/**
 * The pages this session may see, grouped by area.
 *
 * `session.modules` is the user's effective rights, already capped by their
 * property admins' (see lib/rights). A super admin sees everything.
 * Areas with no visible pages are dropped.
 */
export function visibleAreas(session) {
  const superAdmin = session?.isSuperAdmin === true;
  const canSetup = session?.canManageSetup === true;
  const canUsers = session?.canManageUsers === true;
  const effective = new Set(normaliseGrants(session?.modules));

  const areas = AREAS.map((area) => {
    const pages = area.pages.filter((p) => {
      if (EVERYONE_PAGES.has(p.id)) return true;
      if (ADMIN_PAGES.has(p.id)) return canUsers;
      if (SETUP_PAGES.has(p.id) && !canSetup) return false;
      if (PLACEHOLDER_PAGES.has(p.id)) return true;
      return superAdmin || effective.has(p.id);
    });
    return { ...area, pages };
  }).filter((a) => a.pages.some((p) => !PLACEHOLDER_PAGES.has(p.id)));

  // A home page with nothing behind it would summarise nothing, so someone
  // given no pages still sees the "ask your admin" message instead.
  const real = areas.some((a) => a.pages.some((p) => !EVERYONE_PAGES.has(p.id) && !PLACEHOLDER_PAGES.has(p.id)));
  return real ? areas : [];
}

/** Whether a page is in the visible areas, so a link to it can be offered. */
export function canOpenPage(areas, pageId) {
  return areas.some((a) => a.pages.some((p) => p.id === pageId));
}

/** The area containing a page id, for restoring the top bar from `active`. */
export function areaForPage(areas, pageId) {
  return areas.find((a) => a.pages.some((p) => p.id === pageId)) || areas[0];
}

/** Kept for callers that still expect a flat list of visible pages. */
export function visibleModules(session) {
  return visibleAreas(session).flatMap((a) => a.pages);
}
