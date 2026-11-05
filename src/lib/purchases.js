import { getSupabaseAdmin } from '@/lib/database';
import { cleanEntry } from '@/lib/cashBook';
import { localDay, localToday, shiftDay } from '@/lib/financeReports';
import { DEFAULT_ZONE } from '@/lib/hotelTime';
import { notMigrated, readAll, round } from '@/lib/reports';

/**
 * Purchases: what the hotel buys, what is left, and when to buy again.
 *
 * Stock is never stored. It is the last count, plus what was bought since,
 * minus what was taken out by hand since, minus the per-guest-night use times
 * the guest nights since (guests in house or checked out, up to today).
 * A count resets the starting point, so a miscount is fixed by counting.
 *
 * - consumable: soap, brush. Asks to be bought again at the reorder level.
 * - longlife: towels, linen. Same reorder level, and also due for
 *   replacement a set number of months after the last purchase.
 * - asset: a TV, a geyser. No stock, only a replace-after time.
 */

export const KINDS = {
  consumable: 'Consumable',
  longlife: 'Long-life',
  asset: 'Asset',
};

export const PURCHASE_TAG = 'Purchases';
const MESSAGE = 'This page is not switched on yet. Ask your OnlineHotelier contact.';

function wrap(err) {
  return notMigrated(err) ? new Error(MESSAGE) : err;
}

function addMonths(day, months) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Guests in the house each night, from the earliest day wanted up to today. */
async function guestsByNight(supabase, propertyId, from, today) {
  const rows = await readAll(
    () =>
      supabase
        .from('reservation_nights')
        .select('stay_date, reservations!inner(property_id, status, adults, children)')
        .eq('reservations.property_id', propertyId)
        .in('reservations.status', ['in_house', 'checked_out'])
        .gte('stay_date', from)
        .lte('stay_date', today)
        .order('reservation_id')
        .order('stay_date'),
    'guest nights'
  );
  const map = {};
  for (const r of rows) {
    const guests = (Number(r.reservations.adults) || 0) + (Number(r.reservations.children) || 0);
    map[r.stay_date] = (map[r.stay_date] || 0) + guests;
  }
  return map;
}

/** Every item with what is left, what it is used per night and whether it needs buying. */
export async function getPurchases(propertyId, { tz = DEFAULT_ZONE } = {}) {
  const supabase = getSupabaseAdmin();
  let items;
  let moves;
  try {
    [items, moves] = await Promise.all([
      readAll(() => supabase.from('stock_items').select('*').eq('property_id', propertyId).is('archived_at', null).order('name').order('id'), 'items'),
      readAll(() => supabase.from('stock_moves').select('*').eq('property_id', propertyId).is('voided_at', null).order('created_at').order('id'), 'purchases'),
    ]);
  } catch (err) {
    if (notMigrated(err)) return { ready: false, message: MESSAGE };
    throw err;
  }
  const today = localToday(tz);
  const byItem = {};
  for (const m of moves) (byItem[m.item_id] ||= []).push(m);

  // Nights are read once, from the oldest starting point of any used-up item.
  const starts = items.filter((i) => i.kind !== 'asset' && Number(i.per_guest_night) > 0).map((i) => {
    const counts = (byItem[i.id] || []).filter((m) => m.kind === 'count');
    return localDay((counts[counts.length - 1] || i).created_at, tz);
  });
  const nights = starts.length ? await guestsByNight(supabase, propertyId, starts.sort()[0], today) : {};

  const rows = items.map((item) => {
    const list = byItem[item.id] || [];
    const lastCount = [...list].reverse().find((m) => m.kind === 'count');
    const since = lastCount ? list.slice(list.indexOf(lastCount) + 1) : list;
    const startDay = localDay((lastCount || item).created_at, tz);
    const bought = since.filter((m) => m.kind === 'purchase').reduce((s, m) => s + Number(m.qty), 0);
    const taken = since.filter((m) => m.kind === 'used').reduce((s, m) => s + Number(m.qty), 0);
    const guestNights = Object.entries(nights).reduce((s, [d, g]) => (d >= startDay ? s + g : s), 0);
    const rate = Number(item.per_guest_night) || 0;
    const auto = item.kind === 'asset' ? 0 : rate * guestNights;
    const onHand = item.kind === 'asset' ? null : round(Number(lastCount?.qty || 0) + bought - taken - auto);

    const lastBought = [...list].reverse().find((m) => m.kind === 'purchase' || m.kind === 'count');
    const boughtOn = lastBought ? lastBought.move_date : localDay(item.created_at, tz);
    const replaceOn = item.replace_after_months ? addMonths(boughtOn, item.replace_after_months) : null;
    const low = item.kind !== 'asset' && onHand <= Number(item.reorder_level);
    const old = replaceOn != null && replaceOn <= today;
    // Days of stock left at today's rate of use: guest nights of the last 14 days.
    const recent = Object.entries(nights).filter(([d]) => d > shiftDay(today, -14)).reduce((s, [, g]) => s + g, 0);
    const perDay = (rate * recent) / 14;
    const daysLeft = item.kind !== 'asset' && perDay > 0 && onHand > 0 ? Math.floor(onHand / perDay) : null;
    return {
      id: item.id,
      name: item.name,
      kind: item.kind,
      kindLabel: KINDS[item.kind],
      unit: item.unit,
      perGuestNight: rate,
      reorderLevel: Number(item.reorder_level) || 0,
      replaceAfterMonths: item.replace_after_months,
      onHand,
      daysLeft,
      boughtOn,
      replaceOn,
      status: low ? 'low' : old ? 'old' : 'ok',
      history: [...list]
        .reverse()
        .slice(0, 20)
        .map((m) => ({ id: m.id, kind: m.kind, qty: Number(m.qty), date: m.move_date, cost: m.cost == null ? null : Number(m.cost), supplier: m.supplier, notes: m.notes })),
    };
  });

  return { ready: true, today, items: rows, needAttention: rows.filter((r) => r.status !== 'ok').length, kinds: KINDS };
}

const text = (v, n = 200) => (v == null ? null : String(v).trim().slice(0, n) || null);
const num = (v, what, { min = 0 } = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) throw new Error(`Enter ${what} as a number${min > 0 ? ' above zero' : ', 0 or more'}.`);
  return Math.round(n * 100) / 100;
};

/** A new item, with what is on the shelf now as its first count. */
export async function addItem(propertyId, raw, userId, tz = DEFAULT_ZONE) {
  const name = text(raw?.name, 80);
  if (!name) throw new Error('Name the item.');
  const kind = raw?.kind || 'consumable';
  if (!KINDS[kind]) throw new Error('Choose consumable, long-life or asset.');
  const months = raw?.replaceAfterMonths ? Math.round(num(raw.replaceAfterMonths, 'months', { min: 1 })) : null;
  const row = {
    property_id: propertyId,
    name,
    kind,
    unit: text(raw?.unit, 20) || 'pcs',
    per_guest_night: kind === 'consumable' || kind === 'longlife' ? Math.round(Number(raw?.perGuestNight || 0) * 1000) / 1000 : 0,
    reorder_level: kind === 'asset' ? 0 : num(raw?.reorderLevel || 0, 'the reorder level'),
    replace_after_months: months,
  };
  if (!(row.per_guest_night >= 0)) throw new Error('Enter the use per guest night as 0 or more.');
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('stock_items').insert(row).select('id').single();
  if (error) throw wrap(Object.assign(new Error(`Failed to save: ${error.message}`), { code: error.code }));
  if (kind !== 'asset') {
    const { error: e2 } = await supabase.from('stock_moves').insert({
      property_id: propertyId,
      item_id: data.id,
      kind: 'count',
      qty: num(raw?.onHand || 0, 'what is in stock now'),
      move_date: localToday(tz),
      notes: 'Starting stock',
      recorded_by: userId || null,
    });
    if (e2) throw new Error(`Saved the item, but not its starting stock: ${e2.message}`);
  }
}

/**
 * A purchase, a count or a hand-taken use. A purchase with a cost also
 * posts an expense in the cash book, tagged Purchases.
 */
export async function addMove(propertyId, raw, userId, tz = DEFAULT_ZONE) {
  const supabase = getSupabaseAdmin();
  const kind = raw?.kind;
  if (!['purchase', 'count', 'used'].includes(kind)) throw new Error('Choose purchase, count or used.');
  const { data: item } = await supabase.from('stock_items').select('id, name, kind').eq('id', raw?.itemId).eq('property_id', propertyId).is('archived_at', null).maybeSingle();
  if (!item) throw new Error('That item was not found.');
  if (item.kind === 'asset' && kind !== 'purchase') throw new Error('An asset is only bought, not counted or used up.');
  const qty = num(raw?.qty, 'the quantity', { min: kind === 'count' ? 0 : 0.01 });
  const date = raw?.date || localToday(tz);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Choose a date.');
  const cost = kind === 'purchase' && raw?.cost !== '' && raw?.cost != null ? num(raw.cost, 'the cost', { min: 0.01 }) : null;

  let cashEntryId = null;
  if (cost) {
    const entry = cleanEntry({
      kind: 'expense',
      date,
      amount: cost,
      method: raw?.method || 'cash',
      tag: PURCHASE_TAG,
      paidTo: raw?.supplier,
      notes: `${item.name} x ${qty}`,
    });
    const { data, error } = await supabase.from('cash_entries').insert({ ...entry, property_id: propertyId, recorded_by: userId || null }).select('id').single();
    if (error) throw wrap(Object.assign(new Error(`Failed to save the expense: ${error.message}`), { code: error.code }));
    cashEntryId = data.id;
  }
  const { error } = await supabase.from('stock_moves').insert({
    property_id: propertyId,
    item_id: item.id,
    kind,
    qty,
    move_date: date,
    cost,
    supplier: text(raw?.supplier),
    notes: text(raw?.notes, 300),
    cash_entry_id: cashEntryId,
    recorded_by: userId || null,
  });
  if (error) {
    if (cashEntryId) await supabase.from('cash_entries').delete().eq('id', cashEntryId);
    throw wrap(Object.assign(new Error(`Failed to save: ${error.message}`), { code: error.code }));
  }
}

/** Take an item off the list. Its history stays. */
export async function archiveItem(propertyId, id) {
  const { data, error } = await getSupabaseAdmin()
    .from('stock_items')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .eq('property_id', propertyId)
    .is('archived_at', null)
    .select('id');
  if (error) throw wrap(error);
  if (!data?.length) throw new Error('That item was not found.');
}

/** Items to buy again or replace, for the Today page. */
export async function purchasesDue(propertyId, tz) {
  const report = await getPurchases(propertyId, { tz });
  if (!report.ready) return null;
  const rows = report.items.filter((i) => i.status !== 'ok');
  return { count: rows.length, items: rows.slice(0, 6).map((i) => ({ id: i.id, name: i.name, status: i.status, onHand: i.onHand, unit: i.unit, replaceOn: i.replaceOn })) };
}

/** Cancel a wrong line. A cost it posted to the cash book is voided with it. */
export async function voidMove(propertyId, id, userId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('stock_moves')
    .update({ voided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('property_id', propertyId)
    .is('voided_at', null)
    .select('cash_entry_id');
  if (error) throw wrap(error);
  if (!data?.length) throw new Error('That line was not found, or is already cancelled.');
  if (data[0].cash_entry_id) {
    await supabase
      .from('cash_entries')
      .update({ voided_at: new Date().toISOString(), void_reason: 'Purchase line cancelled', voided_by: userId || null })
      .eq('id', data[0].cash_entry_id)
      .is('voided_at', null);
  }
}

/**
 * What was used, bought and spent over some days, item by item. Guest use is
 * the per-guest-night use times the guest nights in the period; the rest is
 * read from the lines entered.
 */
export async function getUsage(propertyId, { start, end, tz = DEFAULT_ZONE }) {
  const supabase = getSupabaseAdmin();
  let items;
  let moves;
  try {
    [items, moves] = await Promise.all([
      readAll(() => supabase.from('stock_items').select('*').eq('property_id', propertyId).order('name').order('id'), 'items'),
      readAll(
        () =>
          supabase
            .from('stock_moves')
            .select('*')
            .eq('property_id', propertyId)
            .is('voided_at', null)
            .gte('move_date', start)
            .lte('move_date', end)
            .order('move_date')
            .order('id'),
        'purchases'
      ),
    ]);
  } catch (err) {
    if (notMigrated(err)) return { ready: false, message: MESSAGE };
    throw err;
  }
  const today = localToday(tz);
  const last = end < today ? end : today;
  const nights = start <= last ? await guestsByNight(supabase, propertyId, start, last) : {};
  const guestNights = Object.entries(nights).reduce((s, [d, g]) => (d <= end ? s + g : s), 0);

  const rows = items.map((item) => {
    const mine = moves.filter((m) => m.item_id === item.id);
    const sum = (kind) => mine.filter((m) => m.kind === kind).reduce((s, m) => s + Number(m.qty), 0);
    // An item has no use before the day it was added.
    const from = localDay(item.created_at, tz);
    const itemNights = Object.entries(nights).reduce((s, [d, g]) => (d >= from && d <= end ? s + g : s), 0);
    const byGuests = item.kind === 'asset' ? 0 : Number(item.per_guest_night) * itemNights;
    const spent = mine.filter((m) => m.kind === 'purchase').reduce((s, m) => s + (Number(m.cost) || 0), 0);
    return {
      id: item.id,
      name: item.name,
      kindLabel: KINDS[item.kind],
      unit: item.unit,
      archived: Boolean(item.archived_at),
      byGuests: round(byGuests),
      takenOut: round(sum('used')),
      bought: round(sum('purchase')),
      spent: round(spent),
    };
  });
  const shown = rows.filter((r) => !r.archived || r.byGuests || r.takenOut || r.bought);
  return {
    ready: true,
    start,
    end,
    guestNights,
    spent: round(shown.reduce((s, r) => s + r.spent, 0)),
    items: shown,
  };
}
