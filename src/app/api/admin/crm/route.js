import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/serverSession";
import { isSuperAdmin } from "@/lib/permissions";
import { getSupabaseAdmin } from "@/lib/database";

/**
 * Admin > CRM: contacts and deals (migration 074). Super admin only.
 *
 * GET               every contact with its deals, and the hotels to link a deal to
 * POST              { lead_id } converts a lead: a contact (the one for that
 *                   number if there is one) and a new deal at Demo; the lead
 *                   is marked converted and keeps its chat
 *                   { contact_id } a new deal for a contact
 * PATCH             { deal_id, stage | note | next_follow_up | property_id }
 *                   { contact_id, name | hotel_name | city | rooms | current_otas | notes }
 * DELETE            ?deal_id= or ?contact_id= (a contact takes its deals with it)
 */

const STAGES = ["demo", "link_sent", "won", "lost"];

async function guard(req) {
  const session = await getSessionFromRequest(req);
  return session && isSuperAdmin(session) ? session : null;
}

function failure(error) {
  const missing = /crm_(contacts|deals)/.test(error.message || "") && /exist|schema cache/i.test(error.message || "");
  return NextResponse.json(
    { error: missing ? "Contacts and deals are not switched on yet: run migration 074." : error.message, missing },
    { status: 500 }
  );
}

const clean = (v) => String(v ?? "").trim().slice(0, 200) || null;

export async function GET(req) {
  if (!(await guard(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const db = getSupabaseAdmin();
  const [contacts, deals, hotels] = await Promise.all([
    db.from("crm_contacts").select("*").order("created_at", { ascending: false }).limit(2000),
    db.from("crm_deals").select("*").order("created_at", { ascending: false }).limit(5000),
    db.from("properties").select("id, name").order("name"),
  ]);
  for (const r of [contacts, deals]) if (r.error) return failure(r.error);
  const byContact = new Map();
  for (const d of deals.data || []) {
    if (!byContact.has(d.contact_id)) byContact.set(d.contact_id, []);
    byContact.get(d.contact_id).push(d);
  }
  return NextResponse.json({
    hotels: hotels.data || [],
    contacts: (contacts.data || []).map((c) => ({ ...c, deals: byContact.get(c.id) || [] })),
  });
}

export async function POST(req) {
  if (!(await guard(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const db = getSupabaseAdmin();

  let contactId = Number(body.contact_id) || null;

  if (body.lead_id) {
    const { data: lead, error } = await db.from("wa_leads").select("*").eq("id", body.lead_id).maybeSingle();
    if (error) return failure(error);
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    const { data: chat } = await db.from("wa_contacts").select("name, property_id").eq("phone", lead.phone).maybeSingle();
    let { data: contact } = await db.from("crm_contacts").select("*").eq("phone", lead.phone).maybeSingle();
    if (!contact) {
      const made = await db
        .from("crm_contacts")
        .insert({
          phone: lead.phone,
          name: chat?.name || null,
          hotel_name: lead.hotel_name,
          city: lead.city,
          rooms: lead.rooms,
          current_otas: lead.current_otas,
          interest: lead.interest,
        })
        .select("*")
        .single();
      if (made.error) return failure(made.error);
      contact = made.data;
    }
    contactId = contact.id;
    const { error: upErr } = await db
      .from("wa_leads")
      .update({ status: "converted", updated_at: new Date().toISOString() })
      .eq("id", lead.id);
    if (upErr) return failure(upErr);
  }

  if (!contactId) return NextResponse.json({ error: "Which contact?" }, { status: 400 });
  const { data: deal, error } = await db.from("crm_deals").insert({ contact_id: contactId }).select("*").single();
  if (error) return failure(error);
  return NextResponse.json({ deal, contact_id: contactId });
}

export async function PATCH(req) {
  if (!(await guard(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const db = getSupabaseAdmin();
  const now = new Date().toISOString();

  if (body.deal_id) {
    const changes = { updated_at: now };
    if (body.stage !== undefined) {
      if (!STAGES.includes(body.stage)) return NextResponse.json({ error: "Unknown stage" }, { status: 400 });
      changes.stage = body.stage;
      changes.closed_at = body.stage === "won" || body.stage === "lost" ? now : null;
    }
    if (body.note !== undefined) changes.note = String(body.note || "").trim().slice(0, 2000) || null;
    if (body.next_follow_up !== undefined) {
      if (body.next_follow_up && !/^\d{4}-\d{2}-\d{2}$/.test(body.next_follow_up)) {
        return NextResponse.json({ error: "That date is not valid" }, { status: 400 });
      }
      changes.next_follow_up = body.next_follow_up || null;
    }
    if (body.property_id !== undefined) {
      changes.property_id = body.property_id || null;
      // A deal tied to a hotel that signed up is won.
      if (changes.property_id && body.stage === undefined) {
        changes.stage = "won";
        changes.closed_at = now;
      }
    }
    const { data, error } = await db.from("crm_deals").update(changes).eq("id", body.deal_id).select("*").single();
    if (error) return failure(error);
    return NextResponse.json({ deal: data });
  }

  if (body.contact_id) {
    const changes = { updated_at: now };
    for (const k of ["name", "hotel_name", "city", "current_otas", "notes"]) {
      if (body[k] !== undefined) changes[k] = clean(body[k]);
    }
    if (body.rooms !== undefined) {
      const n = parseInt(body.rooms, 10);
      changes.rooms = Number.isFinite(n) && n > 0 ? n : null;
    }
    const { data, error } = await db.from("crm_contacts").update(changes).eq("id", body.contact_id).select("*").single();
    if (error) return failure(error);
    return NextResponse.json({ contact: data });
  }

  return NextResponse.json({ error: "Which deal or contact?" }, { status: 400 });
}

export async function DELETE(req) {
  if (!(await guard(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const db = getSupabaseAdmin();
  const dealId = Number(url.searchParams.get("deal_id"));
  const contactId = Number(url.searchParams.get("contact_id"));
  if (Number.isInteger(dealId) && dealId > 0) {
    const { error } = await db.from("crm_deals").delete().eq("id", dealId);
    if (error) return failure(error);
    return NextResponse.json({ ok: true });
  }
  if (Number.isInteger(contactId) && contactId > 0) {
    const { error } = await db.from("crm_contacts").delete().eq("id", contactId);
    if (error) return failure(error);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Which deal or contact?" }, { status: 400 });
}
