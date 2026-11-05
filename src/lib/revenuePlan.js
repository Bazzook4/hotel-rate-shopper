import { getSupabaseAdmin } from '@/lib/database';
import { getMonthlyActuals, notMigrated } from '@/lib/reports';
import { cleanSegments } from '@/lib/revenuePlanMath';

/**
 * The Revenue Planner: a year of monthly goals set against what was achieved.
 * Goals are stored; achievements are read from the reservations each time.
 */

const pad = (n) => String(n).padStart(2, '0');

/** The twelve months of a year as { month, start, end, days }. */
export function monthsOf(year) {
  return Array.from({ length: 12 }, (_, i) => {
    const days = new Date(Date.UTC(year, i + 1, 0)).getUTCDate();
    return {
      month: `${year}-${pad(i + 1)}`,
      start: `${year}-${pad(i + 1)}-01`,
      end: `${year}-${pad(i + 1)}-${pad(days)}`,
      days,
    };
  });
}

export async function getRevenuePlan(propertyId, year) {
  const months = monthsOf(year);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('revenue_goals')
    .select('month, occupancy_pct, adr, revenue, segments')
    .eq('property_id', propertyId)
    .gte('month', months[0].start)
    .lte('month', months[11].start);
  if (error && !notMigrated(error)) throw new Error(`Failed to load goals: ${error.message}`);

  const goals = {};
  for (const g of data || []) {
    goals[String(g.month).slice(0, 7)] = {
      occupancy: g.occupancy_pct == null ? null : Number(g.occupancy_pct),
      adr: g.adr == null ? null : Number(g.adr),
      revenue: g.revenue == null ? null : Number(g.revenue),
      segments: g.segments || [],
    };
  }

  const { capacity, actuals } = await getMonthlyActuals(propertyId, months[0].start, months[11].end, months);
  return { year, capacity, months, goals, actuals, needsMigration: Boolean(error) };
}

/** Save the goals for the months given. An empty goal removes that month's row. */
export async function saveRevenueGoals(propertyId, goals) {
  const supabase = getSupabaseAdmin();
  for (const g of goals) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(g.month || '')) throw new Error('Choose a valid month');
    const month = `${g.month}-01`;
    const occ = g.occupancy == null || g.occupancy === '' ? null : Number(g.occupancy);
    const adr = g.adr == null || g.adr === '' ? null : Number(g.adr);
    const revenue = g.revenue == null || g.revenue === '' ? null : Number(g.revenue);
    for (const v of [occ, adr, revenue]) {
      if (v != null && (!Number.isFinite(v) || v < 0)) throw new Error('Goals must be numbers, zero or more');
    }
    if (occ != null && occ > 100) throw new Error('Occupancy cannot be more than 100%');
    const segments = cleanSegments(g.segments);
    const share = segments.reduce((a, s) => a + s.share, 0);
    if (share > 100.01) throw new Error('The business mix adds up to more than 100%');

    if (occ == null && adr == null && revenue == null && segments.length === 0) {
      const { error } = await supabase.from('revenue_goals').delete().eq('property_id', propertyId).eq('month', month);
      if (error) throw new Error(`Failed to clear the goal: ${error.message}`);
      continue;
    }
    const { error } = await supabase.from('revenue_goals').upsert(
      { property_id: propertyId, month, occupancy_pct: occ, adr, revenue, segments, updated_at: new Date().toISOString() },
      { onConflict: 'property_id,month' }
    );
    if (error) throw new Error(`Failed to save the goal: ${error.message}`);
  }
}
