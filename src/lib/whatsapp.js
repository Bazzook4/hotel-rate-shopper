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

async function callMeta(payload) {
  if (!whatsappReady()) throw new Error("WhatsApp is not connected: WA_TOKEN and WA_PHONE_NUMBER_ID are not set.");
  const version = process.env.WA_API_VERSION || "v23.0";
  const res = await fetch(`https://graph.facebook.com/${version}/${process.env.WA_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `WhatsApp refused the message (${res.status})`);
  return data;
}

/** Sends one message and logs it, sent or failed. Throws on failure after logging. */
async function sendLogged(to, type, body, payload, sentBy) {
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
    payload,
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

export const sendTemplate = (to, name, params = [], sentBy, lang = "en") =>
  sendLogged(
    to,
    "template",
    `Template ${name}${params.length ? `: ${params.join(" | ")}` : ""}`,
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
 * hours, so a refusal falls back to the lead_alert template.
 */
export async function alertAdmin(text, templateParams) {
  const to = waPhone(process.env.ADMIN_ALERT_PHONE);
  if (!to || !whatsappReady()) return;
  try {
    await sendText(to, text, "alert");
  } catch {
    if (!templateParams) return;
    try {
      await sendTemplate(to, "lead_alert", templateParams, "alert");
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
  setup_reminder: { label: "Setup reminder", params: ["Name", "Hotel", "How far set up, like 60%"] },
  day3_checkin: { label: "No bookings lately", params: ["Name", "Hotel", "Since, like 20 Oct"] },
};
