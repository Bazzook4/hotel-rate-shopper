import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import { getAvailabilityGrid, listReservations } from "@/lib/database";

/**
 * Availability per room type per date, plus the stays overlapping the window.
 *
 * No screen calls this today -- the Calendar page is the tape chart, which
 * reads /api/pms/tape and shows actual rooms rather than counts. This is kept
 * because occupancy per date is what pricing wants to reason about, and it is
 * the one place that already computes it; it is not a leftover of the tape
 * chart replacing the counts view.
 */

/** Guard against a window so wide it would pull the whole booking history. */
const MAX_DAYS = 120;

function dayAfter(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

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
      { error: "Give a start and end date for the calendar." },
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
      { error: `The calendar shows at most ${MAX_DAYS} days at a time.` },
      { status: 400 }
    );
  }

  try {
    const [grid, reservations] = await Promise.all([
      getAvailabilityGrid(propertyId, start, end),
      // The calendar window includes its last day, but the overlap filter
      // treats `to` as exclusive, so it is pushed out a day -- otherwise a
      // guest arriving on the final column would be missing from it.
      listReservations(propertyId, { from: start, to: dayAfter(end) }),
    ]);

    return NextResponse.json({ ...grid, reservations });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
