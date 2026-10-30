import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/serverSession";
import { isSuperAdmin } from "@/lib/permissions";
import { getSupabaseAdmin } from "@/lib/database";
import { TEMPLATES, inWindow, sendTemplate, sendText, waPhone, whatsappReady } from "@/lib/whatsapp";
import { aiReady } from "@/lib/aiAgent";
import { MEDIA_TYPES } from "@/lib/whatsappMedia";

/**
 * Admin > WhatsApp: the business number's inbox (migration 064).
 *
 * GET               every contact, newest chat first, with unread count,
 *                   last message and open lead; plus hotels to link to
 * GET ?phone=       that chat's messages, and marks it read; each reaction
 *                   rides on the message it is for, and a photo or file
 *                   comes as `media`, opened through ./media
 * POST              { phone, text } a reply, only within 24 hours of their
 *                   last message; { phone, template, params } at any time;
 *                   { add_property_id } adds a hotel's contact mobile
 *                   A reply by hand clears the AI's call for SJ (handoff_at).
 * PATCH             { phone, bot_paused | opted_in | property_id } a contact;
 *                   turning the bot back on clears handoff_at too
 *                   { lead_id, status | hotel_name | city | rooms | interest } a lead
 */

const LEAD_STATUSES = ["new", "contacted", "won", "lost"];

/** A chat's messages as the inbox shows them: reactions folded onto their message, media named. */
function thread(rows) {
  const reacted = new Map();
  for (const m of rows) {
    if (m.type !== "reaction") continue;
    const r = m.payload?.reaction;
    // The latest one stands; an empty emoji takes the reaction away.
    if (r?.message_id) reacted.set(r.message_id, r.emoji || null);
  }
  return rows
    .filter((m) => m.type !== "reaction")
    .map(({ payload, wa_message_id, ...m }) => {
      const media = MEDIA_TYPES.includes(m.type) ? payload?.[m.type] : null;
      return {
        ...m,
        reaction: (wa_message_id && reacted.get(wa_message_id)) || null,
        media: media
          ? { kind: m.type, name: media.filename || payload?.stored?.name || null, caption: media.caption || null }
          : null,
        location:
          m.type === "location" && payload?.location
            ? `https://www.google.com/maps?q=${payload.location.latitude},${payload.location.longitude}`
            : null,
      };
    });
}

async function guard(req) {
  const session = await getSessionFromRequest(req);
  return session && isSuperAdmin(session) ? session : null;
}

function failure(error) {
  const missing = /wa_(contacts|messages|leads)/.test(error.message || "") && /exist|schema cache/i.test(error.message || "");
  return NextResponse.json(
    { error: missing ? "WhatsApp is not switched on yet: run migration 064." : error.message, missing },
    { status: 500 }
  );
}

export async function GET(req) {
  if (!(await guard(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const db = getSupabaseAdmin();
  const phone = req.nextUrl.searchParams.get("phone");

  if (phone) {
    const { data, error } = await db
      .from("wa_messages")
      .select("id, wa_message_id, direction, type, body, payload, status, error, sent_by, created_at")
      .eq("phone", phone)
      .order("created_at", { ascending: false })
      .limit(400);
    if (error) return failure(error);
    await db.from("wa_contacts").update({ seen_at: new Date().toISOString() }).eq("phone", phone);
    return NextResponse.json({ messages: thread((data || []).reverse()) });
  }

  const [contacts, recent, leads, hotels] = await Promise.all([
    db.from("wa_contacts").select("*").order("last_message_at", { ascending: false, nullsFirst: false }).limit(500),
    db
      .from("wa_messages")
      .select("phone, direction, body, created_at")
      .neq("type", "reaction")
      .order("created_at", { ascending: false })
      .limit(3000),
    db.from("wa_leads").select("*").order("created_at", { ascending: false }).limit(2000),
    db.from("properties").select("id, name, contact_phone").order("name"),
  ]);
  for (const r of [contacts, recent, leads]) if (r.error) return failure(r.error);

  const last = new Map();
  const unread = new Map();
  const seen = new Map((contacts.data || []).map((c) => [c.phone, c.seen_at ? Date.parse(c.seen_at) : 0]));
  for (const m of recent.data || []) {
    if (!last.has(m.phone)) last.set(m.phone, m);
    if (m.direction === "in" && Date.parse(m.created_at) > (seen.get(m.phone) ?? 0)) {
      unread.set(m.phone, (unread.get(m.phone) || 0) + 1);
    }
  }
  const leadOf = new Map();
  for (const l of leads.data || []) if (!leadOf.has(l.phone)) leadOf.set(l.phone, l);

  return NextResponse.json({
    ready: whatsappReady(),
    ai: aiReady(),
    templates: TEMPLATES,
    hotels: (hotels.data || []).map((h) => ({ id: h.id, name: h.name, has_mobile: Boolean(waPhone(h.contact_phone)) })),
    contacts: (contacts.data || []).map((c) => ({
      ...c,
      in_window: inWindow(c),
      unread: unread.get(c.phone) || 0,
      last: last.get(c.phone) || null,
      lead: leadOf.get(c.phone) || null,
    })),
  });
}

export async function POST(req) {
  const session = await guard(req);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));

  // A hotel's contact mobile added to the inbox, linked, so it can get the
  // daily report or a template before they have ever written in.
  if (body.add_property_id) {
    const db = getSupabaseAdmin();
    const { data: hotel } = await db
      .from("properties")
      .select("id, contact_name, contact_phone")
      .eq("id", body.add_property_id)
      .maybeSingle();
    const hotelPhone = waPhone(hotel?.contact_phone);
    if (!hotelPhone) return NextResponse.json({ error: "This hotel has no contact mobile." }, { status: 400 });
    const { data, error } = await db
      .from("wa_contacts")
      .upsert({ phone: hotelPhone, property_id: hotel.id }, { onConflict: "phone" })
      .select("*")
      .single();
    if (error) return failure(error);
    if (!data.name && hotel.contact_name) await db.from("wa_contacts").update({ name: hotel.contact_name }).eq("phone", hotelPhone);
    return NextResponse.json({ contact: { ...data, name: data.name || hotel.contact_name } });
  }

  const phone = waPhone(body.phone);
  if (!phone) return NextResponse.json({ error: "Which number?" }, { status: 400 });
  const sentBy = session.email || "admin";

  try {
    if (body.template) {
      const t = TEMPLATES[body.template];
      if (!t) return NextResponse.json({ error: "Unknown template" }, { status: 400 });
      const params = (body.params || []).map((p) => String(p || "").trim());
      if (params.length !== t.params.length || params.some((p) => !p)) {
        return NextResponse.json({ error: "Fill in every blank in the template" }, { status: 400 });
      }
      await sendTemplate(phone, body.template, params, sentBy);
    } else {
      const text = String(body.text || "").trim();
      if (!text) return NextResponse.json({ error: "Type a message" }, { status: 400 });
      const { data: contact } = await getSupabaseAdmin().from("wa_contacts").select("*").eq("phone", phone).maybeSingle();
      if (!inWindow(contact)) {
        return NextResponse.json(
          { error: "Their last message was over 24 hours ago, so only a template can be sent." },
          { status: 400 }
        );
      }
      await sendText(phone, text.slice(0, 4096), sentBy);
      // Answered: no longer waiting on SJ. Ignored before migration 065.
      await getSupabaseAdmin().from("wa_contacts").update({ handoff_at: null }).eq("phone", phone);
    }
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(req) {
  if (!(await guard(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const db = getSupabaseAdmin();

  if (body.lead_id) {
    const changes = { updated_at: new Date().toISOString() };
    if (body.status !== undefined) {
      if (!LEAD_STATUSES.includes(body.status)) return NextResponse.json({ error: "Unknown status" }, { status: 400 });
      changes.status = body.status;
    }
    for (const k of ["hotel_name", "city", "interest", "current_otas"]) {
      if (body[k] !== undefined) changes[k] = String(body[k] || "").trim().slice(0, 200) || null;
    }
    if (body.rooms !== undefined) {
      const n = parseInt(body.rooms, 10);
      changes.rooms = Number.isFinite(n) && n > 0 ? n : null;
    }
    const { data, error } = await db.from("wa_leads").update(changes).eq("id", body.lead_id).select("*").single();
    if (error) return failure(error);
    return NextResponse.json({ lead: data });
  }

  const phone = waPhone(body.phone);
  if (!phone) return NextResponse.json({ error: "Which number?" }, { status: 400 });
  const changes = {};
  if (typeof body.bot_paused === "boolean") {
    changes.bot_paused = body.bot_paused;
    if (!body.bot_paused) changes.handoff_at = null;
  }
  if (typeof body.opted_in === "boolean") changes.opted_in = body.opted_in;
  if (body.property_id !== undefined) changes.property_id = body.property_id || null;
  if (!Object.keys(changes).length) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  // The daily report goes to a hotel's contact, so it needs a hotel.
  if (changes.property_id === null) changes.opted_in = false;
  const { data, error } = await db.from("wa_contacts").update(changes).eq("phone", phone).select("*").single();
  if (error) return failure(error);
  if (data.opted_in && !data.property_id) {
    await db.from("wa_contacts").update({ opted_in: false }).eq("phone", phone);
    return NextResponse.json({ error: "Link this contact to a hotel first." }, { status: 400 });
  }
  return NextResponse.json({ contact: data });
}
