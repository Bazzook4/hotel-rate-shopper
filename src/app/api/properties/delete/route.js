import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import { getSupabaseAdmin } from "@/lib/database";

/**
 * Erase a hotel and everything it holds: for trial accounts the super admin
 * set up and no longer wants. Super admin only, and the caller must send
 * the hotel's name exactly as a second check.
 *
 * GET ?id= says what would go, so the confirm can name it. POST erases.
 *
 * Almost every table hangs off properties with on delete cascade, but a few
 * links are on delete restrict (wallet top-ups and wallet payments to
 * guests and companies, rooms and bookings to room types), and Postgres
 * checks restrict before the cascade reaches the rows that would clear it.
 * So those rows go first, in order, and the property row last.
 *
 * The hotel's own logins go too: users linked to this hotel and no other,
 * never a super admin. Guest ID photos are removed from storage.
 */

const BUCKET = "guest-ids";

async function count(supabase, table, propertyId) {
  const { count: n } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("property_id", propertyId);
  return n ?? 0;
}

/** Users whose only hotel is this one, leaving out super admins. */
async function ownUsers(supabase, propertyId) {
  const { data: links } = await supabase
    .from("user_properties")
    .select("user_id")
    .eq("property_id", propertyId);
  const ids = (links || []).map((l) => l.user_id);
  if (ids.length === 0) return [];

  const [{ data: users }, { data: other }] = await Promise.all([
    supabase.from("users").select("id, email, role").in("id", ids),
    supabase.from("user_properties").select("user_id").in("user_id", ids).neq("property_id", propertyId),
  ]);
  const elsewhere = new Set((other || []).map((l) => l.user_id));
  return (users || []).filter((u) => u.role !== "SuperAdmin" && !elsewhere.has(u.id));
}

async function guard(req) {
  const session = await getSessionFromRequest(req);
  if (!session || !isSuperAdmin(session)) {
    return { error: NextResponse.json({ error: "Only a super admin can delete a hotel." }, { status: 403 }) };
  }
  return { session };
}

export async function GET(req) {
  const { error } = await guard(req);
  if (error) return error;

  const id = new URL(req.url).searchParams.get("id");
  const supabase = getSupabaseAdmin();
  const { data: property } = await supabase.from("properties").select("id, name").eq("id", id).maybeSingle();
  if (!property) return NextResponse.json({ error: "Hotel not found" }, { status: 404 });

  const [bookings, guests, rooms, users] = await Promise.all([
    count(supabase, "reservations", id),
    count(supabase, "guests", id),
    count(supabase, "rooms", id),
    ownUsers(supabase, id),
  ]);
  return NextResponse.json({
    name: property.name,
    bookings,
    guests,
    rooms,
    users: users.map((u) => u.email),
  });
}

export async function POST(req) {
  const { session, error } = await guard(req);
  if (error) return error;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { id, name } = body || {};

  const supabase = getSupabaseAdmin();
  const { data: property } = await supabase.from("properties").select("id, name").eq("id", id).maybeSingle();
  if (!property) return NextResponse.json({ error: "Hotel not found" }, { status: 404 });
  if (String(name || "").trim() !== property.name.trim()) {
    return NextResponse.json({ error: "The name typed does not match the hotel." }, { status: 400 });
  }
  if (session.propertyId === id) {
    return NextResponse.json({ error: "Switch to another hotel before deleting this one." }, { status: 400 });
  }

  const users = await ownUsers(supabase, id);

  // ID photo files, listed on each guest.
  const { data: guests } = await supabase.from("guests").select("id_photos").eq("property_id", id);
  const paths = (guests || []).flatMap((g) => (Array.isArray(g.id_photos) ? g.id_photos : []).map((p) => p?.path)).filter(Boolean);

  // Restricting rows first, then the property, whose cascade takes the rest.
  const steps = [
    ["wallet_transactions", (q) => q.eq("property_id", id)],
    ["reservations", (q) => q.eq("property_id", id)],
    ["rooms", (q) => q.eq("property_id", id)],
    ["properties", (q) => q.eq("id", id)],
  ];
  for (const [table, where] of steps) {
    const { error: err } = await where(supabase.from(table).delete());
    // A table from a migration not yet run has nothing to delete.
    if (err && err.code !== "42P01" && err.code !== "PGRST205") {
      return NextResponse.json(
        { error: `Stopped while deleting ${table}: ${err.message}. Try again to finish.` },
        { status: 500 }
      );
    }
  }

  // Best effort from here on: the hotel itself is gone.
  for (let i = 0; i < paths.length; i += 100) {
    await supabase.storage.from(BUCKET).remove(paths.slice(i, i + 100));
  }
  if (users.length) {
    await supabase.from("users").delete().in("id", users.map((u) => u.id));
  }

  return NextResponse.json({ ok: true, usersDeleted: users.length, filesDeleted: paths.length });
}
