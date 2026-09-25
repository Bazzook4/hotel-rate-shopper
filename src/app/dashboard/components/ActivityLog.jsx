"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The channel-manager activity log.
 *
 * One row per attempt that crossed the partner boundary, in either direction:
 * rates, inventory and restrictions going out, reservations coming in. Rows
 * are written even when the attempt failed or the connection was not live,
 * so "why did my update not reach Booking.com" has an answer here.
 */

const PAGE_SIZE = 50;

/** Filter tabs. An empty `kinds` means everything. */
const TABS = [
  { id: "all", label: "All activity", kinds: [] },
  { id: "rates", label: "Rates", kinds: ["rates", "multiplier"] },
  { id: "inventory", label: "Inventory", kinds: ["inventory"] },
  { id: "restrictions", label: "Restrictions", kinds: ["restrictions"] },
  { id: "reservation", label: "Reservations", kinds: ["reservation"] },
];

const KIND_LABELS = {
  rates: "Rates",
  inventory: "Inventory",
  restrictions: "Restrictions",
  multiplier: "Channel multiplier",
  reservation: "Reservation",
};

const STATUS_CHIP = {
  success: "chip chip-ok",
  failed: "chip chip-warn",
  skipped: "chip chip-off",
};

const STATUS_LABELS = {
  success: "Sent",
  failed: "Failed",
  skipped: "Not sent",
};

/** Where the row came from, in words rather than the stored slug. */
const SOURCE_LABELS = {
  aiosell: "Aiosell",
  mock: "Not connected",
  local: "Saved here",
};

function formatWhen(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A date span reads as one date when both ends match. */
function formatSpan(from, to) {
  if (!from && !to) return "—";
  if (!to || from === to) return from || to;
  return `${from} → ${to}`;
}

export default function ActivityLog({ session }) {
  const [tab, setTab] = useState("all");
  const [status, setStatus] = useState("");
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      const kinds = TABS.find((t) => t.id === tab)?.kinds || [];
      if (kinds.length > 0) params.set("kinds", kinds.join(","));
      if (status) params.set("status", status);
      if (session?.property_id) params.set("propertyId", session.property_id);

      const res = await fetch(`/api/logs?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not load the log");

      setLogs(json.logs || []);
      setTotal(json.total || 0);
    } catch (err) {
      setError(err.message);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [tab, status, offset, session?.property_id]);

  useEffect(() => {
    load();
  }, [load]);

  // A filter change restarts paging; otherwise page 3 of one filter would
  // carry over to a filter with only one page.
  function changeTab(id) {
    setTab(id);
    setOffset(0);
    setExpanded(null);
  }

  function changeStatus(value) {
    setStatus(value);
    setOffset(0);
    setExpanded(null);
  }

  const showingTo = Math.min(offset + logs.length, total);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="h1">Activity Log</h2>
          <p className="sub">
            Every rate, inventory and restriction update sent to Aiosell, and
            every reservation received back.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="btn btn-secondary"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <p className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => changeTab(t.id)}
            className={tab === t.id ? "btn btn-primary" : "btn btn-secondary"}
          >
            {t.label}
          </button>
        ))}

        <select
          value={status}
          onChange={(e) => changeStatus(e.target.value)}
          className="input ml-auto w-auto"
        >
          <option value="">Any outcome</option>
          <option value="success">Sent</option>
          <option value="failed">Failed</option>
          <option value="skipped">Not sent</option>
        </select>
      </div>

      <div className="card overflow-x-auto">
        <table className="grid-table min-w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide faint">
              <th className="py-1 px-2">When</th>
              <th className="py-1 px-2">Activity</th>
              <th className="py-1 px-2">Outcome</th>
              <th className="py-1 px-2">Dates</th>
              <th className="py-1 px-2">Entries</th>
              <th className="py-1 px-2">Detail</th>
              <th className="py-1 px-2">By</th>
              <th className="py-1 px-2" />
            </tr>
          </thead>
          <tbody>
            {loading && logs.length === 0 && (
              <tr>
                <td colSpan={8} className="py-6 text-center muted">
                  Loading activity…
                </td>
              </tr>
            )}

            {!loading && logs.length === 0 && (
              <tr>
                <td colSpan={8} className="py-6 text-center muted">
                  Nothing logged yet for this filter.
                </td>
              </tr>
            )}

            {logs.map((row) => {
              const open = expanded === row.id;
              return (
                <tr key={row.id}>
                  <td className="py-1 px-2 whitespace-nowrap muted">
                    {formatWhen(row.created_at)}
                  </td>
                  <td className="py-1 px-2 whitespace-nowrap">
                    {KIND_LABELS[row.kind] || row.kind}
                    <span className="faint">
                      {row.direction === "in" ? " ↓ in" : " ↑ out"}
                    </span>
                  </td>
                  <td className="py-1 px-2 whitespace-nowrap">
                    <span className={STATUS_CHIP[row.status] || "chip chip-off"}>
                      {STATUS_LABELS[row.status] || row.status}
                    </span>
                  </td>
                  <td className="py-1 px-2 whitespace-nowrap muted">
                    {formatSpan(row.date_from, row.date_to)}
                  </td>
                  <td className="py-1 px-2 muted">{row.entry_count ?? "—"}</td>
                  <td className="py-1 px-2">
                    <div>{row.summary || "—"}</div>
                    {row.error && (
                      <div className="text-[var(--danger)]">{row.error}</div>
                    )}
                    {open && (
                      <div className="mt-2 space-y-2">
                        <div>
                          <p className="text-[10px] uppercase tracking-wide faint">
                            Sent
                          </p>
                          <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-[var(--surface-2)] p-2 text-[10px] leading-relaxed">
                            {JSON.stringify(row.request, null, 2) || "—"}
                          </pre>
                        </div>
                        {row.response && (
                          <div>
                            <p className="text-[10px] uppercase tracking-wide faint">
                              Reply
                            </p>
                            <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-[var(--surface-2)] p-2 text-[10px] leading-relaxed">
                              {JSON.stringify(row.response, null, 2)}
                            </pre>
                          </div>
                        )}
                        {row.duration_ms != null && (
                          <p className="faint">Took {row.duration_ms} ms</p>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-1 px-2 whitespace-nowrap muted">
                    {row.user_email || SOURCE_LABELS[row.source] || "—"}
                  </td>
                  <td className="py-1 px-2 whitespace-nowrap">
                    {(row.request || row.response) && (
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : row.id)}
                        className="btn btn-secondary text-xs"
                      >
                        {open ? "Hide" : "View"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="flex items-center justify-between gap-3">
          <p className="sub">
            Showing {offset + 1}–{showingTo} of {total}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOffset(Math.max(offset - PAGE_SIZE, 0))}
              disabled={offset === 0 || loading}
              className="btn btn-secondary"
            >
              Newer
            </button>
            <button
              type="button"
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={showingTo >= total || loading}
              className="btn btn-secondary"
            >
              Older
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
