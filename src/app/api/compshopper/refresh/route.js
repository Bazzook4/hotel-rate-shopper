import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { listCompetitors, saveCompetitorRates } from "@/lib/database";
import { resolvePropertyId } from "@/lib/propertyScope";
import { cheapestQuote, MAX_COMPETITORS } from "@/lib/competitors";
import { fetchHotel, isScraperConfigured, jitterDelay, sessionIdFor, sleep } from "@/lib/scraper/fetch";
import { createBudget, cursorFrom } from "@/lib/scraper/budget";
import { addDays, clampToToday, formatDateISO, parseDateISO, todayUTC } from "@/lib/date";

/**
 * A refresh costs one call per competitor per night, so a month across six
 * competitors is ~180 calls -- far past any request timeout. The calendar
 * therefore shows a whole month from storage while a refresh fills one week
 * of it, and paging then refreshing walks the month across.
 */
const REFRESH_DAYS = 7;

/** One competitor on one night, priced at the cheapest channel selling it. */
async function fetchOne(competitor, stayDate, nights, guests, sessionId) {
  const checkOut = formatDateISO(addDays(parseDateISO(stayDate), nights));

  // The competitor is looked up by name. SerpAPI pinned a listing with its
  // own `property_token`, which no longer exists once we read Google's page
  // directly; the stored token is kept for the identity migration but is not
  // a search key here.
  const json = await fetchHotel(competitor.name, {
    checkIn: stayDate,
    checkOut,
    adults: guests,
    sessionId,
  });

  const quote = cheapestQuote(json);
  return {
    competitor_id: competitor.id,
    stay_date: stayDate,
    nights,
    guests,
    rate: quote?.rate ?? null,
    channel: quote?.channel ?? null,
    link: quote?.link ?? null,
    room_name: quote?.room_name ?? null,
    free_cancellation: quote?.free_cancellation === true,
    // No price from any channel means nobody is selling it that night, which
    // the calendar shows as SOLD rather than as a gap in the data.
    sold_out: quote == null,
  };
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

  const propertyId = await resolvePropertyId(session, body?.propertyId);
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected." }, { status: 403 });
  }

  if (!isScraperConfigured()) {
    return NextResponse.json(
      { error: "Rate shopping is not configured. Ask your administrator to add the rate data credentials." },
      { status: 503 }
    );
  }

  const competitors = await listCompetitors(propertyId);
  if (competitors.length === 0) {
    return NextResponse.json(
      {
        error: "Add the hotels you compete with first, then refresh.",
        needsCompetitors: true,
      },
      { status: 409 }
    );
  }

  // Clamped rather than trusted: the rate service refuses a check-in before
  // today, and a browser east of UTC sends "today" as a date this server still
  // considers yesterday, which would fail the whole window.
  const start = parseDateISO(clampToToday(body?.start)) || new Date();
  const days = Math.min(Math.max(Number(body?.days) || REFRESH_DAYS, 1), REFRESH_DAYS);
  const nights = Math.min(Math.max(Number(body?.nights) || 1, 1), 30);
  const guests = Math.min(Math.max(Number(body?.guests) || 2, 1), 20);

  // Any date still in the past is dropped rather than sent: the service
  // rejects the whole call over one dead date.
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

  const tracked = competitors.slice(0, MAX_COMPETITORS);

  const rows = [];
  const failures = [];

  // Sequential and paced, like the parity refresh: concurrency is the
  // loudest signal available to Google's bot detection, so cells are fetched
  // one at a time with a randomised gap.
  let stopped = false;
  // The sweep is competitors x dates, flattened so one cursor addresses a
  // single cell. A nested pair would have to be serialised and revalidated on
  // the way back in; one integer cannot disagree with itself.
  const cells = [];
  for (const competitor of tracked) {
    for (const stayDate of dates) cells.push({ competitor, stayDate });
  }

  // Resume where the previous batch stopped. Six competitors across a week is
  // several minutes of deliberately slow fetching, far past any single
  // request, so the client calls back with the cursor until the grid is done.
  const from = Math.min(Math.max(Number(body?.from) || 0, 0), cells.length);

  const budget = createBudget();
  let index = from;

  // Sequential and paced. Concurrency is the loudest signal available to
  // Google's bot detection, so cells are fetched one at a time.
  for (; index < cells.length; index += 1) {
    // Checked before starting, never during: a fetch already under way has to
    // be allowed to finish and be saved.
    if (index > from && !budget.canContinue()) break;

    const { competitor, stayDate } = cells[index];

    // A session per competitor: one address reading one hotel's calendar
    // looks like a guest comparing dates, where a single session sweeping six
    // different hotels does not. Keyed by competitor rather than by batch, so
    // resuming mid-hotel keeps the address it was already using.
    const sessionId = sessionIdFor(`${propertyId}${competitor.id}`);

    if (index > from) await sleep(jitterDelay());

    try {
      rows.push(await fetchOne(competitor, stayDate, nights, guests, sessionId));
    } catch (err) {
      // One bad cell should not lose the rest of the sweep.
      failures.push({ competitor: competitor.name, date: stayDate, message: err.message });
      // A refusal or a stale parser applies to every remaining cell, so the
      // run stops rather than spending requests against an address Google has
      // just turned away. The cursor is cleared with it, so the client stops
      // asking for more instead of resuming into the same wall.
      if (err.code === "blocked" || err.code === "consent_wall" || err.code === "selectors_stale") {
        index = cells.length;
        stopped = true;
        break;
      }
    }
  }

  const attempted = index - from;

  let saved = 0;
  try {
    saved = await saveCompetitorRates(propertyId, rows);
  } catch (err) {
    console.error("Saving competitor rates failed:", err.message);
    return NextResponse.json({ error: "Could not save the rates we found." }, { status: 500 });
  }

  // Everything in this batch failing is a real failure -- usually a refusal
  // or a layout change -- and should not read as a refresh that found nothing.
  if (rows.length === 0 && attempted > 0 && failures.length === attempted) {
    return NextResponse.json(
      { error: `Could not reach the rate data service. ${failures[0]?.message || ""}`.trim() },
      { status: 502 }
    );
  }

  return NextResponse.json({
    saved,
    competitorsChecked: tracked.length,
    datesChecked: dates.length,
    from: dates[0],
    to: dates[dates.length - 1],
    failures,
    checkedAt: new Date().toISOString(),
    // Where the next batch resumes, or null when the sweep is finished.
    // `total` and `done` count cells, which is what the button shows progress
    // against.
    cursor: stopped ? null : cursorFrom(index, cells.length),
    done: index,
    total: cells.length,
  });
}
