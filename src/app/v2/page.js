"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { visibleModules } from "./modules";
import ChannelManager from "./components/ChannelManager";
import DisparityChecker from "../components/DisparityChecker";
import DynamicPricing from "../components/DynamicPricing";
import AdminUserManager from "../components/AdminUserManager";
import LogoutButton from "../components/LogoutButton";

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
        if (!cancelled) setSession(json?.session ?? json ?? null);
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
    <main className="relative flex min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-blue-500/30 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-[420px] w-[420px] rounded-full bg-purple-500/20 blur-3xl" />
      </div>

      <aside className="sticky top-0 h-screen w-[200px] flex-shrink-0 overflow-y-auto border-r border-white/10 bg-white/5 backdrop-blur-xl">
        <div className="p-3">
          <div className="mb-4 space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Dashboard</p>
              <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                v2
              </span>
            </div>
            <h1 className="text-xl font-semibold text-white">Rate Shopper</h1>
            <p className="text-xs text-slate-300/80">Distribution, parity and pricing.</p>
          </div>

          <nav className="flex flex-col gap-1.5">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActive(item.id)}
                className={`group flex items-center gap-2 rounded-xl px-2.5 py-2 text-left transition ${
                  active === item.id
                    ? "bg-white/15 text-white shadow-inner"
                    : "text-slate-200/80 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span className="text-base leading-none">{item.icon}</span>
                <span className="text-xs font-medium">{item.label}</span>
              </button>
            ))}
          </nav>

          <div className="mt-6 space-y-2">
            <Link
              href="/"
              className="block rounded-xl px-2.5 py-2 text-xs text-slate-400 transition hover:bg-white/10 hover:text-white"
            >
              ← Back to v1
            </Link>
            <LogoutButton />
          </div>
        </div>
      </aside>

      <section className="flex-1 overflow-x-hidden">
        <div className="p-3">
          {sessionLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="space-y-3 text-center">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-white" />
                <p className="text-sm text-slate-400">Loading dashboard…</p>
              </div>
            </div>
          ) : (
            <>
              {active === "cm" && <ChannelManager />}

              {active === "compshopper" && (
                <div className="space-y-4">
                  <div>
                    <h2 className="text-3xl font-semibold text-white">Comp Shopper</h2>
                    <p className="text-sm text-slate-300/80">
                      Calendar view of your rate against the comp set median.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-8 text-center">
                    <p className="text-sm text-slate-300">
                      Calendar grid is the next build step.
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Stored rates with a refresh control, median per date, colour-coded
                      against your own rate.
                    </p>
                  </div>
                </div>
              )}

              {active === "parity" && (
                <div className="space-y-4">
                  <div>
                    <h2 className="text-3xl font-semibold text-white">Rate Parity</h2>
                    <p className="text-sm text-slate-300/80">
                      Audit OTA spreads for a specific hotel and highlight actionable gaps.
                    </p>
                  </div>
                  <DisparityChecker defaultHotelName={session?.propertyName} />
                </div>
              )}

              {active === "location" && (
                <div className="space-y-4">
                  <div>
                    <h2 className="text-3xl font-semibold text-white">Search by Location</h2>
                    <p className="text-sm text-slate-300/80">
                      Surface the strongest offers in a destination.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-8 text-center">
                    <p className="text-sm text-slate-300">
                      Carried over from v1 in the next step.
                    </p>
                  </div>
                </div>
              )}

              {active === "pricing" && <DynamicPricing />}

              {active === "users" && session?.role === "Admin" && (
                <div className="space-y-4">
                  <div>
                    <h2 className="text-3xl font-semibold text-white">Manage Users</h2>
                    <p className="text-sm text-slate-300/80">
                      Provision access and assign modules.
                    </p>
                  </div>
                  <AdminUserManager />
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
