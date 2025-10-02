"use client";

import { useEffect, useMemo, useState } from "react";

// Adjust paths if your folder structure differs
import SearchBar from "./components/SearchBar";
import HotelRateShopper from "./components/HotelRateShopper";
import CompSetEditor from "./components/CompSetEditor";
import ComparePanel from "./components/ComparePanel";
import LocationSearch from "./components/LocationSearch";
import LocationResults from "./components/LocationResults";
import DisparityChecker from "./components/DisparityChecker";
import LogoutButton from "./components/LogoutButton";
import AdminUserManager from "./components/AdminUserManager";

function SingleSearchPanel() {
  const [data, setData] = useState(null);

  return (
    <div className="space-y-4">
      <SearchBar onResult={setData} />
      {data ? (
        <HotelRateShopper data={data} />
      ) : (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200/70">
          Enter a hotel and dates, then hit <span className="text-white font-semibold">Search</span>.
        </div>
      )}
    </div>
  );
}

function LocationSearchPanel() {
  const [results, setResults] = useState(null);

  return (
    <div className="space-y-4">
      <LocationSearch onResult={setResults} />
      {results ? (
        <LocationResults data={results} />
      ) : (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200/70">
          Enter a city/area (optionally lat/lng), then hit <span className="text-white font-semibold">Search by Location</span>.
        </div>
      )}
    </div>
  );
}

export default function Page() {
  // "search" | "compare" | "location" | "disparity" | "users"
  const [active, setActive] = useState("search");
  const [compSet, setCompSet] = useState(null);
  const [session, setSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadSession() {
      setSessionLoading(true);
      try {
        const res = await fetch("/api/auth/session");
        if (!res.ok) throw new Error("Session load failed");
        const data = await res.json();
        if (!cancelled) {
          setSession(data.user || null);
        }
      } catch (err) {
        if (!cancelled) {
          setSession(null);
        }
      } finally {
        if (!cancelled) {
          setSessionLoading(false);
        }
      }
    }
    loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const navItems = useMemo(() => {
    const items = [
      { id: "search", label: "Search a Hotel", icon: "🔎" },
      { id: "compare", label: "Compare Hotels", icon: "📊" },
      { id: "location", label: "Search by Location", icon: "📍" },
      { id: "disparity", label: "Disparity Checker", icon: "🧭" },
    ];
    if (session?.role === "Admin") {
      items.push({ id: "users", label: "Manage Users", icon: "👥" });
    }
    return items;
  }, [session]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-blue-500/30 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-[420px] w-[420px] rounded-full bg-purple-500/20 blur-3xl" />
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8 md:px-6 md:py-12">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[260px_1fr]">
          {/* Sidebar */}
          <aside className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl shadow-[0_20px_50px_rgba(15,23,42,0.35)]">
            <div className="mb-6 space-y-1">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Dashboard</p>
              <h1 className="text-2xl font-semibold text-white">Rate Shopper</h1>
              <p className="text-xs text-slate-300/80">
                Stay on top of parity, compset, and location trends with a single workspace.
              </p>
            </div>

            <nav className="flex flex-col gap-2">
              {navItems.map((item) => {
                const activeState = active === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActive(item.id)}
                    className={`group flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition ${
                      activeState
                        ? "bg-white/15 text-white shadow-inner"
                        : "text-slate-200/80 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <span className="text-lg leading-none">{item.icon}</span>
                    <span className="text-sm font-medium tracking-wide">{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="mt-8">
              <LogoutButton />
            </div>

          </aside>

          {/* Main content */}
          <section className="space-y-6">
            {active === "search" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-3xl font-semibold text-white">Search a Hotel</h2>
                    <p className="text-sm text-slate-300/80">
                      Quick parity snapshot for a single property and date range.
                    </p>
                  </div>
                </div>
                <SingleSearchPanel />
              </div>
            )}

            {active === "compare" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-3xl font-semibold text-white">Compare Hotels</h2>
                    <p className="text-sm text-slate-300/80">
                      Define your comp set and monitor channel-level deltas in real time.
                    </p>
                  </div>
                </div>
                <CompSetEditor value={compSet} onChange={setCompSet} />
                <ComparePanel compSet={compSet} />
              </div>
            )}

            {active === "location" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-3xl font-semibold text-white">Search by Location</h2>
                    <p className="text-sm text-slate-300/80">
                      Surface the strongest offers in a destination, filtered by rating and amenities.
                    </p>
                  </div>
                </div>
                <LocationSearchPanel />
              </div>
            )}

            {active === "disparity" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-3xl font-semibold text-white">Disparity Checker</h2>
                    <p className="text-sm text-slate-300/80">
                      Audit OTA spreads for a specific hotel and highlight actionable gaps.
                    </p>
                  </div>
                </div>
                <DisparityChecker />
              </div>
            )}

            {active === "users" && session?.role === "Admin" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-3xl font-semibold text-white">Manage Users</h2>
                    <p className="text-sm text-slate-300/80">
                      Provision login access for teammates and assign them to properties.
                    </p>
                  </div>
                </div>
                <AdminUserManager />
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
