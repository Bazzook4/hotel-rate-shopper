"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// Adjust paths if your folder structure differs
import SearchBar from "../components/SearchBar";
import HotelRateShopper from "../components/HotelRateShopper";
import CompSetEditor from "../components/CompSetEditor";
import ComparePanel from "../components/ComparePanel";
import LocationSearch from "../components/LocationSearch";
import LocationResults from "../components/LocationResults";
import DisparityChecker from "../components/DisparityChecker";
import LogoutButton from "../components/LogoutButton";
import AdminUserManager from "../components/AdminUserManager";
import DynamicPricing from "../components/DynamicPricing";
import SavedSearchTable from "../components/SavedSearchTable";
import RateHistory from "../components/RateHistory";
import { canManageUsers } from "@/lib/permissions";
import Icon from "../components/Icon";

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
          className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-white/30 hover:bg-white/15"
        >
          {historyOpen ? "Hide Rate History" : "Rate History"}
        </button>
      </div>

      {historyOpen && (
        <div className="space-y-3 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-ink/70">
              Rate Tracking History
            </h3>
            <button
              type="button"
              onClick={loadHistory}
              className="text-xs muted/70 hover:text-ink"
              disabled={historyLoading}
            >
              {historyLoading ? "Refreshing..." : "Refresh list"}
            </button>
          </div>

          {historyError && (
            <div className="rounded-2xl border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-xs text-[var(--warn)]">
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
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 sub/70">
          Select your dates and click <span className="text-ink font-semibold">Track My Rates</span> to get started.
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
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 sub/70">
          Enter a city/area (optionally lat/lng), then hit <span className="text-ink font-semibold">Search by Location</span>.
        </div>
      )}
    </div>
  );
}

export default function Page() {
  // "ratetracker" | "compare" | "location" | "disparity" | "pricing" | "users"
  // Persist active tab in localStorage to survive page refreshes
  const [active, setActive] = useState('ratetracker');
  const [isClient, setIsClient] = useState(false);
  const [compSet, setCompSet] = useState(null);
  const [session, setSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  // Load from localStorage on mount (client-side only) - runs before first paint
  useEffect(() => {
    const savedTab = localStorage.getItem('activeTab');
    if (savedTab) {
      setActive(savedTab);
    }
    setIsClient(true);
  }, []);

  // Persist active tab to localStorage when it changes
  useEffect(() => {
    if (isClient) {
      localStorage.setItem('activeTab', active);
    }
  }, [active, isClient]);

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
    const allItems = [
      { id: "ratetracker", label: "Rate Tracker", icon: "chart" },
      { id: "history", label: "Rate History", icon: "trend" },
      { id: "compare", label: "Compare Hotels", icon: "search" },
      { id: "location", label: "Search by Location", icon: "pin" },
      { id: "disparity", label: "Disparity Checker", icon: "compass" },
      { id: "pricing", label: "Dynamic Pricing", icon: "money" },
    ];

    // Admin always gets Manage Users tab
    if (canManageUsers(session)) {
      allItems.push({ id: "users", label: "Manage Users", icon: "users" });
      // Admins get all modules by default
      return allItems;
    }

    // For non-admin users, filter by module permissions
    const userModules = session?.modules || [];

    // If no modules are assigned, show all (backward compatibility)
    if (userModules.length === 0) {
      return allItems;
    }

    // Filter items based on user's module permissions
    return allItems.filter(item => userModules.includes(item.id));
  }, [session]);

  return (
    <main className="relative min-h-screen flex">

      {/* Sidebar - Sticky to left, full height */}
      <aside className="w-[180px] flex-shrink-0 border-r border-[var(--border)] bg-[var(--surface)] backdrop-blur-xl sticky top-0 h-screen overflow-y-auto">
        <div className="p-3">
          <div className="mb-4 space-y-1">
            <p className="text-xs uppercase tracking-[0.2em] muted">Dashboard</p>
            <h1 className="h2">Rate Shopper</h1>
            <p className="text-xs muted">
              Stay on top of parity and compsets.
            </p>
          </div>

          <nav className="flex flex-col gap-1.5">
            {navItems.map((item) => {
              const activeState = active === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActive(item.id)}
                  style={!isClient ? { opacity: 0 } : {}}
                  className={`group flex items-center gap-2 rounded-xl px-2.5 py-2 text-left transition ${
                    activeState
                      ? "bg-white/15 text-ink shadow-inner"
                      : "text-ink/80 hover:bg-[var(--surface-2)] hover:text-ink"
                  }`}
                >
                  <Icon name={item.icon} />
                  <span className="text-xs font-medium">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="mt-6">
            <LogoutButton />
          </div>
        </div>
      </aside>

      {/* Main content - Takes remaining space */}
      <section className="flex-1 overflow-x-hidden">
        <div className="p-3">
            {sessionLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="text-center space-y-3">
                  <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-white/20 border-t-white"></div>
                  <p className="sub">Loading dashboard...</p>
                </div>
              </div>
            ) : (
              <>
                {active === "ratetracker" && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="h1">Rate Tracker</h2>
                        <p className="sub">
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
                        <h2 className="h1">Rate History</h2>
                        <p className="sub">
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
                        <h2 className="h1">Compare Hotels</h2>
                        <p className="sub">
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
                        <h2 className="h1">Search by Location</h2>
                        <p className="sub">
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
                        <h2 className="h1">Disparity Checker</h2>
                        <p className="sub">
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

                {active === "users" && canManageUsers(session) && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="h1">Manage Users</h2>
                        <p className="sub">
                          Provision login access for teammates and assign them to properties.
                        </p>
                      </div>
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
