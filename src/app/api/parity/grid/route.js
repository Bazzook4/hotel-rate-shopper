import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import { getPropertyById, getUserPropertyId, listParityRates } from "@/lib/database";
import { parityStatus } from "@/lib/parity";
import { addDays, formatDateISO, parseDateISO } from "@/lib/date";

/**
 * The stored parity grid for a date window.
 *
 * Reads only -- never calls Google -- so opening the page is instant and
 * costs nothing. Refreshing is an explicit action on its own route.
 */
export async function GET(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);

  const requested = searchParams.get("propertyId");
  const own = session.property_id || (await getUserPropertyId(session.userId).catch(() => null));
  const propertyId = isSuperAdmin(session) ? requested || own : own;
  if (!propertyId || (!isSuperAdmin(session) && requested && requested !== own)) {
    return NextResponse.json({ error: "No property selected." }, { status: 403 });
  }

  const start = parseDateISO(searchParams.get("start")) || new Date();
  const days = Math.min(Math.max(Number(searchParams.get("days")) || 14, 1), 90);
  const nights = Math.min(Math.max(Number(searchParams.get("nights")) || 1, 1), 30);
  const guests = Math.min(Math.max(Number(searchParams.get("guests")) || 2, 1), 20);

  const startISO = formatDateISO(start);
  const endISO = formatDateISO(addDays(start, days - 1));

  const property = await getPropertyById(propertyId);
  if (!property) {
    return NextResponse.json({ error: "Property not found." }, { status: 404 });
  }

  // Every date in the window, so the grid draws its columns even where no
  // channel reported anything.
  const dates = Array.from({ length: days }, (_, i) => formatDateISO(addDays(start, i)));

  let rows;
  try {
    rows = await listParityRates(propertyId, startISO, endISO, { nights, guests });
  } catch (err) {
    // A database message means nothing to a hotelier, so it is logged and the
    // page is told, in its own terms, that there is nothing to show.
    console.error("Parity grid read failed:", err.message);
    return NextResponse.json(
      { error: "Could not load stored rates. Please try again, or contact support if it persists." },
      { status: 500 }
    );
  }

  // Group into one row per channel, with a cell per date.
  const channels = new Map();
  for (const row of rows) {
    if (!channels.has(row.channel_key)) {
      channels.set(row.channel_key, {
        key: row.channel_key,
        name: row.channel,
        logo: row.channel_logo,
        cells: {},
      });
    }
    const channel = channels.get(row.channel_key);
    // The friendliest spelling Google gave us wins the label.
    if (row.channel_logo && !channel.logo) channel.logo = row.channel_logo;
    channel.cells[row.stay_date] = {
      rate: row.rate == null ? null : Number(row.rate),
      currency: row.currency,
      includesTax: row.includes_tax,
      soldOut: row.sold_out,
      link: row.link,
    };
  }

  // The benchmark for each night is the cheapest channel selling it, since
  // there is no direct rate to compare against.
  const lowestByDate = {};
  for (const date of dates) {
    let lowest = null;
    for (const channel of channels.values()) {
      const rate = channel.cells[date]?.rate;
      if (rate != null && (lowest == null || rate < lowest)) lowest = rate;
    }
    lowestByDate[date] = lowest;
  }

  // Status is derived here rather than in the browser so the CSV export and
  // the grid cannot disagree about what counts as a breach.
  for (const channel of channels.values()) {
    for (const date of dates) {
      const cell = channel.cells[date];
      if (!cell) continue;
      cell.status = parityStatus(cell.rate, lowestByDate[date]);
      cell.isLowest = cell.rate != null && cell.rate === lowestByDate[date];
    }
  }

  const checkedAt = rows.reduce(
    (latest, r) => (!latest || r.checked_at > latest ? r.checked_at : latest),
    null
  );

  return NextResponse.json({
    propertyId,
    propertyName: property.name,
    configured: Boolean(property.google_place_query),
    googleBusinessUrl: property.google_business_url || null,
    start: startISO,
    end: endISO,
    days,
    nights,
    guests,
    dates,
    lowestByDate,
    channels: [...channels.values()].sort((a, b) => a.name.localeCompare(b.name)),
    checkedAt,
  });
}
