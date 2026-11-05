import { getSupabaseAdmin } from '@/lib/database';

/**
 * How many ID proofs a booking still lacks: one per adult, and a proof is
 * a guest on the booking with an ID photo on their record. Guests named on
 * the booking count; with nobody named, the booker is the one guest.
 *
 * Only bookings that are due or here are looked at. Returns a map of
 * reservation id to the number missing; a booking with none missing is left
 * out. If the ID photo column is not there yet (migration 051), nothing is
 * flagged rather than flagging every booking.
 */
export async function idProofsMissing(reservations) {
  const live = (reservations || []).filter((r) => r.status === 'confirmed' || r.status === 'in_house');
  if (!live.length) return {};
  const supabase = getSupabaseAdmin();

  // In batches, so a long list does not make the request too long to send.
  const named = [];
  for (let i = 0; i < live.length; i += 150) {
    const { data, error } = await supabase
      .from('reservation_guests')
      .select('reservation_id, guest_id')
      .in('reservation_id', live.slice(i, i + 150).map((r) => r.id));
    if (error) return {};
    named.push(...(data || []));
  }

  const guestsOf = new Map();
  for (const row of named) {
    if (!guestsOf.has(row.reservation_id)) guestsOf.set(row.reservation_id, new Set());
    guestsOf.get(row.reservation_id).add(row.guest_id || null);
  }
  // Nobody named: the booker stands for the one guest.
  for (const r of live) {
    if (!guestsOf.has(r.id)) guestsOf.set(r.id, new Set([r.guest_id || null]));
  }

  const guestIds = [...new Set([...guestsOf.values()].flatMap((s) => [...s]).filter(Boolean))];
  const withPhoto = new Set();
  for (let i = 0; i < guestIds.length; i += 150) {
    const { data, error: photoError } = await supabase.from('guests').select('id, id_photos').in('id', guestIds.slice(i, i + 150));
    if (photoError) return {};
    for (const g of data || []) if (Array.isArray(g.id_photos) && g.id_photos.length) withPhoto.add(g.id);
  }

  const out = {};
  for (const r of live) {
    const have = [...guestsOf.get(r.id)].filter((id) => id && withPhoto.has(id)).length;
    const missing = Math.max(0, (Number(r.adults) || 1) - have);
    if (missing) out[r.id] = missing;
  }
  return out;
}
