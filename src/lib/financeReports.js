import {
  getSupabaseAdmin,
  listPropertyExtras,
  listPropertyTaxes,
  listRoomBlocks,
  listRooms,
} from '@/lib/database';
import { folioTotals } from '@/lib/taxes';
import { capacityOf, channelOf, chunks, notMigrated, readAll, round } from '@/lib/reports';

/**
 * The money side of the PMS: the night audit, the invoice register with what
 * is still owed and still un-invoiced, and the payments taken.
 *
 * Like booking performance, all of it is worked out on read. Balances come
 * from `folioTotals`, the same arithmetic the folio itself uses, so a balance
 * on a report is the balance the desk sees when it opens the stay.
 *
 * Payments and invoices are stamped with a moment, not a date, and a hotel's
 * day is its own local day: a payment taken at 1am in Ooty belongs to that
 * day, not to the UTC day before it. The property has no timezone of its own
 * yet, so the page sends the desk's offset (`tz`, in minutes, with the sign
 * `getTimezoneOffset` uses -- IST is -330) and days are cut there.
 */

export const PAYMENT_METHODS = {
  cash: 'Cash',
  card: 'Card',
  upi: 'UPI',
  bank_transfer: 'Bank transfer',
  ota: 'Paid to OTA',
  other: 'Other',
};

/** Statuses that gave the room back rather than used it. */
const RELEASED = new Set(['cancelled', 'no_show']);

const STAY_SELECT = '*, room_types(room_type_name), rooms(room_number)';

/** Differences smaller than this are rounding, not money. */
const PENNY = 0.009;

// ------------------------------------------------------------------
// Days
// ------------------------------------------------------------------

/** A browser's UTC offset, trusted only when it is one the world uses. */
export function normaliseTz(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && Math.abs(n) <= 14 * 60 ? Math.round(n) : 0;
}

/** The instant a local day begins, as a UTC timestamp to filter on. */
function dayStart(iso, tz) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + tz * 60000).toISOString();
}

/** The local day a stored moment falls on. */
function localDay(ts, tz) {
  if (!ts) return null;
  return new Date(Date.parse(ts) - tz * 60000).toISOString().slice(0, 10);
}

/** Today, as the desk's clock has it. */
export function localToday(tz) {
  return localDay(new Date().toISOString(), tz);
}

function shiftDay(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function everyDay(start, end) {
  const out = [];
  for (let d = start; d <= end; d = shiftDay(d, 1)) out.push(d);
  return out;
}

// ------------------------------------------------------------------
// Loading
// ------------------------------------------------------------------

/**
 * Run `fn` over `items` a few at a time. A year of stays is a couple of
 * hundred id chunks, each several queries; firing them all at once is how a
 * report gets rate-limited halfway through.
 */
async function inBatches(items, fn, width = 4) {
  for (let i = 0; i < items.length; i += width) {
    await Promise.all(items.slice(i, i + width).map(fn));
  }
}

/** A table or column that is not there yet reads as nothing, not an error. */
async function tolerant(load) {
  try {
    return await load();
  } catch (err) {
    if (notMigrated(err)) return [];
    throw err;
  }
}

function groupBy(rows, key = 'reservation_id') {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r[key])) map.set(r[key], []);
    map.get(r[key]).push(r);
  }
  return map;
}

/**
 * The folio of every stay given, computed exactly as the folio tab computes
 * it: nights, lines, payments and invoices read in bulk, the property's tax
 * rules and services read once.
 */
async function loadFolios(propertyId, reservations) {
  const supabase = getSupabaseAdmin();
  const [taxRules, services] = await Promise.all([
    listPropertyTaxes(propertyId),
    listPropertyExtras(propertyId, { includeInactive: true }),
  ]);

  const nights = [];
  const extras = [];
  const payments = [];
  const invoices = [];
  await inBatches(chunks(reservations.map((r) => r.id)), async (chunk) => {
    const [n, e, p, i] = await Promise.all([
      readAll(
        () =>
          supabase
            .from('reservation_nights')
            .select('reservation_id, stay_date, rate, room_id')
            .in('reservation_id', chunk)
            .order('reservation_id')
            .order('stay_date'),
        'nights'
      ),
      tolerant(() =>
        readAll(
          () => supabase.from('reservation_extras').select('*').in('reservation_id', chunk).order('id'),
          'folio lines'
        )
      ),
      tolerant(() =>
        readAll(
          () => supabase.from('reservation_payments').select('*').in('reservation_id', chunk).order('id'),
          'payments'
        )
      ),
      tolerant(() =>
        readAll(
          () =>
            supabase
              .from('reservation_invoices')
              .select('id, reservation_id, invoice_number, issued_at, total_amount, voided_at')
              .in('reservation_id', chunk)
              .order('id'),
          'invoices'
        )
      ),
    ]);
    nights.push(...n);
    extras.push(...e);
    payments.push(...p);
    invoices.push(...i);
  });

  const nightsBy = groupBy(nights);
  const extrasBy = groupBy(extras);
  const paymentsBy = groupBy(payments);
  const invoicesBy = groupBy(invoices);

  const folios = new Map();
  for (const r of reservations) {
    const stayNights = (nightsBy.get(r.id) || [])
      .map((n) => ({ stay_date: n.stay_date, rate: n.rate == null ? null : Number(n.rate), room_id: n.room_id }))
      .sort((a, b) => a.stay_date.localeCompare(b.stay_date));
    const stayExtras = extrasBy.get(r.id) || [];
    const stayPayments = paymentsBy.get(r.id) || [];
    const { tax, totals } = folioTotals({
      reservation: r,
      nights: stayNights,
      extras: stayExtras,
      payments: stayPayments,
      taxRules,
      services,
    });
    folios.set(r.id, {
      nights: stayNights,
      extras: stayExtras,
      payments: stayPayments,
      // Newest first, and only the ones that still stand.
      invoices: (invoicesBy.get(r.id) || [])
        .filter((inv) => !inv.voided_at)
        .sort((a, b) => String(b.issued_at).localeCompare(String(a.issued_at))),
      tax,
      totals,
    });
  }
  return { folios, services };
}

/** Payments taken (or voided) between two instants, with their booking. */
function loadPayments(propertyId, from, to, column = 'paid_at') {
  const supabase = getSupabaseAdmin();
  return readAll(
    () =>
      supabase
        .from('reservation_payments')
        .select('*, reservations!inner(id, property_id, reference, guest_name, currency)')
        .eq('reservations.property_id', propertyId)
        .gte(column, from)
        .lt(column, to)
        .order(column)
        .order('id'),
    'payments'
  );
}

/** Who a user id is, for "recorded by" -- an email, which is what the users page shows. */
async function userEmails(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};
  const { data, error } = await getSupabaseAdmin().from('users').select('id, email').in('id', unique);
  if (error) return {};
  return Object.fromEntries((data || []).map((u) => [u.id, u.email]));
}

/** The currency most rows are in; a property sells in one. */
function mainCurrency(values) {
  const counts = {};
  for (const v of values) if (v) counts[v] = (counts[v] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'INR';
}

/** The fields every list on these pages shows for a stay. */
function stayRow(r) {
  return {
    reservationId: r.id,
    reference: r.reference,
    guest: r.guest_name,
    checkIn: r.check_in,
    checkOut: r.check_out,
    status: r.status,
    room: r.rooms?.room_number || null,
    roomType: r.room_types?.room_type_name || null,
    channel: channelOf(r),
  };
}

// ------------------------------------------------------------------
// Payments
// ------------------------------------------------------------------

function paymentRow(p, tz, emails) {
  return {
    id: p.id,
    paidAt: p.paid_at,
    day: localDay(p.paid_at, tz),
    reservationId: p.reservation_id,
    reference: p.reservations?.reference || null,
    guest: p.reservations?.guest_name || null,
    method: p.method,
    methodLabel: PAYMENT_METHODS[p.method] || p.method,
    transaction: p.reference || null,
    notes: p.notes || null,
    amount: Number(p.amount) || 0,
    recordedBy: emails[p.recorded_by] || null,
    voidedAt: p.voided_at || null,
    voidReason: p.void_reason || null,
    voidedBy: emails[p.voided_by] || null,
  };
}

/**
 * Money in, money back out, by method. Voided payments are left out of every
 * figure -- they were recorded in error -- and counted on their own.
 */
function summarisePayments(rows) {
  const live = rows.filter((p) => !p.voidedAt);
  const voided = rows.filter((p) => p.voidedAt);
  const methods = new Map();
  let received = 0;
  let refunded = 0;
  for (const p of live) {
    if (!methods.has(p.method)) {
      methods.set(p.method, { method: p.method, label: p.methodLabel, received: 0, refunded: 0, count: 0 });
    }
    const m = methods.get(p.method);
    if (p.amount >= 0) {
      m.received += p.amount;
      received += p.amount;
    } else {
      m.refunded -= p.amount;
      refunded -= p.amount;
    }
    m.count += 1;
  }
  return {
    received: round(received),
    refunded: round(refunded),
    net: round(received - refunded),
    count: live.length,
    voidedCount: voided.length,
    voidedAmount: round(voided.reduce((s, p) => s + p.amount, 0)),
    byMethod: [...methods.values()]
      .map((m) => ({ ...m, received: round(m.received), refunded: round(m.refunded), net: round(m.received - m.refunded) }))
      .sort((a, b) => b.net - a.net),
  };
}

/** Every payment taken between two dates (local days, both inclusive). */
export async function getPaymentsReport(propertyId, { start, end, tz = 0 }) {
  const raw = await loadPayments(propertyId, dayStart(start, tz), dayStart(shiftDay(end, 1), tz));
  const emails = await userEmails(raw.flatMap((p) => [p.recorded_by, p.voided_by]));
  const payments = raw.map((p) => paymentRow(p, tz, emails));
  const live = payments.filter((p) => !p.voidedAt);

  const days = new Map(everyDay(start, end).map((d) => [d, { date: d, received: 0, refunded: 0, count: 0, byMethod: {} }]));
  const users = new Map();
  for (const p of live) {
    const day = days.get(p.day);
    if (day) {
      if (p.amount >= 0) day.received += p.amount;
      else day.refunded -= p.amount;
      day.count += 1;
      day.byMethod[p.method] = round((day.byMethod[p.method] || 0) + p.amount);
    }
    const who = p.recordedBy || 'Not recorded';
    if (!users.has(who)) users.set(who, { user: who, received: 0, refunded: 0, count: 0 });
    const u = users.get(who);
    if (p.amount >= 0) u.received += p.amount;
    else u.refunded -= p.amount;
    u.count += 1;
  }

  const finish = (x) => ({ ...x, received: round(x.received), refunded: round(x.refunded), net: round(x.received - x.refunded) });

  return {
    start,
    end,
    currency: mainCurrency(raw.map((p) => p.reservations?.currency)),
    methods: PAYMENT_METHODS,
    summary: summarisePayments(payments),
    byDay: [...days.values()].map(finish),
    byUser: [...users.values()].map(finish).sort((a, b) => b.net - a.net),
    payments,
  };
}

// ------------------------------------------------------------------
// Invoicing
// ------------------------------------------------------------------

/**
 * One line of the register, read from the invoice's frozen snapshot -- the
 * register has to agree with the documents that were handed out, not with
 * the stay as it is now.
 *
 * Taxable value is what was charged before tax: room and extras, less any
 * tax that was included in those prices.
 */
function registerRow(inv, tz, emails) {
  const snap = inv.snapshot || {};
  const t = snap.totals || {};
  const taxes = {};
  let included = 0;
  let taxTotal = 0;
  for (const x of snap.taxes || []) {
    const amount = Number(x.amount) || 0;
    taxes[x.name] = round((taxes[x.name] || 0) + amount);
    taxTotal += amount;
    if (x.inclusive) included += amount;
  }
  const charges = (Number(t.room) || 0) + (Number(t.extras) || 0);
  return {
    id: inv.id,
    number: inv.invoice_number,
    issuedAt: inv.issued_at,
    day: localDay(inv.issued_at, tz),
    reservationId: inv.reservation_id,
    reference: snap.reference || null,
    guest: snap.guest_name || null,
    checkIn: snap.check_in || null,
    checkOut: snap.check_out || null,
    residency: snap.guest_residency || null,
    taxable: round(charges - included),
    taxes,
    taxTotal: round(taxTotal),
    total: Number(inv.total_amount) || 0,
    currency: inv.currency || snap.currency || 'INR',
    voided: Boolean(inv.voided_at),
    voidedAt: inv.voided_at || null,
    voidReason: inv.void_reason || null,
    issuedBy: emails[inv.created_by] || null,
  };
}

/**
 * Tax by rule across the invoices that stand. The base a percentage was
 * charged on is recovered from the line's own working ("2.5% of 5000"), which
 * is the taxable value per rate a GST return asks for.
 */
function taxSummary(invoices) {
  const out = new Map();
  for (const inv of invoices) {
    if (inv.voided_at) continue;
    for (const x of inv.snapshot?.taxes || []) {
      if (!out.has(x.name)) out.set(x.name, { name: x.name, inclusive: Boolean(x.inclusive), amount: 0, base: 0, hasBase: false, invoices: 0 });
      const s = out.get(x.name);
      s.amount += Number(x.amount) || 0;
      s.invoices += 1;
      const base = /% of ([\d.]+)$/.exec(x.detail || '');
      if (base) {
        s.base += Number(base[1]);
        s.hasBase = true;
      }
    }
  }
  return [...out.values()]
    .map((s) => ({ name: s.name, inclusive: s.inclusive, invoices: s.invoices, amount: round(s.amount), base: s.hasBase ? round(s.base) : null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Holes in the invoice numbering. Invoices are numbered in one run per
 * property and never deleted, only voided, so a missing number means an
 * invoice went somewhere it should not have -- most likely with a deleted
 * reservation, which takes its invoices with it.
 */
function sequenceGaps(rows) {
  const nums = rows
    .map((r) => ({ n: Number(/(\d+)\s*$/.exec(r.invoice_number || '')?.[1]), number: r.invoice_number }))
    .filter((x) => Number.isFinite(x.n))
    .sort((a, b) => a.n - b.n);
  const gaps = [];
  for (let i = 1; i < nums.length; i += 1) {
    const missing = nums[i].n - nums[i - 1].n - 1;
    if (missing > 0) gaps.push({ after: nums[i - 1].number, before: nums[i].number, missing });
  }
  return gaps;
}

/** How far back the home page keeps reminding the desk of a guest who left owing. */
const STILL_OWING_DAYS = 30;

/**
 * Guests who checked out before today and still owe, from the last month.
 * The night audit names only the day's own departures, so a balance missed
 * yesterday dropped off the home page; this keeps it there until settled.
 */
export async function getStillOwing(propertyId, { today }) {
  const supabase = getSupabaseAdmin();
  const departed = await readAll(
    () =>
      supabase
        .from('reservations')
        .select(STAY_SELECT)
        .eq('property_id', propertyId)
        .eq('status', 'checked_out')
        .gte('check_out', shiftDay(today, -STILL_OWING_DAYS))
        .lt('check_out', today)
        .order('id'),
    'departed stays'
  );
  if (!departed.length) return [];
  const { folios } = await loadFolios(propertyId, departed);
  return departed
    .filter((r) => (folios.get(r.id)?.totals.balance ?? 0) > PENNY)
    .map((r) => ({ ...stayRow(r), amount: folios.get(r.id).totals.balance }))
    .sort((a, b) => b.amount - a.amount);
}

/** How long a departed guest has owed, in the buckets a debtor list uses. */
const AGE_BUCKETS = [
  { id: 'inHouse', label: 'In house' },
  { id: 'd7', label: '0–7 days', upTo: 7 },
  { id: 'd30', label: '8–30 days', upTo: 30 },
  { id: 'd60', label: '31–60 days', upTo: 60 },
  { id: 'd90', label: '61–90 days', upTo: 90 },
  { id: 'older', label: 'Over 90 days', upTo: Infinity },
];

/** How far back the balances look, whatever period the register shows. */
const BALANCE_LOOKBACK_DAYS = 365;

/**
 * The invoicing report for [start, end]:
 *
 *   register     invoices issued in the period, with tax by rule and any
 *                gaps in the numbering
 *   outstanding  stays still owing money, or owed money back, as of today --
 *                everyone in house, and everyone who checked out in the last
 *                year (or since the period began, if that is earlier). Old
 *                debts must not disappear because a short period was chosen.
 *   uninvoiced   stays that checked out in the period and were never
 *                invoiced, or whose bill has changed since it was
 */
export async function getInvoicingReport(propertyId, { start, end, tz = 0 }) {
  const supabase = getSupabaseAdmin();
  const today = localToday(tz);
  const lookback = [start, shiftDay(today, -BALANCE_LOOKBACK_DAYS)].sort()[0];

  const [issued, numbers, inHouse, departed] = await Promise.all([
    readAll(
      () =>
        supabase
          .from('reservation_invoices')
          .select('*')
          .eq('property_id', propertyId)
          .gte('issued_at', dayStart(start, tz))
          .lt('issued_at', dayStart(shiftDay(end, 1), tz))
          .order('issued_at')
          .order('id'),
      'invoices'
    ),
    readAll(
      () => supabase.from('reservation_invoices').select('invoice_number').eq('property_id', propertyId).order('id'),
      'invoice numbers'
    ),
    readAll(
      () => supabase.from('reservations').select(STAY_SELECT).eq('property_id', propertyId).eq('status', 'in_house').order('id'),
      'in-house stays'
    ),
    readAll(
      () =>
        supabase
          .from('reservations')
          .select(STAY_SELECT)
          .eq('property_id', propertyId)
          .eq('status', 'checked_out')
          .gte('check_out', lookback)
          .order('id'),
      'departed stays'
    ),
  ]);

  const emails = await userEmails(issued.map((i) => i.created_by));
  const stays = [...inHouse, ...departed];
  const { folios } = await loadFolios(propertyId, stays);

  // ---- Register ----
  const rows = issued.map((inv) => registerRow(inv, tz, emails));
  const standing = rows.filter((r) => !r.voided);
  const taxNames = [...new Set(standing.flatMap((r) => Object.keys(r.taxes)))].sort();
  const taxTotals = {};
  for (const name of taxNames) taxTotals[name] = round(standing.reduce((s, r) => s + (r.taxes[name] || 0), 0));

  // ---- Balances ----
  const buckets = Object.fromEntries(AGE_BUCKETS.map((b) => [b.id, { ...b, count: 0, amount: 0 }]));
  const owing = [];
  const credits = [];
  for (const r of stays) {
    const f = folios.get(r.id);
    const balance = f.totals.balance;
    if (Math.abs(balance) <= PENNY) continue;
    const age = r.status === 'in_house' ? null : Math.max(0, daysBetween(r.check_out, today));
    const bucket =
      age === null ? 'inHouse' : AGE_BUCKETS.find((b) => b.upTo !== undefined && age <= b.upTo).id;
    const lastPayment = f.payments
      .filter((p) => !p.voided_at)
      .map((p) => p.paid_at)
      .sort()
      .pop();
    const row = {
      ...stayRow(r),
      total: f.totals.total,
      paid: f.totals.paid,
      balance,
      age,
      bucket,
      lastPayment: lastPayment || null,
      invoice: f.invoices[0]?.invoice_number || null,
    };
    if (balance > 0) {
      owing.push(row);
      buckets[bucket].count += 1;
      buckets[bucket].amount += balance;
    } else {
      credits.push(row);
    }
  }
  owing.sort((a, b) => (b.age ?? -1) - (a.age ?? -1) || b.balance - a.balance);
  credits.sort((a, b) => a.balance - b.balance);

  // ---- Not invoiced, or changed since ----
  const uninvoiced = [];
  for (const r of departed) {
    if (r.check_out < start || r.check_out > end) continue;
    const f = folios.get(r.id);
    const latest = f.invoices[0];
    if (!latest) {
      // A complimentary stay with nothing on it has nothing to invoice.
      if (f.totals.total <= PENNY) continue;
      uninvoiced.push({ ...stayRow(r), kind: 'none', total: f.totals.total, balance: f.totals.balance });
    } else if (Math.abs(Number(latest.total_amount) - f.totals.total) > PENNY) {
      uninvoiced.push({
        ...stayRow(r),
        kind: 'changed',
        total: f.totals.total,
        balance: f.totals.balance,
        invoice: latest.invoice_number,
        invoiced: Number(latest.total_amount),
      });
    }
  }
  uninvoiced.sort((a, b) => a.checkOut.localeCompare(b.checkOut));

  return {
    start,
    end,
    today,
    lookback,
    currency: mainCurrency([...rows.map((r) => r.currency), ...stays.map((s) => s.currency)]),
    register: {
      rows,
      taxNames,
      totals: {
        count: standing.length,
        taxable: round(standing.reduce((s, r) => s + r.taxable, 0)),
        taxes: taxTotals,
        taxTotal: round(standing.reduce((s, r) => s + r.taxTotal, 0)),
        total: round(standing.reduce((s, r) => s + r.total, 0)),
        voidedCount: rows.length - standing.length,
        voidedTotal: round(rows.filter((r) => r.voided).reduce((s, r) => s + r.total, 0)),
      },
      taxSummary: taxSummary(issued),
      gaps: sequenceGaps(numbers),
    },
    outstanding: {
      owing,
      credits,
      buckets: AGE_BUCKETS.map((b) => ({ id: b.id, label: b.label, count: buckets[b.id].count, amount: round(buckets[b.id].amount) })),
      totalOwed: round(owing.reduce((s, r) => s + r.balance, 0)),
      totalCredit: round(credits.reduce((s, r) => s - r.balance, 0)),
    },
    uninvoiced,
  };
}

// ------------------------------------------------------------------
// Night audit
// ------------------------------------------------------------------

/**
 * The close of one business day: who came, who left, who is in, what the day
 * earned, what was collected, and what the desk must put right before the
 * day can be called closed.
 *
 * Revenue is posted by the night: a night's room rate, the folio lines dated
 * to that day (an undated line goes with the arrival, as the tax engine and
 * the performance report both have it), and the taxes that fell on them.
 */
export async function getNightAudit(propertyId, { date, tz = 0 }) {
  const supabase = getSupabaseAdmin();
  const today = localToday(tz);
  const from = dayStart(date, tz);
  const to = dayStart(shiftDay(date, 1), tz);
  const stays = () => supabase.from('reservations').select(STAY_SELECT).eq('property_id', propertyId);

  const [around, overdue, created, { capacity }, blocks, paid, voidedPayments, issued, voidedInvoices, rooms] =
    await Promise.all([
      // Everything arriving, staying or leaving on the date.
      readAll(() => stays().lte('check_in', date).gte('check_out', date).order('id'), 'stays'),
      // Guests still marked in house after the day they were due to leave.
      readAll(() => stays().eq('status', 'in_house').lt('check_out', date).order('id'), 'overdue stays'),
      readAll(() => stays().gte('created_at', from).lt('created_at', to).order('id'), 'new bookings'),
      capacityOf(propertyId),
      listRoomBlocks(propertyId, date, date),
      loadPayments(propertyId, from, to),
      // Only once migration 030 is in; until then nothing can be voided.
      tolerant(() => loadPayments(propertyId, from, to, 'voided_at')),
      readAll(
        () =>
          supabase
            .from('reservation_invoices')
            .select('id, reservation_id, invoice_number, total_amount, snapshot, voided_at')
            .eq('property_id', propertyId)
            .gte('issued_at', from)
            .lt('issued_at', to)
            .order('issued_at'),
        'invoices issued'
      ),
      readAll(
        () =>
          supabase
            .from('reservation_invoices')
            .select('id, reservation_id, invoice_number, total_amount, snapshot, void_reason')
            .eq('property_id', propertyId)
            .gte('voided_at', from)
            .lt('voided_at', to)
            .order('voided_at'),
        'invoices voided'
      ),
      // Housekeeping is a state, not a history: it only says anything about today.
      date === today ? listRooms(propertyId, { includeInactive: false }).catch(() => []) : null,
    ]);

  const active = (r) => !RELEASED.has(r.status) && r.status !== 'inquiry';
  const withFolio = [...around.filter(active), ...overdue];
  const { folios, services } = await loadFolios(propertyId, withFolio);

  // ---- Movement ----
  const arrivals = around.filter((r) => r.check_in === date && r.status !== 'inquiry');
  const departures = around.filter((r) => r.check_out === date && active(r));
  const tonight = around.filter((r) => r.check_in <= date && r.check_out > date && active(r));
  const movement = {
    arrivals: {
      expected: arrivals.filter((r) => r.status !== 'cancelled').length,
      arrived: arrivals.filter((r) => r.status === 'in_house' || r.status === 'checked_out').length,
      pending: arrivals.filter((r) => r.status === 'confirmed').length,
      noShows: arrivals.filter((r) => r.status === 'no_show').length,
      cancelled: arrivals.filter((r) => r.status === 'cancelled').length,
    },
    departures: {
      expected: departures.length,
      departed: departures.filter((r) => r.status === 'checked_out').length,
      pending: departures.filter((r) => r.status !== 'checked_out').length,
    },
    stayovers: tonight.filter((r) => r.check_in < date).length,
    inHouse: tonight.length,
    guests: tonight.reduce((s, r) => s + (Number(r.adults) || 0) + (Number(r.children) || 0), 0),
    newBookings: created.filter((r) => r.status !== 'inquiry').length,
    newBookingValue: round(
      created.filter((r) => r.status !== 'inquiry').reduce((s, r) => s + (Number(r.total_amount) || 0), 0)
    ),
  };

  // ---- Revenue posted for the night ----
  const serviceById = Object.fromEntries(services.map((s) => [s.id, s]));
  const categoryOf = (serviceId) =>
    serviceId && serviceById[serviceId]
      ? serviceById[serviceId].service_categories?.name || 'Uncategorised'
      : 'Other';
  const other = {};
  const taxes = {};
  let roomRevenue = 0;
  let compRooms = 0;
  const zeroNights = [];
  for (const r of around.filter(active)) {
    const f = folios.get(r.id);
    const comp = r.booking_type === 'complimentary';
    const night = f.nights.find((n) => n.stay_date === date);
    if (night) {
      const value = comp ? 0 : night.rate ?? (Number(r.total_amount) || 0) / Math.max(1, f.nights.length);
      roomRevenue += value;
      if (comp) compRooms += 1;
      else if (value <= PENNY) zeroNights.push({ ...stayRow(r), amount: 0 });
    }
    const firstNight = f.nights[0]?.stay_date || r.check_in;
    for (const e of f.extras) {
      if (e.kind !== 'extra' || (e.stay_date || firstNight) !== date) continue;
      const cat = categoryOf(e.extra_id);
      other[cat] = (other[cat] || 0) + Number(e.unit_price) * Number(e.quantity);
    }
    for (const [name, t] of Object.entries(f.tax.byDate?.[date] || {})) {
      taxes[name] = taxes[name] || { name, amount: 0, inclusive: t.inclusive };
      taxes[name].amount += t.amount;
    }
  }
  const otherRevenue = Object.values(other).reduce((s, v) => s + v, 0);
  const taxLines = Object.values(taxes)
    .map((t) => ({ ...t, amount: round(t.amount) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const taxAdded = taxLines.filter((t) => !t.inclusive).reduce((s, t) => s + t.amount, 0);

  // ---- Rooms ----
  const outOfOrder = new Set(blocks.map((b) => b.room_id)).size;
  const available = Math.max(0, capacity - outOfOrder);
  const paidRooms = tonight.length - compRooms;
  const roomStats = {
    capacity,
    outOfOrder,
    available,
    occupied: tonight.length,
    comp: compRooms,
    vacant: Math.max(0, available - tonight.length),
    occupancy: available > 0 ? round((tonight.length / available) * 100, 1) : null,
    adr: paidRooms > 0 ? round(roomRevenue / paidRooms) : null,
    revpar: available > 0 ? round(roomRevenue / available) : null,
  };

  // ---- Money collected ----
  const emails = await userEmails([...paid, ...voidedPayments].flatMap((p) => [p.recorded_by, p.voided_by]));
  const paymentRows = paid.map((p) => paymentRow(p, tz, emails));
  const voidedRows = voidedPayments.map((p) => paymentRow(p, tz, emails));

  // ---- What the desk still has to put right ----
  const balanceOf = (r) => folios.get(r.id)?.totals.balance ?? 0;
  const departedToday = departures.filter((r) => r.status === 'checked_out');
  const dirty = new Set((rooms || []).filter((room) => room.housekeeping === 'dirty').map((room) => room.id));

  const exceptions = [
    {
      id: 'arrivals',
      tone: 'warn',
      title: 'Arrivals not checked in',
      hint: 'Check them in, or mark them as no-shows.',
      rows: arrivals.filter((r) => r.status === 'confirmed').map(stayRow),
    },
    {
      id: 'departures',
      tone: 'warn',
      title: 'Departures not checked out',
      hint: 'Due to leave on or before this day but still open. Check them out, or extend the stay.',
      rows: [...departures.filter((r) => r.status !== 'checked_out'), ...overdue].map((r) => ({
        ...stayRow(r),
        amount: balanceOf(r),
      })),
    },
    {
      id: 'balance',
      tone: 'danger',
      title: 'Checked out with a balance owing',
      hint: 'The guest left without settling the folio. Collect, or record why not.',
      rows: departedToday.filter((r) => balanceOf(r) > PENNY).map((r) => ({ ...stayRow(r), amount: balanceOf(r) })),
    },
    {
      id: 'invoice',
      tone: 'warn',
      title: 'Checked out without an invoice',
      hint: 'Issue the invoice from the stay’s Bill.',
      rows: departedToday
        .filter((r) => folios.get(r.id).invoices.length === 0 && folios.get(r.id).totals.total > PENNY)
        .map((r) => ({ ...stayRow(r), amount: folios.get(r.id).totals.total })),
    },
    {
      id: 'zero',
      tone: 'warn',
      title: 'Nights charged at nothing',
      hint: 'A night with no rate that is not a complimentary stay. Set the rate in the stay’s Bill, or mark the stay complimentary.',
      rows: zeroNights,
    },
    {
      id: 'noroom',
      tone: 'warn',
      title: 'In house with no room assigned',
      hint: 'Assign a room so housekeeping and the tape chart know where they are.',
      rows: tonight.filter((r) => r.status === 'in_house' && !r.room_id).map(stayRow),
    },
    {
      id: 'inquiry',
      tone: 'warn',
      title: 'Inquiries due to arrive',
      hint: 'Still holding a room on the day of arrival. Confirm or cancel them.',
      rows: around.filter((r) => r.status === 'inquiry' && r.check_in === date).map(stayRow),
    },
    {
      id: 'dirty',
      tone: 'warn',
      title: 'Arrivals into dirty rooms',
      hint: 'The guest is due today and the room is not yet clean.',
      rows: arrivals
        .filter((r) => r.status === 'confirmed' && r.room_id && dirty.has(r.room_id))
        .map(stayRow),
    },
    {
      id: 'voidedPayments',
      tone: 'info',
      title: 'Payments voided',
      hint: 'Taken off a folio on this day. Check each against the cash drawer or card terminal.',
      rows: voidedRows.map((p) => ({
        reservationId: p.reservationId,
        reference: p.reference,
        guest: p.guest,
        detail: [p.methodLabel, p.voidReason, p.voidedBy && `by ${p.voidedBy}`].filter(Boolean).join(' · '),
        amount: p.amount,
      })),
    },
    {
      id: 'voidedInvoices',
      tone: 'info',
      title: 'Invoices voided',
      hint: 'Voided on this day. A replacement should normally be issued.',
      rows: voidedInvoices.map((inv) => ({
        reservationId: inv.reservation_id,
        reference: inv.snapshot?.reference || null,
        guest: inv.snapshot?.guest_name || null,
        detail: [inv.invoice_number, inv.void_reason].filter(Boolean).join(' · '),
        amount: Number(inv.total_amount) || 0,
      })),
    },
  ];

  return {
    date,
    today,
    currency: mainCurrency(withFolio.map((r) => r.currency)),
    rooms: roomStats,
    movement,
    revenue: {
      room: round(roomRevenue),
      other: Object.entries(other)
        .map(([name, amount]) => ({ name, amount: round(amount) }))
        .sort((a, b) => b.amount - a.amount),
      otherTotal: round(otherRevenue),
      taxes: taxLines,
      taxAdded: round(taxAdded),
      total: round(roomRevenue + otherRevenue + taxAdded),
    },
    payments: { summary: summarisePayments(paymentRows), rows: paymentRows },
    invoices: {
      count: issued.filter((i) => !i.voided_at).length,
      total: round(issued.filter((i) => !i.voided_at).reduce((s, i) => s + (Number(i.total_amount) || 0), 0)),
    },
    ledger: {
      // What the guests in house tonight owe between them, and how many.
      inHouseBalance: round(tonight.filter((r) => r.status === 'in_house').reduce((s, r) => s + balanceOf(r), 0)),
      inHouseCount: tonight.filter((r) => r.status === 'in_house').length,
    },
    housekeeping: rooms
      ? {
          dirty: rooms.filter((r) => r.housekeeping === 'dirty').length,
          clean: rooms.filter((r) => r.housekeeping === 'clean' || r.housekeeping === 'inspected').length,
          outOfOrder: rooms.filter((r) => r.housekeeping === 'out_of_order').length,
        }
      : null,
    exceptions: exceptions.filter((e) => e.rows.length > 0),
  };
}
