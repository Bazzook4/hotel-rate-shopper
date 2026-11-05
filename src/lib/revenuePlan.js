import { getSupabaseAdmin } from '@/lib/database';
import { getDailyActuals, getMonthlyActuals, notMigrated } from '@/lib/reports';
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

/** Rows of a goal-shaped table for [first, last] month, keyed 'YYYY-MM'. */
async function readRows(propertyId, table, first, last) {
  const { data, error } = await getSupabaseAdmin()
    .from(table)
    .select('month, occupancy_pct, adr, revenue, segments')
    .eq('property_id', propertyId)
    .gte('month', first)
    .lte('month', last);
  if (error && !notMigrated(error)) throw new Error(`Failed to load ${table}: ${error.message}`);
  const out = {};
  for (const g of data || []) {
    out[String(g.month).slice(0, 7)] = {
      occupancy: g.occupancy_pct == null ? null : Number(g.occupancy_pct),
      adr: g.adr == null ? null : Number(g.adr),
      revenue: g.revenue == null ? null : Number(g.revenue),
      segments: g.segments || [],
    };
  }
  return { rows: out, missing: Boolean(error) };
}

/** What the system saw last year, as a goal-shaped figure with the mix as shares. */
function fromBookings(a) {
  const segments = Object.entries(a.bySegment || {}).map(([key, x]) => ({
    key,
    share: a.roomNights > 0 ? Math.round((x.roomNights / a.roomNights) * 1000) / 10 : 0,
    adr: x.adr,
  }));
  return { source: 'bookings', occupancy: a.occupancy, adr: a.adr, revenue: a.revenue, roomNights: a.roomNights, segments };
}

export async function getRevenuePlan(propertyId, year, today = null) {
  const months = monthsOf(year);
  const before = monthsOf(year - 1);

  const [goals, history, now, past] = await Promise.all([
    readRows(propertyId, 'revenue_goals', months[0].start, months[11].start),
    readRows(propertyId, 'revenue_history', before[0].start, before[11].start),
    getMonthlyActuals(propertyId, months[0].start, months[11].end, months, today),
    getMonthlyActuals(propertyId, before[0].start, before[11].end, before),
  ]);

  // Last year per month of this year: real bookings if there are any, else
  // what the hotel typed in, else nothing (the page offers to add it).
  const lastYear = {};
  months.forEach((m, i) => {
    const ly = before[i].month;
    const real = past.actuals[ly];
    if (real && real.roomNights > 0) lastYear[m.month] = { ...fromBookings(real), lastMonth: ly };
    else if (history.rows[ly]) lastYear[m.month] = { ...history.rows[ly], source: 'entered', lastMonth: ly };
  });

  return {
    year,
    capacity: now.capacity,
    months,
    goals: goals.rows,
    actuals: now.actuals,
    lastYear,
    lastMonths: before.map((m) => m.month),
    needsMigration: goals.missing || history.missing,
  };
}

/** Save the goals for the months given. An empty goal removes that month's row. */
export async function saveRevenueGoals(propertyId, goals, table = 'revenue_goals') {
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
      const { error } = await supabase.from(table).delete().eq('property_id', propertyId).eq('month', month);
      if (error) throw new Error(`Failed to clear the goal: ${error.message}`);
      continue;
    }
    const { error } = await supabase.from(table).upsert(
      { property_id: propertyId, month, occupancy_pct: occ, adr, revenue, segments, updated_at: new Date().toISOString() },
      { onConflict: 'property_id,month' }
    );
    if (error) throw new Error(`Failed to save the goal: ${error.message}`);
  }
}

/** One month night by night. `month` is 'YYYY-MM'. */
export async function getDailyPlan(propertyId, month) {
  const [y, m] = month.split('-').map(Number);
  const m0 = monthsOf(y)[m - 1];
  return { month, ...(await getDailyActuals(propertyId, month, m0.start, m0.end)) };
}
