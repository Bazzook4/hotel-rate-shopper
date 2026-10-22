import { getSupabaseAdmin } from "@/lib/database";

/**
 * Rate limits, counted in the `rate_limit_events` table.
 *
 * Kept in the database rather than in memory because every serverless
 * instance has memory of its own: a counter held there resets whenever a
 * request lands on a fresh instance, which on Vercel is often.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Rows older than this are no use to any window below, and are pruned. */
const RETENTION_MS = 2 * DAY;

/** Sign-in: failures per address being tried, and per network address. */
const LOGIN_WINDOW_MS = 15 * MINUTE;
const LOGIN_MAX_PER_EMAIL = 5;
const LOGIN_MAX_PER_IP = 20;

/**
 * Paid page fetches per property. A full parity month is 31 fetches and a
 * competitor week is up to 42, so the hourly cap leaves room for a hotelier
 * to walk the whole month on both screens and still stops a loop -- a stolen
 * session, a stuck client -- from running up the proxy bill overnight.
 */
const SCRAPE_MAX_PER_HOUR = 300;
const SCRAPE_MAX_PER_DAY = 1500;

async function countSince(key, windowMs) {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count, error } = await getSupabaseAdmin()
    .from("rate_limit_events")
    .select("id", { count: "exact", head: true })
    .eq("key", key)
    .gte("created_at", since);
  if (error) throw new Error(`Failed to read rate limit: ${error.message}`);
  return count || 0;
}

async function record(key) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("rate_limit_events").insert({ key });
  if (error) throw new Error(`Failed to record rate limit event: ${error.message}`);

  // Pruned as it grows rather than by a scheduled job, which this project
  // does not have. Scoped to the key so it rides the same index.
  const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
  await supabase.from("rate_limit_events").delete().eq("key", key).lt("created_at", cutoff);
}

async function clear(key) {
  const { error } = await getSupabaseAdmin().from("rate_limit_events").delete().eq("key", key);
  if (error) throw new Error(`Failed to clear rate limit: ${error.message}`);
}

/**
 * The caller's address. Vercel sets `x-forwarded-for` itself, overwriting
 * anything the client sent, so its first entry is the real client.
 */
export function clientIp(req) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

const loginKeys = (email, ip) => [`login:email:${email}`, `login:ip:${ip}`];

/**
 * Whether another sign-in attempt is allowed.
 *
 * Fails open: if the ledger cannot be read, nobody is locked out of the
 * hotel's front desk over it. The password check still stands behind this.
 */
export async function loginAllowed(email, ip) {
  const [emailKey, ipKey] = loginKeys(email, ip);
  try {
    const [byEmail, byIp] = await Promise.all([
      countSince(emailKey, LOGIN_WINDOW_MS),
      countSince(ipKey, LOGIN_WINDOW_MS),
    ]);
    return byEmail < LOGIN_MAX_PER_EMAIL && byIp < LOGIN_MAX_PER_IP;
  } catch (err) {
    console.error("Sign-in rate limit unavailable:", err.message);
    return true;
  }
}

export async function recordLoginFailure(email, ip) {
  try {
    await Promise.all(loginKeys(email, ip).map(record));
  } catch (err) {
    console.error("Recording a failed sign-in failed:", err.message);
  }
}

/** A correct password wipes that account's slate; the address's stays. */
export async function clearLoginFailures(email) {
  try {
    await clear(loginKeys(email, "")[0]);
  } catch (err) {
    console.error("Clearing sign-in failures failed:", err.message);
  }
}

const scrapeKey = (propertyId) => `scrape:${propertyId}`;

/**
 * How many paid fetches this property may still make right now.
 *
 * Fails closed, unlike sign-in: this limit exists to cap spend, and a cap
 * that lifts whenever the ledger is unreadable is not a cap. Throws, and the
 * route reports the refresh as unavailable.
 */
export async function scrapeAllowance(propertyId) {
  const key = scrapeKey(propertyId);
  const [lastHour, lastDay] = await Promise.all([countSince(key, HOUR), countSince(key, DAY)]);
  return Math.max(0, Math.min(SCRAPE_MAX_PER_HOUR - lastHour, SCRAPE_MAX_PER_DAY - lastDay));
}

/** Counted whether the fetch succeeded or not: the proxy bills either way. */
export async function recordScrape(propertyId) {
  try {
    await record(scrapeKey(propertyId));
  } catch (err) {
    console.error("Recording a rate fetch failed:", err.message);
  }
}

/** The message both refresh screens show when a property is over its cap. */
export const SCRAPE_LIMIT_MESSAGE =
  "This property has reached its rate refresh limit for now. Rates already fetched are saved; try again in an hour.";

/**
 * Sign-ups through shareable onboarding links. Every sign-up makes a
 * property that can run paid pages, so a link left on a website must not be
 * a way to make hundreds. Per network address: Indian mobile networks put
 * many phones behind one address, so this counts only completed sign-ups
 * and leaves room for a hotel group adding its hotels. Across all shareable
 * links: a ceiling on a bad day, whatever the addresses. The link's own
 * `max_uses` caps it too.
 */
export const SIGNUP_MAX_PER_IP_PER_DAY = 5;
export const SIGNUP_MAX_PER_DAY = 5;
const SIGNUP_ALL_KEY = "signup:all";
const signupIpKey = (ip) => `signup:ip:${ip}`;

/**
 * Whether another sign-up through a shareable link may go ahead: null when
 * it may, else "ip" or "all" for the cap that is full.
 *
 * Checked before and recorded after, so two requests sent at the same
 * moment can both pass; the bot traps and the link's own cap bound that.
 *
 * Fails closed: a hotel that cannot sign up can ask for a one-hotel link,
 * which these caps do not apply to.
 */
export async function signupBlockedBy(ip) {
  const [byIp, all] = await Promise.all([
    countSince(signupIpKey(ip), DAY),
    countSince(SIGNUP_ALL_KEY, DAY),
  ]);
  if (byIp >= SIGNUP_MAX_PER_IP_PER_DAY) return "ip";
  if (all >= SIGNUP_MAX_PER_DAY) return "all";
  return null;
}

/** Only completed sign-ups are counted. */
export async function recordSignup(ip) {
  try {
    await Promise.all([record(signupIpKey(ip)), record(SIGNUP_ALL_KEY)]);
  } catch (err) {
    console.error("Recording a sign-up failed:", err.message);
  }
}

/**
 * The guest's online check-in page has no sign-in, only the link. Per
 * network address: every save and upload is counted, and so is every link
 * that does not exist, so nobody can try links in bulk or fill the storage
 * from one place. Generous, since a family fills in several guests from one
 * hotel Wi-Fi.
 */
const CHECKIN_MAX_PER_HOUR = 150;
const CHECKIN_BAD_LINK_MAX_PER_HOUR = 20;
const checkinKey = (ip) => `checkin:ip:${ip}`;
const checkinBadKey = (ip) => `checkin:bad:${ip}`;

/**
 * Whether this address may use a check-in link right now.
 *
 * Fails open, like sign-in: a guest at the gate must not be locked out
 * because the ledger cannot be read. The link itself still has to be right.
 */
export async function checkinAllowed(ip) {
  try {
    const [used, bad] = await Promise.all([
      countSince(checkinKey(ip), HOUR),
      countSince(checkinBadKey(ip), HOUR),
    ]);
    return used < CHECKIN_MAX_PER_HOUR && bad < CHECKIN_BAD_LINK_MAX_PER_HOUR;
  } catch (err) {
    console.error("Check-in rate limit unavailable:", err.message);
    return true;
  }
}

/** A save or an upload; `badLink` for a link that does not exist. */
export async function recordCheckinUse(ip, { badLink = false } = {}) {
  try {
    await record(badLink ? checkinBadKey(ip) : checkinKey(ip));
  } catch (err) {
    console.error("Recording a check-in request failed:", err.message);
  }
}
