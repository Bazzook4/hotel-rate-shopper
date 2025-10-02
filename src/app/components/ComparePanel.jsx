"use client";

import { useEffect, useMemo, useState } from "react";

async function fetchHotel(name, params) {
  const qs = new URLSearchParams({ q: name, ...params });
  const res = await fetch(`/api/hotel?${qs.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("hotel fetch failed");
  return res.json();
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

function pickNumber(values, { integersOnly = false } = {}) {
  for (const val of values) {
    if (typeof val === "number" && Number.isFinite(val)) {
      return integersOnly ? Math.round(val) : val;
    }
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (!trimmed) continue;
      let num;
      if (integersOnly) {
        const digits = trimmed.replace(/[^\d]/g, "");
        if (!digits) continue;
        num = parseInt(digits, 10);
      } else {
        num = parseFloat(trimmed);
        if (!Number.isFinite(num)) {
          const cleaned = trimmed.replace(/[^\d.]/g, "");
          if (!cleaned) continue;
          num = parseFloat(cleaned);
        }
      }
      if (Number.isFinite(num)) return integersOnly ? Math.round(num) : num;
    }
  }
  return null;
}

function extractPrice(item) {
  if (!item) return null;
  if (typeof item?.rate_per_night?.extracted_lowest === "number") {
    return item.rate_per_night.extracted_lowest;
  }
  if (typeof item?.total_rate?.extracted_lowest === "number") {
    return item.total_rate.extracted_lowest;
  }
  if (typeof item?.extracted_price === "number") {
    return item.extracted_price;
  }
  if (typeof item?.price === "string") {
    const n = Number(item.price.replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeHotel(json, fallbackName) {
  if (!json) return { hotelName: fallbackName || "-", channels: {} };

  const collect = [];
  const push = (entry) => {
    if (!entry) return;
    const source = entry.source || entry.platform || entry.name || entry.channel;
    if (!source) return;
    const price = extractPrice(entry);
    if (price == null) return;
    collect.push({ source, price });
  };

  const featured = Array.isArray(json.featured_prices) ? json.featured_prices : [];
  const prices = Array.isArray(json.prices) ? json.prices : [];
  const ads = Array.isArray(json.ads) ? json.ads : [];

  featured.forEach(push);
  prices.forEach(push);
  ads.forEach(push);

  const channels = {};
  collect.forEach(({ source, price }) => {
    const existing = channels[source];
    if (existing == null || price < existing) {
      channels[source] = price;
    }
  });

  const hotelName =
    json.name ||
    json.search_parameters?.q ||
    json.hotel_name ||
    fallbackName ||
    "-";

  const rating = pickNumber(
    [
      json.overall_rating,
      json.rating,
      json.hotel_rating,
      json.guest_rating,
      json.star_rating,
    ],
    { integersOnly: false }
  );

  const reviews = pickNumber(
    [
      json.reviews,
      json.review_count,
      json.reviews_count,
      json.total_reviews,
      json.user_ratings_total,
      json.ratings_total,
    ],
    { integersOnly: true }
  );

  return { hotelName, channels, rating, reviews };
}

function sanitizeRow(row, fallbackIn, fallbackOut) {
  if (!row) return null;
  const trimmedName = row.name?.trim();
  if (!trimmedName) return null;
  const checkIn = row.check_in_date?.trim() || fallbackIn;
  const checkOut = row.check_out_date?.trim() || fallbackOut;
  const adults = Number.isFinite(Number(row.adults)) ? Number(row.adults) : 2;
  const children = Number.isFinite(Number(row.children)) ? Number(row.children) : 0;
  const currency = row.currency?.trim() || "INR";

  return {
    name: trimmedName,
    check_in_date: checkIn,
    check_out_date: checkOut,
    adults,
    children,
    currency,
  };
}

function rowToParams(row) {
  return {
    check_in_date: row.check_in_date,
    check_out_date: row.check_out_date,
    adults: String(row.adults ?? 2),
    children: String(row.children ?? 0),
    currency: row.currency || "INR",
  };
}

export default function ComparePanel({ compSet }) {
  const [compareData, setCompareData] = useState(null);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [err, setErr] = useState("");

  const [snapshots, setSnapshots] = useState([]);
  const [loadingSnap, setLoadingSnap] = useState(false);
  const [saving, setSaving] = useState(false);

  const today = useMemo(() => new Date(), []);
  const fallbackIn = useMemo(() => fmtDate(new Date(today)), [today]);
  const fallbackOut = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return fmtDate(d);
  }, [today]);

  const normalized = useMemo(() => {
    if (!compSet) return null;

    if (Array.isArray(compSet)) {
      if (compSet.length === 0) return null;
      const [primaryRaw, ...rest] = compSet;
      const primary = sanitizeRow(primaryRaw, fallbackIn, fallbackOut);
      if (!primary) return null;
      const competitors = rest
        .map((r) => sanitizeRow(r, fallbackIn, fallbackOut))
        .filter(Boolean);
      return { primary, competitors, id: primary.name };
    }

    if (typeof compSet === "object") {
      const primary = sanitizeRow(compSet.primary, fallbackIn, fallbackOut);
      if (!primary) return null;
      const competitors = Array.isArray(compSet.competitors)
        ? compSet.competitors
            .map((r) => sanitizeRow(r, fallbackIn, fallbackOut))
            .filter(Boolean)
        : [];
      return { primary, competitors, id: compSet.id || compSet.name || primary.name };
    }

    return null;
  }, [compSet, fallbackIn, fallbackOut]);

  const compSetId = normalized?.id || null;

  // --- Compare Now ---
  async function onCompare() {
    if (!normalized?.primary) return;
    setLoadingCompare(true);
    setErr("");
    try {
      const primaryParams = rowToParams(normalized.primary);
      const primaryRes = await fetchHotel(normalized.primary.name, primaryParams);
      const compRes = await Promise.all(
        normalized.competitors.map((c) =>
          fetchHotel(c.name, rowToParams(c)).catch(() => null)
        )
      );

      const primary = normalizeHotel(primaryRes, normalized.primary.name);
      const comps = compRes.map((res, idx) => normalizeHotel(res, normalized.competitors[idx]?.name));

      const renameChannel = (map) => {
        if (!map?.channels) return;
        if (map.channels[map.hotelName]) {
          map.channels["Official Website"] = map.channels[map.hotelName];
          delete map.channels[map.hotelName];
        }
      };

      renameChannel(primary);
      comps.forEach(renameChannel);

      // Build table rows by channel
      const channelSet = new Set([
        ...Object.keys(primary.channels),
        ...comps.flatMap(c => Object.keys(c.channels)),
      ]);
      const rows = [...channelSet].map(ch => {
        const p = primary.channels[ch] ?? null;
        const competitorPrices = comps.map(c => {
          const v = c.channels[ch] ?? null;
          const diffPct = p != null && v != null ? ((v - p) / p) * 100 : null;
          return { value: v, diffPct };
        });
        return { channel: ch, primaryPrice: p, competitorPrices };
      });

      const rowSortValue = (row) => {
        const prices = [row.primaryPrice, ...row.competitorPrices.map((cp) => cp.value)];
        const finite = prices.filter((v) => typeof v === "number" && Number.isFinite(v));
        return finite.length ? Math.min(...finite) : Infinity;
      };

      rows.sort((a, b) => rowSortValue(a) - rowSortValue(b));

      const competitorMeta = comps.map(c => ({
        name: c.hotelName,
        rating: typeof c.rating === "number" ? c.rating : null,
        reviews: typeof c.reviews === "number" ? c.reviews : null,
      }));

      setCompareData({
        primary: {
          name: primary.hotelName,
          rating: typeof primary.rating === "number" ? primary.rating : null,
          reviews: typeof primary.reviews === "number" ? primary.reviews : null,
        },
        competitors: competitorMeta,
        primaryName: primary.hotelName,
        competitorNames: competitorMeta.map((c) => c.name),
        rows,
      });
    } catch (e) {
      console.error(e);
      setCompareData(null);
      setErr("Unable to fetch rates. Check hotel names, dates, or API key.");
    } finally {
      setLoadingCompare(false);
    }
  }

  useEffect(() => {
    if (!loadingCompare && !normalized?.primary) {
      setCompareData(null);
    }
  }, [normalized, loadingCompare]);

  // --- Snapshots API ---
  async function loadSnapshots() {
    if (!compSetId) return;
    setLoadingSnap(true);
    try {
      const res = await fetch(`/api/compsets/${encodeURIComponent(compSetId)}/snapshots`, { cache: "no-store" });
      const json = await res.json();
      if (res.ok) setSnapshots(json.snapshots || []);
    } finally {
      setLoadingSnap(false);
    }
  }

  async function saveSnapshot() {
    if (!compSetId || !compareData) return;
    setSaving(true);
    try {
      await fetch(`/api/compsets/${encodeURIComponent(compSetId)}/snapshots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: compareData }),
      });
      await loadSnapshots();
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => { loadSnapshots(); }, [compSetId]);

  const lastSync = useMemo(() => snapshots[0]?.lastSync || null, [snapshots]);

  const formatRating = (r) => {
    if (typeof r !== "number" || !Number.isFinite(r)) return null;
    const rounded = Math.round(r * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  };

  const formatReviews = (n) => {
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    return new Intl.NumberFormat().format(Math.round(n));
  };

  const renderMeta = (rating, reviews) => {
    const parts = [];
    const ratingText = formatRating(rating);
    if (ratingText) parts.push(`⭐ ${ratingText}`);
    const reviewsText = formatReviews(reviews);
    if (reviewsText) parts.push(`${reviewsText} reviews`);
    if (!parts.length) return null;
    return <div className="text-[11px] text-slate-200/70 whitespace-nowrap">{parts.join(" · ")}</div>;
  };

  return (
    <div className="space-y-5 rounded-3xl border border-white/10 bg-white/5 p-5 md:p-6 backdrop-blur-xl shadow-[0_16px_40px_rgba(15,23,42,0.35)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h3 className="text-2xl font-semibold text-white">Comparison</h3>
          <p className="text-xs text-slate-200/70">
            Align your primary property with the comp set and inspect channel spreads instantly.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lastSync && (
            <span className="text-[11px] text-slate-200/70">
              Last sync: {new Date(lastSync).toLocaleString()}
            </span>
          )}
          <button
            onClick={onCompare}
            disabled={loadingCompare || !normalized?.primary}
            className="rounded-2xl bg-gradient-to-r from-blue-500/80 to-indigo-500/80 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition hover:from-blue-400 hover:to-indigo-400 disabled:opacity-50 disabled:shadow-none"
          >
            {loadingCompare ? "Comparing…" : "Compare Now"}
          </button>
          <button
            onClick={loadSnapshots}
            disabled={loadingSnap}
            className="rounded-2xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-white/20 hover:bg-white/15 disabled:opacity-50"
          >
            {loadingSnap ? "Refreshing…" : "Refresh"}
          </button>
          {compareData && (
            <button
              onClick={saveSnapshot}
              disabled={saving}
              className="rounded-2xl bg-gradient-to-r from-emerald-400/80 to-teal-500/80 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:from-emerald-400 hover:to-teal-400 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save snapshot"}
            </button>
          )}
        </div>
      </div>

      {err && <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{err}</div>}

      {!compareData ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-slate-200/70">
          Set your comp set and click <b>Compare Now</b>.
        </div>
      ) : (
        <div className="overflow-auto rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-[0_12px_32px_rgba(15,23,42,0.3)]">
          <table className="min-w-full text-sm text-slate-100">
            <thead className="bg-white/5 text-slate-200/80">
              <tr>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-[0.2em] text-[11px]">Channel</th>
                <th className="px-4 py-3 text-left">
                  <div className="text-sm font-semibold text-white">{compareData.primary?.name || "Primary"}</div>
                  {renderMeta(compareData.primary?.rating, compareData.primary?.reviews)}
                </th>
                {compareData.competitors?.map((meta, idx) => (
                  <th key={meta?.name || idx} className="px-4 py-3 text-left">
                    <div className="text-sm font-semibold text-white">{meta?.name || `Competitor ${idx + 1}`}</div>
                    {renderMeta(meta?.rating, meta?.reviews)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {compareData.rows.map((row) => (
                <tr key={row.channel} className="border-t border-white/10 text-slate-200/80">
                  <td className="px-4 py-3 text-sm font-medium text-white">{row.channel}</td>
                  <td className="px-4 py-3 text-sm">{row.primaryPrice ?? "-"}</td>
                  {row.competitorPrices.map((p, i) => (
                    <td key={i} className="px-4 py-3 text-sm">
                      {p.value ?? "-"}
                      {typeof p.diffPct === "number" && (
                        <span
                          className={`ml-2 text-xs font-semibold ${
                            p.diffPct <= 0 ? "text-emerald-300" : "text-rose-300"
                          }`}
                        >
                          {p.diffPct > 0 ? "+" : ""}
                          {p.diffPct.toFixed(1)}%
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {compareData.rows.length === 0 && (
            <div className="px-4 py-4 text-sm text-slate-200/70">No rates found for the selected hotels and dates.</div>
          )}
        </div>
      )}
    </div>
  );
}
