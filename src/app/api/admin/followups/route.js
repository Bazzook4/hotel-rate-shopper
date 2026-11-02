import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/serverSession";
import { isSuperAdmin } from "@/lib/permissions";
import { getSupabaseAdmin } from "@/lib/database";
import { inWindow, sendTemplate, sendText, waPhone, whatsappReady } from "@/lib/whatsapp";
import { hotelProgress } from "@/lib/whatsappReminders";

/**
 * Follow-up messages sent to hotels from Admin > Follow up (migration 062).
 *
 * GET              every follow-up, newest first, for the list's "last
 *                  followed up" column and each hotel's history
 * POST             { property_id, kind, message, activity } when a message
 *                  is opened in WhatsApp; with send: true it is sent on the
 *                  business number first (see sendToHotel)
 * PATCH            { id, note } what the hotel said back
 */

const KINDS = ["questions", "setup", "first_booking", "quiet"];

async function guard(req) {
  const session = await getSessionFromRequest(req);
  return session && isSuperAdmin(session) ? session : null;
}

const firstName = (name) => (name ? String(name).trim().split(/\s+/)[0] : null);

/**
 * Sends a follow-up to the hotel's contact mobile. The written message goes
 * as it is when they wrote to us in the last 24 hours; otherwise WhatsApp
 * only allows an approved template, so the one that fits the hotel goes
 * instead (setup_reminder_v2 while rooms are not set up, else day3_checkin_v2).
 * Returns "text" or "template".
 */
async function sendToHotel(propertyId, kind, message, sentBy) {
  const fail = (text, status = 400) => Object.assign(new Error(text), { status });
  if (!whatsappReady()) throw fail("WhatsApp is not connected yet.", 503);
  const db = getSupabaseAdmin();
  const { data: p } = await db
    .from("properties")
    .select("id, name, contact_name, contact_phone, total_rooms, created_at")
    .eq("id", propertyId)
    .maybeSingle();
  const phone = waPhone(p?.contact_phone);
  if (!phone) throw fail("This hotel has no contact mobile.");

  const { data: contact } = await db.from("wa_contacts").select("*").eq("phone", phone).maybeSingle();
  if (inWindow(contact)) {
    await sendText(phone, message.slice(0, 4096), sentBy);
    return "text";
  }

  const { done, setup, since } = await hotelProgress(db, p);
  const name = firstName(p.contact_name) || p.name;
  if (kind === "setup" || done < 100) await sendTemplate(phone, "setup_reminder_v2", [name, p.name, setup], sentBy);
  else await sendTemplate(phone, "day3_checkin_v2", [name, p.name, since], sentBy);
  return "template";
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

  // Sent from here: the message goes out on the business WhatsApp number and
  // is kept as a follow-up only once it has gone.
  let how = null;
  if (body.send) {
    try {
      how = await sendToHotel(body.property_id, body.kind, message, session.email || "admin");
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: err.status || 502 });
    }
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
  return NextResponse.json({ row: data, how });
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
