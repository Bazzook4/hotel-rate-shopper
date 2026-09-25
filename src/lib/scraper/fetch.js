/**
 * Fetching Google Travel through a residential proxy.
 *
 * This is the only module that knows a proxy exists. Callers ask for a hotel
 * or a location search and get SerpAPI's response shape back, so the routes
 * that used to call SerpAPI change by one import.
 *
 * ## Why a proxy at all
 *
 * Google tolerates occasional lookups from a home connection and blocks the
 * volume this product needs from a datacentre address. Residential exits make
 * the traffic look like what it is functionally -- somebody in India checking
 * hotel prices -- and keep the application's own address out of it, so a
 * blocked exit costs one request rather than the whole deployment.
 */

import { parseHotelOffers, parseSearchResults, parseHealth, pricedStayDate } from "./parse.js";

/** Chrome on macOS. The headers below must stay consistent with this. */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Compression is not an optimisation here, it is most of the bill.
 *
 * Measured on a real hotel page: 2.66 MB uncompressed against 0.39 MB on the
 * wire. Residential proxies meter transferred bytes, so omitting this header
 * costs roughly seven times more per fetch for identical data.
 */
const HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-IN,en-GB;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Upgrade-Insecure-Requests": "1",
};

/** Pause between sequential fetches, in ms. */
const MIN_DELAY_MS = 3000;
const MAX_DELAY_MS = 8000;

/**
 * Build the proxy username.
 *
 * Decodo encodes geo and session into the username, and the exact spelling
 * matters more than it looks: `user-<id>-country-in` alone was tested and
 * silently ignored the country, exiting in Vietnam. Only the form carrying a
 * `-session-` fragment actually honoured the India target. An Indian hotel
 * query arriving from a Vietnamese address is precisely the mismatch this
 * whole approach exists to avoid, so the session is never optional.
 */
function proxyUsername(sessionId) {
  const user = process.env.DECODO_USER;
  const minutes = process.env.DECODO_SESSION_MINUTES || "10";
  return `user-${user}-country-in-session-${sessionId}-sessionduration-${minutes}`;
}

/** The proxy URL for one sticky session, or null when not configured. */
export function proxyUrlFor(sessionId) {
  const user = process.env.DECODO_USER;
  const pass = process.env.DECODO_PASSWORD;
  const host = process.env.DECODO_HOST || "gate.decodo.com";
  const port = process.env.DECODO_PORT || "10001";
  if (!user || !pass) return null;

  const username = encodeURIComponent(proxyUsername(sessionId));
  return `http://${username}:${encodeURIComponent(pass)}@${host}:${port}`;
}

/** Is scraping configured? Routes check this before offering a refresh. */
export function isScraperConfigured() {
  return Boolean(process.env.DECODO_USER && process.env.DECODO_PASSWORD);
}

/**
 * A session id for one sweep.
 *
 * One id per property per run, so every date for that property leaves from
 * the same address with the same cookies: one person planning one trip.
 * Rotating mid-sweep is what looks automated.
 */
export function sessionIdFor(key) {
  const slug = String(key || "rs").replace(/[^a-z0-9]/gi, "").slice(0, 12).toLowerCase();
  return `${slug || "rs"}${Math.floor(Date.now() / 600000) % 10000}`;
}

/** Random pause, so the gaps between requests are not a machine's metronome. */
export function jitterDelay() {
  return MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The proxy agent.
 *
 * `undici`'s ProxyAgent is what lets a standard fetch go through an
 * authenticated HTTP proxy -- the platform fetch has no option for it. It is
 * a direct dependency: undici is bundled inside Node but not resolvable as a
 * package, so it has to be installed explicitly. Imported lazily so that a deployment without proxy credentials
 * still boots and merely reports scraping as unconfigured.
 */
async function agentFor(sessionId) {
  const url = proxyUrlFor(sessionId);
  if (!url) return null;
  const { ProxyAgent } = await import("undici");
  return new ProxyAgent(url);
}

/**
 * One Google Travel page, as text.
 *
 * Retries only what is worth retrying. A block is not a transient error:
 * hammering an address that just refused us is how a soft throttle becomes a
 * hard ban, so `blocked` and `consent_wall` stop immediately. Network faults
 * and 5xx get one more try on a fresh session.
 */
async function fetchPage(url, { sessionId, expect, attempts = 2 }) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    // A retry deliberately changes session: the point is a different exit
    // address, not another go from the one that just failed.
    const session = attempt === 1 ? sessionId : `${sessionId}r${attempt}`;
    const dispatcher = await agentFor(session);

    try {
      const res = await fetch(url, {
        headers: HEADERS,
        cache: "no-store",
        dispatcher,
        signal: AbortSignal.timeout(45000),
      });

      const html = await res.text();
      const health = parseHealth(html, { expect });

      if (health.ok) return { html, health };

      if (health.reason === "blocked" || health.reason === "consent_wall") {
        const err = new Error(`Google refused the request (${health.reason}).`);
        err.code = health.reason;
        throw err;
      }

      // `selectors_stale` usually means the markup changed, which no retry
      // can fix -- but not always. Google also serves an occasional stripped
      // page that carries no results and parses to nothing, and treating that
      // as a permanent layout change reports a false alarm and abandons a
      // sweep that would have succeeded on the next attempt. So it is retried
      // once on a fresh address, and only called stale if it happens again.
      if (health.reason === "selectors_stale") {
        lastError = new Error(
          "Google changed its page layout and rates can no longer be read. The parser needs updating."
        );
        lastError.code = "selectors_stale";
      } else {
        lastError = new Error(`Unusable response (${health.reason}).`);
      }
    } catch (err) {
      // A refusal is never retried: going straight back at an address that
      // just turned us away is what turns a soft throttle into a ban.
      if (err.code === "blocked" || err.code === "consent_wall") {
        throw err;
      }
      lastError = err;
    }

    if (attempt < attempts) await sleep(jitterDelay());
  }

  throw lastError || new Error("Could not reach Google.");
}

/** The search URL for one stay. */
function travelUrl(query, { checkIn, checkOut, adults = 2, currency = "INR" }) {
  const url = new URL("https://www.google.com/travel/search");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "in");
  url.searchParams.set("currency", currency);
  if (checkIn) url.searchParams.set("check_in_date", checkIn);
  if (checkOut) url.searchParams.set("check_out_date", checkOut);
  if (adults) url.searchParams.set("adults", String(adults));
  return url.toString();
}

/**
 * One hotel, one stay -> SerpAPI's response shape.
 *
 * Drop-in for the SerpAPI call the parity and competitor refreshes used to
 * make, so `normaliseChannels()` and `cheapestQuote()` read it unchanged.
 */
export async function fetchHotel(query, options = {}) {
  const sessionId = options.sessionId || sessionIdFor(query);
  const url = travelUrl(query, options);
  const { html } = await fetchPage(url, { sessionId, expect: "hotel" });

  // Google accepts a check-in date, echoes it back in the page furniture, and
  // then serves whatever stay its server-rendered response already had --
  // in practice the next bookable night, whatever was asked for. Storing
  // those numbers against the requested date fills the grid with prices for
  // a different night, which is worse than an empty cell because it reads as
  // fact. So the page has to say it priced the night we asked about.
  const priced = pricedStayDate(html);
  if (options.checkIn && priced && priced !== options.checkIn) {
    const err = new Error(
      `Google priced ${priced}, not ${options.checkIn}. It does not sell future dates from this page.`
    );
    err.code = "wrong_date";
    err.pricedDate = priced;
    throw err;
  }

  return parseHotelOffers(html);
}

/** "hotels near X" -> `{ properties }`, for competitor suggestions. */
export async function fetchSearch(query, options = {}) {
  const sessionId = options.sessionId || sessionIdFor(query);
  const url = travelUrl(query, options);
  const { html } = await fetchPage(url, { sessionId, expect: "search" });
  return parseSearchResults(html);
}
