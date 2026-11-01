import { NextResponse } from "next/server";
import { getPropertyClock, getPropertyCurrency, getSupabaseAdmin } from "@/lib/database";
import { getNightAudit, localDay, localToday, shiftDay } from "@/lib/financeReports";
import { formatAmount } from "@/lib/money";
import { sendTemplate, waPhone, whatsappReady } from "@/lib/whatsapp";

/**
 * The 8 AM WhatsApp run (vercel.json, 08:00 IST). Two lists:
 *
 * - each hotel contact ticked for the daily report in Admin > WhatsApp
 * - each live plan from Admin > Usage (migration 070): the daily report or a
 *   reminder to the hotel's contact mobile, for its number of days
 *
 * A phone gets at most one daily report a morning, whichever list it is on.
 * Templates are used, so they reach a hotel however long since it last wrote.
 *
 * The report: today's arrivals and departures and the rooms sold tonight
 * from the night audit, as on the Today page; yesterday's revenue is room
 * and other charges before tax.
 *
 * The reminder asks a hotel whose rooms are not set up how far it got
 * (setup_reminder_v2), and one with no booking in a week since when
 * (day3_checkin_v2). A hotel that needs neither has its plan ended.
 *
 * A plan's day counts only when its message went out; three failed
 * mornings in a row end it, with the reason kept. Each morning is claimed
 * on the plan before sending, so two runs at once cannot both send.
 *
 * There is no session: Vercel sends CRON_SECRET as a bearer token. Without
 * the secret set, the call is refused rather than left open.
 */

export const maxDuration = 300;

const QUIET_DAYS = 7;
const MAX_FAILS = 3;
const firstName = (name) => (name ? String(name).trim().split(/\s+/)[0] : null);
const IST = "Asia/Kolkata";

async function sendReport(phone, name, propertyId) {
  const [tz, currency] = await Promise.all([getPropertyClock(propertyId), getPropertyCurrency(propertyId)]);
  const today = localToday(tz);
  const [now, yesterday] = await Promise.all([
    getNightAudit(propertyId, { date: today, tz }),
    getNightAudit(propertyId, { date: shiftDay(today, -1), tz }),
  ]);
  const occupancy = now.rooms.occupancy == null ? "-" : `${Math.round(now.rooms.occupancy)}%`;
  const revenue = (yesterday.revenue.room || 0) + (yesterday.revenue.otherTotal || 0);
  await sendTemplate(
    phone,
    "daily_report_v2",
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
}

const count = async (query) => (await query).count ?? 0;

/** The reminder this hotel needs today, or null once it is using the app. */
async function reminderFor(db, p) {
  const [roomTypes, rooms, lastBooking, tz] = await Promise.all([
    count(db.from("room_types").select("id", { count: "exact", head: true }).eq("property_id", p.id)),
    count(db.from("rooms").select("id", { count: "exact", head: true }).eq("property_id", p.id).eq("is_active", true)),
    db
      .from("reservations")
      .select("created_at")
      .eq("property_id", p.id)
      .not("status", "in", "(cancelled,no_show)")
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => data?.[0]?.created_at ?? null),
    getPropertyClock(p.id),
  ]);
  const done = !roomTypes ? 0 : !rooms ? 50 : p.total_rooms ? Math.min(100, Math.round((rooms / p.total_rooms) * 100)) : 100;
  if (done < 100) return { template: "setup_reminder_v2", third: done ? `${done}%` : "not yet" };

  const shown = (ts) =>
    new Date(`${localDay(ts, tz)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  if (!lastBooking) return { template: "day3_checkin_v2", third: shown(p.created_at) };
  if (Date.now() - Date.parse(lastBooking) > QUIET_DAYS * 86400000) return { template: "day3_checkin_v2", third: shown(lastBooking) };
  return null;
}

async function runPlans(db, reported) {
  const { data: plans, error } = await db
    .from("wa_schedules")
    .select("id, kind, days, sent, fails, last_sent_on, properties(id, name, contact_name, contact_phone, total_rooms, created_at)")
    .is("stopped_at", null);
  if (error) return [{ plans: false, error: error.message }];

  const today = localToday(IST);
  const results = [];
  for (const plan of plans || []) {
    const p = plan.properties;
    if (!p || plan.last_sent_on === today) continue;
    const end = (reason, extra = {}) =>
      db.from("wa_schedules").update({ stopped_at: new Date().toISOString(), stop_reason: reason, ...extra }).eq("id", plan.id);

    // Claim this morning first; a run already on it gets nothing back.
    const { data: claimed } = await db
      .from("wa_schedules")
      .update({ last_sent_on: today })
      .eq("id", plan.id)
      .is("stopped_at", null)
      .or(`last_sent_on.is.null,last_sent_on.neq.${today}`)
      .select("id");
    if (!claimed?.length) continue;

    const phone = waPhone(p.contact_phone);
    if (!phone) {
      await end("No contact mobile on this hotel");
      continue;
    }
    const name = firstName(p.contact_name) || p.name;
    let sentError = null;
    try {
      if (plan.kind === "daily_report") {
        if (!reported.has(phone)) await sendReport(phone, name, p.id);
        reported.add(phone);
      } else {
        const r = await reminderFor(db, p);
        if (!r) {
          await end("The hotel is set up and taking bookings");
          continue;
        }
        await sendTemplate(phone, r.template, [name, p.name, r.third], "reminder");
      }
    } catch (err) {
      sentError = err.message.slice(0, 300);
    }
    if (sentError) {
      const fails = (plan.fails || 0) + 1;
      const changes = { fails, last_error: sentError };
      if (fails >= MAX_FAILS) await end(`Could not send for ${MAX_FAILS} mornings`, changes);
      else await db.from("wa_schedules").update(changes).eq("id", plan.id);
    } else {
      const sent = plan.sent + 1;
      const changes = { sent, fails: 0, last_error: null };
      if (sent >= plan.days) await end("All days sent", changes);
      else await db.from("wa_schedules").update(changes).eq("id", plan.id);
    }
    results.push({ phone, kind: plan.kind, ok: !sentError, error: sentError || undefined });
  }
  return results;
}

export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!whatsappReady()) return NextResponse.json({ sent: 0, skipped: "WhatsApp is not connected" });

  const db = getSupabaseAdmin();
  const { data: contacts, error } = await db
    .from("wa_contacts")
    .select("phone, name, property_id, properties(name)")
    .eq("opted_in", true)
    .not("property_id", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = [];
  const reported = new Set();
  for (const c of contacts || []) {
    try {
      await sendReport(c.phone, firstName(c.name) || c.properties?.name || "there", c.property_id);
      reported.add(c.phone);
      results.push({ phone: c.phone, ok: true });
    } catch (err) {
      results.push({ phone: c.phone, ok: false, error: err.message });
    }
  }

  results.push(...(await runPlans(db, reported)));
  return NextResponse.json({ sent: results.filter((r) => r.ok).length, results });
}
