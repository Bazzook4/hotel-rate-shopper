import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/serverSession";
import { isSuperAdmin } from "@/lib/permissions";
import { getSupabaseAdmin } from "@/lib/database";
import { inWindow, sendTemplate, sendText, templateWords, waPhone, whatsappReady } from "@/lib/whatsapp";
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

// Two approved templates and a typed message; the older kinds stay for history.
const TEMPLATE_KINDS = { setup_reminder: "setup_reminder_v2", no_bookings: "day3_checkin_v2" };
const KINDS = ["custom", ...Object.keys(TEMPLATE_KINDS), "questions", "setup", "first_booking", "quiet"];

async function guard(req) {
  const session = await getSessionFromRequest(req);
  return session && isSuperAdmin(session) ? session : null;
}

const firstName = (name) => (name ? String(name).trim().split(/\s+/)[0] : null);

async function loadHotel(db, propertyId) {
  const { data: p } = await db
    .from("properties")
    .select("id, name, contact_name, contact_phone, total_rooms, created_at")
    .eq("id", propertyId)
    .maybeSingle();
  return p;
}

/** The words of each approved template, filled in with this hotel's own numbers. */
async function templateFor(db, p, kind) {
  const { setup, since } = await hotelProgress(db, p);
  const name = firstName(p.contact_name) || p.name;
  const params = kind === "setup_reminder" ? [name, p.name, setup] : [name, p.name, since];
  const template = TEMPLATE_KINDS[kind];
  return { template, params, words: templateWords(template, params) };
}

/**
 * Sends a follow-up to the hotel's contact mobile on the business number.
 * A template always goes. A typed message goes only when they wrote to us in
 * the last 24 hours; otherwise WhatsApp would drop it, so it is refused with
 * a plain reason and nothing is swapped in. Returns the words that went out.
 */
async function sendToHotel(propertyId, kind, message, sentBy) {
  const fail = (text, status = 400) => Object.assign(new Error(text), { status });
  if (!whatsappReady()) throw fail("WhatsApp is not connected yet.", 503);
  const db = getSupabaseAdmin();
  const p = await loadHotel(db, propertyId);
  const phone = waPhone(p?.contact_phone);
  if (!phone) throw fail("This hotel has no contact mobile.");

  if (kind === "custom") {
    const { data: contact } = await db.from("wa_contacts").select("*").eq("phone", phone).maybeSingle();
    if (!inWindow(contact)) {
      throw fail("They have not written to you in the last 24 hours, so WhatsApp will not deliver a typed message. Send a template instead.");
    }
    await sendText(phone, message.slice(0, 4096), sentBy);
    return message;
  }
  const t = await templateFor(db, p, kind);
  await sendTemplate(phone, t.template, t.params, sentBy);
  return t.words;
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
  // ?preview=<hotel id>: the words each template would send to this hotel.
  const preview = new URL(req.url).searchParams.get("preview");
  if (preview) {
    const db = getSupabaseAdmin();
    const p = await loadHotel(db, preview);
    if (!p) return NextResponse.json({ error: "Hotel not found" }, { status: 404 });
    const out = {};
    for (const kind of Object.keys(TEMPLATE_KINDS)) out[kind] = (await templateFor(db, p, kind)).words;
    return NextResponse.json({ templates: out });
  }
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
  let message = String(body.message || "").trim();
  if (!body.property_id || !KINDS.includes(body.kind) || (!message && !TEMPLATE_KINDS[body.kind])) {
    return NextResponse.json({ error: "Hotel, message type and message are needed" }, { status: 400 });
  }

  // Sent from here: the message goes out on the business WhatsApp number and
  // is kept as a follow-up only once it has gone.
  let how = null;
  if (body.send) {
    try {
      message = await sendToHotel(body.property_id, body.kind, message, session.email || "admin");
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: err.status || 502 });
    }
    how = body.kind === "custom" ? "text" : "template";
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
