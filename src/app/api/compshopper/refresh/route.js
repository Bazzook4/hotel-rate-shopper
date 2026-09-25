import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { listCompetitors, saveCompetitorRates } from "@/lib/database";
import { resolvePropertyId } from "@/lib/propertyScope";
import { cheapestQuote, MAX_COMPETITORS } from "@/lib/competitors";
import { addDays, formatDateISO, parseDateISO } from "@/lib/date";

/**
 * A refresh costs one call per competitor per night, so a month across six
 * competitors is ~180 calls -- far past any request timeout. The calendar
 * therefore shows a whole month from storage while a refresh fills one week
 * of it, and paging then refreshing walks the month across.
 */
const REFRESH_DAYS = 7;

/** One competitor on one night, priced at the cheapest channel selling it. */
async function fetchOne(apiKey, competitor, stayDate, nights, guests) {
  const checkOut = formatDateISO(addDays(parseDateISO(stayDate), nights));

  const serp = new URL("https://serpapi.com/search.json");
  serp.searchParams.set("engine", "google_hotels");
  // Google rejects a property_token sent without a q, so the name rides
  // along; the token is what actually pins the listing.
  serp.searchParams.set("q", competitor.name);
  serp.searchParams.set("property_token", competitor.property_token);
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

  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Rate shopping is not configured. Ask your administrator to add the rate data key." },
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

  const start = parseDateISO(body?.start) || new Date();
  const days = Math.min(Math.max(Number(body?.days) || REFRESH_DAYS, 1), REFRESH_DAYS);
  const nights = Math.min(Math.max(Number(body?.nights) || 1, 1), 30);
  const guests = Math.min(Math.max(Number(body?.guests) || 2, 1), 20);

  const dates = Array.from({ length: days }, (_, i) => formatDateISO(addDays(start, i)));
  const tracked = competitors.slice(0, MAX_COMPETITORS);

  const rows = [];
  const failures = [];

  // Sequential, like the parity refresh: the data service rate-limits
  // concurrent calls, and a burst fails the whole run rather than speeding
  // it up.
  for (const competitor of tracked) {
    for (const stayDate of dates) {
      try {
        rows.push(await fetchOne(apiKey, competitor, stayDate, nights, guests));
      } catch (err) {
        // One bad cell should not lose the rest of the sweep.
        failures.push({ competitor: competitor.name, date: stayDate, message: err.message });
      }
    }
  }

  let saved = 0;
  try {
    saved = await saveCompetitorRates(propertyId, rows);
  } catch (err) {
    console.error("Saving competitor rates failed:", err.message);
    return NextResponse.json({ error: "Could not save the rates we found." }, { status: 500 });
  }

  // Everything failing is a real failure -- usually a bad key or an exhausted
  // quota -- and should not read as a refresh that found nothing.
  if (rows.length === 0 && failures.length > 0) {
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
  });
}
