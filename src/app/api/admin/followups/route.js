import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/serverSession";
import { isSuperAdmin } from "@/lib/permissions";
import { getSupabaseAdmin } from "@/lib/database";

/**
 * Follow-up messages sent to hotels from Admin > Follow up (migration 062).
 *
 * GET              every follow-up, newest first, for the list's "last
 *                  followed up" column and each hotel's history
 * POST             { property_id, kind, message, activity } when a message
 *                  is opened in WhatsApp
 * PATCH            { id, note } what the hotel said back
 */

const KINDS = ["questions", "setup", "first_booking", "quiet"];

async function guard(req) {
  const session = await getSessionFromRequest(req);
  return session && isSuperAdmin(session) ? session : null;
}

function failure(error) {
  const missing = /follow_ups/.test(error.message || "") && /exist|schema cache/i.test(error.message || "");
  return NextResponse.json(
    { error: missing ? "Follow-ups are not switched on yet: run migration 062." : error.message, missing },
    { status: 500 }
  );
}

export async function GET(req) {
  if (!(await guard(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { data, error } = await getSupabaseAdmin()
    .from("follow_ups")
    .select("id, property_id, kind, message, activity, note, sent_by, sent_at")
    .order("sent_at", { ascending: false })
    .limit(2000);
  if (error) return failure(error);
  return NextResponse.json({ rows: data || [] });
}

export async function POST(req) {
  const session = await guard(req);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const message = String(body.message || "").trim();
  if (!body.property_id || !KINDS.includes(body.kind) || !message) {
    return NextResponse.json({ error: "Hotel, message type and message are needed" }, { status: 400 });
  }
  const { data, error } = await getSupabaseAdmin()
    .from("follow_ups")
    .insert({
      property_id: body.property_id,
      kind: body.kind,
      message: message.slice(0, 4000),
      activity: body.activity && typeof body.activity === "object" ? body.activity : null,
      sent_by: session.email || null,
    })
    .select("id, property_id, kind, message, activity, note, sent_by, sent_at")
    .single();
  if (error) return failure(error);
  return NextResponse.json({ row: data });
}

export async function PATCH(req) {
  if (!(await guard(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "Which follow-up?" }, { status: 400 });
  const note = String(body.note || "").trim().slice(0, 2000) || null;
  const { data, error } = await getSupabaseAdmin()
    .from("follow_ups")
    .update({ note })
    .eq("id", body.id)
    .select("id, property_id, kind, message, activity, note, sent_by, sent_at")
    .single();
  if (error) return failure(error);
  return NextResponse.json({ row: data });
}
