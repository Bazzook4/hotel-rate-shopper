/**
 * Competitor Shopper helpers.
 *
 * A competitor is identified by Google's property_token, not by name: the
 * token pins one listing, so a lookup months later still reads the hotel the
 * hotelier chose. Every call that resolves a token must also send the name as
 * `q` -- Google rejects a token on its own.
 */

/**
 * How many competitors a property may track.
 *
 * Six, because a refresh costs one API call per competitor per night: the cap
 * is what keeps a week's refresh inside a request timeout, not an arbitrary
 * product limit.
 */
export const MAX_COMPETITORS = 6;

/** Metres between two coordinates, for ranking nearby hotels by distance. */
export function distanceMetres(a, b) {
  if (!a?.latitude || !a?.longitude || !b?.latitude || !b?.longitude) return null;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** "3-star hotel" -> 3. Null when Google gave no class. */
export function starsOf(hotelClass) {
  const match = /(\d)\s*-?\s*star/i.exec(String(hotelClass || ""));
  return match ? Number(match[1]) : null;
}

/**
 * Turn a Google Hotels location search into competitor suggestions.
 *
 * Ranked by how comparable each hotel is to this property rather than by
 * distance alone: a five-star across the road is not a competitor to a
 * guesthouse. Star rating is the strongest available signal for that, with
 * distance breaking ties, since Google gives no category beyond it.
 *
 * `self` is the property doing the searching -- it is always the top hit on
 * its own doorstep, and offering a hotel its own comp set would be absurd.
 */
export function rankSuggestions(properties, { self, excludeTokens = [] } = {}) {
  const excluded = new Set(excludeTokens.filter(Boolean));
  const selfStars = starsOf(self?.hotel_class);
  const selfCoords =
    self?.latitude != null && self?.longitude != null
      ? { latitude: Number(self.latitude), longitude: Number(self.longitude) }
      : null;

  return (properties || [])
    .filter((p) => p?.property_token && p?.name)
    .filter((p) => !excluded.has(p.property_token))
    // The property's own listing, matched by token where we know it and by
    // name otherwise, since a hotelier searching their own area always gets
    // themselves back first.
    .filter((p) => {
      if (self?.property_token && p.property_token === self.property_token) return false;
      // Matched against every name we hold for ourselves, not just the one in
      // the database: a property is often recorded under a short internal
      // name ("Sarjapur") while Google knows it by its full trading name, and
      // comparing only the short one lets the hotel offer itself as its own
      // competitor.
      const mine = (self?.names || [self?.name])
        .filter(Boolean)
        .map((n) => String(n).trim().toLowerCase());
      const candidate = p.name.trim().toLowerCase();
      if (mine.some((n) => n === candidate || n.includes(candidate) || candidate.includes(n))) {
        return false;
      }
      return true;
    })
    .map((p) => {
      const coords = p.gps_coordinates || null;
      const distance = selfCoords && coords ? distanceMetres(selfCoords, coords) : null;
      const stars = starsOf(p.hotel_class);

      // Lower is more comparable. A missing star rating is neither rewarded
      // nor punished -- plenty of genuine competitors are unrated on Google.
      const starGap = selfStars != null && stars != null ? Math.abs(selfStars - stars) : 0.5;

      return {
        property_token: p.property_token,
        name: p.name,
        address: p.address || null,
        hotel_class: p.hotel_class || null,
        stars,
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null,
        rate: p?.rate_per_night?.extracted_lowest ?? null,
        distance_m: distance,
        score: starGap * 2000 + (distance ?? 5000) / 1000,
      };
    })
    .sort((a, b) => a.score - b.score);
}

/**
 * The cheapest rate any channel quoted, and where it came from.
 *
 * The comparison a guest makes is against the lowest price they can find, so
 * that is the number the calendar shows. The channel travels with it because
 * a surprising rate is worth clicking through to verify.
 */
export function cheapestQuote(json) {
  const all = [
    ...(Array.isArray(json?.featured_prices) ? json.featured_prices : []),
    ...(Array.isArray(json?.prices) ? json.prices : []),
  ];

  const rateOf = (p) =>
    typeof p?.rate_per_night?.extracted_lowest === "number"
      ? p.rate_per_night.extracted_lowest
      : typeof p?.extracted_price === "number"
      ? p.extracted_price
      : null;

  let best = null;
  for (const p of all) {
    const rate = rateOf(p);
    if (rate == null) continue;
    if (!best || rate < best.rate) {
      best = {
        rate,
        channel: p?.source ?? p?.platform ?? null,
        link: p?.link ?? null,
        room_name: p?.rooms?.[0]?.name ?? null,
        free_cancellation: p?.free_cancellation === true,
      };
    }
  }

  if (best && !best.room_name) {
    // Google only names the room on its featured rows, and the cheapest quote
    // is often the hotel's own direct rate, which carries none. Rather than
    // leave the column empty we take the name from the cheapest row that has
    // one -- it describes the same property on the same night, which is what
    // the column is for, even though it is not always the headline rate.
    let named = null;
    for (const p of all) {
      const rate = rateOf(p);
      const name = p?.rooms?.[0]?.name;
      if (rate == null || !name) continue;
      if (!named || rate < named.rate) named = { rate, name };
    }
    if (named) best.room_name = named.name;
  }

  // Google sometimes gives a headline rate with no channel breakdown at all,
  // which is still a real price and better than showing the night as unknown.
  if (!best) {
    const headline = json?.rate_per_night?.extracted_lowest;
    if (typeof headline === "number") {
      return { rate: headline, channel: null, link: null, room_name: null, free_cancellation: false };
    }
  }

  return best;
}

/**
 * Where the property's own rate sits against the competitors that night.
 *
 * Measured against the median rather than the mean, so one competitor running
 * a fire sale does not drag the benchmark down and make an ordinary rate look
 * expensive.
 */
export function medianOf(rates) {
  const values = (rates || []).filter((r) => typeof r === "number").sort((a, b) => a - b);
  if (values.length === 0) return null;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
}
