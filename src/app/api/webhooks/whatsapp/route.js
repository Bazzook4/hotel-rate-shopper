import { NextResponse, after } from "next/server";
import { getSupabaseAdmin } from "@/lib/database";
import { markRead, sendText, signatureValid, waPhone } from "@/lib/whatsapp";
import { handleIncoming } from "@/lib/salesFlow";
import { aiReady, aiReply, loadHistory } from "@/lib/aiAgent";
import { storeIncoming } from "@/lib/whatsappMedia";

// The AI reply waits a few seconds and sends in parts, so allow for it.
export const maxDuration = 60;

/**
 * Meta's webhook for the business WhatsApp number (migration 064).
 *
 * GET   the one-time check when the webhook is saved in Meta: the verify
 *       token must match WA_VERIFY_TOKEN, and the challenge is echoed back.
 * POST  messages in and delivery statuses, signed with the app secret. An
 *       unsigned or wrongly signed call is refused. Each message is saved
 *       once (Meta retries, so a repeat id is skipped), and the reply is
 *       sent after answering, since Meta retries anything slow.
 *
 * With ANTHROPIC_API_KEY set the AI assistant answers (migration 065);
 * without it, the fixed questions in salesFlow.js do.
 *
 * A reaction is saved with no text, so it is shown on the message it is
 * for and never answered. A photo or file is copied into storage before
 * the reply, while Meta still has it.
 */

const STATUS_RANK = { sent: 1, delivered: 2, read: 3, failed: 4 };

export async function GET(req) {
  const p = req.nextUrl.searchParams;
  const token = process.env.WA_VERIFY_TOKEN;
  if (token && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === token) {
    return new Response(p.get("hub.challenge") || "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

/** What a message says, whatever its kind, and which button it pressed. */
function readMessage(msg) {
  if (msg.type === "text") return { text: msg.text?.body || "" };
  if (msg.type === "interactive") {
    const r = msg.interactive?.button_reply || msg.interactive?.list_reply;
    return { text: r?.title || "", buttonId: r?.id || null };
  }
  if (msg.type === "button") return { text: msg.button?.text || "", buttonId: msg.button?.payload || null };
  if (msg.type === "reaction") return { text: null, reaction: true };
  const m = msg[msg.type] || {};
  const caption = m.caption ? `: ${m.caption}` : "";
  if (msg.type === "image") return { text: `Photo${caption}` };
  if (msg.type === "sticker") return { text: "Sticker" };
  if (msg.type === "video") return { text: `Video${caption}` };
  if (msg.type === "audio") return { text: m.voice ? "Voice note" : "Audio" };
  if (msg.type === "document") return { text: `File: ${m.filename || "document"}${m.caption ? `, ${m.caption}` : ""}` };
  if (msg.type === "location") {
    const place = [m.name, m.address].filter(Boolean).join(", ");
    return { text: `Location: ${place || `${m.latitude}, ${m.longitude}`}` };
  }
  if (msg.type === "contacts") return { text: `Contact card: ${msg.contacts?.map((c) => c.name?.formatted_name).filter(Boolean).join(", ") || "no name"}` };
  return { text: `[${msg.type}]` };
}

/** Links a new contact to a hotel whose contact mobile is the same number. */
async function hotelFor(phone) {
  const { data } = await getSupabaseAdmin().from("properties").select("id, contact_phone").not("contact_phone", "is", null);
  return (data || []).find((p) => waPhone(p.contact_phone) === phone)?.id || null;
}

/** Saves what Meta sent, and returns the replies to make once it has its answer. */
async function receive(value) {
  const db = getSupabaseAdmin();
  const replies = [];
  const names = new Map((value.contacts || []).map((c) => [c.wa_id, c.profile?.name || null]));

  for (const msg of value.messages || []) {
    const phone = msg.from;
    const read = readMessage(msg);
    const at = msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString();

    const { data: saved, error: dup } = await db.from("wa_messages").insert({
      wa_message_id: msg.id,
      phone,
      direction: "in",
      type: msg.type,
      body: read.text,
      payload: msg,
      created_at: at,
    }).select("id, phone, type, payload").single();
    if (dup) {
      if (dup.code !== "23505") console.error("WhatsApp message not saved:", dup.message);
      continue;
    }

    const { data: existing } = await db.from("wa_contacts").select("*").eq("phone", phone).maybeSingle();
    const changes = { phone, last_inbound_at: at, last_message_at: at };
    const name = names.get(phone);
    if (name) changes.name = name;
    if (!existing?.property_id) {
      const propertyId = await hotelFor(phone).catch(() => null);
      if (propertyId) changes.property_id = propertyId;
    }
    const { data: contact } = await db.from("wa_contacts").upsert(changes, { onConflict: "phone" }).select("*").single();

    replies.push({ id: msg.id, contact, read, saved });
  }

  for (const s of value.statuses || []) {
    const { data: row } = await db.from("wa_messages").select("id, status").eq("wa_message_id", s.id).maybeSingle();
    if (!row || (STATUS_RANK[s.status] || 0) <= (STATUS_RANK[row.status] || 0)) continue;
    await db
      .from("wa_messages")
      .update({ status: s.status, error: s.status === "failed" ? s.errors?.[0]?.title || s.errors?.[0]?.message || null : null })
      .eq("id", row.id);
  }
  return replies;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function currentContact(phone) {
  const { data } = await getSupabaseAdmin().from("wa_contacts").select("*").eq("phone", phone).single();
  return data;
}

/** True if a newer message from this phone came in since `id`: that one will be answered instead. */
async function overtaken(phone, id) {
  const { data } = await getSupabaseAdmin()
    .from("wa_messages")
    .select("wa_message_id")
    .eq("phone", phone)
    .eq("direction", "in")
    .neq("type", "reaction")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return Boolean(data && data.wa_message_id !== id);
}

/**
 * The assistant reads the chat after a short pause, as a person would, and
 * answers everything said so far once, in parts a second or so apart.
 */
async function aiAnswer(phone, id) {
  await sleep(2000 + Math.random() * 2000);
  if (await overtaken(phone, id)) return;
  const contact = await currentContact(phone);
  if (!contact || contact.bot_paused) return;

  const { text, handedOff } = await aiReply(contact, await loadHistory(phone));
  const parts = (text || (handedOff ? "Our team will contact you shortly." : ""))
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const [i, part] of parts.entries()) {
    if (i) await sleep(1200);
    await sendText(phone, part, "ai");
  }
}

/** One at a time, so two quick messages from one phone cannot answer the same question twice. */
async function reply(all) {
  for (const { id } of all) await markRead(id);
  for (const { saved } of all) {
    await storeIncoming(saved).catch((err) => console.error("WhatsApp file not kept:", err.message));
  }
  // A thumbs up is not a question.
  const replies = all.filter((r) => !r.read.reaction);

  if (aiReady()) {
    // Only the last message of each phone in this batch; the history carries the rest.
    const last = new Map(replies.map((r) => [r.contact?.phone, r.id]));
    for (const [phone, id] of last) {
      if (!phone) continue;
      try {
        await aiAnswer(phone, id);
      } catch (err) {
        console.error("WhatsApp AI reply failed:", err.message);
      }
    }
    return;
  }

  for (const { contact, read } of replies) {
    if (!contact || contact.bot_paused) continue;
    try {
      // Re-read: the message before may have paused the bot.
      const now = await currentContact(contact.phone);
      if (now && !now.bot_paused) await handleIncoming(now, read);
    } catch (err) {
      console.error("WhatsApp auto-reply failed:", err.message);
    }
  }
}

export async function POST(req) {
  const raw = await req.text();
  if (!signatureValid(raw, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }

  const replies = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      try {
        replies.push(...(await receive(change.value || {})));
      } catch (err) {
        console.error("WhatsApp webhook:", err.message);
      }
    }
  }
  if (replies.length) after(() => reply(replies));
  return NextResponse.json({ ok: true });
}
