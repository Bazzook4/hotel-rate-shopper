/**
 * Parser for Google Travel HTML.
 *
 * This replaces SerpAPI, which charged per call and -- measured against real
 * Indian properties -- silently dropped MakeMyTrip and Goibibo from its
 * parsed output even though both are quoted in the page Google serves. We
 * parse the page ourselves so those channels reach the grid.
 *
 * Both functions emit SerpAPI's response shape (`prices`, `featured_prices`,
 * `properties`) so that `normaliseChannels()` and `cheapestQuote()` keep
 * working untouched. The seam is here, not scattered through the routes.
 *
 * ## The fragility to understand before editing
 *
 * Google's class names are obfuscated build output: `j2tiVc_`, `iqYCVb`,
 * `AF5RIe`. They are not a public interface and will change without notice.
 * Every extraction below therefore tries several strategies and reports what
 * it found, so a markup change surfaces as a loud parse failure via
 * `parseHealth()` rather than as a grid that quietly fills with blanks.
 */

/**
 * Which stay the prices on this page actually belong to.
 *
 * Google echoes the requested check-in in the page furniture but prices
 * whatever stay its server-rendered response happens to carry, which is not
 * the same thing. Each offer embeds its own stay dates, and that is the only
 * honest answer to "what night is this rate for".
 *
 * Returns the check-in date as YYYY-MM-DD, or null when the page embeds none.
 */
export function pricedStayDate(html) {
  // ["2026-09-26","2026-09-27",1,1,2,...] sits beside each offer's price.
  const match = /\["(\d{4}-\d{2}-\d{2})","(\d{4}-\d{2}-\d{2})",\d+,\d+,\d+/.exec(String(html || ""));
  return match ? match[1] : null;
}

/** "₹12,980" / "₹1,574" -> 12980. Null when there is no number in there. */
export function extractPrice(text) {
  if (!text) return null;
  // Strip the currency symbol and separators; Indian formatting groups with
  // commas the same way, so this holds for ₹1,23,456 as well.
  const digits = String(text).replace(/[^\d.]/g, "");
  if (!digits) return null;
  const value = Number.parseFloat(digits);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

/**
 * Google writes the channel into a `data-id` as `j2tiVc_Booking.com`, and for
 * the hotel's own direct rate it uses the property name with underscores for
 * spaces ("Taj_MG_Road,_Bengaluru"). Restoring the spaces matters because
 * `channelKey()` downstream would otherwise treat the direct rate as a
 * channel of its own each time the name is written differently.
 */
function cleanChannelName(raw) {
  return String(raw || "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip HTML tags and decode the few entities Google actually emits. */
function textOf(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&middot;/g, "·")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * One hotel's page -> the per-channel offers for the requested stay.
 *
 * Returns SerpAPI's shape. We put every offer in `prices` rather than
 * splitting into `featured_prices`: the distinction was Google's own
 * presentation choice and `normaliseChannels()` merges the two anyway,
 * keeping the lower rate where a channel appears twice.
 */
export function parseHotelOffers(html) {
  const page = String(html || "");

  // Each offer is a block introduced by data-id="j2tiVc_<Channel>". Splitting
  // on it is more robust than matching a nested element, because Google
  // reorders and re-wraps the inner markup between renders.
  const blocks = page.split('data-id="j2tiVc_').slice(1);

  const prices = [];
  const seen = new Set();

  for (const block of blocks) {
    const channel = cleanChannelName(block.split('"')[0]);
    if (!channel) continue;

    // The same offer is emitted more than once per page (once per layout
    // breakpoint), so the first occurrence of a channel wins and the rest
    // are skipped.
    if (seen.has(channel)) continue;

    // `iqYCVb` is the displayed rate. `MW1oTb` and `UeIHqb` carry the same
    // number for other breakpoints and stand in when the first is absent.
    const priceMatch =
      /class="iqYCVb">([^<]+)/.exec(block) ||
      /class="MW1oTb">([^<]+)/.exec(block) ||
      /class="UeIHqb">([^<]+)/.exec(block);
    const rate = extractPrice(priceMatch?.[1]);
    if (rate == null) continue;

    seen.add(channel);

    // Google states cancellation terms in prose ("Free cancellation until
    // Nov 25") rather than in a field, so the text is what we have to read.
    const cancelMatch = /class="ZK8M7">\s*([^<]*?)\s*</.exec(block);
    const cancelText = textOf(cancelMatch?.[1] || "");

    // Attribute values arrive HTML-escaped, so a link kept verbatim carries
    // "&amp;" between its parameters and breaks when followed.
    const linkMatch = /href="(\/aclk[^"]+|https?:\/\/[^"]+)"/.exec(block);
    const link = linkMatch ? linkMatch[1].replace(/&amp;/g, "&") : null;
    const absoluteLink =
      link && link.startsWith("/") ? `https://www.google.com${link}` : link;
    const roomMatch = /class="QcMSrf[^"]*">([^<]+)/.exec(block);

    // Google serves each channel's mark from its own branding host, as a
    // protocol-relative URL the browser cannot load as written.
    const logoMatch = /<img[^>]+src="(\/\/www\.gstatic\.com\/travel-hotels\/branding\/[^"]+)"/.exec(block);
    const logo = logoMatch ? `https:${logoMatch[1]}` : null;

    prices.push({
      source: channel,
      // SerpAPI nested the rate this way and the downstream helpers read
      // `extracted_lowest` first, so the shape is preserved exactly.
      rate_per_night: { extracted_lowest: rate, lowest: priceMatch[1].trim() },
      extracted_price: rate,
      link: absoluteLink,
      logo,
      free_cancellation: /free cancellation/i.test(cancelText),
      rooms: roomMatch ? [{ name: textOf(roomMatch[1]) }] : [],
      remarks: cancelText ? [cancelText] : [],
    });
  }

  // A headline rate with no channel breakdown is still a real price, and
  // `cheapestQuote()` falls back to it rather than calling the night unknown.
  const headline = extractPrice(/class="UydQr AdWm1c">([^<]+)/.exec(page)?.[1]);

  return {
    prices,
    featured_prices: [],
    rate_per_night: headline != null ? { extracted_lowest: headline } : undefined,
  };
}

/**
 * A "hotels near X" page -> the candidate list Competitor Shopper ranks.
 *
 * SerpAPI identified a hotel by `property_token`. Scraping gives us Google's
 * `data-entity-key` instead, which is the same idea -- a handle for one
 * listing -- but it has not yet been proven stable across dates and weeks.
 * It is therefore emitted as `property_token` (so ranking and storage keep
 * working) *and* as `entity_key`, so a later migration can tell the two
 * apart without re-scraping.
 */
export function parseSearchResults(html) {
  const page = String(html || "");

  // Cards are delimited by the entity key; the name, price and class follow
  // inside the same card.
  const cards = page.split('data-entity-key="').slice(1);

  const properties = [];
  const seen = new Set();

  for (const card of cards) {
    const entityKey = card.split('"')[0];
    if (!entityKey) continue;

    const nameMatch = /class="[^"]*AF5RIe[^"]*">([^<]+)</.exec(card);
    const name = textOf(nameMatch?.[1]);
    if (!name) continue;

    if (seen.has(entityKey)) continue;
    seen.add(entityKey);

    const rate = extractPrice(/class="UydQr AdWm1c">([^<]+)/.exec(card)?.[1]);
    const starMatch = /(\d)-star hotel/.exec(card);
    const ratingMatch = /aria-label="([\d.]+) out of 5 stars from ([\d,]+) reviews/.exec(card);

    // Coordinates appear as a bare [lat,lng] array in the card's embedded
    // data rather than in a field of their own. They matter: `properties`
    // holds no lat/long, so the property's own hit in these results is what
    // makes distance ranking possible at all.
    //
    // The bounds are a sanity check, not decoration: the page is dense with
    // other bracketed number pairs (layout metrics, image dimensions), and
    // without them the first such pair gets read as a location.
    const gpsMatch = /\[(-?\d{1,2}\.\d{4,}),(-?\d{1,3}\.\d{4,})\]/.exec(card);
    const lat = gpsMatch ? Number(gpsMatch[1]) : null;
    const lng = gpsMatch ? Number(gpsMatch[2]) : null;
    const hasGps =
      lat != null && lng != null &&
      Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
      !(lat === 0 && lng === 0);

    properties.push({
      name,
      // Kept under SerpAPI's key so ranking, storage and self-exclusion are
      // unchanged; see the note above about the pending identity migration.
      property_token: entityKey,
      entity_key: entityKey,
      hotel_class: starMatch ? `${starMatch[1]}-star hotel` : null,
      extracted_hotel_class: starMatch ? Number(starMatch[1]) : null,
      overall_rating: ratingMatch ? Number(ratingMatch[1]) : null,
      reviews: ratingMatch ? Number(ratingMatch[2].replace(/,/g, "")) : null,
      rate_per_night: rate != null ? { extracted_lowest: rate } : null,
      gps_coordinates: hasGps ? { latitude: lat, longitude: lng } : null,
    });
  }

  return { properties };
}

/**
 * Is this page usable, and if not, why?
 *
 * The failure we must never ship silently is a markup change that parses to
 * zero rows: the grid would fill with blanks that read as "no availability"
 * rather than as "we can no longer read the page". Callers treat `ok: false`
 * as a hard stop, and the canary script reports `reason` verbatim.
 */
export function parseHealth(html, { expect = "hotel" } = {}) {
  const page = String(html || "");

  if (!page || page.length < 10000) {
    return { ok: false, reason: "empty_or_truncated", count: 0 };
  }
  // Google serves these instead of results when it thinks we are a bot.
  //
  // Matched narrowly on purpose. A bare /captcha/ test reports every healthy
  // page as blocked: Google ships a client-side routing table listing
  // "/recaptcha/challenge" in the normal page, so the word appears four times
  // in a response that parsed perfectly well.
  if (/\/sorry\/index|unusual traffic from your computer/i.test(page)) {
    return { ok: false, reason: "blocked", count: 0 };
  }
  if (/consent\.google\.com|Before you continue/i.test(page)) {
    return { ok: false, reason: "consent_wall", count: 0 };
  }

  const count =
    expect === "search"
      ? parseSearchResults(page).properties.length
      : parseHotelOffers(page).prices.length;

  if (count === 0) {
    // The page came back whole and unblocked but yielded nothing, which
    // means the selectors no longer match what Google is emitting.
    return { ok: false, reason: "selectors_stale", count: 0 };
  }

  return { ok: true, reason: null, count };
}
