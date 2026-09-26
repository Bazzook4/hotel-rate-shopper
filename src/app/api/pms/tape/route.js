import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import { getTapeChart, getTapeRates, listPropertyExtras } from "@/lib/database";

/**
 * The tape chart: rooms down the side, dates across, stays as bars.
 *
 * The property's extras list rides along because the booking modal opens
 * straight from a bar on this chart, and fetching the menu only once the
 * modal is open would leave its Inclusions tab briefly empty. The two-adult
 * rate per type and night rides along too, for the fine print on the chart.
 */

const MAX_DAYS = 60;

function daysBetween(start, end) {
  return Math.round(
    (new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000
  );
}

export async function GET(req) {
  const { error, session } = await pmsGuard(req);
  if (error) return error;

  const params = req.nextUrl.searchParams;
  const propertyId = await resolvePropertyId(session, params.get("propertyId"));
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }

  const start = params.get("start");
  const end = params.get("end");
  if (!start || !end) {
    return NextResponse.json(
      { error: "Give a start and end date for the chart." },
      { status: 400 }
    );
  }

  const span = daysBetween(start, end);
  if (span < 0) {
    return NextResponse.json(
      { error: "The end date is before the start date." },
      { status: 400 }
    );
  }
  if (span > MAX_DAYS) {
    return NextResponse.json(
      { error: `The chart shows at most ${MAX_DAYS} days at a time.` },
      { status: 400 }
    );
  }

  try {
    const [chart, extras, rates] = await Promise.all([
      getTapeChart(propertyId, start, end),
      listPropertyExtras(propertyId),
      // A rate that fails to price leaves the fine print blank; it must not
      // take the chart down with it.
      getTapeRates(propertyId, start, end).catch(() => ({})),
    ]);
    return NextResponse.json({ ...chart, extras, rates });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
