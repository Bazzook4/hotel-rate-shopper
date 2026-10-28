import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseAdmin } from "@/lib/database";
import { minutesNowInZone } from "@/lib/hotelTime";
import { alertAdmin } from "@/lib/whatsapp";

/**
 * The WhatsApp assistant (migration 065): Claude Haiku chats with a new
 * enquiry in its own words, saves the lead's details as it learns them, and
 * hands the chat to SJ for prices, complaints or anything it is unsure of.
 *
 * Only with ANTHROPIC_API_KEY set; without it the fixed question flow in
 * salesFlow.js answers instead. Effort is low: these are short chat turns.
 */

const MODEL = "claude-haiku-5-5";
const MAX_ROUNDS = 4;
const HISTORY = 20;

export const aiReady = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client = null;
const ai = () => (client ||= new Anthropic());

function systemPrompt() {
  const now = minutesNowInZone("Asia/Kolkata");
  const online = now >= 13 * 60 && now < 21 * 60;
  const link = process.env.WA_CALENDAR_LINK;
  return `You are the WhatsApp assistant for Online Hotelier (onlinehotelier.com), run by SJ.
Online Hotelier helps independent hotels with:
- OTA listing and management (MakeMyTrip, Goibibo, Booking.com, Agoda, Airbnb)
- OTA audits and rate parity
- A free hotel PMS (front desk, bookings, rooms)
- Revenue optimisation and hotel websites

Style:
- Warm, short, conversational. 1 to 3 short sentences per message. No long paragraphs.
- Reply in the customer's language (English, Hindi or Hinglish).
- Use their name once you know it. At most one emoji, only if they use emojis.
- Ask one question at a time. Never send a form or a list of questions.
- If asked, say you are SJ's AI assistant. Never claim to be SJ or a human.
- Plain text only: WhatsApp does not render markdown headings or tables.

Goal:
- Understand what they need, then naturally collect: hotel name, city, number of rooms, which OTAs they use today.
- Call save_lead as soon as you learn any of these details.
- For pricing, custom quotes, complaints, or anything you are unsure about: say SJ will personally follow up, then call handoff_to_sj.
${link ? `- Offer a call booking link when they are interested: ${link}\n` : ""}- SJ is available 1 PM to 9 PM IST. SJ is ${online ? "available now" : "offline now, back from 1 PM IST"}.

A first message from the website ends with a tag naming the page they came from: [ota] OTA listing, [pms] the free PMS, [audit] an OTA audit, [home] the home page. Use it as context, never repeat the tag.

Never invent prices, guarantees, or features not listed here. Stay on Online Hotelier topics; politely decline unrelated requests.`;
}

const TOOLS = [
  {
    name: "save_lead",
    description:
      "Save or update this contact's lead details. Call it as soon as any detail is known; send only the fields learned.",
    input_schema: {
      type: "object",
      properties: {
        interest: { type: "string", enum: ["ota_listing", "ota_audit", "pms", "revenue", "website", "other"] },
        hotel_name: { type: "string" },
        city: { type: "string" },
        rooms: { type: "integer" },
        current_otas: { type: "string", description: "The OTAs they use today, as they said it" },
      },
    },
  },
  {
    name: "handoff_to_sj",
    description: "Pause the assistant on this chat and alert SJ to take over. Use for pricing, quotes, complaints or anything unsure.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string", description: "Why SJ is needed, in one line" } },
      required: ["reason"],
    },
  },
];

/** The last messages with this phone, oldest first, as alternating turns starting with theirs. */
export async function loadHistory(phone) {
  const { data } = await getSupabaseAdmin()
    .from("wa_messages")
    .select("direction, body, status")
    .eq("phone", phone)
    .not("body", "is", null)
    .order("created_at", { ascending: false })
    .limit(HISTORY);
  const merged = [];
  for (const m of (data || []).reverse()) {
    if (m.direction === "out" && m.status === "failed") continue;
    const role = m.direction === "in" ? "user" : "assistant";
    const last = merged[merged.length - 1];
    if (last && last.role === role) last.content = `${last.content}\n${m.body}`;
    else merged.push({ role, content: m.body });
  }
  while (merged.length && merged[0].role !== "user") merged.shift();
  return merged;
}

const LEAD_FIELDS = ["interest", "hotel_name", "city", "rooms", "current_otas"];

async function saveLead(phone, input) {
  const db = getSupabaseAdmin();
  const changes = {};
  for (const k of LEAD_FIELDS) {
    if (input[k] == null || input[k] === "") continue;
    changes[k] = k === "rooms" ? parseInt(input[k], 10) || null : String(input[k]).slice(0, 200);
  }
  if (!Object.keys(changes).length) return;
  const { data: lead } = await db
    .from("wa_leads")
    .select("id")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lead) {
    await db.from("wa_leads").update({ ...changes, updated_at: new Date().toISOString() }).eq("id", lead.id);
  } else {
    const first = (await loadHistory(phone))[0]?.content || "";
    const tag = /\[(ota|pms|audit|home)\]/i.exec(first)?.[1]?.toLowerCase() || null;
    await db.from("wa_leads").insert({ phone, source_page: tag, step: "ai", ...changes });
  }
}

export async function handOff(contact, reason) {
  const db = getSupabaseAdmin();
  await db
    .from("wa_contacts")
    .update({ bot_paused: true, handoff_at: new Date().toISOString(), handoff_reason: String(reason || "").slice(0, 300) })
    .eq("phone", contact.phone);
  const { data: lead } = await db
    .from("wa_leads")
    .select("*")
    .eq("phone", contact.phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const details = lead ? [lead.hotel_name, lead.city, lead.rooms != null ? `${lead.rooms} rooms` : null].filter(Boolean).join(", ") : "";
  await alertAdmin(
    `Needs you: ${contact.name || "+" + contact.phone} (+${contact.phone}). ${reason}${details ? `. ${details}` : ""}`,
    [lead?.hotel_name || contact.name || contact.phone, lead?.interest || "-", String(lead?.rooms ?? "-"), lead?.city || "-"]
  );
}

const textOf = (res) =>
  res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

/**
 * The assistant's answer to the chat so far, after running any tools it
 * calls. Returns { text, handedOff }; text may be empty after a handoff.
 */
export async function aiReply(contact, history) {
  const messages = [...history];
  if (messages[messages.length - 1]?.role !== "user") return { text: "", handedOff: false };
  let handedOff = false;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await ai().messages.create({
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: "low" },
      system: systemPrompt(),
      tools: TOOLS,
      messages,
    });

    if (res.stop_reason === "refusal") {
      await handOff(contact, "The assistant would not answer this chat");
      return { text: "", handedOff: true };
    }

    const uses = res.content.filter((b) => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || uses.length === 0) return { text: textOf(res), handedOff };

    messages.push({ role: "assistant", content: res.content });
    const results = [];
    for (const t of uses) {
      try {
        if (t.name === "save_lead") await saveLead(contact.phone, t.input || {});
        else if (t.name === "handoff_to_sj") {
          await handOff(contact, t.input?.reason || "Asked for SJ");
          handedOff = true;
        }
        results.push({ type: "tool_result", tool_use_id: t.id, content: "ok" });
      } catch (err) {
        results.push({ type: "tool_result", tool_use_id: t.id, content: err.message, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { text: "Thanks! SJ will get back to you shortly.", handedOff };
}

/** A draft reply for SJ to edit and send from the inbox. */
export async function suggestReply(phone) {
  // A draft answers their last message; a trailing turn of ours would read
  // as a prefill, which the model refuses.
  const history = await loadHistory(phone);
  while (history.length && history[history.length - 1].role !== "user") history.pop();
  if (!history.length) return "";
  const res = await ai().messages.create({
    model: MODEL,
    max_tokens: 1500,
    output_config: { effort: "low" },
    system:
      "Draft a short, warm WhatsApp reply for SJ of Online Hotelier to send to this contact, written as SJ. 1 to 3 sentences. Match the customer's language. Plain text only. Never invent prices or promises.",
    messages: history,
  });
  if (res.stop_reason === "refusal") return "";
  return textOf(res);
}
