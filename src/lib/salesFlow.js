import { getSupabaseAdmin } from "@/lib/database";
import { minutesNowInZone } from "@/lib/hotelTime";
import { alertAdmin, sendButtons, sendText } from "@/lib/whatsapp";

/**
 * The auto-reply on the business WhatsApp number: a new enquiry is asked
 * what it wants, then the property name, city and room count, and handed to
 * SJ with an alert. A lead's step is the question it is waiting on:
 *
 *   start       sent the welcome buttons, waiting for what they want
 *   hotel_name  waiting for the property name
 *   city        waiting for the city
 *   rooms       waiting for the room count
 *   done        handed over; the bot stays quiet from here
 *
 * Website links carry a tag in the prefilled text ([ota], [pms], [audit],
 * [home]), which names the page and, but for [home], skips the first
 * question. "Talk to our team", or two replies in a row the bot cannot use, pause
 * the bot for that contact and alert SJ. A hotel's own contact never gets
 * the sales questions; their message is passed to SJ instead.
 */

const OWNER = "SJ";
const OPEN_FROM = 10 * 60; // 10 AM IST
const OPEN_UNTIL = 22 * 60; // 10 PM IST
const MAX_MISSES = 2;

export const INTERESTS = {
  ota_listing: "OTA listing",
  pms: "Free PMS",
  ota_audit: "OTA audit",
  other: "Other",
};

const TAGS = { ota: "ota_listing", pms: "pms", audit: "ota_audit", home: null };

const BUTTONS = [
  { id: "ota_listing", title: "OTA Listing" },
  { id: "pms", title: "Free PMS" },
  { id: "talk", title: "Talk to our team" },
];

const QUESTIONS = {
  hotel_name: "Great! What's your property name?",
  city: "Which city is it in?",
  rooms: "How many rooms?",
};

function offline() {
  const now = minutesNowInZone("Asia/Kolkata");
  return now < OPEN_FROM || now >= OPEN_UNTIL;
}

const offlineNote = () => (offline() ? `\n\nOur team is offline now, will reply from 10 AM.` : "");

function tagOf(text) {
  const m = /\[(ota|pms|audit|home)\]/i.exec(text || "");
  return m ? m[1].toLowerCase() : null;
}

function interestFromText(text) {
  const t = (text || "").toLowerCase();
  if (/audit/.test(t)) return "ota_audit";
  if (/\bpms\b|property management/.test(t)) return "pms";
  if (/\bota\b|listing/.test(t)) return "ota_listing";
  return null;
}

async function saveLead(id, changes) {
  const { data } = await getSupabaseAdmin()
    .from("wa_leads")
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  return data;
}

async function pause(phone) {
  await getSupabaseAdmin().from("wa_contacts").update({ bot_paused: true }).eq("phone", phone);
}

function leadLine(lead) {
  const parts = [lead.hotel_name, lead.city, lead.rooms != null ? `${lead.rooms} rooms` : null].filter(Boolean);
  return `${INTERESTS[lead.interest] || "New"} lead: ${parts.join(", ") || "no details yet"}. Source: ${lead.source_page || "direct"}`;
}

async function handOver(contact, lead, why) {
  await pause(contact.phone);
  await sendText(contact.phone, `Our team will contact you shortly.${offlineNote()}`);
  await alertAdmin(
    `${why} from ${contact.name || contact.phone} (+${contact.phone}).${lead ? ` ${leadLine(lead)}` : ""}`,
    lead ? [lead.hotel_name || contact.name || contact.phone, INTERESTS[lead.interest] || "-", String(lead.rooms ?? "-"), lead.city || "-"] : null
  );
}

/**
 * One message in from a contact whose bot is on.
 * msg: { text, buttonId } -- text is the typed text or the button's title.
 */
export async function handleIncoming(contact, msg) {
  const db = getSupabaseAdmin();
  const text = (msg.text || "").trim();

  const { data: latest } = await db
    .from("wa_leads")
    .select("*")
    .eq("phone", contact.phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let lead = latest;

  if (msg.buttonId === "talk" || new RegExp(`talk to (${OWNER}|our team|team)`, "i").test(text)) {
    await handOver(contact, lead, `Asked for ${OWNER}`);
    return;
  }

  // Handed over already: a person is on it.
  if (lead?.step === "done") return;

  if (!lead) {
    const tag = tagOf(text);
    const interest = tag ? TAGS[tag] : interestFromText(text);
    const { data } = await db
      .from("wa_leads")
      .insert({ phone: contact.phone, interest, source_page: tag, step: interest ? "hotel_name" : "start" })
      .select("*")
      .single();
    lead = data;
    const first = contact.name ? contact.name.split(" ")[0] : "there";
    const hello = `Hi ${first}! Thanks for contacting Online Hotelier.`;
    if (interest) await sendText(contact.phone, `${hello}\n\n${QUESTIONS.hotel_name}`);
    else await sendButtons(contact.phone, `${hello} How can I help?`, BUTTONS);
    return;
  }

  const miss = async (again) => {
    const misses = (lead.misses || 0) + 1;
    lead = await saveLead(lead.id, { misses });
    if (misses >= MAX_MISSES) await handOver(contact, lead, "Bot could not follow a chat");
    else await again();
  };

  if (lead.step === "start") {
    const interest = INTERESTS[msg.buttonId] ? msg.buttonId : interestFromText(text);
    if (!interest) return miss(() => sendButtons(contact.phone, "Please pick one:", BUTTONS));
    await saveLead(lead.id, { interest, step: "hotel_name", misses: 0 });
    await sendText(contact.phone, QUESTIONS.hotel_name);
    return;
  }

  if (!text || msg.buttonId) return miss(() => sendText(contact.phone, QUESTIONS[lead.step]));

  if (lead.step === "hotel_name") {
    await saveLead(lead.id, { hotel_name: text.slice(0, 200), step: "city", misses: 0 });
    await sendText(contact.phone, QUESTIONS.city);
    return;
  }

  if (lead.step === "city") {
    await saveLead(lead.id, { city: text.slice(0, 100), step: "rooms", misses: 0 });
    await sendText(contact.phone, QUESTIONS.rooms);
    return;
  }

  if (lead.step === "rooms") {
    const rooms = parseInt(/\d+/.exec(text)?.[0] ?? "", 10);
    if (!Number.isFinite(rooms) || rooms <= 0 || rooms > 5000) {
      return miss(() => sendText(contact.phone, "Please send the number of rooms, like 12."));
    }
    lead = await saveLead(lead.id, { rooms, step: "done", misses: 0 });
    const when = offline() ? "between 10 AM and 10 PM" : "today between 10 AM and 10 PM";
    const calendar = process.env.WA_CALENDAR_LINK ? ` Prefer to book a time? ${process.env.WA_CALENDAR_LINK}` : "";
    await sendText(contact.phone, `Thanks! Our team will call you ${when}.${calendar}${offlineNote()}`);
    await alertAdmin(leadLine(lead), [lead.hotel_name, INTERESTS[lead.interest] || "-", String(rooms), lead.city || "-"]);
  }
}
