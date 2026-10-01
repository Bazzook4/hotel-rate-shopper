import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import { COMPARISONS, getBookingPerformance } from "@/lib/reports";

/**
 * Booking performance for a period: headline figures against a comparison
 * period (the same dates last year unless another is asked for), the mix by
 * channel, source, room type, rate plan and market, a daily trend by
 * channel, and seasonality by weekday and month.
 *
 * Reading the property's own reservations is ordinary front-office work, so
 * this takes the PMS guard rather than the setup permission.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Long enough for a year against the year before; past that the page would be
// reading tens of thousands of nights to draw a chart nobody can read.
const MAX_DAYS = 400;

export async function GET(req) {
  const { error, session } = await pmsGuard(req, ["performance"]);
  if (error) return error;

  const params = req.nextUrl.searchParams;
  const propertyId = await resolvePropertyId(session, params.get("propertyId"));
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }

  const start = params.get("start");
  const end = params.get("end");
  const basis = params.get("basis") === "booked" ? "booked" : "stay";

  if (!ISO.test(start || "") || !ISO.test(end || "")) {
    return NextResponse.json({ error: "Choose a start and end date" }, { status: 400 });
  }
  if (end < start) {
    return NextResponse.json({ error: "The end date is before the start date" }, { status: 400 });
  }
  const days = (new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000 + 1;
  if (days > MAX_DAYS) {
    return NextResponse.json(
      { error: `Choose a period of at most ${MAX_DAYS} days` },
      { status: 400 }
    );
  }

  const compare = COMPARISONS.includes(params.get("compare")) ? params.get("compare") : "yoy";
  const compareStart = params.get("compareStart");
  const compareEnd = params.get("compareEnd");
  if (compare === "custom") {
    if (!ISO.test(compareStart || "") || !ISO.test(compareEnd || "")) {
      return NextResponse.json({ error: "Choose the dates to compare with" }, { status: 400 });
    }
    if (compareEnd < compareStart) {
      return NextResponse.json(
        { error: "The comparison ends before it starts" },
        { status: 400 }
      );
    }
    const compareDays =
      (new Date(`${compareEnd}T00:00:00Z`) - new Date(`${compareStart}T00:00:00Z`)) / 86400000 + 1;
    if (compareDays > MAX_DAYS) {
      return NextResponse.json(
        { error: `Choose a comparison of at most ${MAX_DAYS} days` },
        { status: 400 }
      );
    }
  }

  try {
    return NextResponse.json(
      await getBookingPerformance(propertyId, {
        start,
        end,
        basis,
        compare,
        compareStart,
        compareEnd,
      })
    );
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
