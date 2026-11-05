import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/serverSession";
import { isSuperAdmin } from "@/lib/permissions";
import { graph, whatsappReady } from "@/lib/whatsapp";

/**
 * CRM > WhatsApp Templates: every message template on the business account,
 * with the status Meta gives it (approved, pending, rejected, paused).
 *
 * GET   the list, read live from Meta. Needs WA_WABA_ID (the WhatsApp
 *       Business Account id, not the phone number id) and a token that may
 *       read templates. Without them, `error` says what is missing.
 */

export async function GET(req) {
  const session = await getSessionFromRequest(req);
  if (!session || !isSuperAdmin(session)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  const waba = process.env.WA_WABA_ID;
  if (!whatsappReady() || !waba) {
    return NextResponse.json({
      templates: [],
      error: "Add WA_WABA_ID (your WhatsApp Business Account id from WhatsApp Manager) to the Vercel settings to see live status.",
    });
  }

  const fields = "name,status,category,language,components,quality_score,rejected_reason,last_updated_time";
  const res = await fetch(`${graph(`${waba}/message_templates`)}?fields=${fields}&limit=100`, {
    headers: { Authorization: `Bearer ${process.env.WA_TOKEN}` },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json({ templates: [], error: data?.error?.message || `Meta refused the request (${res.status})` });
  }

  const templates = (data.data || []).map((t) => ({
    id: t.id,
    name: t.name,
    status: t.status,
    category: t.category,
    language: t.language,
    quality: t.quality_score?.score || null,
    rejected_reason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
    updated: t.last_updated_time || null,
    words: (t.components || []).find((c) => c.type === "BODY")?.text || "",
  }));
  return NextResponse.json({ templates });
}
