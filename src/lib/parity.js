/**
 * Rate parity helpers.
 *
 * Parity is measured between channels rather than against a direct rate: the
 * property does not sell direct through this product yet, so the benchmark
 * for a night is the cheapest channel selling it that night, and a channel is
 * "out of parity" when it sits above that.
 */

/** Percentage `to` sits above `from`. Null when there is nothing to compare. */
export function pctDiff(from, to) {
  if (from == null || to == null || from <= 0) return null;
  return ((to - from) / from) * 100;
}

/**
 * A channel's name reduced to a key.
 *
 * Google is inconsistent about how it writes the same channel -- "Booking.com",
 * "Booking.com ", "booking.com" -- and each spelling would otherwise become
 * its own row in the grid and its own row in the table.
 */
export function channelKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/**
 * Turn a Google Business / Maps URL into the query we send to Google Hotels.
 *
 * Hoteliers paste whatever the Google UI gave them, which is one of several
 * shapes: a /maps/place/ URL with the name in the path, a share link with the
 * name in `q`, or a shortened goo.gl link that carries no name at all. The
 * first two we can read; the third we cannot, and saying so is better than
 * silently searching for nothing.
 *
 * Returns { query, error }. A `query` means we found a usable name.
 */
export function deriveGoogleQuery(url) {
  const raw = String(url || "").trim();
  if (!raw) return { query: null, error: "Enter your Google Business URL." };

  let parsed;
  try {
    parsed = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return { query: null, error: "That does not look like a web address." };
  }

  const host = parsed.hostname.toLowerCase();
  if (!/(^|\.)google\.[a-z.]+$/.test(host) && !/(^|\.)goo\.gl$/.test(host)) {
    return {
      query: null,
      error: "Use the Google Maps or Google Business link for your hotel.",
    };
  }

  // A shortened link hides the name behind a redirect we are not going to
  // follow from here, so ask for the full one instead of guessing.
  if (/(^|\.)goo\.gl$/.test(host) || parsed.pathname.startsWith("/url")) {
    return {
      query: null,
      error:
        "That is a shortened link. Open it in your browser and paste the full Google Maps address.",
    };
  }

  // /maps/place/Hotel+Name/@lat,lng,... -- the segment after "place".
  const segments = parsed.pathname.split("/").filter(Boolean);
  const placeAt = segments.indexOf("place");
  if (placeAt !== -1 && segments[placeAt + 1]) {
    const name = decodeURIComponent(segments[placeAt + 1]).replace(/\+/g, " ");
    // The "@" segment is coordinates, not a name.
    if (name && !name.startsWith("@")) {
      return { query: name.trim(), error: null };
    }
  }

  // Share and search links carry the name in a query parameter instead.
  for (const key of ["q", "query"]) {
    const value = parsed.searchParams.get(key);
    // A "q" holding only coordinates names no hotel.
    if (value && !/^[-\d.]+,[-\d.]+$/.test(value.trim())) {
      return { query: value.trim(), error: null };
    }
  }

  return {
    query: null,
    error:
      "We could not read a hotel name from that link. Paste the Google Maps address that shows your hotel's name.",
  };
}

/**
 * Collapse one Google Hotels response into one row per channel.
 *
 * The response splits the same channels across `prices` and `featured_prices`,
 * and a channel can appear in both. Where it does we keep the lower rate,
 * since that is the one a guest would actually pay and therefore the one that
 * matters for parity.
 */
export function normaliseChannels(json) {
  const prices = Array.isArray(json?.prices) ? json.prices : [];
  const featured = Array.isArray(json?.featured_prices) ? json.featured_prices : [];

  const toRow = (p) => {
    const perNight = p?.rate_per_night || {};
    const total = p?.total_rate || {};
    const rate =
      typeof perNight.extracted_lowest === "number"
        ? perNight.extracted_lowest
        : typeof total.extracted_lowest === "number"
        ? total.extracted_lowest
        : typeof p?.extracted_price === "number"
        ? p.extracted_price
        : null;

    const remarks = Array.isArray(p?.remarks) ? p.remarks.join(" ").toLowerCase() : "";

    return {
      channel: p?.source ?? p?.platform ?? null,
      channel_logo: p?.logo ?? p?.source_icon ?? null,
      link: p?.link ?? null,
      rate,
      // Google says so in the remarks rather than in a field of its own.
      includes_tax: /taxes and fees included|includes taxes/.test(remarks),
      sold_out: rate == null,
    };
  };

  const byKey = new Map();
  for (const row of [...prices.map(toRow), ...featured.map(toRow)]) {
    if (!row.channel) continue;
    const key = channelKey(row.channel);
    if (!key) continue;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...row, channel_key: key });
      continue;
    }
    // Prefer a real number over a blank, then the lower of two numbers.
    if (existing.rate == null && row.rate != null) {
      byKey.set(key, { ...row, channel_key: key });
    } else if (existing.rate != null && row.rate != null && row.rate < existing.rate) {
      byKey.set(key, { ...row, channel_key: key });
    }
  }

  return [...byKey.values()];
}

/**
 * Parity verdict for one channel's rate on one night.
 *
 * The thresholds match what the grid colours: within 1% of the cheapest
 * channel is parity (rounding and currency conversion move rates by less than
 * that), up to 5% is a drift worth watching, beyond that is a real breach.
 */
export function parityStatus(rate, lowest) {
  if (rate == null || lowest == null) return "none";
  const diff = pctDiff(lowest, rate);
  if (diff == null) return "none";
  if (diff <= 1) return "parity";
  if (diff <= 5) return "drift";
  return "breach";
}
