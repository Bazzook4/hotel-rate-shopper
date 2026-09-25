/**
 * Does the parser still understand Google's page?
 *
 * The failure this exists to catch is silent. Google's class names are
 * obfuscated build output, so when they change the fetch still returns 200
 * and the parse still "succeeds" -- with zero rows. The grid then fills with
 * blanks that read as "no availability" rather than "we can no longer read
 * the page", and nobody notices for days.
 *
 * Run it after deploying, and on a schedule once there is somewhere to run it.
 *
 *   node scripts/scraper-canary.mjs
 *
 * Exits non-zero when something needs a human, so cron reports it.
 */

import { fetchHotel, fetchSearch, isScraperConfigured, jitterDelay, sleep } from "../src/lib/scraper/fetch.js";

/**
 * Tomorrow.
 *
 * Not an arbitrary choice: Google's server-rendered page prices only the next
 * bookable night, whatever check-in is asked for, so a date further out comes
 * back priced for tomorrow anyway and the fetch rejects it. Measured across
 * several URL shapes -- /travel/search, a ts token, and /travel/hotels/entity
 * -- all of which returned the same night.
 */
function stayDates() {
  const checkIn = new Date(Date.now() + 86400000);
  const checkOut = new Date(Date.now() + 2 * 86400000);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { checkIn: iso(checkIn), checkOut: iso(checkOut) };
}

const checks = [
  {
    name: "hotel page (offers per channel)",
    run: async () => {
      const { checkIn, checkOut } = stayDates();
      const json = await fetchHotel("Taj MG Road Bengaluru", { checkIn, checkOut });
      const channels = json.prices.map((p) => p.source);
      return {
        count: json.prices.length,
        detail: channels.join(", ") || "(none)",
        // One channel is not proof of health: a page that half-parses is how
        // a partial layout change would show up.
        ok: json.prices.length >= 2,
      };
    },
  },
  {
    name: "rates belong to the night we asked for",
    run: async () => {
      // The failure this guards against is silent and the worst kind: a page
      // that parses perfectly into prices for a different night, stored as
      // though they were today's answer.
      const { checkIn, checkOut } = stayDates();
      const json = await fetchHotel("Taj MG Road Bengaluru", { checkIn, checkOut });
      return {
        count: json.prices.length,
        detail: `priced for ${checkIn}`,
        ok: json.prices.length > 0,
      };
    },
  },
  {
    name: "location search (competitor suggestions)",
    run: async () => {
      const { checkIn, checkOut } = stayDates();
      const json = await fetchSearch("hotels near Koramangala, Bengaluru", { checkIn, checkOut });
      const named = json.properties.filter((p) => p.name && p.rate_per_night);
      return {
        count: json.properties.length,
        detail: `${named.length} with a rate`,
        ok: json.properties.length >= 3 && named.length >= 2,
      };
    },
  },
];

async function main() {
  if (!isScraperConfigured()) {
    console.error("FAIL  scraper is not configured (DECODO_USER / DECODO_PASSWORD).");
    process.exit(2);
  }

  let failed = 0;

  for (const [index, check] of checks.entries()) {
    if (index > 0) await sleep(jitterDelay());

    try {
      const result = await check.run();
      if (result.ok) {
        console.log(`PASS  ${check.name}: ${result.count} rows -- ${result.detail}`);
      } else {
        failed += 1;
        console.error(`FAIL  ${check.name}: ${result.count} rows -- ${result.detail}`);
      }
    } catch (err) {
      failed += 1;
      const hint =
        err.code === "selectors_stale"
          ? " -- Google changed its layout; src/lib/scraper/parse.js needs updating"
          : err.code === "blocked"
          ? " -- the exit address was refused; back off before retrying"
          : "";
      console.error(`FAIL  ${check.name}: ${err.message}${hint}`);
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} of ${checks.length} checks failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${checks.length} checks passed.`);
}

main();
