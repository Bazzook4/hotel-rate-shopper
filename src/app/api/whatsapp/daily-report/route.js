import { NextResponse } from "next/server";
import { getPropertyClock, getPropertyCurrency, getSupabaseAdmin } from "@/lib/database";
import { getNightAudit, localToday, shiftDay } from "@/lib/financeReports";
import { formatAmount } from "@/lib/money";
import { sendTemplate, whatsappReady } from "@/lib/whatsapp";

/**
 * The morning WhatsApp report to each hotel contact ticked for it in
 * Admin > WhatsApp (vercel.json, 08:00 IST). Uses the approved daily_report
 * template, so it reaches them however long since they last wrote.
 *
 * Today's arrivals and departures and the rooms sold tonight come from the
 * night audit, as on the Today page; yesterday's revenue is room and other
 * charges before tax.
 *
 * There is no session: Vercel sends CRON_SECRET as a bearer token. Without
 * the secret set, the call is refused rather than left open.
 */
export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!whatsappReady()) return NextResponse.json({ sent: 0, skipped: "WhatsApp is not connected" });

  const { data: contacts, error } = await getSupabaseAdmin()
    .from("wa_contacts")
    .select("phone, name, property_id, properties(name)")
    .eq("opted_in", true)
    .not("property_id", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = [];
  for (const c of contacts || []) {
    try {
      const [tz, currency] = await Promise.all([getPropertyClock(c.property_id), getPropertyCurrency(c.property_id)]);
      const today = localToday(tz);
      const [now, yesterday] = await Promise.all([
        getNightAudit(c.property_id, { date: today, tz }),
        getNightAudit(c.property_id, { date: shiftDay(today, -1), tz }),
      ]);
      const name = c.name ? c.name.split(" ")[0] : c.properties?.name || "there";
      const occupancy = now.rooms.occupancy == null ? "-" : `${Math.round(now.rooms.occupancy)}%`;
      const revenue = (yesterday.revenue.room || 0) + (yesterday.revenue.otherTotal || 0);
      await sendTemplate(
        c.phone,
        "daily_report",
        [
          name,
          String(now.movement.arrivals.expected),
          String(now.movement.departures.expected),
          String(now.rooms.occupied),
          occupancy,
          formatAmount(revenue, { currency }),
        ],
        "daily report"
      );
      results.push({ phone: c.phone, ok: true });
    } catch (err) {
      results.push({ phone: c.phone, ok: false, error: err.message });
    }
  }

  return NextResponse.json({ sent: results.filter((r) => r.ok).length, results });
}
