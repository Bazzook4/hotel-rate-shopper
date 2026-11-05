"use client";

import { useEffect, useState } from "react";

/**
 * Super admin only, CRM > WhatsApp Templates: every message template on the
 * business account and where it stands with Meta, so it is clear which are
 * live and which are still waiting for review. Read live, nothing is stored.
 */

const STATUS = {
  APPROVED: { label: "Live", chip: "chip-ok", order: 2 },
  PENDING: { label: "In review", chip: "chip-booked", order: 1 },
  IN_APPEAL: { label: "In review", chip: "chip-booked", order: 1 },
  REJECTED: { label: "Rejected", chip: "chip-warn", order: 0 },
  PAUSED: { label: "Paused", chip: "chip-warn", order: 0 },
  DISABLED: { label: "Switched off", chip: "chip-off", order: 3 },
};
const statusOf = (s) => STATUS[s] || { label: s || "Unknown", chip: "chip-off", order: 4 };

const FILTERS = [
  ["all", "All"],
  ["live", "Live"],
  ["review", "In review"],
  ["fix", "Needs attention"],
];
const inFilter = (t, f) =>
  f === "all" ||
  (f === "live" && t.status === "APPROVED") ||
  (f === "review" && (t.status === "PENDING" || t.status === "IN_APPEAL")) ||
  (f === "fix" && ["REJECTED", "PAUSED", "DISABLED"].includes(t.status));

const REASON = {
  ABUSIVE_CONTENT: "Meta found abusive content",
  INCORRECT_CATEGORY: "Wrong category",
  INVALID_FORMAT: "Wrong format",
  SCAM: "Looks like a scam to Meta",
  TAG_CONTENT_MISMATCH: "Words do not match the category",
};

const shortDate = (v) => {
  if (!v) return "";
  const d = typeof v === "number" ? new Date(v * 1000) : new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

export default function WhatsAppTemplates() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  const load = () => {
    setRows(null);
    setError("");
    fetch("/api/admin/whatsapp/templates")
      .then((r) => r.json())
      .then((d) => {
        setRows(d.templates || []);
        setError(d.error || "");
      })
      .catch(() => {
        setRows([]);
        setError("Could not reach the server. Try again.");
      });
  };
  useEffect(load, []);

  const counts = (rows || []).reduce((n, t) => {
    const k = statusOf(t.status).label;
    n[k] = (n[k] || 0) + 1;
    return n;
  }, {});
  const shown = (rows || [])
    .filter((t) => inFilter(t, filter))
    .sort((a, b) => statusOf(a.status).order - statusOf(b.status).order || a.name.localeCompare(b.name));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            className={filter === id ? "btn btn-secondary text-sm" : "btn btn-ghost text-sm"}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
        <button type="button" className="btn btn-ghost text-sm" onClick={load} disabled={rows === null}>
          Refresh
        </button>
        {rows && rows.length > 0 && (
          <span className="text-xs muted">
            {Object.entries(counts).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(", ")}
          </span>
        )}
      </div>

      {error && <div className="card p-3 text-sm">{error}</div>}

      {rows === null ? (
        <div className="card p-3 text-sm muted">Loading templates...</div>
      ) : shown.length === 0 ? (
        !error && <div className="card p-3 text-sm muted">No templates here.</div>
      ) : (
        <div className="card">
          <table className="grid-table min-w-full text-sm">
            <thead>
              <tr>
                <th>Template</th>
                <th>Status</th>
                <th>Type</th>
                <th>Words</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                const s = statusOf(t.status);
                return (
                  <tr key={t.id}>
                    <td>
                      <span className="block text-ink">{t.name}</span>
                      <span className="text-xs muted">{t.language}</span>
                    </td>
                    <td>
                      <span className={`chip ${s.chip}`}>{s.label}</span>
                      {t.rejected_reason && (
                        <span className="block text-xs muted">{REASON[t.rejected_reason] || t.rejected_reason}</span>
                      )}
                    </td>
                    <td className="text-xs">{(t.category || "").toLowerCase()}</td>
                    <td className="text-xs whitespace-pre-line" style={{ maxWidth: 420 }}>{t.words}</td>
                    <td className="text-xs">{shortDate(t.updated)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
