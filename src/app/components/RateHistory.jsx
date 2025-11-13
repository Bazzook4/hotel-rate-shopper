"use client";

import { useCallback, useEffect, useState, useMemo } from "react";

export default function RateHistory({ session }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDate, setSelectedDate] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [refreshingId, setRefreshingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/searchHistory");
      if (res.status === 401) {
        setHistory([]);
        setError("History is available after you sign in.");
        return;
      }
      if (!res.ok) {
        throw new Error(`History request failed (${res.status})`);
      }
      const json = await res.json();
      const historyData = Array.isArray(json.history) ? json.history : [];
      console.log("Loaded history data:", historyData);
      if (historyData.length > 0) {
        console.log("Sample entry:", historyData[0]);
        console.log("Sample params:", historyData[0].params);
      }
      setHistory(historyData);
    } catch (err) {
      console.error("Failed to load search history", err);
      setError("Could not load history right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Parse params safely
  const parseParams = (entry) => {
    try {
      if (!entry) return null;
      // API returns camelCase 'params' field
      const paramsField = entry.params || entry["Request Params"];
      if (typeof paramsField === "string") {
        return JSON.parse(paramsField);
      }
      return paramsField;
    } catch (err) {
      console.error("Failed to parse params:", err);
      return null;
    }
  };

  // Extract rates from payload
  const extractRates = (entry) => {
    try {
      // API returns camelCase 'payload' field
      const payloadField = entry.payload || entry.Payload;
      const payload = typeof payloadField === "string" ? JSON.parse(payloadField) : payloadField;

      const rates = {};

      // Extract from featured_prices (sponsored)
      (payload?.featured_prices || []).forEach((p) => {
        if (p?.rate_per_night?.extracted_lowest && p.source) {
          rates[p.source] = p.rate_per_night.extracted_lowest;
        }
      });

      // Extract from prices (organic)
      (payload?.prices || []).forEach((p) => {
        if (p?.rate_per_night?.extracted_lowest && p.source) {
          rates[p.source] = p.rate_per_night.extracted_lowest;
        }
      });

      return rates;
    } catch (err) {
      console.error("Failed to extract rates:", err);
    }
    return {};
  };

  // Group history by check-in date
  const groupedHistory = useMemo(() => {
    const groups = {};

    history.forEach((entry) => {
      const params = parseParams(entry);
      const checkInDate = params?.check_in_date;

      console.log("Processing entry:", { entry, params, checkInDate });

      if (checkInDate) {
        if (!groups[checkInDate]) {
          groups[checkInDate] = [];
        }
        groups[checkInDate].push({
          ...entry,
          parsedParams: params,
        });
      }
    });

    // Sort each group by snapshot date (newest first)
    Object.keys(groups).forEach((date) => {
      groups[date].sort((a, b) => {
        // API returns camelCase 'snapshotDate' field
        const dateA = new Date(a.snapshotDate || a["Snapshot Date"] || a.createdAt || 0);
        const dateB = new Date(b.snapshotDate || b["Snapshot Date"] || b.createdAt || 0);
        return dateB - dateA;
      });
    });

    console.log("Grouped history:", groups);
    console.log("Total groups:", Object.keys(groups).length);

    return groups;
  }, [history]);

  // Generate calendar days for current month
  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days = [];

    // Add empty cells for days before the month starts
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }

    // Add all days in the month
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      days.push({
        day,
        dateStr,
        hasData: !!groupedHistory[dateStr],
        searches: groupedHistory[dateStr] || [],
      });
    }

    return days;
  }, [currentMonth, groupedHistory]);

  const handlePrevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
    setSelectedDate(null);
  };

  const handleNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
    setSelectedDate(null);
  };

  const handleToday = () => {
    setCurrentMonth(new Date());
    setSelectedDate(null);
  };

  const handleRefresh = async (entry) => {
    if (!entry?.parsedParams) return;
    setRefreshingId(entry.id);
    try {
      const params = new URLSearchParams(entry.parsedParams);
      const res = await fetch(`/api/hotel?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || "Refresh failed");
      }

      const updateRes = await fetch(`/api/searchHistory/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: json,
          params: entry.parsedParams,
        }),
      });

      if (updateRes.ok) {
        await loadHistory();
      }
    } catch (err) {
      console.error("Failed to refresh snapshot", err);
      setError("Failed to refresh. Please try again.");
      setTimeout(() => setError(""), 3000);
    } finally {
      setRefreshingId(null);
    }
  };

  const handleDelete = async (entry) => {
    setDeletingId(entry.id);
    try {
      await fetch(`/api/searchHistory/${entry.id}`, { method: "DELETE" });
      await loadHistory();
      if (selectedDate && groupedHistory[selectedDate]?.length === 1) {
        setSelectedDate(null);
      }
    } catch (err) {
      console.error("Failed to delete snapshot", err);
      setError("Failed to delete. Please try again.");
      setTimeout(() => setError(""), 3000);
    } finally {
      setDeletingId(null);
    }
  };

  const formatDateTime = (dateString) => {
    try {
      if (!dateString) return "N/A";
      return new Date(dateString).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch {
      return "Invalid date";
    }
  };

  const compareRates = (latest, previous) => {
    const latestRates = extractRates(latest);
    const previousRates = extractRates(previous);

    const comparison = {};
    Object.keys(latestRates).forEach((source) => {
      const current = latestRates[source];
      const prev = previousRates[source];

      if (prev && current !== prev) {
        comparison[source] = {
          current,
          previous: prev,
          change: current - prev,
          percentChange: ((current - prev) / prev * 100).toFixed(1),
        };
      } else {
        comparison[source] = { current, previous: prev };
      }
    });

    return comparison;
  };

  const monthName = currentMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  if (loading) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center backdrop-blur-xl">
        <p className="text-slate-300">Loading rate history...</p>
      </div>
    );
  }

  if (error && history.length === 0) {
    return (
      <div className="rounded-3xl border border-amber-300/30 bg-amber-400/10 p-4 backdrop-blur-xl">
        <p className="text-sm text-amber-100">{error}</p>
      </div>
    );
  }

  const selectedDayData = selectedDate ? groupedHistory[selectedDate] : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Calendar View */}
      <div className="lg:col-span-2 space-y-4">
        {/* Month Navigation */}
        <div className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <button
              onClick={handlePrevMonth}
              className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-white/15 transition"
            >
              ← Prev
            </button>
            <div className="text-center">
              <h3 className="text-xl font-semibold text-white">{monthName}</h3>
              <button
                onClick={handleToday}
                className="mt-1 text-xs text-blue-300 hover:text-blue-200 transition"
              >
                Today
              </button>
            </div>
            <button
              onClick={handleNextMonth}
              className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-white/15 transition"
            >
              Next →
            </button>
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
          {/* Week day headers */}
          <div className="grid grid-cols-7 gap-2 mb-4">
            {weekDays.map((day) => (
              <div key={day} className="text-center text-xs font-semibold text-slate-400 uppercase tracking-wider">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar days */}
          <div className="grid grid-cols-7 gap-2">
            {calendarDays.map((dayData, idx) => {
              if (!dayData) {
                return <div key={`empty-${idx}`} className="aspect-square" />;
              }

              const isSelected = selectedDate === dayData.dateStr;
              const isToday = dayData.dateStr === new Date().toISOString().split('T')[0];
              const rates = dayData.hasData ? extractRates(dayData.searches[0]) : {};
              const rateCount = Object.keys(rates).length;
              const latestParams = dayData.hasData ? dayData.searches[0].parsedParams : null;
              const guestInfo = latestParams ? `${latestParams.adults}A${latestParams.children > 0 ? `,${latestParams.children}C` : ''}` : '';

              return (
                <button
                  key={dayData.dateStr}
                  onClick={() => setSelectedDate(dayData.hasData ? dayData.dateStr : null)}
                  disabled={!dayData.hasData}
                  className={`
                    aspect-square rounded-xl p-2 transition-all relative
                    ${dayData.hasData
                      ? 'bg-gradient-to-br from-blue-500/20 to-purple-500/20 border-2 border-blue-400/30 hover:border-blue-400/60 hover:from-blue-500/30 hover:to-purple-500/30 cursor-pointer'
                      : 'bg-white/5 border border-white/10 cursor-default'
                    }
                    ${isSelected ? 'ring-2 ring-blue-400 border-blue-400' : ''}
                    ${isToday ? 'ring-1 ring-amber-400' : ''}
                  `}
                >
                  <div className="flex flex-col h-full">
                    <span className={`text-sm font-semibold ${dayData.hasData ? 'text-white' : 'text-slate-400'}`}>
                      {dayData.day}
                    </span>
                    {dayData.hasData && (
                      <div className="mt-auto space-y-0.5">
                        <div className="text-[9px] text-blue-200 font-medium">
                          {rateCount} rate{rateCount !== 1 ? 's' : ''}
                        </div>
                        <div className="text-[8px] text-purple-200 font-medium">
                          {guestInfo}
                        </div>
                        {dayData.searches.length > 1 && (
                          <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-green-400" title={`${dayData.searches.length} searches`} />
                        )}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-center gap-6 text-xs text-slate-300">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-gradient-to-br from-blue-500/20 to-purple-500/20 border-2 border-blue-400/30" />
              <span>Has data</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400" />
              <span>Multiple searches</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded ring-1 ring-amber-400" />
              <span>Today</span>
            </div>
          </div>
        </div>
      </div>

      {/* Details Panel */}
      <div className="lg:col-span-1">
        {selectedDayData ? (
          <div className="space-y-4">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
              <h4 className="text-lg font-semibold text-white mb-2">
                {new Date(selectedDate).toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric'
                })}
              </h4>
              <div className="flex items-center gap-3 text-xs text-slate-400">
                <span>
                  {selectedDayData.length} search{selectedDayData.length !== 1 ? 'es' : ''} for this date
                </span>
                <span className="text-slate-500">•</span>
                <span className="rounded-full border border-purple-400/30 bg-purple-500/10 px-2 py-0.5 text-purple-200">
                  {selectedDayData[0].parsedParams?.adults || 2} adults
                  {selectedDayData[0].parsedParams?.children > 0 && `, ${selectedDayData[0].parsedParams.children} children`}
                </span>
              </div>
            </div>

            {/* Latest Search */}
            <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl overflow-hidden">
              <div className="bg-gradient-to-r from-blue-500/20 to-purple-500/20 px-4 py-3 border-b border-white/10">
                <div className="flex items-center justify-between">
                  <h5 className="text-sm font-semibold text-white">Latest Search</h5>
                  <button
                    onClick={() => handleRefresh(selectedDayData[0])}
                    disabled={refreshingId === selectedDayData[0].id}
                    className="rounded-lg bg-blue-500/30 px-3 py-1 text-xs font-medium text-blue-100 hover:bg-blue-500/40 disabled:opacity-50 transition"
                  >
                    {refreshingId === selectedDayData[0].id ? "..." : "↻ Refresh"}
                  </button>
                </div>
                <p className="text-xs text-slate-300 mt-1">
                  {formatDateTime(selectedDayData[0].snapshotDate || selectedDayData[0]["Snapshot Date"] || selectedDayData[0].createdAt)}
                </p>
              </div>

              <div className="p-4 space-y-2">
                {(() => {
                  const rates = extractRates(selectedDayData[0]);
                  const params = selectedDayData[0].parsedParams;

                  // Sort rates from low to high
                  const sortedRates = Object.entries(rates).sort((a, b) => a[1] - b[1]);

                  return sortedRates.length > 0 ? (
                    <>
                      {sortedRates.map(([source, rate], idx) => (
                        <div key={source} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                          <span className="text-sm text-slate-300 font-medium">{source}</span>
                          <span className={`text-base font-semibold ${idx === 0 ? 'text-green-300' : 'text-white'}`}>
                            {params?.currency || 'INR'} {rate?.toLocaleString()}
                          </span>
                        </div>
                      ))}
                      <div className="pt-2 text-xs text-slate-400">
                        {params?.adults} adults {params?.children > 0 ? `, ${params.children} children` : ''}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-slate-400">No rate data available</p>
                  );
                })()}
              </div>
            </div>

            {/* Historical Searches */}
            {selectedDayData.length > 1 && (
              <div className="space-y-3">
                <h5 className="text-sm font-semibold text-slate-200 px-2">
                  Previous Searches ({selectedDayData.length - 1})
                </h5>
                {selectedDayData.slice(1).map((search) => {
                  const comparison = compareRates(selectedDayData[0], search);
                  const params = search.parsedParams;

                  return (
                    <div
                      key={search.id}
                      className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl overflow-hidden"
                    >
                      <div className="px-4 py-2 bg-white/5 border-b border-white/10 flex items-center justify-between">
                        <p className="text-xs text-slate-300">
                          {formatDateTime(search.snapshotDate || search["Snapshot Date"] || search.createdAt)}
                        </p>
                        <button
                          onClick={() => handleDelete(search)}
                          disabled={deletingId === search.id}
                          className="text-xs text-rose-300 hover:text-rose-200 disabled:opacity-50 transition"
                        >
                          {deletingId === search.id ? "..." : "Delete"}
                        </button>
                      </div>

                      <div className="p-3 space-y-2">
                        {Object.entries(comparison).map(([source, data]) => (
                          <div key={source} className="flex items-center justify-between text-xs">
                            <span className="text-slate-400">{source}</span>
                            <div className="flex items-center gap-2">
                              {data.previous && (
                                <span className="text-slate-500 line-through">
                                  {params?.currency || 'INR'} {data.previous?.toLocaleString()}
                                </span>
                              )}
                              {data.change && (
                                <span
                                  className={`font-semibold ${
                                    data.change > 0
                                      ? "text-rose-300"
                                      : data.change < 0
                                      ? "text-green-300"
                                      : "text-slate-300"
                                  }`}
                                >
                                  {data.change > 0 ? "↑" : "↓"}
                                  {Math.abs(data.percentChange)}%
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center backdrop-blur-xl">
            <div className="text-4xl mb-3">📅</div>
            <p className="text-sm text-slate-300">
              Select a date with tracked rates to view details
            </p>
          </div>
        )}
      </div>

      {/* Error Toast */}
      {error && history.length > 0 && (
        <div className="fixed bottom-4 right-4 rounded-2xl border border-rose-300/30 bg-rose-500/20 backdrop-blur-xl px-4 py-3 text-sm text-rose-100 shadow-lg">
          {error}
        </div>
      )}
    </div>
  );
}
