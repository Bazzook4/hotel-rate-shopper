import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import {
  getPropertyById,
  getUserPropertyId,
  saveParityRates,
  clearParityRatesForDates,
} from "@/lib/database";
import { normaliseChannels } from "@/lib/parity";
import { fetchHotel, isScraperConfigured, jitterDelay, sessionIdFor, sleep } from "@/lib/scraper/fetch";
import { createBudget, cursorFrom } from "@/lib/scraper/budget";
import { addDays, clampToToday, formatDateISO, parseDateISO, todayUTC } from "@/lib/date";

/**
 * Google Hotels prices one stay at a time, so a window of dates costs one
 * call per date. That is the expensive part of this feature, so a refresh is
 * capped: the grid refreshes what the hotelier is looking at, not the whole
 * horizon.
 */
const MAX_DATES_PER_REFRESH = 31;

/** The window a refresh covers when the caller does not ask for one. */
const DEFAULT_DAYS = 7;

/** One stay date, priced across every channel Google knows. */
async function fetchDate(_unused, query, stayDate, nights, guests, sessionId) {
  const checkOut = formatDateISO(addDays(parseDateISO(stayDate), nights));

  // Rates are read from Google's own page rather than bought from SerpAPI,
  // which -- measured against these properties -- omitted MakeMyTrip and
  // Goibibo from its parsed output even though Google quotes them.
  const json = await fetchHotel(query, {
    checkIn: stayDate,
    checkOut,
    adults: guests,
    sessionId,
  });

  return normaliseChannels(json);
}

export async function POST(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const own = session.property_id || (await getUserPropertyId(session.userId).catch(() => null));
  const propertyId = isSuperAdmin(session) ? body?.propertyId || own : own;
  if (!propertyId || (!isSuperAdmin(session) && body?.propertyId && body.propertyId !== own)) {
    return NextResponse.json({ error: "No property selected." }, { status: 403 });
  }

  if (!isScraperConfigured()) {
    return NextResponse.json(
      { error: "Rate shopping is not configured. Ask your administrator to add the rate data credentials." },
      { status: 503 }
    );
  }

  const property = await getPropertyById(propertyId);
  if (!property) {
    return NextResponse.json({ error: "Property not found." }, { status: 404 });
  }

  // Parity cannot run against a hotel we cannot find. This is the prompt that
  // sends the hotelier to Property Setup.
  if (!property.google_place_query) {
    return NextResponse.json(
      {
        error:
          "Tell us which hotel to look up: add your Google Business URL in Property Setup, then refresh.",
        needsSetup: true,
      },
      { status: 409 }
    );
  }

  // Clamped rather than trusted: the rate service refuses a check-in before
  // today, and a browser east of UTC sends "today" as a date this server still
  // considers yesterday, which would fail the whole window.
  const start = parseDateISO(clampToToday(body?.start)) || new Date();
  const days = Math.min(Math.max(Number(body?.days) || DEFAULT_DAYS, 1), MAX_DATES_PER_REFRESH);
  const nights = Math.min(Math.max(Number(body?.nights) || 1, 1), 30);
  const guests = Math.min(Math.max(Number(body?.guests) || 2, 1), 20);

  // Any date still in the past -- a window opened yesterday and refreshed
  // today, say -- is dropped rather than sent, since the service rejects the
  // whole call over one dead date.
  const today = todayUTC();
  const dates = Array.from({ length: days }, (_, i) => formatDateISO(addDays(start, i))).filter(
    (d) => d >= today
  );

  if (dates.length === 0) {
    return NextResponse.json(
      { error: "Those dates have passed. Choose today or later and refresh again." },
      { status: 400 }
    );
  }

  const rows = [];
  const emptyDates = [];
  const failures = [];
  let saved = 0;

  // Resume where the previous batch stopped. A refresh of more than a couple
  // of dates cannot finish inside one request, so the client calls back with
  // the cursor it was given until the window is done.
  const from = Math.min(Math.max(Number(body?.from) || 0, 0), dates.length);

  // One session for the whole sweep, so every date leaves from the same
  // address carrying the same cookies: one person planning one trip. Derived
  // from the property alone, so the batches of one refresh keep sharing an
  // address instead of hopping between them.
  const sessionId = sessionIdFor(propertyId);

  const budget = createBudget();
  let index = from;
  let stopped = false;

  // Sequential, and deliberately unhurried. Concurrency is the loudest signal
  // available to Google's bot detection, so dates are fetched one at a time
  // with a randomised gap rather than in a burst.
  for (; index < dates.length; index += 1) {
    // Checked before starting, never during: a fetch already under way has to
    // be allowed to finish and be saved.
    if (index > from && !budget.canContinue()) break;

    const stayDate = dates[index];
    if (index > from) await sleep(jitterDelay());

    try {
      const channels = await fetchDate(null, property.google_place_query, stayDate, nights, guests, sessionId);
      if (channels.length === 0) {
        emptyDates.push(stayDate);
        // Cleared as it is found, for the same reason the rates below are
        // saved as they arrive: a request killed mid-batch would otherwise
        // leave last week's rates standing on a night nobody is selling.
        try {
          await clearParityRatesForDates(propertyId, [stayDate], { nights, guests });
        } catch (err) {
          console.error("Clearing a sold-out date failed:", err.message);
        }
        continue;
      }

      const dateRows = channels.map((channel) => ({ ...channel, stay_date: stayDate, nights, guests }));
      rows.push(...dateRows);

      // Saved a date at a time rather than banked until the batch ends. A
      // request killed mid-batch -- a hung page against the platform's own
      // limit -- would otherwise discard every night already paid for and
      // re-fetch them on the next attempt.
      try {
        saved += await saveParityRates(propertyId, dateRows);
      } catch (err) {
        // The rates were read; only storing them failed. Worth reporting, but
        // not worth abandoning a sweep that is otherwise working.
        console.error("Saving a night's rates failed:", err.message);
        failures.push({ date: stayDate, message: "Could not be saved." });
      }
    } catch (err) {
      // A refusal or a stale parser applies to every remaining date, so the
      // sweep stops rather than spending more requests on an address Google
      // has just turned away -- retrying through a soft block is what turns
      // it into a hard one. The cursor is cleared with it, so the client
      // stops asking for more instead of resuming into the same wall.
      failures.push({ date: stayDate, message: err.message });
      if (err.code === "blocked" || err.code === "consent_wall" || err.code === "selectors_stale") {
        index = dates.length;
        stopped = true;
        break;
      }
    }
  }

  const attempted = index - from;

  // Every date in this batch failing is a real failure, not a partial one --
  // usually a refusal or a layout change -- and should not look like a
  // successful refresh that found nothing.
  if (attempted > 0 && failures.length === attempted) {
    return NextResponse.json(
      {
        error: `Could not reach the rate data service. ${failures[0]?.message || ""}`.trim(),
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    saved,
    datesChecked: attempted - failures.length,
    failures,
    checkedAt: new Date().toISOString(),
    // Where the next batch resumes, or null when the window is finished.
    // `total` and `done` are what the button counts progress with.
    cursor: stopped ? null : cursorFrom(index, dates.length),
    done: index,
    total: dates.length,
  });
}
