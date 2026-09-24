"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { visibleModules } from "./dashboard/modules";
import ChannelManager from "./dashboard/components/ChannelManager";
import PropertySetup from "./dashboard/components/PropertySetup";
import Integrations from "./dashboard/components/Integrations";
import DisparityChecker from "./components/DisparityChecker";
import DynamicPricing from "./components/DynamicPricing";
import AdminUserManager from "./components/AdminUserManager";
import LogoutButton from "./components/LogoutButton";
import ThemeToggle from "./components/ThemeToggle";

export default function V2Dashboard() {
  const [session, setSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [active, setActive] = useState("cm");

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

  const navItems = useMemo(() => visibleModules(session), [session]);

  useEffect(() => {
    if (navItems.length && !navItems.some((i) => i.id === active)) {
      setActive(navItems[0].id);
    }
  }, [navItems, active]);

  return (
    <main className="flex min-h-screen">
      <aside
        className="sticky top-0 h-screen w-[230px] flex-shrink-0 overflow-y-auto"
        style={{
          background: "var(--surface)",
          borderRight: "1px solid var(--border)",
        }}
      >
        <div className="p-4">
          <div className="mb-6">
            <h1 className="h2">Rate Shopper</h1>
            <p className="sub text-xs">Distribution &amp; pricing</p>
          </div>

          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider faint">
            Menu
          </p>

          <nav className="flex flex-col gap-0.5">
            {navItems.map((item) => {
              const on = active === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActive(item.id)}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition"
                  style={{
                    background: on ? "var(--accent-soft)" : "transparent",
                    color: on ? "var(--accent-text)" : "var(--text-muted)",
                    fontWeight: on ? 600 : 500,
                  }}
                >
                  <span className="text-base leading-none">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div
            className="mt-6 space-y-1 pt-4"
            style={{ borderTop: "1px solid var(--border)" }}
          >
            <Link
              href="/admin"
              className="block rounded-lg px-3 py-2 text-sm muted transition hover:opacity-80"
            >
              Admin
            </Link>
            <Link
              href="/v1"
              className="block rounded-lg px-3 py-2 text-sm muted transition hover:opacity-80"
            >
              Previous dashboard
            </Link>
            <ThemeToggle className="w-full justify-start px-3" />
            <LogoutButton />
          </div>
        </div>
      </aside>

      <section className="flex-1 overflow-x-hidden">
        <div className="mx-auto max-w-[1400px] p-6">
          {sessionLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="space-y-3 text-center">
                <div
                  className="inline-block h-7 w-7 animate-spin rounded-full border-2"
                  style={{ borderColor: "var(--border)", borderTopColor: "var(--accent)" }}
                />
                <p className="sub">Loading dashboard…</p>
              </div>
            </div>
          ) : (
            <>
              {active === "cm" && <ChannelManager />}

              {active === "compshopper" && (
                <div className="space-y-4">
                  <div>
                    <h2 className="h1">Comp Shopper</h2>
                    <p className="sub">
                      Calendar view of your rate against the comp set median.
                    </p>
                  </div>
                  <div className="card card-pad text-center">
                    <p className="sub">
                      Calendar grid is the next build step.
                    </p>
                    <p className="mt-1 text-xs faint">
                      Stored rates with a refresh control, median per date, colour-coded
                      against your own rate.
                    </p>
                  </div>
                </div>
              )}

              {active === "parity" && (
                <div className="space-y-4">
                  <div>
                    <h2 className="h1">Rate Parity</h2>
                    <p className="sub">
                      Audit OTA spreads for a specific hotel and highlight actionable gaps.
                    </p>
                  </div>
                  <DisparityChecker defaultHotelName={session?.propertyName} />
                </div>
              )}

              {active === "location" && (
                <div className="space-y-4">
                  <div>
                    <h2 className="h1">Search by Location</h2>
                    <p className="sub">
                      Surface the strongest offers in a destination.
                    </p>
                  </div>
                  <div className="card card-pad text-center">
                    <p className="sub">
                      Carried over from v1 in the next step.
                    </p>
                  </div>
                </div>
              )}

              {active === "pricing" && <DynamicPricing />}

              {active === "setup" && <PropertySetup session={session} />}

              {active === "integrations" && <Integrations session={session} />}

              {active === "users" && session?.canManageUsers && (
                <div className="space-y-4">
                  <div>
                    <h2 className="h1">Manage Users</h2>
                    <p className="sub">
                      Provision access and assign modules.
                    </p>
                  </div>
                  <AdminUserManager session={session} />
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
