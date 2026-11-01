import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/serverSession";
import { isSuperAdmin } from "@/lib/permissions";
import { getSupabaseAdmin } from "@/lib/database";

/**
 * WhatsApp plans from Admin > Usage (migration 070): a hotel gets the daily
 * report or a reminder each morning for a set number of days.
 *
 * GET     every hotel's latest plan, live or ended
 * POST    { property_ids, kind, days } starts a plan for each hotel, ending
 *         any live one it had
 * DELETE  { property_ids } ends their live plans
 */

const KINDS = ["daily_report", "reminder"];
const FIELDS = "id, property_id, kind, days, sent, last_sent_on, last_error, fails, stopped_at, stop_reason, created_by, created_at";

async function guard(req) {
  const session = await getSessionFromRequest(req);
  return session && isSuperAdmin(session) ? session : null;
}

function failure(error) {
  const missing = /wa_schedules/.test(error.message || "") && /exist|schema cache/i.test(error.message || "");
  return NextResponse.json(
    { error: missing ? "WhatsApp plans are not switched on yet: run migration 070." : error.message, missing },
    { status: 500 }
  );
}

const idsOf = (body) =>
  Array.isArray(body.property_ids) ? [...new Set(body.property_ids.filter((id) => typeof id === "string"))].slice(0, 500) : [];

async function stop(db, ids, reason) {
  return db
    .from("wa_schedules")
    .update({ stopped_at: new Date().toISOString(), stop_reason: reason })
    .in("property_id", ids)
    .is("stopped_at", null);
}

export async function GET(req) {
  if (!(await guard(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { data, error } = await getSupabaseAdmin()
    .from("wa_schedules")
    .select(FIELDS)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) return failure(error);
  const latest = new Map();
  for (const r of data || []) if (!latest.has(r.property_id)) latest.set(r.property_id, r);
  return NextResponse.json({ rows: [...latest.values()] });
}

export async function POST(req) {
  const session = await guard(req);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const ids = idsOf(body);
  const days = parseInt(body.days, 10);
  if (!ids.length || !KINDS.includes(body.kind) || !(days >= 1 && days <= 90)) {
    return NextResponse.json({ error: "Pick hotels, what to send and 1 to 90 days" }, { status: 400 });
  }
  const db = getSupabaseAdmin();
  const { error: stopError } = await stop(db, ids, "Replaced by a new plan");
  if (stopError) return failure(stopError);
  const { data, error } = await db
    .from("wa_schedules")
    .insert(ids.map((property_id) => ({ property_id, kind: body.kind, days, created_by: session.email || null })))
    .select(FIELDS);
  if (error) return failure(error);
  return NextResponse.json({ rows: data || [] });
}

export async function DELETE(req) {
  if (!(await guard(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const ids = idsOf(await req.json().catch(() => ({})));
  if (!ids.length) return NextResponse.json({ error: "Which hotels?" }, { status: 400 });
  const db = getSupabaseAdmin();
  const { error } = await stop(db, ids, "Stopped by hand");
  if (error) return failure(error);
  const { data, error: readError } = await db.from("wa_schedules").select(FIELDS).in("property_id", ids).order("created_at", { ascending: false });
  if (readError) return failure(readError);
  const latest = new Map();
  for (const r of data || []) if (!latest.has(r.property_id)) latest.set(r.property_id, r);
  return NextResponse.json({ rows: [...latest.values()] });
}
