import { getPropertyClock } from "@/lib/database";
import { localDay } from "@/lib/financeReports";

/**
 * How far a hotel has got, in the words the WhatsApp reminder templates use.
 * The 8 AM plans and the inbox's template boxes both read it, so a hand-sent
 * reminder says what the automatic one would.
 *
 * p: { id, total_rooms, created_at }
 * Returns { done, setup, since, lastBooking }: done is percent set up, setup
 * reads after "is" in setup_reminder_v2 ("60%", "not yet"), since is the day
 * of the last booking, or of signing up if there has been none ("20 Oct").
 */
const count = async (query) => (await query).count ?? 0;

export async function hotelProgress(db, p) {
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
  const from = lastBooking || p.created_at;
  const since = from
    ? new Date(`${localDay(from, tz)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
    : "";
  return { done, setup: done ? `${done}%` : "not yet", since, lastBooking };
}
