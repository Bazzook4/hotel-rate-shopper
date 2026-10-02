import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { canManageSetup } from "@/lib/permissions";
import { resolvePropertyId, sessionRights } from "@/lib/propertyScope";
import { BOOKING_VIEW_PAGES } from "@/lib/pmsGuard";
import { getNightAudit, localToday, normaliseTz } from "@/lib/financeReports";
import { getBookingPerformance } from "@/lib/reports";
import {
  getPropertyById,
  getPropertyIntegration,
  listPropertyTaxes,
  listRatePlanRooms,
  listRatePlans,
  listRooms,
  listRoomTypes,
  listSyncLogs,
} from "@/lib/database";

/**
 * The home page: how today looks, how the month is going, what needs doing,
 * and -- until it is done -- what is left to set up.
 *
 * Each part summarises another page and is only sent to someone who holds
 * that page, so the home page never shows what the page itself would refuse.
 * A part that fails is left out with its error rather than failing the rest:
 * a slow channel log should not hide today's arrivals.
 */

const DAY_MS = 86400000;
const DISTRIBUTION_PAGES = ["cm", "integrations", "logs"];
// Room movement belongs to anyone who works the desk or the floor.
const MOVEMENT_PAGES = [...BOOKING_VIEW_PAGES, "housekeeping"];

function shiftIso(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Runs a part, turning a failure into a message on that part alone. */
async function part(build) {
  try {
    return await build();
  } catch (err) {
    return { error: err.message || "Could not load this part" };
  }
}

/** Tonight, against the same night a week ago: the weekday is what makes nights alike. */
async function todayPart(propertyId, today, tz, { money, exceptions }) {
  const lastWeek = shiftIso(today, -7);
  const [now, then] = await Promise.all([
    getNightAudit(propertyId, { date: today, tz }),
    getNightAudit(propertyId, { date: lastWeek, tz }),
  ]);
  const roomsOf = (a) => ({
    occupancy: a.rooms.occupancy,
    occupied: a.rooms.occupied,
    available: a.rooms.available,
    adr: money ? a.rooms.adr : undefined,
    revpar: money ? a.rooms.revpar : undefined,
    roomRevenue: money ? a.revenue.room : undefined,
  });
  return {
    date: today,
    compareDate: lastWeek,
    currency: now.currency,
    current: roomsOf(now),
    previous: roomsOf(then),
    movement: now.movement,
    housekeeping: now.housekeeping,
    // Voided payments and invoices are for the auditor, not today's to-do list.
    exceptions: exceptions ? now.exceptions.filter((e) => e.tone !== "info") : [],
  };
}

/** The month so far against the same days last year, as Booking Performance has it. */
async function monthPart(propertyId, today) {
  const start = `${today.slice(0, 8)}01`;
  const report = await getBookingPerformance(propertyId, { start, end: today, compare: "yoy" });
  const pick = (k) => ({
    roomRevenue: k.roomRevenue,
    occupancy: k.occupancy,
    adr: k.adr,
    revpar: k.revpar,
    reservations: k.reservations,
  });
  return {
    start,
    end: today,
    previous: report.previous,
    currency: report.currency,
    kpis: { current: pick(report.kpis.current), previous: pick(report.kpis.previous) },
  };
}

/**
 * What is wrong between the hotel and its channels: the latest attempt of
 * each kind failing, and rooms the channel manager has no code for. A
 * failure since put right by a later success is history, not a problem.
 */
async function distributionPart(propertyId) {
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const [{ rows }, found, roomTypes] = await Promise.all([
    listSyncLogs(propertyId, { from: since, limit: 200 }),
    getPropertyIntegration(propertyId, "aiosell").catch(() => null),
    listRoomTypes(propertyId),
  ]);

  const latest = new Map();
  for (const row of rows) if (!latest.has(row.kind)) latest.set(row.kind, row);
  const failures = [...latest.values()]
    .filter((r) => r.status === "failed")
    .map((r) => ({ kind: r.kind, at: r.created_at, error: r.error || r.summary || null }));

  const integration = found?.integration;
  const mapped = new Set(
    (found?.codeMap || []).filter((m) => m.room_type_id && m.partner_room_code).map((m) => m.room_type_id)
  );
  const unmapped =
    integration?.enabled && integration?.hotel_code
      ? roomTypes.filter((t) => !mapped.has(t.id)).map((t) => t.room_type_name)
      : [];

  return { failures, unmapped };
}

/** The setup steps a new property works through, in the order they depend on each other. */
async function setupPart(propertyId) {
  const [property, roomTypes, rooms, plans, planRooms, taxes, found] = await Promise.all([
    getPropertyById(propertyId),
    listRoomTypes(propertyId),
    listRooms(propertyId, { includeInactive: false }),
    listRatePlans(propertyId),
    listRatePlanRooms(propertyId),
    listPropertyTaxes(propertyId),
    getPropertyIntegration(propertyId, "aiosell").catch(() => null),
  ]);
  const integration = found?.integration;
  const steps = [
    {
      id: "roomTypes",
      page: "rooms",
      label: "Add your room types",
      hint: "Deluxe, Suite and so on, with how many of each you have.",
      done: roomTypes.length > 0,
    },
    {
      id: "rooms",
      page: "pmssetup",
      label: "Number your rooms",
      hint: "The physical rooms, so bookings can be put in one.",
      done: rooms.length > 0,
    },
    {
      id: "ratePlans",
      page: "rateplans",
      label: "Create a rate plan",
      hint: "What you charge: room only, with breakfast, and so on.",
      done: plans.length > 0,
    },
    {
      id: "planRooms",
      page: "rateplans",
      label: "Choose which rooms each plan is sold in",
      hint: "A plan with no rooms has nothing to sell.",
      done: planRooms.length > 0,
    },
    {
      id: "taxes",
      page: "taxsetup",
      label: "Set up taxes",
      hint: "So invoices charge the right tax. Indian GST can be added in one click.",
      done: taxes.length > 0,
    },
    {
      id: "channel",
      page: "integrations",
      label: "Connect your channel manager",
      hint: "Enter your hotel code and switch it on, so rates and availability reach the OTAs.",
      done: Boolean(integration?.enabled && integration?.hotel_code),
    },
    {
      id: "google",
      page: "setup",
      label: "Link your Google listing",
      hint: "Rate Parity and Competitor Shopper find your hotel through it.",
      done: Boolean(property?.google_place_query),
    },
  ];
  return { steps, done: steps.filter((s) => s.done).length, total: steps.length };
}

export async function GET(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  const propertyId = await resolvePropertyId(session, params.get("propertyId"));
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }

  const { user, rights } = await sessionRights(session);
  const holds = (pages) => pages.some((p) => rights.includes(p));
  const tz = normaliseTz(params.get("tz"));
  const today = localToday(tz);

  const [todayData, month, distribution, setup] = await Promise.all([
    holds(MOVEMENT_PAGES)
      ? part(() =>
          todayPart(propertyId, today, tz, {
            money: holds(["nightaudit"]),
            exceptions: holds(BOOKING_VIEW_PAGES),
          })
        )
      : null,
    holds(["performance"]) ? part(() => monthPart(propertyId, today)) : null,
    holds(DISTRIBUTION_PAGES) ? part(() => distributionPart(propertyId)) : null,
    user && canManageSetup(user) ? part(() => setupPart(propertyId)) : null,
  ]);

  return NextResponse.json({ today: todayData, month, distribution, setup });
}
