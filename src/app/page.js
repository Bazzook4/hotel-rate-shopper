"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
import DynamicPricing from "./components/DynamicPricing";
import SavedSearchTable from "./components/SavedSearchTable";
import RateHistory from "./components/RateHistory";

function SingleSearchPanel({ session }) {
  const [data, setData] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [history, setHistory] = useState([]);
  const [refreshingId, setRefreshingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    []
  );

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const res = await fetch("/api/searchHistory");
      if (res.status === 401) {
        setHistory([]);
        setHistoryError("History is available after you sign in.");
        return;
      }
      if (!res.ok) {
        throw new Error(`History request failed (${res.status})`);
      }
      const json = await res.json();
      setHistory(Array.isArray(json.history) ? json.history : []);
    } catch (err) {
      console.error("Failed to load search history", err);
      setHistoryError("Could not load history right now.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const toggleHistory = useCallback(() => {
    setHistoryOpen((prev) => {
      const next = !prev;
      if (next) {
        loadHistory();
      }
      return next;
    });
  }, [loadHistory]);

  const handleResult = async (result, context) => {
    setData(result);
    if (!context?.query) return;
    try {
      const res = await fetch("/api/searchHistory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: context.query,
          params: context.params,
          payload: result,
        }),
      });
      if (!res.ok) return;
      const body = await res.json();
      if (body?.history) {
        setHistory((prev) => {
          const filtered = prev.filter((item) => item.id !== body.history.id);
          return [body.history, ...filtered];
        });
      }
    } catch (err) {
      console.error("Failed to save search snapshot", err);
    }
  };

  const handleRefresh = async (entry) => {
    if (!entry?.params) return;
    setRefreshingId(entry.id);
    try {
      const params = new URLSearchParams(entry.params);
      const res = await fetch(`/api/hotel?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || "Refresh failed");
      }
      setData(json);

      const updateRes = await fetch(`/api/searchHistory/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: json,
          params: entry.params,
        }),
      });

      if (updateRes.ok) {
        const updatedBody = await updateRes.json();
        if (updatedBody?.history) {
          setHistory((prev) => {
            const filtered = prev.filter((item) => item.id !== updatedBody.history.id);
            return [updatedBody.history, ...filtered];
          });
        }
      }
    } catch (err) {
      console.error("Failed to refresh snapshot", err);
    } finally {
      setRefreshingId(null);
    }
  };

  const handleDelete = async (entry) => {
    setDeletingId(entry.id);
    try {
      await fetch(`/api/searchHistory/${entry.id}`, { method: "DELETE" });
      setHistory((prev) => prev.filter((item) => item.id !== entry.id));
      if (expandedId === entry.id) {
        setExpandedId(null);
      }
    } catch (err) {
      console.error("Failed to delete snapshot", err);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={toggleHistory}
          className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-white/30 hover:bg-white/15"
        >
          {historyOpen ? "Hide Rate History" : "Rate History"}
        </button>
      </div>

      {historyOpen && (
        <div className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-200/70">
              Rate Tracking History
            </h3>
            <button
              type="button"
              onClick={loadHistory}
              className="text-xs text-slate-300/70 hover:text-white"
              disabled={historyLoading}
            >
              {historyLoading ? "Refreshing..." : "Refresh list"}
            </button>
          </div>

          {historyError && (
            <div className="rounded-2xl border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
              {historyError}
            </div>
          )}

          {!historyLoading && (
            <SavedSearchTable
              history={history}
              onRefresh={handleRefresh}
              onDelete={handleDelete}
              refreshingId={refreshingId}
              deletingId={deletingId}
            />
          )}
        </div>
      )}

      <SearchBar onResult={handleResult} defaultHotelName={session?.propertyName} />
      {data ? (
        <HotelRateShopper data={data} />
      ) : (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200/70">
          Select your dates and click <span className="text-white font-semibold">Track My Rates</span> to get started.
        </div>
      )}
    </div>
  );
}

function LocationSearchPanel({ session }) {
  const [results, setResults] = useState(null);

  return (
    <div className="space-y-4">
      <LocationSearch onResult={setResults} defaultLocation={session?.propertyLocation} />
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
  // "ratetracker" | "compare" | "location" | "disparity" | "pricing" | "users"
  const [active, setActive] = useState("ratetracker");
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
      { id: "ratetracker", label: "Rate Tracker", icon: "📊" },
      { id: "history", label: "Rate History", icon: "📈" },
      { id: "compare", label: "Compare Hotels", icon: "🔎" },
      { id: "location", label: "Search by Location", icon: "📍" },
      { id: "disparity", label: "Disparity Checker", icon: "🧭" },
      { id: "pricing", label: "Dynamic Pricing", icon: "💰" },
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
            {active === "ratetracker" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-3xl font-semibold text-white">Rate Tracker</h2>
                    <p className="text-sm text-slate-300/80">
                      Track your property&apos;s rates across multiple OTAs over time.
                    </p>
                  </div>
                </div>
                <SingleSearchPanel session={session} />
              </div>
            )}

            {active === "history" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-3xl font-semibold text-white">Rate History</h2>
                    <p className="text-sm text-slate-300/80">
                      View and compare historical rate searches grouped by check-in date.
                    </p>
                  </div>
                </div>
                <RateHistory session={session} />
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
                <CompSetEditor value={compSet} onChange={setCompSet} session={session} />
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
                <LocationSearchPanel session={session} />
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
                <DisparityChecker defaultHotelName={session?.propertyName} />
              </div>
            )}

            {active === "pricing" && (
              <div className="space-y-4">
                <DynamicPricing />
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
