"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { visibleAreas, areaForPage, PLACEHOLDER_PAGES } from "./dashboard/modules";
import ChannelManager from "./dashboard/components/ChannelManager";
import PropertySetup from "./dashboard/components/PropertySetup";
import Integrations from "./dashboard/components/Integrations";
import ActivityLog from "./dashboard/components/ActivityLog";
import RateParity from "./dashboard/components/RateParity";
import GoogleListingSetup from "./dashboard/components/GoogleListingSetup";
import CompetitorShopper from "./dashboard/components/CompetitorShopper";
import DynamicPricing from "./components/DynamicPricing";
import AdminUserManager from "./components/AdminUserManager";
import LogoutButton from "./components/LogoutButton";
import ThemeToggle from "./components/ThemeToggle";
import Icon from "./components/Icon";

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
  const [active, setActive] = useState("cm");
  // The sidebar collapses to give the grid its full width, which matters most
  // on the Channel Manager's 30-day view.
  const [railOpen, setRailOpen] = useState(true);
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
      // Switching happens in the header now, so no page offers its own picker.
      canSwitchProperties: false,
    };
  }, [session, properties, propertyId]);

  const areas = useMemo(() => visibleAreas(session), [session]);

  // The top bar follows the open page rather than being selected separately,
  // so switching areas and landing on a page keep one source of truth.
  const currentArea = useMemo(() => areaForPage(areas, active), [areas, active]);

  useEffect(() => {
    const exists = areas.some((a) => a.pages.some((p) => p.id === active));
    if (areas.length && !exists) {
      setActive(areas[0].pages[0].id);
    }
  }, [areas, active]);

  const pageLabel = currentArea?.pages.find((p) => p.id === active)?.label || "";

  return (
    <main className="min-h-screen" style={{ background: "var(--page)" }}>
      {/* Row 1 — brand, property, account */}
      <header
        className="sticky top-0 z-30 flex h-[46px] items-center justify-between px-4"
        style={{
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-[22px] w-[22px] items-center justify-center rounded text-[10px] font-bold"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            RS
          </span>
          <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            Rate Shopper
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* A super admin picks the property; everyone else sees theirs named.
              Either way this is the one place it is set. */}
          {session?.canSwitchProperties && properties.length > 1 ? (
            <select
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              aria-label="Property"
              className="mr-2 rounded px-2 py-1 text-sm"
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
              <span className="mr-2 text-sm" style={{ color: "var(--text-muted)" }}>
                {scopedSession.propertyName}
              </span>
            )
          )}
          <Link
            href="/admin"
            className="rounded px-2 py-1 text-xs transition hover:opacity-70"
            style={{ color: "var(--text-muted)" }}
          >
            Admin
          </Link>
          <ThemeToggle />
          <LogoutButton />
        </div>
      </header>

      {/* Row 2 — areas */}
      <nav
        className="sticky top-[46px] z-20 flex items-center gap-1 px-4"
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
              onClick={() => setActive(area.pages[0].id)}
              className="relative px-3 py-2.5 text-[13px] transition"
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
        {/* Sidebar — the pages of the open area */}
        <aside
          className="sticky top-[84px] h-[calc(100vh-84px)] flex-shrink-0 overflow-y-auto transition-all"
          style={{
            width: railOpen ? 208 : 44,
            background: "var(--surface)",
            borderRight: "1px solid var(--border)",
          }}
        >
          <div className="flex justify-end px-2 py-2">
            <button
              type="button"
              onClick={() => setRailOpen((v) => !v)}
              aria-label={railOpen ? "Collapse menu" : "Expand menu"}
              title={railOpen ? "Collapse menu" : "Expand menu"}
              className="rounded px-1.5 py-1 text-xs transition hover:opacity-70"
              style={{ color: "var(--text-faint)" }}
            >
              {railOpen ? "«" : "»"}
            </button>
          </div>

          <nav className="flex flex-col gap-0.5 px-2 pb-4">
            {railOpen && (
              <p
                className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-faint)" }}
              >
                {currentArea?.label}
              </p>
            )}

            {currentArea?.pages.map((page) => {
              const on = active === page.id;
              const soon = PLACEHOLDER_PAGES.has(page.id);
              return (
                <button
                  key={page.id}
                  type="button"
                  onClick={() => setActive(page.id)}
                  title={railOpen ? undefined : page.label}
                  className="flex items-center gap-2.5 rounded px-2 py-[7px] text-left text-[13px] transition"
                  style={{
                    background: on ? "var(--accent-soft)" : "transparent",
                    color: on ? "var(--accent-text)" : "var(--text-muted)",
                    fontWeight: on ? 600 : 500,
                  }}
                >
                  <span className="flex-shrink-0">
                    <Icon name={page.icon} />
                  </span>
                  {railOpen && (
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
          </nav>
        </aside>

        {/* Content */}
        <section className="min-w-0 flex-1">
          <div className="mx-auto max-w-[1400px] p-6">
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
            ) : (
              <>
                {active === "cm" && <ChannelManager />}

                {active === "integrations" && <Integrations session={scopedSession} />}

                {active === "logs" && <ActivityLog session={scopedSession} />}

                {active === "parity" && <RateParity session={scopedSession} />}

                {active === "pricing" && <DynamicPricing />}

                {/* Rooms and rate plans are separate pages; the component
                    renders one panel or the other. */}
                {active === "rooms" && (
                  <PropertySetup session={scopedSession} only="rooms" />
                )}

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
                  <div className="space-y-4">
                    <div>
                      <h2 className="h1">Users</h2>
                      <p className="sub">Provision access and assign modules.</p>
                    </div>
                    <AdminUserManager session={scopedSession} />
                  </div>
                )}

                {active === "calendar" && (
                  <ComingSoon title="Calendar">
                    A month view of arrivals, departures and occupancy. Part of the
                    Front Office build.
                  </ComingSoon>
                )}

                {active === "reservations" && (
                  <ComingSoon title="Reservations">
                    Create and manage direct bookings. Part of the Front Office build.
                  </ComingSoon>
                )}

                {active === "workflow" && (
                  <ComingSoon title="Workflow">
                    Automations across distribution — rules that act on rates and
                    inventory without manual steps.
                  </ComingSoon>
                )}

                {active === "compshopper" && <CompetitorShopper session={scopedSession} />}

                {active === "location" && (
                  <ComingSoon title="Search by Location">
                    Surface the strongest offers in a destination.
                  </ComingSoon>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
