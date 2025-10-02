"use client";

import { useMemo, useState } from "react";

export default function LocationResults({ data }) {
  // Accept both shapes:
  //   { data: rawResponse, minStars, sortBy? }  OR  rawResponse directly
  const raw = data?.data ? data.data : data;
  const initialMinStars = data?.minStars ?? 0;

  // local UI sort state (no refetch)
  const [sortBy, setSortBy] = useState(
    ["price", "reviews", "rating"].includes(data?.sortBy) ? data.sortBy : "price"
  );
  const [minStars, setMinStars] = useState(initialMinStars);

  // ----- helpers -----
  const getStars = (item) => item?.hotel_class ?? item?.star_rating ?? null;

  const getPriceNumber = (item) => {
    if (typeof item?.extracted_price === "number") return item.extracted_price; // common on ads
    if (typeof item?.rate_per_night?.extracted_lowest === "number")
      return item.rate_per_night.extracted_lowest;
    if (typeof item?.total_rate?.extracted_lowest === "number")
      return item.total_rate.extracted_lowest;
    if (typeof item?.price === "string") {
      const n = Number(item.price.replace(/[^\d.]/g, ""));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  // Some responses have a logo/icon; many organic list items don't.
  const pickLogo = (item) => item?.source_icon || item?.logo || item?.platform_icon || null;

  const pickThumb = (item) => {
    const candidates = [
      item?.thumbnail,
      item?.thumbnail_url,
      item?.image,
      item?.image_url,
      item?.main_image,
      item?.photo,
      item?.photo_url,
      item?.main_photo_url,
      item?.photos?.[0]?.image,
      item?.photos?.[0]?.image_url,
      item?.photos?.[0]?.thumbnail,
      item?.property_photos?.[0]?.image_url,
      item?.images?.[0]?.thumbnail,
      item?.images?.[0]?.image,
      item?.images?.[0]?.image_url,
      item?.images?.[0]?.original_image,
    ];
    return candidates.find((url) => typeof url === "string" && url.trim().startsWith("http")) || null;
  };

  const normalizeReviewSnippets = (item) => {
    const snippets = [];
    const seen = new Set();

    const addSnippet = (text) => {
      if (typeof text !== "string") return;
      const trimmed = text.trim();
      if (!trimmed) return;
      if (seen.has(trimmed)) return;
      seen.add(trimmed);
      snippets.push(trimmed);
    };

    const harvest = (value) => {
      if (!value) return;
      if (Array.isArray(value)) {
        value.forEach(harvest);
        return;
      }
      if (typeof value === "string") {
        addSnippet(value);
        return;
      }
      if (typeof value === "object") {
        const directKeys = ["text", "summary", "snippet", "highlight", "description", "phrase"];
        for (const key of directKeys) {
          if (typeof value[key] === "string") addSnippet(value[key]);
        }
        if (typeof value?.snippet_text === "string") addSnippet(value.snippet_text);
        if (typeof value?.title === "string" && typeof value?.subtitle === "string") {
          addSnippet(`${value.title.trim()} - ${value.subtitle.trim()}`);
        }
        Object.values(value).forEach(harvest);
      }
    };

    const candidates = [
      item?.reviews_summary,
      item?.review_summary,
      item?.review_highlights,
      item?.reviews_highlights,
      item?.review_snippets,
      item?.reviews_snippets,
      item?.review_phrases,
      item?.top_review_phrases,
      item?.top_reviews,
      item?.common_reviews,
      item?.review_summary_snippets,
    ];

    candidates.forEach(harvest);

    return snippets.slice(0, 3);
  };

  const normalizeAmenities = (list) => {
    if (!Array.isArray(list)) return [];
    const labels = [];
    for (const entry of list) {
      if (!entry) continue;
      if (typeof entry === "string") {
        const trimmed = entry.trim();
        if (trimmed) labels.push(trimmed);
        continue;
      }
      if (typeof entry === "object") {
        const title = typeof entry.title === "string" ? entry.title.trim() : "";
        const label = typeof entry.label === "string" ? entry.label.trim() : "";
        const name = typeof entry.name === "string" ? entry.name.trim() : "";
        const text = [title || name, label].filter(Boolean).join(" - ");
        if (text) {
          labels.push(text);
        }
      }
    }
    const deduped = [];
    const seen = new Set();
    for (const label of labels) {
      if (seen.has(label)) continue;
      seen.add(label);
      deduped.push(label);
    }
    return deduped;
  };

  const asCard = (item, { sponsored = false } = {}) => {
    const stars = getStars(item);
    const priceNum = getPriceNumber(item);
    return {
      key: `${sponsored ? "ad" : "org"}:${item.property_token ?? item.name ?? Math.random()}`,
      sponsored,
      name: item.name,
      link: item.link || item.serpapi_property_details_link || null,
      source: item.source || item.platform || null,
      source_icon: pickLogo(item),
      rating: item.overall_rating ?? item.rating ?? null,
      reviews: item.reviews ?? null,
      stars,
      thumb: pickThumb(item),
      priceText:
        item.price ??
        item.rate_per_night?.lowest ??
        item.total_rate?.lowest ??
        (priceNum != null ? String(priceNum) : null),
      priceNum,
      amenities: normalizeAmenities(item.amenities),
      gps: item.gps_coordinates || null,
      reviewSnippets: normalizeReviewSnippets(item),
    };
  };

  // Build unified list (ads + organics)
  const ads = Array.isArray(raw?.ads) ? raw.ads.map((x) => asCard(x, { sponsored: true })) : [];
  const organicsSrc =
    (Array.isArray(raw?.properties) && raw.properties) ||
    (Array.isArray(raw?.hotels) && raw.hotels) ||
    (Array.isArray(raw?.results) && raw.results) ||
    [];
  const organics = organicsSrc.map((x) => asCard(x, { sponsored: false }));

  // Filter by min stars
  const filtered = useMemo(() => {
    return [...ads, ...organics].filter((c) => {
      if (!minStars) return true;
      const s = Number(c.stars);
      return Number.isFinite(s) ? s >= minStars : true; // keep items without star info
    });
  }, [ads, organics, minStars]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sortBy === "price") {
      arr.sort((a, b) => {
        const A = a.priceNum ?? Infinity;
        const B = b.priceNum ?? Infinity;
        return A - B; // ascending
      });
    } else if (sortBy === "reviews") {
      arr.sort((a, b) => {
        const A = a.reviews ?? -1;
        const B = b.reviews ?? -1;
        return B - A; // descending
      });
    } else if (sortBy === "rating") {
      arr.sort((a, b) => {
        const A = a.rating ?? -1;
        const B = b.rating ?? -1;
        return B - A; // descending
      });
    }
    return arr;
  }, [filtered, sortBy]);

  const selectClasses =
    "rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-slate-100 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-400/60 backdrop-blur-sm appearance-none";

  return (
    <div className="space-y-5">
      {/* controls */}
      <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl shadow-[0_12px_32px_rgba(15,23,42,0.3)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1 text-xs text-slate-200/70">
          <span className="font-semibold uppercase tracking-[0.4em]">Results</span>
          <p className="text-[11px] text-slate-200/60">
            Sort and refine your compset leads directly from SerpAPI responses.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <label className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-200/70">
            Sort by
          </label>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className={`${selectClasses} pr-8`}>
            <option value="price">Price (low → high)</option>
            <option value="reviews">Reviews (high → low)</option>
            <option value="rating">Rating (high → low)</option>
          </select>
          <label className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-200/70">
            Min stars
          </label>
          <select
            value={minStars}
            onChange={(e) => setMinStars(Number(e.target.value))}
            className={`${selectClasses} pr-8`}
          >
            <option value={0}>Any</option>
            <option value={1}>1★+</option>
            <option value={2}>2★+</option>
            <option value={3}>3★+</option>
            <option value={4}>4★+</option>
            <option value={5}>5★</option>
          </select>
        </div>
      </div>

      {/* results */}
      {sorted.length === 0 ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-sm text-slate-200/70 backdrop-blur-xl shadow-[0_12px_32px_rgba(15,23,42,0.3)]">
          No results (try lowering the Min stars or changing dates).
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((h) => (
            <article
              key={h.key}
              className="group flex h-full flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-[0_12px_32px_rgba(15,23,42,0.3)] transition hover:border-blue-300/40 hover:bg-white/10"
            >
              {h.thumb ? (
                <img src={h.thumb} alt={h.name} className="h-40 w-full object-cover" />
              ) : (
                <div className="h-40 w-full bg-gradient-to-br from-slate-800/80 to-slate-900/80" />
              )}

              <div className="flex flex-1 flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-lg font-semibold text-white leading-tight">{h.name}</h3>
                  {h.sponsored && (
                    <span className="rounded-full border border-amber-300/40 bg-amber-400/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-200">
                      Sponsored
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.2em] text-slate-200/70">
                  {h.stars != null && <span>{h.stars}★</span>}
                  {h.rating != null && (
                    <span className="inline-flex items-center gap-1 normal-case tracking-normal text-slate-100">
                      ⭐ {h.rating}
                    </span>
                  )}
                  {h.reviews != null && <span>{h.reviews} reviews</span>}
                </div>

                <div className="flex items-center justify-between">
                  <div className="text-xl font-semibold text-white">
                    {h.priceText ? h.priceText : h.priceNum != null ? `₹${h.priceNum}` : "—"}
                  </div>
                  {h.source && (
                    <div className="flex items-center gap-2 text-xs text-slate-200/70">
                      {h.source_icon && (
                        <img src={h.source_icon} alt="" className="h-4 w-4 rounded-full border border-white/20" />
                      )}
                      <span>{h.source}</span>
                    </div>
                  )}
                </div>

                {h.reviewSnippets.length > 0 && (
                  <div className="space-y-1 pt-1">
                    {h.reviewSnippets.map((snippet, idx) => (
                      <p key={`${h.key}-review-${idx}`} className="text-xs italic text-slate-200/70">
                        "{snippet}"
                      </p>
                    ))}
                  </div>
                )}

                {h.amenities.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {h.amenities.slice(0, 6).map((amenity, idx) => (
                      <span
                        key={`${h.key}-amenity-${idx}`}
                        className="rounded-full border border-white/10 bg-white/10 px-2 py-1 text-[11px] text-slate-200/80"
                      >
                        {amenity}
                      </span>
                    ))}
                    {h.amenities.length > 6 && (
                      <span className="text-[11px] text-slate-200/60 px-2 py-1">
                        +{h.amenities.length - 6} more
                      </span>
                    )}
                  </div>
                )}

                {h.link && (
                  <a
                    href={h.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-auto inline-flex items-center text-sm font-semibold text-sky-300 transition hover:text-sky-200"
                  >
                    View deal →
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
