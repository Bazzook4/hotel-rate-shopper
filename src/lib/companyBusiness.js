import { getSupabaseAdmin } from '@/lib/database';
import { localToday, shiftDay } from '@/lib/financeReports';
import { DEFAULT_ZONE } from '@/lib/hotelTime';
import { readAll, round } from '@/lib/reports';

/**
 * The business each company or agent brought in over the last 12 months:
 * stays it booked that arrived in that time, the nights they stayed and
 * their room value -- whoever paid the bill. Cancelled and no-show bookings
 * and inquiries are not business done.
 */

export const BUSINESS_DAYS = 365;

const DONE_STATUSES = ['confirmed', 'in_house', 'checked_out'];

const nightsOf = (r) =>
  Math.max(0, Math.round((Date.parse(`${r.check_out}T00:00:00Z`) - Date.parse(`${r.check_in}T00:00:00Z`)) / 86400000));

export async function businessByCompany(propertyId, { tz = DEFAULT_ZONE } = {}) {
  const today = localToday(tz);
  const from = shiftDay(today, -(BUSINESS_DAYS - 1));
  const supabase = getSupabaseAdmin();

  const stays = await readAll(
    () =>
      supabase
        .from('reservations')
        .select('id, company_id, check_in, check_out, total_amount')
        .eq('property_id', propertyId)
        .not('company_id', 'is', null)
        .in('status', DONE_STATUSES)
        .gte('check_in', from)
        .lte('check_in', today)
        .order('id'),
    'company bookings'
  );

  const out = new Map();
  for (const r of stays) {
    const t = out.get(r.company_id) || { bookings: 0, nights: 0, value: 0 };
    t.bookings += 1;
    t.nights += nightsOf(r);
    t.value += Number(r.total_amount) || 0;
    out.set(r.company_id, t);
  }
  for (const t of out.values()) t.value = round(t.value);
  return { from, to: today, byCompany: out };
}
