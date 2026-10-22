import { getSupabaseAdmin } from '@/lib/database';
import { getPaymentsReport, userEmails } from '@/lib/financeReports';
import { notMigrated, readAll, round } from '@/lib/reports';

/**
 * The cash book: where the drawer's cash came from and went.
 *
 * Cash in is guests' cash payments (read from the folios and wallet top-ups,
 * never copied here) and cash the owner puts in. Cash out is refunds paid in
 * cash, expenses paid in cash, cash banked and cash handed to the owner.
 *
 * The drawer is checked by counting it. Each count is the starting point
 * for the next: what should be in the drawer now is the last count plus
 * every cash movement recorded since, so a shortage shows against the shift
 * it happened in rather than being lost in a month's total.
 *
 * Expenses are tagged (groceries, laundry, repairs) whatever they were paid
 * with, so the owner also sees what the money went on.
 */

export const ENTRY_KINDS = {
  expense: { label: 'Expense', sign: -1 },
  cash_in: { label: 'Cash added', sign: 1 },
  to_bank: { label: 'Paid into bank', sign: -1 },
  to_owner: { label: 'Given to owner', sign: -1 },
};

export const ENTRY_METHODS = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank_transfer: 'Bank transfer',
  other: 'Other',
};

/** Tags offered before a hotel has made its own. */
export const DEFAULT_TAGS = [
  'Groceries and kitchen',
  'Housekeeping supplies',
  'Laundry',
  'Electricity',
  'Water',
  'Gas and fuel',
  'Repairs and maintenance',
  'Staff salary',
  'Staff advance',
  'Staff food',
  'Internet and phone',
  'Transport',
  'Commission',
  'Office and printing',
  'Other',
];

// Seen by the desk, so no setup words; the server log says which migration.
export const MIGRATION_MESSAGE = 'This page is not switched on yet. Ask your OnlineHotelier contact.';

function migrationError(err) {
  if (notMigrated(err)) return new Error(MIGRATION_MESSAGE);
  return err;
}

function entryRow(e, emails) {
  const kind = ENTRY_KINDS[e.kind] || ENTRY_KINDS.expense;
  return {
    id: e.id,
    kind: e.kind,
    kindLabel: kind.label,
    date: e.entry_date,
    at: e.created_at,
    amount: Number(e.amount) || 0,
    // Signed as the drawer sees it: money out is negative.
    signed: kind.sign * (Number(e.amount) || 0),
    method: e.method,
    methodLabel: ENTRY_METHODS[e.method] || e.method,
    tag: e.tag || null,
    paidTo: e.paid_to || null,
    billNumber: e.bill_number || null,
    notes: e.notes || null,
    recordedBy: emails[e.recorded_by] || null,
    voidedAt: e.voided_at || null,
    voidReason: e.void_reason || null,
    voidedBy: emails[e.voided_by] || null,
  };
}

/** The last count, and what should be in the drawer now. */
export async function drawerNow(propertyId) {
  const supabase = getSupabaseAdmin();
  const { data: last, error } = await supabase
    .from('cash_counts')
    .select('*')
    .eq('property_id', propertyId)
    .order('counted_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw migrationError(Object.assign(new Error(`Failed to load the drawer: ${error.message}`), { code: error.code }));
  // Nothing counted yet: there is no starting figure to add to, and a
  // guess would only teach the desk to ignore the number.
  if (!last) return { lastCount: null, expected: null };

  const since = last.counted_at;
  const [payments, topUps, entries] = await Promise.all([
    readAll(
      () =>
        supabase
          .from('reservation_payments')
          .select('amount, reservations!inner(property_id)')
          .eq('reservations.property_id', propertyId)
          .eq('method', 'cash')
          .is('voided_at', null)
          .gt('paid_at', since)
          .order('id'),
      'payments'
    ),
    readAll(
      () =>
        supabase
          .from('wallet_transactions')
          .select('cash_amount')
          .eq('property_id', propertyId)
          .eq('kind', 'topup')
          .eq('method', 'cash')
          .is('voided_at', null)
          .gt('created_at', since)
          .order('id'),
      'wallet top-ups'
    ).catch((err) => {
      if (notMigrated(err)) return [];
      throw err;
    }),
    readAll(
      () =>
        supabase
          .from('cash_entries')
          .select('kind, amount')
          .eq('property_id', propertyId)
          .eq('method', 'cash')
          .is('voided_at', null)
          .gt('created_at', since)
          .order('id'),
      'cash entries'
    ),
  ]);

  const fromGuests = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0) + topUps.reduce((s, t) => s + (Number(t.cash_amount) || 0), 0);
  const moved = entries.reduce((s, e) => s + (ENTRY_KINDS[e.kind]?.sign || -1) * (Number(e.amount) || 0), 0);
  const emails = await userEmails([last.counted_by]);
  return {
    lastCount: {
      at: last.counted_at,
      counted: Number(last.counted),
      by: emails[last.counted_by] || null,
    },
    sinceCount: { fromGuests: round(fromGuests), moved: round(moved) },
    expected: round(Number(last.counted) + fromGuests + moved),
  };
}

/**
 * The cash book over some days: every cash movement in order, the drawer
 * counts made in them, and the expenses by tag.
 */
export async function getCashBook(propertyId, { start, end, tz = 0 }) {
  const supabase = getSupabaseAdmin();
  let entries;
  let counts;
  try {
    [entries, counts] = await Promise.all([
      readAll(
        () =>
          supabase
            .from('cash_entries')
            .select('*')
            .eq('property_id', propertyId)
            .gte('entry_date', start)
            .lte('entry_date', end)
            .order('entry_date')
            .order('created_at'),
        'cash entries'
      ),
      readAll(
        () =>
          supabase
            .from('cash_counts')
            .select('*')
            .eq('property_id', propertyId)
            .gte('counted_at', new Date(Date.parse(`${start}T00:00:00Z`) + tz * 60000).toISOString())
            .lt('counted_at', new Date(Date.parse(`${end}T00:00:00Z`) + 86400000 + tz * 60000).toISOString())
            .order('counted_at'),
        'cash counts'
      ),
    ]);
  } catch (err) {
    if (notMigrated(err)) return { ready: false, start, end, message: MIGRATION_MESSAGE };
    throw err;
  }

  const [payments, drawer] = await Promise.all([getPaymentsReport(propertyId, { start, end, tz }), drawerNow(propertyId)]);
  const emails = await userEmails([...entries.flatMap((e) => [e.recorded_by, e.voided_by]), ...counts.map((c) => c.counted_by)]);
  const rows = entries.map((e) => entryRow(e, emails));
  const live = rows.filter((e) => !e.voidedAt);

  // The cash lines, in the order they happened.
  const lines = [
    ...payments.payments
      .filter((p) => p.method === 'cash' && !p.voidedAt)
      .map((p) => ({
        id: `p-${p.id}`,
        date: p.day,
        at: p.paidAt,
        what: p.walletTopUp ? 'Wallet top-up' : p.amount < 0 ? 'Refund to guest' : 'Guest payment',
        detail: [p.reference, p.guest].filter(Boolean).join(', ') || p.notes || null,
        reservationId: p.reservationId,
        amount: p.amount,
        by: p.recordedBy,
      })),
    ...live
      .filter((e) => e.method === 'cash')
      .map((e) => ({
        id: `e-${e.id}`,
        date: e.date,
        at: e.at,
        what: e.kind === 'expense' ? e.tag || 'Expense' : e.kindLabel,
        detail: [e.paidTo, e.billNumber ? `Bill ${e.billNumber}` : null, e.notes].filter(Boolean).join(', ') || null,
        amount: e.signed,
        by: e.recordedBy,
      })),
  ].sort((a, b) => a.date.localeCompare(b.date) || String(a.at).localeCompare(String(b.at)));

  const sum = (list) => round(list.reduce((s, x) => s + x, 0));
  const cashLines = (pred) => lines.filter(pred).map((l) => l.amount);
  const cashEntries = (kind) => live.filter((e) => e.method === 'cash' && e.kind === kind).map((e) => e.amount);

  const tags = new Map();
  for (const e of live.filter((x) => x.kind === 'expense')) {
    const t = e.tag || 'No tag';
    if (!tags.has(t)) tags.set(t, { tag: t, count: 0, cash: 0, other: 0, total: 0 });
    const row = tags.get(t);
    row.count += 1;
    row.total += e.amount;
    if (e.method === 'cash') row.cash += e.amount;
    else row.other += e.amount;
  }

  const usedTags = [...new Set(entries.map((e) => e.tag).filter(Boolean))];
  const { data: recentTags } = await supabase
    .from('cash_entries')
    .select('tag')
    .eq('property_id', propertyId)
    .not('tag', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500);

  return {
    ready: true,
    start,
    end,
    currency: payments.currency,
    drawer,
    summary: {
      fromGuests: sum(cashLines((l) => l.id.startsWith('p-') && l.amount > 0)),
      refunds: -sum(cashLines((l) => l.id.startsWith('p-') && l.amount < 0)),
      added: sum(cashEntries('cash_in')),
      expensesCash: sum(cashEntries('expense')),
      toBank: sum(cashEntries('to_bank')),
      toOwner: sum(cashEntries('to_owner')),
      net: sum(lines.map((l) => l.amount)),
      expensesAll: sum(live.filter((e) => e.kind === 'expense').map((e) => e.amount)),
    },
    lines,
    entries: rows,
    counts: counts.map((c) => ({
      id: c.id,
      at: c.counted_at,
      counted: Number(c.counted),
      expected: c.expected == null ? null : Number(c.expected),
      difference: c.expected == null ? null : round(Number(c.counted) - Number(c.expected)),
      notes: c.notes || null,
      by: emails[c.counted_by] || null,
    })),
    byTag: [...tags.values()].map((t) => ({ ...t, cash: round(t.cash), other: round(t.other), total: round(t.total) })).sort((a, b) => b.total - a.total),
    tags: [...new Set([...usedTags, ...(recentTags || []).map((r) => r.tag), ...DEFAULT_TAGS])],
    kinds: Object.fromEntries(Object.entries(ENTRY_KINDS).map(([k, v]) => [k, v.label])),
    methods: ENTRY_METHODS,
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** A new entry, checked. Throws a message for the desk. */
export function cleanEntry(raw) {
  const kind = raw?.kind || 'expense';
  if (!ENTRY_KINDS[kind]) throw new Error('Choose what kind of entry this is.');
  const amount = Math.round(Number(raw?.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter an amount above zero.');
  if (amount > 10000000) throw new Error('That amount is too large.');
  if (!ISO.test(raw?.date || '')) throw new Error('Choose a date.');
  const method = raw?.method || 'cash';
  if (!ENTRY_METHODS[method]) throw new Error('Choose how it was paid.');
  // Moving cash to the bank or the owner is cash by definition.
  if ((kind === 'to_bank' || kind === 'to_owner' || kind === 'cash_in') && method !== 'cash') {
    throw new Error(`${ENTRY_KINDS[kind].label} is cash leaving or entering the drawer, so it is always cash.`);
  }
  const text = (v, n = 200) => (v == null ? null : String(v).trim().slice(0, n) || null);
  const tag = text(raw?.tag, 60);
  if (kind === 'expense' && !tag) throw new Error('Choose a tag for the expense.');
  return {
    kind,
    entry_date: raw.date,
    amount,
    method,
    tag: kind === 'expense' ? tag : null,
    paid_to: text(raw?.paidTo),
    bill_number: text(raw?.billNumber, 60),
    notes: text(raw?.notes, 500),
  };
}

export async function addCashEntry(propertyId, raw, userId) {
  const row = { ...cleanEntry(raw), property_id: propertyId, recorded_by: userId || null };
  const { error } = await getSupabaseAdmin().from('cash_entries').insert(row);
  if (error) throw migrationError(Object.assign(new Error(`Failed to save: ${error.message}`), { code: error.code }));
}

export async function voidCashEntry(propertyId, id, reason, userId) {
  if (!String(reason || '').trim()) throw new Error('Say why the entry is being voided.');
  const { data, error } = await getSupabaseAdmin()
    .from('cash_entries')
    .update({ voided_at: new Date().toISOString(), void_reason: String(reason).trim().slice(0, 300), voided_by: userId || null })
    .eq('id', id)
    .eq('property_id', propertyId)
    .is('voided_at', null)
    .select('id');
  if (error) throw migrationError(Object.assign(new Error(`Failed to void: ${error.message}`), { code: error.code }));
  if (!data?.length) throw new Error('That entry was not found, or is already voided.');
}

/** Record the cash counted in the drawer, against what it should hold now. */
export async function recordCount(propertyId, { counted, notes }, userId) {
  const amount = Math.round(Number(counted) * 100) / 100;
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Enter the cash counted, 0 or more.');
  const drawer = await drawerNow(propertyId).catch((err) => {
    throw migrationError(err);
  });
  const row = {
    property_id: propertyId,
    counted: amount,
    expected: drawer.expected,
    notes: notes ? String(notes).trim().slice(0, 300) : null,
    counted_by: userId || null,
  };
  const { error } = await getSupabaseAdmin().from('cash_counts').insert(row);
  if (error) throw migrationError(Object.assign(new Error(`Failed to save the count: ${error.message}`), { code: error.code }));
  return { expected: drawer.expected, difference: drawer.expected == null ? null : round(amount - drawer.expected) };
}
