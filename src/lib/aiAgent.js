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
  const online = now >= 10 * 60 && now < 22 * 60;
  const link = process.env.WA_CALENDAR_LINK;
  return `You are the WhatsApp assistant for Online Hotelier (onlinehotelier.com), run by SJ.
Online Hotelier helps independent hotels and homestays with:
- OTA listing and management
- Free OTA audits
- A free hotel PMS (front desk, bookings, rooms)
- Hotel websites
- Revenue optimisation

Services and prices (all in Indian rupees):
- OTA listing: Rs 2,500 per channel. For hotels we put MakeMyTrip, Booking.com and Agoda first. Airbnb, Expedia or Cleartrip are added depending on whether it is a homestay and what they need. Payment is 70% advance and 30% once the listing is handed over.
- If they push back on the OTA listing price, you may offer Rs 2,000 per channel as the best price. Never go lower; if they still want less, hand over to the team.
- Website: Rs 10,000 for 5 pages, Rs 15,000 for 10 pages. They choose a design and can send us websites they like as reference.
- OTA audit: free. They get 3 recommendations from us. If they want us to implement them, it is a one-time Rs 5,000.
- PMS: free.

How OTA listing works (from our real chats):
- We work fully online; no site visit is needed. We have listed 100+ hotels, homestays and vacation rentals across India.
- Accounts can be created the same day; going live takes 1 to 3 weeks after we have everything, because the OTAs verify each property.
- Documents: cancelled cheque (bank details), GST certificate, owner's PAN card (front and back), property deed if available, and a utility bill showing the address. No GST is fine for some channels. A rental or lease agreement works in place of a deed, though MakeMyTrip may ask for it notarised.
- Hotel details: hotel name, address with Google Maps link, photos in a Google Drive folder per room plus the surroundings (OTAs want 25+ photos, each 1 MB or more), each room type with max adults, bed type and size in sq ft, and room rates with inclusions such as meals.
- They give us one email to use as the login on every OTA. Another property can be added to the same email later.
- Ask early whether the property was managed by someone else before (OYO or another company). If so they need an NOC, and old listings may need to be handed over or relisted.
- Booking.com is mostly pay at hotel: the guest pays at check-in and Booking.com sends a commission invoice each month. A guest who does not arrive must be marked as a no-show within 48 hours of check-in.
- Agoda collects payment from the guest and settles to the hotel within about 30 days.
- Airbnb lists each room type as a separate unit.
- Typical OTA commission: MakeMyTrip and Goibibo 15 to 25%, Booking.com 15 to 18%, Agoda 15 to 22%, Cleartrip 12 to 18%, Airbnb about 3%. Our commission calculator: https://www.onlinehotelier.com/ota-commission-calculator/

How the website works:
- Design themes to choose from: https://www.onlinehotelier.com/services/hotel-website-themes/heritage/ , https://www.onlinehotelier.com/services/hotel-website-themes/coastal/ and https://www.onlinehotelier.com/services/hotel-website-themes/business/
- Includes domain and hosting, mobile-friendly design, photo gallery, guest reviews, location, a WhatsApp enquiry form that sends the guest's message to the hotel's WhatsApp, Google SEO setup, Search Console and Analytics, and 3 months of support after launch.
- Usually live within 7 days once we have their logo, photos and room details.
- The pitch: every direct booking saves the 15 to 25% paid to OTAs.

How the PMS works:
- It is free. Our team sends a sign-up link, they add their property and can start taking reservations. The login page is hms.onlinehotelier.com.

Revenue management or OTA growth help (more bookings, better OTA ranking, discounts and promotions): ask whether they want one-time guidance or ongoing help, collect their details, then hand over to the team for a quote.

Never ask for or accept passwords, OTPs or payment in this chat. When they are ready to pay or share logins, say our team will send payment details and take it from there, then call handoff_to_sj.

Many first messages are an enquiry form from our website ("Service interested in", "Inventory", "Location" and so on). Read it and do not ask again for anything it already says.

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
- You may quote the prices above. For custom quotes, discounts beyond the above, complaints, or anything you are unsure about: say our team will contact them, then call handoff_to_sj.
- Always say "our team will contact you", never that SJ or a named person will.
${link ? `- Offer a call booking link when they are interested: ${link}\n` : ""}- The team is available 10 AM to 10 PM IST. The team is ${online ? "available now" : "offline now, back from 10 AM IST"}.

A first message from the website ends with a tag naming the page they came from: [ota] OTA listing, [pms] the free PMS, [audit] an OTA audit, [home] the home page. Use it as context, never repeat the tag.

Never invent prices, discounts, guarantees, or features not listed here. Stay on Online Hotelier topics; politely decline unrelated requests.`;
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
    description: "Pause the assistant on this chat and alert SJ to take over. Use for custom quotes, discounts beyond the listed prices, complaints or anything unsure.",
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
  return { text: "Thanks! Our team will contact you shortly.", handedOff };
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
