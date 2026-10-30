import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/serverSession";
import { isSuperAdmin } from "@/lib/permissions";
import { getUserPropertyId } from "@/lib/database";
import { moduleDeniedResponse } from "@/lib/propertyScope";

/** The pages that make and change bookings. */
export const BOOKING_PAGES = ["calendar", "reservations"];

/**
 * Those, plus the reports that open a booking: the finance reports to show
 * its folio, the police report to fill in its guests.
 */
export const BOOKING_VIEW_PAGES = [...BOOKING_PAGES, "nightaudit", "invoicing", "payments", "cashbook", "policereport"];

/**
 * Rooms, services and taxes are read by every page that books, bills or
 * cleans, so reading them needs any one of those pages, or a setup page.
 * Someone with nothing ticked reads nothing.
 */
export const SETUP_READ_PAGES = [
  ...BOOKING_VIEW_PAGES,
  "housekeeping",
  "guests",
  "companies",
  "cityledger",
  "bookingengine",
  "rates",
  "cm",
  "rooms",
  "rateplans",
  "servicesetup",
  "taxsetup",
];

/**
 * Who may make each kind of change to a booking. Seeing a booking from a
 * report is not the right to change it: each report may do only the one job
 * it exists for (Night Audit marks no-shows and takes what is owed, Payments
 * voids a payment, Invoicing issues and voids invoices, Police fills in
 * guests). Everything else needs a booking page.
 */
export const WRITE_PAGES = {
  booking: BOOKING_PAGES,
  status: [...BOOKING_PAGES, "nightaudit"],
  guest: [...BOOKING_PAGES, "policereport"],
  payment: [...BOOKING_PAGES, "nightaudit", "payments", "cashbook"],
  invoice: [...BOOKING_PAGES, "invoicing"],
};

/**
 * Session and property scoping for the PMS routes.
 *
 * Every PMS route repeats the same two questions -- is this a real session,
 * and which property may it act on -- so they live here rather than being
 * copied into each route. Unlike the Setup routes this does not require
 * `canManageSetup`: taking a booking is ordinary front-desk work, not
 * configuring the property, so a PropertyUser must be able to do it.
 */
export async function pmsGuard(req, pages) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  // A page switched off for a user must be closed here too, not only hidden.
  if (pages) {
    const denied = await moduleDeniedResponse(session, pages);
    if (denied) return { error: denied };
  }
  return { session };
}

/**
 * The property a request may act on.
 *
 * Only a super admin may name a property other than their own; anyone else
 * passing an id has it ignored rather than trusted. Returns null when there
 * is no property to act on, which the caller turns into a 400.
 */
export async function resolvePropertyId(session, requested) {
  const own =
    session.property_id ||
    (await getUserPropertyId(session.userId).catch(() => null));

  if (isSuperAdmin(session)) return requested || own;
  if (requested && requested !== own) return null;
  return own;
}
