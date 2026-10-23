import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import { getSupabaseAdmin } from "@/lib/database";

/**
 * How each onboarded hotel is getting on: what it has set up, the bookings
 * it has made and when its own staff last opened the app. For the super
 * admin to spot new sign-ups that stalled and hotels that went quiet.
 *
 * Bookings are counted by when they were created, not stayed, since the
 * question is whether the hotel is using the app. Cancelled and no-show
 * bookings are left out of counts and value. A booking with a partner
 * booking id came in from the channel manager; the rest were made at the
 * desk, which is the clearer sign that the hotel uses the PMS itself.
 *
 * "Last opened" comes from page_opens (migration 042) and leaves out super
 * admin visits, so looking into a hotel does not make it look busy.
 */

const PAGE = 1000;
const DAY = 24 * 60 * 60 * 1000;

async function allReservations(supabase) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("reservations")
      .select("property_id, total_amount, status, created_at, partner_booking_id")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

async function countOf(query) {
  const { count, error } = await query;
  return error ? null : count ?? 0;
}

export async function GET(req) {
  const session = await getSessionFromRequest(req);
  if (!session || !isSuperAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();

  const { data: properties, error } = await supabase
    .from("properties")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let reservations;
  try {
    reservations = await allReservations(supabase);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  const since30 = Date.now() - 30 * DAY;
  const since7Day = new Date(Date.now() - 7 * DAY).toISOString().slice(0, 10);

  const bookings = new Map();
  for (const r of reservations) {
    if (r.status === "cancelled" || r.status === "no_show") continue;
    const b = bookings.get(r.property_id) || {
      count: 0, value: 0, desk: 0, count30: 0, value30: 0, last: null,
    };
    const amount = Number(r.total_amount) || 0;
    b.count += 1;
    b.value += amount;
    if (!r.partner_booking_id) b.desk += 1;
    if (new Date(r.created_at).getTime() >= since30) {
      b.count30 += 1;
      b.value30 += amount;
    }
    b.last = r.created_at;
    bookings.set(r.property_id, b);
  }

  const rows = await Promise.all(
    properties.map(async (p) => {
      const [roomTypes, rooms, lastOpen, opens7] = await Promise.all([
        countOf(
          supabase.from("room_types").select("id", { count: "exact", head: true }).eq("property_id", p.id)
        ),
        countOf(
          supabase
            .from("rooms")
            .select("id", { count: "exact", head: true })
            .eq("property_id", p.id)
            .eq("is_active", true)
        ),
        supabase
          .from("page_opens")
          .select("opened_on")
          .eq("property_id", p.id)
          .neq("role", "SuperAdmin")
          .order("opened_on", { ascending: false })
          .limit(1)
          .then(({ data }) => data?.[0]?.opened_on ?? null),
        countOf(
          supabase
            .from("page_opens")
            .select("id", { count: "exact", head: true })
            .eq("property_id", p.id)
            .neq("role", "SuperAdmin")
            .gte("opened_on", since7Day)
        ),
      ]);
      const b = bookings.get(p.id);
      return {
        id: p.id,
        name: p.name,
        city: p.city,
        contact_name: p.contact_name ?? null,
        contact_phone: p.contact_phone ?? null,
        created_at: p.created_at,
        total_rooms: p.total_rooms,
        room_types: roomTypes,
        rooms,
        bookings: b?.count ?? 0,
        bookings_value: b?.value ?? 0,
        desk_bookings: b?.desk ?? 0,
        bookings_30: b?.count30 ?? 0,
        value_30: b?.value30 ?? 0,
        last_booking: b?.last ?? null,
        last_open: lastOpen,
        opens_7: opens7,
      };
    })
  );

  return NextResponse.json({ rows });
}
