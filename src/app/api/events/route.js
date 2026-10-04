import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import { canManageSetup } from "@/lib/database";
import { isSuperAdmin } from "@/lib/permissions";
import { addDays, formatDateISO } from "@/lib/date";
import {
  deleteEvent,
  eventsForProperty,
  getEvent,
  getPropertyProfile,
  listPublicEvents,
  saveEvent,
  validateEvent,
} from "@/lib/events";

/**
 * Events: the calendar a hotel sees, and the shared catalogue behind it.
 *
 * GET returns this hotel's events -- its own private ones and every public
 * one its profile matches. A super admin asking for `view=public` gets the
 * whole public catalogue instead, whichever hotels it reaches.
 *
 * Who may change what:
 *   private events   anyone who may change this hotel's setup
 *   public events    super admins only, since one public event moves the
 *                    prices of every hotel it matches
 */

const PAGE = "events";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The window asked for, or today and the year after it. */
function windowOf(params) {
  const start = DATE_RE.test(params.get("start") || "") ? params.get("start") : formatDateISO(new Date());
  const end = DATE_RE.test(params.get("end") || "")
    ? params.get("end")
    : formatDateISO(addDays(start, 365));
  return { start, end: end < start ? start : end };
}

export async function GET(req) {
  const { error, session } = await pmsGuard(req, PAGE);
  if (error) return error;

  const params = req.nextUrl.searchParams;
  const propertyId = await resolvePropertyId(session, params.get("propertyId"));
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });

  const { start, end } = windowOf(params);
  const superAdmin = isSuperAdmin(session);

  try {
    const profile = await getPropertyProfile(propertyId);
    const events =
      superAdmin && params.get("view") === "public"
        ? await listPublicEvents(start, end)
        : await eventsForProperty(propertyId, start, end, profile);
    return NextResponse.json({
      start,
      end,
      profile,
      events,
      canEdit: superAdmin || (await canManageSetup(session.userId)),
      canPublish: superAdmin,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * Whether this session may change an event of this scope for this hotel. An
 * existing event is judged by what it is now, so a hotel cannot edit a public
 * event by sending it back marked private.
 */
async function mayChange(session, propertyId, existing, scope) {
  if (isSuperAdmin(session)) return null;
  if (scope === "public" || (existing && !existing.property_id)) {
    return "Only the Online Hotelier team can change events shared with every hotel.";
  }
  if (existing && existing.property_id !== propertyId) return "That event belongs to another hotel.";
  if (!(await canManageSetup(session.userId))) return "You do not have permission to change events.";
  return null;
}

async function write(req, method) {
  const { error, session } = await pmsGuard(req, PAGE);
  if (error) return error;

  const body = await req.json().catch(() => null);
  if (!body?.event) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const propertyId = await resolvePropertyId(session, body.propertyId);
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });

  const existing = method === "PUT" ? await getEvent(body.event.id) : null;
  if (method === "PUT" && !existing) {
    return NextResponse.json({ error: "That event no longer exists." }, { status: 404 });
  }

  const scope = body.event.scope === "public" ? "public" : "private";
  const denied = await mayChange(session, propertyId, existing, scope);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  // An edited private event stays with the hotel it was made for, even when a
  // super admin edits it from another hotel's page.
  const owner = existing?.property_id || propertyId;
  const { row, error: invalid } = validateEvent(body.event, { scope, propertyId: owner });
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  try {
    const event = await saveEvent(existing?.id || null, row, session.userId);
    return NextResponse.json({ event });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export const POST = (req) => write(req, "POST");
export const PUT = (req) => write(req, "PUT");

export async function DELETE(req) {
  const { error, session } = await pmsGuard(req, PAGE);
  if (error) return error;

  const params = req.nextUrl.searchParams;
  const propertyId = await resolvePropertyId(session, params.get("propertyId"));
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });

  const existing = await getEvent(params.get("id"));
  if (!existing) return NextResponse.json({ error: "That event no longer exists." }, { status: 404 });

  const denied = await mayChange(session, propertyId, existing, existing.property_id ? "private" : "public");
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  try {
    await deleteEvent(existing.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
