import crypto from "crypto";
import { getSupabaseAdmin } from "@/lib/database";

/**
 * The business WhatsApp number on Meta's Cloud API (migration 064).
 *
 * Nothing goes out unless WA_TOKEN and WA_PHONE_NUMBER_ID are set: without
 * them every send refuses with a plain reason, rather than calling Meta with
 * half a setup. Every message sent is logged to wa_messages, failed ones
 * too, so the inbox shows what the hotel or lead actually got.
 *
 * Free text and buttons only reach a phone within 24 hours of its last
 * message to us; after that only an approved template does.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000;

export function whatsappReady() {
  return Boolean(process.env.WA_TOKEN && process.env.WA_PHONE_NUMBER_ID);
}

/** Digits only, as Meta writes them: 919876543210. A bare 10-digit number is taken as Indian. */
export function waPhone(phone) {
  const raw = String(phone || "").trim();
  let digits = raw.replace(/\D/g, "");
  if (!raw.startsWith("+") && digits.length === 10) digits = `91${digits}`;
  return digits.length >= 8 ? digits : null;
}

export function inWindow(contact) {
  const last = contact?.last_inbound_at ? Date.parse(contact.last_inbound_at) : 0;
  return Date.now() - last < WINDOW_MS;
}

/** Meta's signature on a webhook: sha256= and the HMAC of the raw body with the app secret. */
export function signatureValid(rawBody, header) {
  const secret = process.env.WA_APP_SECRET;
  if (!secret || !header) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Template blanks cannot hold line breaks or be empty. */
export const blank = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || "-";

/** A Graph API address, like graph("123/messages"). */
export function graph(path) {
  if (!whatsappReady()) throw new Error("WhatsApp is not connected: WA_TOKEN and WA_PHONE_NUMBER_ID are not set.");
  return `https://graph.facebook.com/${process.env.WA_API_VERSION || "v23.0"}/${path}`;
}

async function callMeta(payload) {
  const res = await fetch(graph(`${process.env.WA_PHONE_NUMBER_ID}/messages`), {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `WhatsApp refused the message (${res.status})`);
  return data;
}

/**
 * Sends one message and logs it, sent or failed. Throws on failure after
 * logging. `kept` is saved with the payload but not sent, like where a
 * photo we sent is stored.
 */
export async function sendLogged(to, type, body, payload, sentBy, kept) {
  const db = getSupabaseAdmin();
  const now = new Date().toISOString();
  let data = null;
  let failure = null;
  try {
    data = await callMeta({ to, type, ...payload });
  } catch (err) {
    failure = err;
  }
  await db.from("wa_messages").insert({
    wa_message_id: data?.messages?.[0]?.id || null,
    phone: to,
    direction: "out",
    type,
    body,
    payload: kept ? { ...payload, ...kept } : payload,
    status: failure ? "failed" : "sent",
    error: failure ? failure.message.slice(0, 500) : null,
    sent_by: sentBy || null,
  });
  await db.from("wa_contacts").upsert({ phone: to, last_message_at: now }, { onConflict: "phone" });
  if (failure) throw failure;
  return data;
}

export const sendText = (to, body, sentBy) => sendLogged(to, "text", body, { text: { body } }, sentBy);

/** Up to 3 reply buttons, each title at most 20 characters. */
export const sendButtons = (to, body, buttons, sentBy) =>
  sendLogged(
    to,
    "interactive",
    `${body}\n${buttons.map((b) => `[${b.title}]`).join(" ")}`,
    {
      interactive: {
        type: "button",
        body: { text: body },
        action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) },
      },
    },
    sentBy
  );

/** Meta's approved wording, so the inbox shows what the phone shows. Must match Meta's exactly. */
const TEMPLATE_WORDS = {
  daily_report_v2:
    "Good morning {{1}}, here is today at your hotel.\nArrivals: {{2}}\nDepartures: {{3}}\nRooms occupied: {{4}}\nOccupancy: {{5}}\nYesterday's revenue: {{6}}\nHave a good day.",
  lead_alert_v2: "New lead from {{1}}.\nInterested in: {{2}}\nRooms: {{3}}\nCity: {{4}}\nPlease follow up from the WhatsApp inbox.",
  needs_you_v1:
    "{{1}} needs you on WhatsApp.\nWhy: {{2}}\nDetails: {{3}}\nPlease reply from the WhatsApp inbox.",
  welcome_v1:
    "Hi {{1}}, welcome to OnlineHotelier. Your hotel {{2}} is created. Log in at {{3}} and add your rooms to start. Reply here if you need any help.",
  setup_reminder_v2: "Hi {{1}}, your hotel {{2}} is {{3}} set up on OnlineHotelier. Reply here if you need any help finishing it.",
  day3_checkin_v2: "Hi {{1}}, we have not seen new bookings at {{2}} since {{3}}. Is everything working fine? Reply here and we will help.",
};

export function templateWords(name, params) {
  const words = TEMPLATE_WORDS[name];
  if (!words) return `Template ${name}${params.length ? `: ${params.join(" | ")}` : ""}`;
  return words.replace(/\{\{(\d+)\}\}/g, (_, n) => params[n - 1] ?? "");
}

/** A template message logged before its words were kept, as the phone showed it. */
export function templateBody(body) {
  const m = /^Template (\w+): (.*)$/s.exec(body || "");
  return m && TEMPLATE_WORDS[m[1]] ? templateWords(m[1], m[2].split(" | ")) : body;
}

export const sendTemplate = (to, name, params = [], sentBy, lang = "en") =>
  sendLogged(
    to,
    "template",
    templateWords(name, params),
    {
      template: {
        name,
        language: { code: lang },
        ...(params.length
          ? { components: [{ type: "body", parameters: params.map((t) => ({ type: "text", text: String(t) })) }] }
          : {}),
      },
    },
    sentBy
  );

/** Blue ticks on a message we received. Not logged; a failure is ignored. */
export async function markRead(messageId) {
  try {
    await callMeta({ status: "read", message_id: messageId });
  } catch {
    // Read receipts are a courtesy; the message is already saved.
  }
}

/**
 * A note to the owner's own phone (ADMIN_ALERT_PHONE). Free text reaches it
 * only if the owner has written to the business number in the last 24
 * hours. Meta can accept free text outside that window and drop it later,
 * so the window is checked first: closed means the template (lead_alert_v2,
 * or needs_you_v1 when the bot cannot reply) goes at once. A refused free text still falls back to the template.
 */
export async function alertAdmin(text, templateParams, templateName = "lead_alert_v2") {
  const to = waPhone(process.env.ADMIN_ALERT_PHONE);
  if (!to || !whatsappReady()) return;
  const { data: contact } = await getSupabaseAdmin().from("wa_contacts").select("last_inbound_at").eq("phone", to).maybeSingle();
  try {
    if (!inWindow(contact)) throw new Error("24-hour window closed");
    await sendText(to, text, "alert");
  } catch {
    if (!templateParams) return;
    try {
      await sendTemplate(to, templateName, templateParams, "alert");
    } catch (err) {
      console.error("WhatsApp lead alert not sent:", err.message);
    }
  }
}

/**
 * Templates approved in WhatsApp Manager that the inbox can send by hand,
 * with what each blank is. The names must match Meta's exactly.
 */
export const TEMPLATES = {
  welcome_v1: { label: "Welcome", params: ["Name", "Hotel", "Login link"] },
  setup_reminder_v2: { label: "Setup reminder", params: ["Name", "Hotel", "How far set up, like 60%"] },
  day3_checkin_v2: { label: "No bookings lately", params: ["Name", "Hotel", "Since, like 20 Oct"] },
};
