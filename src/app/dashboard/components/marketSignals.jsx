"use client";

import { useCallback, useEffect, useState } from "react";
import { usePageState } from "./usePageState";

/**
 * The market, as it bears on the rates grid: what the competition charges,
 * whether the channels agree, and what Dynamic Pricing proposes.
 *
 * Shown once per date in the grid's header and as one suggestion row per
 * room type -- never inside every cell, which already carry a rate per
 * plan and adult count. The full pages (Competitor Shopper, Rate Parity,
 * Dynamic Pricing) stay for digging in; this is what a daily price decision
 * needs on the screen where the price is set.
 *
 * Each source is fetched on its own and simply left out when this user has
 * no right to it or it has nothing yet, so the grid never waits on, or
 * fails because of, a page the user may not even have.
 */

const money = (v) => (v == null ? "—" : Math.round(v).toLocaleString("en-IN"));

async function getJSON(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** The months touched by a run of dates, as one date inside each. */
function monthsOf(dates) {
  return [...new Set(dates.map((d) => d.slice(0, 7)))].map((m) => `${m}-01`);
}

const PARITY_RANK = { breach: 2, drift: 1 };

export function useMarketSignals(propertyId, dates) {
  const [competitors, setCompetitors] = useState([]);
  const [medianByDate, setMedianByDate] = useState({});
  const [parityByDate, setParityByDate] = useState({});
  const [suggestions, setSuggestions] = useState({});
  const [nonce, setNonce] = useState(0);
  // The one hotel this manager watches most, chosen on the grid. Kept per
  // browser and per hotel.
  const [keyCompetitor, setKeyCompetitor] = usePageState(`rates.keyCompetitor.${propertyId}`, "");

  const first = dates[0];
  const last = dates[dates.length - 1];

  useEffect(() => {
    if (!first || !last) return undefined;
    let stale = false;
    const qs = propertyId ? `&propertyId=${propertyId}` : "";
    const span = dates.length;

    (async () => {
      const months = await Promise.all(
        monthsOf(dates).map((m) => getJSON(`/api/compshopper/grid?month=${m}${qs}`))
      );
      if (stale) return;
      const median = {};
      const byId = new Map();
      for (const m of months) {
        if (!m) continue;
        Object.assign(median, m.medianByDate || {});
        for (const c of m.competitors || []) {
          const seen = byId.get(c.id);
          byId.set(c.id, seen ? { ...seen, cells: { ...seen.cells, ...c.cells } } : c);
        }
      }
      setMedianByDate(median);
      setCompetitors([...byId.values()]);
    })();

    (async () => {
      const parity = await getJSON(`/api/parity/grid?start=${first}&days=${span}${qs}`);
      if (stale || !parity) return;
      const worst = {};
      for (const ch of parity.channels || []) {
        for (const [date, cell] of Object.entries(ch.cells || {})) {
          if ((PARITY_RANK[cell.status] || 0) > (PARITY_RANK[worst[date]] || 0)) worst[date] = cell.status;
        }
      }
      setParityByDate(worst);
    })();

    (async () => {
      const recs = await getJSON(`/api/pricing/recommendations?start=${first}&days=${span}${qs}`);
      if (stale || !recs) return;
      const byRoom = {};
      for (const row of recs.rows || []) {
        const pending = Object.fromEntries(
          Object.entries(row.cells || {}).filter(([, c]) => c.status === "pending")
        );
        if (Object.keys(pending).length) byRoom[row.roomTypeId] = pending;
      }
      setSuggestions(byRoom);
    })();

    return () => {
      stale = true;
    };
    // `dates` is rebuilt each render; its ends say everything that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, first, last, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const key = competitors.find((c) => c.id === keyCompetitor) || null;

  return {
    competitors,
    keyCompetitor: key,
    setKeyCompetitor,
    medianByDate,
    parityByDate,
    suggestions,
    reload,
  };
}

/** The market under one date in the header: key competitor or median, and parity. */
export function DateSignals({ date, market }) {
  const median = market.medianByDate[date];
  const keyRate = market.keyCompetitor?.cells?.[date]?.rate;
  const parity = market.parityByDate[date];
  if (median == null && keyRate == null && !parity) return null;

  const shown = keyRate ?? median;
  const title = [
    market.keyCompetitor && `${market.keyCompetitor.name}: ${keyRate != null ? `₹${money(keyRate)}` : "no rate"}`,
    median != null && `Competitor median: ₹${money(median)}`,
    parity === "breach" && "Your channels disagree by more than 5% on this night",
    parity === "drift" && "Your channels differ by 1–5% on this night",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="mt-0.5 space-y-0.5" title={title}>
      {shown != null && (
        <div className="text-[10px] tabular-nums" style={{ color: "var(--text-muted)" }}>
          {keyRate != null ? "★" : "comp"} {money(shown)}
        </div>
      )}
      {parity && (
        <div
          className="text-[10px] font-semibold"
          style={{ color: parity === "breach" ? "var(--danger)" : "var(--warn)" }}
        >
          ≠ parity
        </div>
      )}
    </div>
  );
}

/** The reason that moved the price most, in a line. */
function mainReason(cell) {
  const reasons = [...(cell.reasons || [])].filter((r) => r?.note);
  reasons.sort((a, b) => Math.abs(b.pct || 0) - Math.abs(a.pct || 0));
  return reasons[0]?.note || null;
}

/**
 * One row under a room type: the price Dynamic Pricing proposes for each
 * night that has a proposal. A tap opens it to Accept, Adjust or Skip --
 * never all at once, and never without the reason in view.
 */
export function SuggestionRow({ room, cells, dates, onOpen }) {
  return (
    <tr>
      <td
        className="cm-name-col sticky left-0 z-10 px-2 py-1.5 text-xs md:px-4"
        style={{
          background: "var(--surface)",
          borderRight: "1px solid var(--border-strong)",
          borderBottom: "1px solid var(--border)",
          color: "var(--accent-text)",
          fontWeight: 600,
        }}
      >
        Suggested
      </td>
      {dates.map((d) => {
        const cell = cells[d];
        const up = cell && cell.current != null && cell.recommended > cell.current;
        return (
          <td
            key={d}
            className="cm-date-col px-1 py-1 text-center"
            style={{ borderRight: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}
          >
            {cell ? (
              <button
                type="button"
                className="w-full rounded px-1 py-0.5 text-xs font-semibold tabular-nums"
                style={{
                  background: up ? "var(--accent-soft)" : "var(--warn-soft)",
                  color: up ? "var(--accent-text)" : "var(--warn)",
                }}
                title={mainReason(cell) || "Why this price?"}
                onClick={() => onOpen({ room, date: d, cell })}
              >
                {up ? "▲" : "▼"} {money(cell.recommended)}
              </button>
            ) : null}
          </td>
        );
      })}
    </tr>
  );
}

/**
 * Accept · Adjust · Skip for one suggestion, with today's price, the
 * proposal and why. Adjust lets the hotelier nudge the number and keep the
 * rest of the reasoning.
 */
export function SuggestionDialog({ open, propertyId, onClose, onDone }) {
  const { room, date, cell } = open;
  const [rate, setRate] = useState(String(Math.round(cell.recommended)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const adjusted = Number(rate) !== Math.round(cell.recommended);

  async function send(decision) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/pricing/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          ids: [cell.id],
          ...(decision === "dismissed" ? { decision } : {}),
          ...(decision !== "dismissed" && adjusted ? { overrides: { [cell.id]: Number(rate) } } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "That did not go through.");
      onDone(
        decision === "dismissed"
          ? `Skipped the suggestion for ${room.name}, ${date}.`
          : json.warning || `${room.name} on ${date} is now ₹${money(Number(rate))} and sent to your channels.`
      );
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const day = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog card" role="dialog" aria-modal="true" aria-label="Suggested price" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
          {room.name} · {day}
        </h3>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          Now ₹{money(cell.current)} → suggested ₹{money(cell.recommended)}
          {cell.boundedBy ? ` (held at your ${cell.boundedBy})` : ""}
        </p>
        {cell.reasons?.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-sm" style={{ color: "var(--text-muted)", paddingLeft: "1.1rem", listStyle: "disc" }}>
            {cell.reasons.filter((r) => r?.note).map((r, i) => (
              <li key={i}>{r.note}</li>
            ))}
          </ul>
        )}
        <div className="mt-3">
          <label className="label">Price to send</label>
          <input
            className="input w-full"
            type="number"
            min="1"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
          <p className="mt-1 text-xs" style={{ color: "var(--text-faint)" }}>
            For the full room. Other adult counts keep their usual difference from it.
          </p>
        </div>
        {error && (
          <p className="mt-2 text-sm" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-ghost text-sm" onClick={() => send("dismissed")} disabled={busy}>
            Skip
          </button>
          <button
            type="button"
            className="btn btn-primary text-sm"
            onClick={() => send("applied")}
            disabled={busy || !(Number(rate) > 0)}
          >
            {busy ? "Sending…" : adjusted ? `Send ₹${money(Number(rate))}` : "Accept"}
          </button>
        </div>
      </div>
    </div>
  );
}
