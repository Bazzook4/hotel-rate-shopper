"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { visibleAreas, areaForPage, PLACEHOLDER_PAGES } from "./dashboard/modules";
import LogoutButton from "./components/LogoutButton";
import ThemeToggle from "./components/ThemeToggle";
import Icon from "./components/Icon";

/**
 * Each page is fetched the first time it is opened, not with the dashboard.
 *
 * Imported directly, every page -- the Channel Manager, the tape chart, the
 * reports and the charting library behind them -- was downloaded and parsed
 * before the first one could show, though a session opens only a few. Once
 * fetched a page is cached, so returning to it is immediate.
 */
function PageLoading() {
  return (
    <div className="flex items-center justify-center py-20">
      <div
        className="inline-block h-7 w-7 animate-spin rounded-full border-2"
        style={{ borderColor: "var(--border)", borderTopColor: "var(--accent)" }}
      />
    </div>
  );
}

const ChannelManager = dynamic(() => import("./dashboard/components/ChannelManager"), {
  ssr: false,
  loading: PageLoading,
});
const PropertySetup = dynamic(() => import("./dashboard/components/PropertySetup"), {
  ssr: false,
  loading: PageLoading,
});
const Integrations = dynamic(() => import("./dashboard/components/Integrations"), {
  ssr: false,
  loading: PageLoading,
});
const ActivityLog = dynamic(() => import("./dashboard/components/ActivityLog"), {
  ssr: false,
  loading: PageLoading,
});
const RateParity = dynamic(() => import("./dashboard/components/RateParity"), {
  ssr: false,
  loading: PageLoading,
});
const GoogleListingSetup = dynamic(() => import("./dashboard/components/GoogleListingSetup"), {
  ssr: false,
  loading: PageLoading,
});
const CompetitorShopper = dynamic(() => import("./dashboard/components/CompetitorShopper"), {
  ssr: false,
  loading: PageLoading,
});
const DynamicPricingGrid = dynamic(() => import("./dashboard/components/DynamicPricingGrid"), {
  ssr: false,
  loading: PageLoading,
});
const Reservations = dynamic(() => import("./dashboard/components/Reservations"), {
  ssr: false,
  loading: PageLoading,
});
const TapeChart = dynamic(() => import("./dashboard/components/TapeChart"), {
  ssr: false,
  loading: PageLoading,
});
const RoomInventory = dynamic(() => import("./dashboard/components/RoomInventory"), {
  ssr: false,
  loading: PageLoading,
});
const Housekeeping = dynamic(() => import("./dashboard/components/Housekeeping"), {
  ssr: false,
  loading: PageLoading,
});
const BillingSetup = dynamic(() => import("./dashboard/components/BillingSetup"), {
  ssr: false,
  loading: PageLoading,
});
const BookingPerformance = dynamic(() => import("./dashboard/components/BookingPerformance"), {
  ssr: false,
  loading: PageLoading,
});
const NightAudit = dynamic(() => import("./dashboard/components/NightAudit"), {
  ssr: false,
  loading: PageLoading,
});
const InvoicingReport = dynamic(() => import("./dashboard/components/InvoicingReport"), {
  ssr: false,
  loading: PageLoading,
});
const PaymentsReport = dynamic(() => import("./dashboard/components/PaymentsReport"), {
  ssr: false,
  loading: PageLoading,
});
const UserRights = dynamic(() => import("./dashboard/components/UserRights"), {
  ssr: false,
  loading: PageLoading,
});

/**
 * A page that is agreed but not yet built.
 *
 * Shown instead of leaving the nav item inert, so it is clear the page is
 * planned rather than broken.
 */
function ComingSoon({ title, children }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="h1">{title}</h2>
      </div>
      <div className="card card-pad text-center" style={{ padding: "48px 24px" }}>
        <span
          className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full"
          style={{ background: "var(--surface-2)", color: "var(--text-faint)" }}
        >
          <Icon name="info" />
        </span>
        <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
          Not built yet
        </p>
        <p className="sub mx-auto mt-1 max-w-[420px]">{children}</p>
      </div>
    </div>
  );
}

export default function V2Dashboard() {
  const [session, setSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  // The open page lives in the URL hash, so a refresh reopens where you were
  // and a page can be linked to. This page is prerendered, so the hash is
  // read in an effect rather than here: the server has no hash, and starting
  // from one would not match what it rendered. Empty until then, which the
  // loading spinner already covers.
  const [active, setActive] = useState("");
  // The sidebar collapses to give the grid its full width, which matters most
  // on the Channel Manager's 30-day view.
  const [railOpen, setRailOpen] = useState(true);
  // On a phone there is no room for a rail beside the page, so the sidebar
  // becomes a drawer over it, opened from the header and closed by choosing
  // a page. Separate from `railOpen`, so collapsing the rail on a desktop is
  // not undone by visiting on a phone, nor the other way round.
  const [drawerOpen, setDrawerOpen] = useState(false);
  // The property every page works against. A super admin switches it here in
  // the header rather than inside each page, so there is one answer to "which
  // property am I changing" wherever they are.
  const [properties, setProperties] = useState([]);
  const [propertyId, setPropertyId] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadSession() {
      try {
        const res = await fetch("/api/auth/session");
        const json = res.ok ? await res.json() : null;
        // The session route returns { user: {...} }.
        if (!cancelled) setSession(json?.user ?? null);
      } catch {
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) setSessionLoading(false);
      }
    }
    loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  // The properties this session may work in. A super admin gets the full list
  // and may switch; everyone else gets only their own, so the control shows
  // where they are without offering a change they may not make.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetch("/api/properties")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.properties) return;
        setProperties(j.properties);
        setPropertyId((cur) => cur || session.propertyId || j.properties[0]?.id || "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session]);

  /**
   * The session as the pages should see it: the selected property, not the
   * one the cookie was issued for. Pages read propertyId from here, so a
   * switch in the header moves every page at once.
   */
  const scopedSession = useMemo(() => {
    if (!session) return null;
    const chosen = properties.find((p) => p.id === propertyId);
    return {
      ...session,
      propertyId: propertyId || session.propertyId,
      propertyName: chosen?.name || session.propertyName,
      // New bookings default the guest's country to the hotel's own.
      propertyCountry: chosen?.country || null,
      // Switching happens in the header now, so no page offers its own picker.
      canSwitchProperties: false,
    };
  }, [session, properties, propertyId]);

  const areas = useMemo(() => visibleAreas(session), [session]);

  // The top bar follows the open page rather than being selected separately,
  // so switching areas and landing on a page keep one source of truth.
  //
  // Nothing is selected until a page is. `areaForPage` falls back to the first
  // area for a page it does not know, which before a page is settled would
  // light up Front Office and its sidebar for as long as the session takes to
  // load, then jump to the real page -- a visible flash on every refresh.
  const currentArea = useMemo(
    () => (active ? areaForPage(areas, active) : null),
    [areas, active]
  );

  // Settle on a page: the hash if it names one this session may see,
  // otherwise the first page available.
  //
  // Waits for the session, because `areas` without one is not yet the real
  // answer -- it omits Setup, so judging a #rateplans hash against it would
  // reject a page the user is in fact allowed, and nothing would revisit that
  // once a page had been chosen. After that it runs whenever `active` leaves
  // the visible set, which is what drops a hash naming a page this user may
  // not open, or one left over from a page that has since been renamed.
  useEffect(() => {
    if (sessionLoading || !areas.length) return;
    const canSee = (id) => areas.some((a) => a.pages.some((p) => p.id === id));
    if (canSee(active)) return;

    const hashed = window.location.hash.slice(1);
    setActive(canSee(hashed) ? hashed : areas[0].pages[0].id);
  }, [areas, active, sessionLoading]);

  // Write the open page back to the hash. replaceState rather than assigning
  // to location.hash, so moving around the dashboard does not fill the back
  // button with every page visited; back leaves the dashboard as before.
  useEffect(() => {
    // Not while the session is still loading: `areas` is at its widest then,
    // and writing the page chosen against it would overwrite the incoming
    // hash before the effect above has had the loaded session to judge it by.
    if (sessionLoading || !active) return;
    if (window.location.hash.slice(1) === active) return;
    window.history.replaceState(null, "", `#${active}`);
  }, [active, sessionLoading]);

  // Back and forward still move between pages when the hash does change --
  // from a pasted link, or from the browser's own history.
  useEffect(() => {
    function onHashChange() {
      const id = window.location.hash.slice(1);
      if (id) setActive(id);
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Escape closes the drawer, as it would any other overlay.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // Widening past a phone -- a rotated tablet, a resized window -- brings the
  // rail back, so a drawer left open would sit on the rail as a wider copy.
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 768px)");
    const onChange = (e) => e.matches && setDrawerOpen(false);
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);

  function openPage(id) {
    setActive(id);
    setDrawerOpen(false);
  }

  // The drawer lists every area's pages, so a phone reaches any page in two
  // taps rather than choosing an area first and then opening the drawer. The
  // rail beside the page stays with the open area, as the tabs above it do.
  const railAreas = drawerOpen ? areas : currentArea ? [currentArea] : [];
  const expanded = railOpen || drawerOpen;

  const pageLabel = currentArea?.pages.find((p) => p.id === active)?.label || "";

  return (
    <main className="min-h-screen" style={{ background: "var(--page)" }}>
      {/* Row 1 — brand, property, account */}
      <header
        className="sticky top-0 z-30 flex h-[46px] items-center justify-between gap-2 px-3 md:px-4"
        style={{
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="flex flex-shrink-0 items-center gap-2.5">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="-ml-1 flex h-9 w-9 items-center justify-center rounded md:hidden"
            style={{ color: "var(--text)" }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M3 5h12M3 9h12M3 13h12" />
            </svg>
          </button>
          <span
            className="flex h-[22px] w-[22px] items-center justify-center rounded text-[10px] font-bold"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            OH
          </span>
          <span className="hidden text-sm font-semibold sm:inline" style={{ color: "var(--text)" }}>
            HMS<span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · Online Hotelier</span>
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-1">
          {/* A super admin picks the property; everyone else sees theirs named.
              Either way this is the one place it is set. */}
          {session?.canSwitchProperties && properties.length > 1 ? (
            <select
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              aria-label="Property"
              className="mr-2 min-w-0 max-w-[38vw] truncate rounded px-2 py-1 text-sm md:max-w-none"
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                color: "var(--text)",
              }}
            >
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            scopedSession?.propertyName && (
              <span className="mr-2 min-w-0 truncate text-sm" style={{ color: "var(--text-muted)" }}>
                {scopedSession.propertyName}
              </span>
            )
          )}
          <Link
            href="/admin"
            className="flex-shrink-0 rounded px-2 py-1 text-xs transition hover:opacity-70"
            style={{ color: "var(--text-muted)" }}
          >
            Admin
          </Link>
          <ThemeToggle />
          <LogoutButton className="whitespace-nowrap" />
        </div>
      </header>

      {/* Row 2 — areas */}
      <nav
        className="no-scrollbar sticky top-[46px] z-20 flex items-center gap-1 overflow-x-auto whitespace-nowrap px-2 md:px-4"
        style={{
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {areas.map((area) => {
          const on = currentArea?.id === area.id;
          return (
            <button
              key={area.id}
              type="button"
              // Entering an area opens its first page, so a tab click always
              // lands somewhere rather than leaving the content blank.
              onClick={() => openPage(area.pages[0].id)}
              className="relative flex-shrink-0 px-3 py-2.5 text-[13px] transition"
              style={{
                color: on ? "var(--accent-text)" : "var(--text-muted)",
                fontWeight: on ? 600 : 500,
              }}
            >
              {area.label}
              {on && (
                <span
                  className="absolute inset-x-2 bottom-0 h-[2px] rounded-t"
                  style={{ background: "var(--accent)" }}
                />
              )}
            </button>
          );
        })}
      </nav>

      <div className="flex">
        {/* Backdrop behind the drawer on a phone; a tap outside closes it. */}
        {drawerOpen && (
          <div
            className="fixed inset-0 z-40 md:hidden"
            style={{ background: "rgba(0, 0, 0, 0.4)" }}
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
        )}

        {/* Sidebar — the pages of the open area. A rail beside the page from
            tablet width up; below that, a drawer that slides in over it. */}
        <aside
          className={`fixed inset-y-0 left-0 z-50 flex-shrink-0 overflow-y-auto transition-all md:sticky md:top-[84px] md:z-auto md:h-[calc(100vh-84px)] md:translate-x-0 ${
            drawerOpen ? "translate-x-0" : "-translate-x-full"
          }`}
          style={{
            width: expanded ? (drawerOpen ? 256 : 208) : 44,
            background: "var(--surface)",
            borderRight: "1px solid var(--border)",
          }}
          aria-label="Pages"
        >
          <div className="flex items-center justify-between px-2 py-2">
            {/* The drawer's own close button, where the rail has its collapse. */}
            <span className="px-2 text-sm font-semibold md:hidden" style={{ color: "var(--text)" }}>
              Menu
            </span>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              className="flex h-9 w-9 items-center justify-center rounded text-lg md:hidden"
              style={{ color: "var(--text-muted)" }}
            >
              ×
            </button>
            <button
              type="button"
              onClick={() => setRailOpen((v) => !v)}
              aria-label={railOpen ? "Collapse menu" : "Expand menu"}
              title={railOpen ? "Collapse menu" : "Expand menu"}
              className="ml-auto hidden rounded px-1.5 py-1 text-xs transition hover:opacity-70 md:block"
              style={{ color: "var(--text-faint)" }}
            >
              {railOpen ? "«" : "»"}
            </button>
          </div>

          <nav className="flex flex-col gap-0.5 px-2 pb-4">
            {railAreas.map((area, i) => (
              <div key={area.id} className={`flex flex-col gap-0.5 ${i > 0 ? "mt-3" : ""}`}>
                {expanded && (
                  <p
                    className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: "var(--text-faint)" }}
                  >
                    {area.label}
                  </p>
                )}

                {area.pages.map((page) => {
                  const on = active === page.id;
                  const soon = PLACEHOLDER_PAGES.has(page.id);
                  return (
                    <button
                      key={page.id}
                      type="button"
                      onClick={() => openPage(page.id)}
                      title={expanded ? undefined : page.label}
                      className={`flex items-center gap-2.5 rounded px-2 text-left text-[13px] transition ${
                        drawerOpen ? "py-2.5" : "py-[7px]"
                      }`}
                      style={{
                        background: on ? "var(--accent-soft)" : "transparent",
                        color: on ? "var(--accent-text)" : "var(--text-muted)",
                        fontWeight: on ? 600 : 500,
                      }}
                    >
                      <span className="flex-shrink-0">
                        <Icon name={page.icon} />
                      </span>
                      {expanded && (
                        <>
                          <span className="flex-1 truncate">{page.label}</span>
                          {soon && (
                            <span
                              className="rounded px-1 py-[1px] text-[8.5px] font-semibold uppercase tracking-wide"
                              style={{
                                background: "var(--surface-2)",
                                color: "var(--text-faint)",
                              }}
                            >
                              Soon
                            </span>
                          )}
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <section className="min-w-0 flex-1">
          <div className="mx-auto max-w-[1400px] p-3 sm:p-4 md:p-6">
            {sessionLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="space-y-3 text-center">
                  <div
                    className="inline-block h-7 w-7 animate-spin rounded-full border-2"
                    style={{
                      borderColor: "var(--border)",
                      borderTopColor: "var(--accent)",
                    }}
                  />
                  <p className="sub">Loading dashboard…</p>
                </div>
              </div>
            ) : !areas.length ? (
              <div className="card card-pad sub">
                No pages have been given to your account yet. Ask your property admin for access.
              </div>
            ) : (
              <>
                {/* Keyed by property so a switch starts the grid afresh:
                    an unsaved edit must never publish to another hotel. */}
                {active === "cm" && (
                  <ChannelManager key={scopedSession?.propertyId || ""} session={scopedSession} />
                )}

                {active === "integrations" && <Integrations session={scopedSession} />}

                {active === "logs" && <ActivityLog session={scopedSession} />}

                {active === "parity" && <RateParity session={scopedSession} />}

                {active === "pricing" && <DynamicPricingGrid session={scopedSession} />}

                {active === "performance" && <BookingPerformance session={scopedSession} />}

                {active === "nightaudit" && <NightAudit session={scopedSession} />}

                {active === "invoicing" && <InvoicingReport session={scopedSession} />}

                {active === "payments" && <PaymentsReport session={scopedSession} />}

                {/* Rooms and rate plans are separate pages; the component
                    renders one panel or the other. */}
                {active === "rooms" && (
                  <PropertySetup session={scopedSession} only="rooms" />
                )}

                {active === "pmssetup" && <RoomInventory session={scopedSession} />}

                {active === "servicesetup" && (
                  <BillingSetup session={scopedSession} only="services" />
                )}

                {active === "taxsetup" && <BillingSetup session={scopedSession} only="taxes" />}

                {active === "rateplans" && (
                  <PropertySetup session={scopedSession} only="plans" />
                )}

                {active === "setup" && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="h1">Property Setup</h2>
                      <p className="sub">
                        Property details — address, contact, policies and amenities — will
                        be fed from the PMS rather than entered here. The Google listing is
                        set here because only the hotelier knows which listing is theirs.
                      </p>
                    </div>
                    <GoogleListingSetup propertyId={scopedSession?.propertyId} />
                  </div>
                )}

                {active === "users" && session?.canManageUsers && (
                  <UserRights session={scopedSession} propertyId={scopedSession?.propertyId} />
                )}

                {active === "calendar" && <TapeChart session={scopedSession} />}

                {active === "reservations" && <Reservations session={scopedSession} />}

                {active === "housekeeping" && <Housekeeping session={scopedSession} />}

                {active === "workflow" && (
                  <ComingSoon title="Workflow">
                    Automations across distribution — rules that act on rates and
                    inventory without manual steps.
                  </ComingSoon>
                )}

                {active === "compshopper" && <CompetitorShopper session={scopedSession} />}

              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
