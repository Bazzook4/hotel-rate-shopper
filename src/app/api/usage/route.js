import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/serverSession";
import { getSupabaseAdmin } from "@/lib/database";
import { resolvePropertyId } from "@/lib/propertyScope";
import { MODULES } from "@/app/dashboard/modules";

/**
 * Count one page open: page, role and job profile only -- never who (see
 * migration 042). Or a batch of what was done on pages (`events`, from
 * lib/track.js; migration 061), as anonymous. Best effort: until the table exists, or if the insert
 * fails, it answers 204 all the same, since a page view must never fail
 * because it could not be counted.
 */

const PAGES = new Set(MODULES.map((m) => m.id));
const PROFILES = new Set(["owner", "desk", "housekeeping", "other"]);
const KINDS = new Set([
  "visit", "click", "guide", "tour", "tour_done", "tour_quit", "palette", "palette_go",
]);
const MAX_EVENTS = 50;
// A day; a longer visit is a tab left open, not a day's reading.
const MAX_SECONDS = 24 * 60 * 60;

const whole = (n, max) =>
  Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n))) : null;

async function saveEvents(session, events) {
  const propertyIds = new Map();
  const rows = [];
  for (const e of events.slice(0, MAX_EVENTS)) {
    if (!KINDS.has(e?.kind)) continue;
    const asked = typeof e.propertyId === "string" ? e.propertyId : "";
    if (!propertyIds.has(asked)) propertyIds.set(asked, await resolvePropertyId(session, asked || undefined));
    rows.push({
      property_id: propertyIds.get(asked) || null,
      page_id: PAGES.has(e.page) ? e.page : null,
      role: session.role || null,
      profile: PROFILES.has(e.profile) ? e.profile : "other",
      kind: e.kind,
      target: typeof e.target === "string" ? e.target.slice(0, 60) : null,
      value: whole(e.value, MAX_SECONDS),
      clicks: whole(e.clicks, 10000),
    });
  }
  if (rows.length) await getSupabaseAdmin().from("usage_events").insert(rows);
}

export async function POST(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) return new NextResponse(null, { status: 204 });

  let body;
  try {
    body = await req.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  if (Array.isArray(body?.events)) {
    try {
      await saveEvents(session, body.events);
    } catch {
      // Not counted; nothing else changes.
    }
    return new NextResponse(null, { status: 204 });
  }
  if (!PAGES.has(body?.page)) return new NextResponse(null, { status: 204 });

  try {
    const propertyId = await resolvePropertyId(session, body?.propertyId);
    await getSupabaseAdmin()
      .from("page_opens")
      .insert({
        property_id: propertyId || null,
        page_id: body.page,
        role: session.role || null,
        profile: PROFILES.has(body?.profile) ? body.profile : "other",
      });
  } catch {
    // Not counted; nothing else changes.
  }
  return new NextResponse(null, { status: 204 });
}
