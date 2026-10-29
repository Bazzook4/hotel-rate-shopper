import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import { getSupabaseAdmin } from "@/lib/database";
import { inWindow, waPhone } from "@/lib/whatsapp";
import { MAX_SEND_BYTES, SEND_TYPES, mediaLink, sendMedia } from "@/lib/whatsappMedia";

/**
 * Admin > WhatsApp photos and files.
 *
 * GET ?id=   opens a message's photo or file: a redirect to a link that runs
 *            out in an hour, so the address in the page never changes and
 *            the browser keeps the picture between refreshes.
 * POST       form data { phone, file, caption } sends a JPEG, PNG or PDF,
 *            only within 24 hours of their last message, as a reply does.
 */

async function guard(req) {
  const session = await getSessionFromRequest(req);
  return session && isSuperAdmin(session) ? session : null;
}

export async function GET(req) {
  if (!(await guard(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Which message?" }, { status: 400 });
  try {
    const url = await mediaLink(id);
    if (!url) return NextResponse.json({ error: "This message has no file" }, { status: 404 });
    const res = NextResponse.redirect(url);
    res.headers.set("Cache-Control", "private, max-age=3000");
    return res;
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

export async function POST(req) {
  const session = await guard(req);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const form = await req.formData().catch(() => null);
  const phone = waPhone(form?.get("phone"));
  const file = form?.get("file");
  if (!phone) return NextResponse.json({ error: "Which number?" }, { status: 400 });
  if (!file || typeof file === "string") return NextResponse.json({ error: "Pick a photo or PDF" }, { status: 400 });
  if (!SEND_TYPES[file.type]) return NextResponse.json({ error: "Send a JPEG or PNG photo, or a PDF." }, { status: 400 });
  if (file.size > MAX_SEND_BYTES) return NextResponse.json({ error: "That file is over 4 MB." }, { status: 400 });

  const db = getSupabaseAdmin();
  const { data: contact } = await db.from("wa_contacts").select("*").eq("phone", phone).maybeSingle();
  if (!inWindow(contact)) {
    return NextResponse.json({ error: "Their last message was over 24 hours ago, so only a template can be sent." }, { status: 400 });
  }
  try {
    await sendMedia(
      phone,
      { buffer: Buffer.from(await file.arrayBuffer()), mime: file.type, name: String(file.name || "").slice(0, 120) || null },
      form.get("caption"),
      session.email || "admin"
    );
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
  // Answered, as a typed reply is.
  await db.from("wa_contacts").update({ handoff_at: null }).eq("phone", phone);
  return NextResponse.json({ ok: true });
}
