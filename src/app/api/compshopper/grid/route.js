import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { getPropertyById, listCompetitors, listCompetitorRates, listParityRates } from "@/lib/database";
import { resolvePropertyId } from "@/lib/propertyScope";
import { medianOf } from "@/lib/competitors";
import { addDays, formatDateISO, parseDateISO } from "@/lib/date";

/**
 * The competitor calendar for one month.
 *
 * Reads only -- refreshing is a separate action -- so opening the page is
 * instant and costs nothing, and a month that was filled a week at a time
 * shows as one whole month here.
 */
export async function GET(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const propertyId = await resolvePropertyId(session, searchParams.get("propertyId"));
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected." }, { status: 403 });
  }

  const nights = Math.min(Math.max(Number(searchParams.get("nights")) || 1, 1), 30);
  const guests = Math.min(Math.max(Number(searchParams.get("guests")) || 2, 1), 20);

  // The month is named by any date inside it, so the caller can page with a
  // single date rather than tracking month boundaries itself.
  const anchor = parseDateISO(searchParams.get("month")) || new Date();
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const startISO = formatDateISO(first);
  const endISO = formatDateISO(last);

  const property = await getPropertyById(propertyId);
  if (!property) {
    return NextResponse.json({ error: "Property not found." }, { status: 404 });
  }

  const dates = Array.from({ length: last.getDate() }, (_, i) => formatDateISO(addDays(first, i)));

  let competitors = [];
  let rateRows = [];
  let ownRows = [];
  try {
    competitors = await listCompetitors(propertyId);
    // The property's own rate comes from whatever Rate Parity has already
    // scraped, so the two pages agree and this one costs no extra calls.
    [rateRows, ownRows] = await Promise.all([
      listCompetitorRates(propertyId, startISO, endISO, { nights, guests }),
      listParityRates(propertyId, startISO, endISO, { nights, guests }).catch(() => []),
    ]);
  } catch (err) {
    console.error("Competitor grid read failed:", err.message);
    return NextResponse.json(
      { error: "Could not load stored rates. Please try again, or contact support if it persists." },
      { status: 500 }
    );
  }

  // One row per competitor, a cell per date.
  const byCompetitor = new Map(
    competitors.map((c) => [c.id, { id: c.id, name: c.name, address: c.address, stars: c.hotel_class, cells: {} }])
  );
  for (const row of rateRows) {
    const entry = byCompetitor.get(row.competitor_id);
    if (!entry) continue;
    entry.cells[row.stay_date] = {
      rate: row.rate == null ? null : Number(row.rate),
      currency: row.currency,
      channel: row.channel,
      link: row.link,
      soldOut: row.sold_out,
    };
  }

  // Our own cheapest rate per night, from the parity scrape.
  const ownByDate = {};
  for (const row of ownRows) {
    if (row.rate == null) continue;
    const rate = Number(row.rate);
    if (ownByDate[row.stay_date] == null || rate < ownByDate[row.stay_date]) {
      ownByDate[row.stay_date] = rate;
    }
  }

  // The benchmark is the median competitor rate: one rival running a fire
  // sale should not drag it down and make an ordinary rate look expensive.
  const medianByDate = {};
  const diffByDate = {};
  for (const date of dates) {
    const rates = [];
    for (const entry of byCompetitor.values()) {
      const rate = entry.cells[date]?.rate;
      if (rate != null) rates.push(rate);
    }
    const median = medianOf(rates);
    medianByDate[date] = median;

    const own = ownByDate[date];
    diffByDate[date] =
      own != null && median != null && median > 0
        ? ((own - median) / median) * 100
        : null;
  }

  const checkedAt = rateRows.reduce(
    (latest, r) => (!latest || r.checked_at > latest ? r.checked_at : latest),
    null
  );

  return NextResponse.json({
    propertyId,
    propertyName: property.name,
    configured: Boolean(property.google_place_query),
    hasCompetitors: competitors.length > 0,
    month: startISO,
    start: startISO,
    end: endISO,
    dates,
    competitors: [...byCompetitor.values()],
    ownByDate,
    medianByDate,
    diffByDate,
    nights,
    guests,
    checkedAt,
  });
}
