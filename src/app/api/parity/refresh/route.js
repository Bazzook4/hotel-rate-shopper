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
async function fetchDate(apiKey, query, stayDate, nights, guests) {
  const checkOut = formatDateISO(addDays(parseDateISO(stayDate), nights));

  const serp = new URL("https://serpapi.com/search.json");
  serp.searchParams.set("engine", "google_hotels");
  serp.searchParams.set("q", query);
  serp.searchParams.set("check_in_date", stayDate);
  serp.searchParams.set("check_out_date", checkOut);
  serp.searchParams.set("adults", String(guests));
  serp.searchParams.set("currency", "INR");
  serp.searchParams.set("gl", "in");
  serp.searchParams.set("hl", "en");
  serp.searchParams.set("api_key", apiKey);

  const res = await fetch(serp, { cache: "no-store" });
  const json = await res.json();

  if (!res.ok || json?.error) {
    throw new Error(json?.error || `Google returned ${res.status}`);
  }

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

  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Rate shopping is not configured. Ask your administrator to add the rate data key." },
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

  // Sequential on purpose: SerpAPI rate-limits concurrent calls on the plans
  // this runs on, and a burst of parallel requests fails the whole refresh
  // rather than slowing it down.
  for (const stayDate of dates) {
    try {
      const channels = await fetchDate(apiKey, property.google_place_query, stayDate, nights, guests);
      if (channels.length === 0) {
        emptyDates.push(stayDate);
        continue;
      }
      for (const channel of channels) {
        rows.push({ ...channel, stay_date: stayDate, nights, guests });
      }
    } catch (err) {
      // One bad date should not lose the rest of the window, so the failure is
      // collected and reported alongside whatever did come back.
      failures.push({ date: stayDate, message: err.message });
    }
  }

  let saved = 0;
  try {
    saved = await saveParityRates(propertyId, rows);
    // A date Google answered for with no channel at all means nobody is
    // selling that night; the old rates for it would otherwise read as
    // current.
    if (emptyDates.length > 0) {
      await clearParityRatesForDates(propertyId, emptyDates, { nights, guests });
    }
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  // Every date failing is a real failure, not a partial one -- usually a bad
  // key or an exhausted quota -- and should not look like a successful
  // refresh that found nothing.
  if (failures.length === dates.length) {
    return NextResponse.json(
      {
        error: `Could not reach the rate data service. ${failures[0]?.message || ""}`.trim(),
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    saved,
    datesChecked: dates.length - failures.length,
    failures,
    checkedAt: new Date().toISOString(),
  });
}
