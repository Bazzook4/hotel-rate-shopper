import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import { aiReady, suggestReply } from "@/lib/aiAgent";
import { waPhone } from "@/lib/whatsapp";

/**
 * Admin > WhatsApp "Suggest reply": the assistant drafts an answer to the
 * chat for SJ to edit and send. Nothing is sent from here.
 *
 * POST { phone } -> { draft }
 */
export async function POST(req) {
  const session = await getSessionFromRequest(req);
  if (!session || !isSuperAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!aiReady()) return NextResponse.json({ error: "AI replies are not set up: ANTHROPIC_API_KEY is not set." }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const phone = waPhone(body.phone);
  if (!phone) return NextResponse.json({ error: "Which number?" }, { status: 400 });
  try {
    const draft = await suggestReply(phone);
    if (!draft) return NextResponse.json({ error: "Nothing to answer yet: their last message has been replied to." }, { status: 400 });
    return NextResponse.json({ draft });
  } catch (err) {
    return NextResponse.json({ error: `Could not draft a reply: ${err.message}` }, { status: 502 });
  }
}
