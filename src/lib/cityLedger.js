import { getSupabaseAdmin } from '@/lib/database';
import { loadFolios, localToday } from '@/lib/financeReports';
import { notMigrated, readAll, round } from '@/lib/reports';

/**
 * The city ledger: what companies and travel agents owe for stays billed to
 * them, when it falls due, and the money they have sent.
 *
 * What is owed is the folio balance of each stay billed to a company, worked
 * out by `loadFolios` exactly as the folio tab works it out -- never stored,
 * so the ledger and the bill cannot disagree. A stay owes from the day it is
 * billed: its latest invoice, or check-out if none was issued. It falls due
 * after the company's credit days.
 *
 * Money a company sends is a receipt (migration 047), applied to its stays as
 * ordinary folio payments carrying the receipt's id. Whatever is not applied
 * is credit, shown against the company until it is applied to later bills.
 */

/** Differences smaller than this are rounding, not money. */
const PENNY = 0.009;

const STAY_SELECT = '*, room_types(room_type_name), rooms(room_number)';

export const RECEIPT_METHODS = ['bank_transfer', 'upi', 'card', 'cash', 'other'];

function shiftDay(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/** Overdue buckets, by days past the due date. */
export const AGE_BUCKETS = [
  { id: 'notDue', label: 'Not due' },
  { id: 'd30', label: '1–30 days', upTo: 30 },
  { id: 'd60', label: '31–60 days', upTo: 60 },
  { id: 'd90', label: '61–90 days', upTo: 90 },
  { id: 'older', label: '90+ days', upTo: Infinity },
];

function bucketFor(overdueDays) {
  if (overdueDays <= 0) return 'notDue';
  return AGE_BUCKETS.find((b) => b.upTo != null && overdueDays <= b.upTo).id;
}

/**
 * Where a stay is in the ledger.
 *
 *   billed     the guest has left (or the booking was cancelled with a
 *              charge left on it): the balance is owed
 *   running    the guest is still in house: the bill is still growing
 *   upcoming   not arrived yet; only matters if the company paid ahead
 */
function phaseOf(r) {
  if (r.status === 'in_house') return 'running';
  if (r.status === 'checked_out' || r.status === 'cancelled' || r.status === 'no_show') return 'billed';
  return 'upcoming';
}

/** A stay billed to a company, as a ledger line. */
function stayLine(r, folio, company, today, tz) {
  const phase = phaseOf(r);
  const invoice = folio?.invoices?.[0] || null;
  const billedOn =
    phase === 'billed'
      ? invoice?.issued_at
        ? new Date(Date.parse(invoice.issued_at) - tz * 60000).toISOString().slice(0, 10)
        : r.status === 'checked_out'
        ? r.check_out
        : String(r.updated_at || r.check_in).slice(0, 10)
      : null;
  const dueOn = billedOn ? shiftDay(billedOn, Number(company?.credit_days) || 0) : null;
  const totals = folio?.totals || { total: 0, paid: 0, balance: 0 };
  const overdueDays = dueOn && totals.balance > PENNY ? Math.max(0, daysBetween(dueOn, today)) : 0;
  return {
    reservationId: r.id,
    reference: r.reference,
    guestName: r.guest_name,
    checkIn: r.check_in,
    checkOut: r.check_out,
    status: r.status,
    roomType: r.room_types?.room_type_name || null,
    roomNumber: r.rooms?.room_number || null,
    phase,
    invoiceNumber: invoice?.invoice_number || null,
    billedOn,
    dueOn,
    overdueDays,
    charges: totals.total,
    paid: totals.paid,
    balance: totals.balance,
    currency: r.currency || 'INR',
  };
}

/** Everything the ledger reads, for one company or all of them. */
async function loadLedger(propertyId, { companyId = null, today, tz = 0 } = {}) {
  const supabase = getSupabaseAdmin();

  let companyQuery = supabase.from('companies').select('*').eq('property_id', propertyId);
  if (companyId) companyQuery = companyQuery.eq('id', companyId);
  const { data: companies, error: companyError } = await companyQuery.order('name');
  if (companyError) throw new Error(`Failed to load companies: ${companyError.message}`);
  const byId = new Map((companies || []).map((c) => [c.id, c]));

  const stays = await readAll(() => {
    let q = supabase
      .from('reservations')
      .select(STAY_SELECT)
      .eq('property_id', propertyId)
      .eq('bill_to', 'company')
      .not('company_id', 'is', null);
    if (companyId) q = q.eq('company_id', companyId);
    return q.order('id');
  }, 'stays billed to companies');

  const { folios } = stays.length ? await loadFolios(propertyId, stays) : { folios: new Map() };

  let receipts = [];
  let applied = new Map();
  try {
    receipts = await readAll(() => {
      let q = supabase.from('city_ledger_receipts').select('*').eq('property_id', propertyId);
      if (companyId) q = q.eq('company_id', companyId);
      return q.order('received_on', { ascending: false }).order('id');
    }, 'receipts');

    const ids = receipts.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await supabase
        .from('reservation_payments')
        .select('receipt_id, reservation_id, amount, voided_at')
        .in('receipt_id', ids.slice(i, i + 100));
      if (error) throw new Error(`Failed to load receipt payments: ${error.message}`);
      for (const p of data || []) {
        if (p.voided_at) continue;
        const list = applied.get(p.receipt_id) || [];
        list.push(p);
        applied.set(p.receipt_id, list);
      }
    }
  } catch (err) {
    // Before migration 047 there are no receipts: the ledger still shows
    // what is owed, just not the money sent against it.
    if (!notMigrated(err) && !/city_ledger_receipts|receipt_id/.test(err.message)) throw err;
    receipts = [];
    applied = new Map();
  }

  const lines = stays.map((r) => ({
    companyId: r.company_id,
    ...stayLine(r, folios.get(r.id), byId.get(r.company_id), today, tz),
  }));

  const receiptRows = receipts.map((rc) => {
    const used = (applied.get(rc.id) || []).reduce((s, p) => s + Number(p.amount), 0);
    return {
      id: rc.id,
      companyId: rc.company_id,
      amount: Number(rc.amount),
      method: rc.method,
      reference: rc.reference,
      receivedOn: rc.received_on,
      notes: rc.notes,
      voided: Boolean(rc.voided_at),
      voidReason: rc.void_reason,
      applied: round(used),
      unapplied: rc.voided_at ? 0 : round(Number(rc.amount) - used),
      appliedTo: (applied.get(rc.id) || []).map((p) => ({ reservationId: p.reservation_id, amount: Number(p.amount) })),
    };
  });

  return { companies: companies || [], lines, receipts: receiptRows };
}

function emptyTotals() {
  return {
    receivable: 0,
    overdue: 0,
    dueIn7: 0,
    dueIn30: 0,
    running: 0,
    credit: 0,
    receivedThisMonth: 0,
    buckets: Object.fromEntries(AGE_BUCKETS.map((b) => [b.id, 0])),
    openStays: 0,
  };
}

/** Add one stay or receipt to a running set of totals. */
function addLine(t, line, today) {
  if (line.phase === 'running') {
    t.running += line.balance;
    return;
  }
  if (line.balance < -PENNY) {
    // Paid more than the bill: credit the company holds.
    t.credit += -line.balance;
    return;
  }
  if (line.phase !== 'billed' || line.balance <= PENNY) return;
  t.receivable += line.balance;
  t.openStays += 1;
  t.buckets[bucketFor(line.overdueDays)] += line.balance;
  if (line.overdueDays > 0) t.overdue += line.balance;
  else if (line.dueOn <= shiftDay(today, 7)) t.dueIn7 += line.balance;
  else if (line.dueOn <= shiftDay(today, 30)) t.dueIn30 += line.balance;
}

function roundTotals(t) {
  for (const k of Object.keys(t)) if (typeof t[k] === 'number' && k !== 'openStays') t[k] = round(t[k]);
  for (const k of Object.keys(t.buckets)) t.buckets[k] = round(t.buckets[k]);
  return t;
}

/**
 * The ledger for every company and agent with something on it: what is
 * owed and how overdue, what is still running in house, credit held, and
 * the money received this month -- per company and for the property.
 */
export async function getCityLedger(propertyId, { tz = 0 } = {}) {
  const today = localToday(tz);
  const monthStart = `${today.slice(0, 7)}-01`;
  const { companies, lines, receipts } = await loadLedger(propertyId, { today, tz });

  const total = emptyTotals();
  const per = new Map(companies.map((c) => [c.id, emptyTotals()]));
  const lastReceipt = new Map();

  for (const line of lines) {
    addLine(total, line, today);
    if (per.has(line.companyId)) addLine(per.get(line.companyId), line, today);
  }
  for (const rc of receipts) {
    if (rc.voided) continue;
    const t = per.get(rc.companyId);
    if (rc.unapplied > PENNY) {
      total.credit += rc.unapplied;
      if (t) t.credit += rc.unapplied;
    }
    if (rc.receivedOn >= monthStart && rc.receivedOn <= today) {
      total.receivedThisMonth += rc.amount;
      if (t) t.receivedThisMonth += rc.amount;
    }
    if (!lastReceipt.has(rc.companyId) || rc.receivedOn > lastReceipt.get(rc.companyId).receivedOn) {
      lastReceipt.set(rc.companyId, rc);
    }
  }

  const rows = companies
    .map((c) => {
      const t = roundTotals(per.get(c.id));
      const exposure = round(t.receivable + t.running);
      return {
        id: c.id,
        name: c.name,
        kind: c.kind,
        gstin: c.gstin,
        isActive: c.is_active,
        creditDays: c.credit_days ?? null,
        creditLimit: c.credit_limit == null ? null : Number(c.credit_limit),
        overLimit: c.credit_limit != null && exposure > Number(c.credit_limit) + PENNY,
        exposure,
        lastReceipt: lastReceipt.get(c.id)
          ? { receivedOn: lastReceipt.get(c.id).receivedOn, amount: lastReceipt.get(c.id).amount }
          : null,
        ...t,
      };
    })
    // A company with nothing owed, running or held says nothing a hotelier
    // needs today; it is still on the Companies & agents page.
    .filter((r) => r.receivable > PENNY || r.running > PENNY || r.credit > PENNY || r.receivedThisMonth > PENNY);

  return {
    today,
    currency: lines[0]?.currency || 'INR',
    totals: roundTotals(total),
    buckets: AGE_BUCKETS.map(({ id, label }) => ({ id, label })),
    companies: rows,
  };
}

/**
 * One company's statement: every stay billed to it that still has money on
 * it (or every one, with `all`), oldest due first, and its receipts.
 */
export async function getCompanyStatement(propertyId, companyId, { tz = 0, all = false } = {}) {
  const today = localToday(tz);
  const { companies, lines, receipts } = await loadLedger(propertyId, { companyId, today, tz });
  const company = companies[0];
  if (!company) return null;

  const stays = lines
    .filter((l) => all || Math.abs(l.balance) > PENNY)
    .sort(
      (a, b) =>
        String(a.dueOn || '9999').localeCompare(String(b.dueOn || '9999')) ||
        String(a.checkIn).localeCompare(String(b.checkIn))
    );

  const totals = emptyTotals();
  for (const l of lines) addLine(totals, l, today);
  for (const rc of receipts) if (!rc.voided && rc.unapplied > PENNY) totals.credit += rc.unapplied;

  return {
    today,
    company: {
      id: company.id,
      name: company.name,
      kind: company.kind,
      gstin: company.gstin,
      creditDays: company.credit_days ?? null,
      creditLimit: company.credit_limit == null ? null : Number(company.credit_limit),
      billingAddress: company.billing_address,
      city: company.city,
      state: company.state,
      postalCode: company.postal_code,
      contactPerson: company.contact_person,
      email: company.email,
      phone: company.phone,
    },
    totals: roundTotals(totals),
    stays,
    receipts,
  };
}

// ------------------------------------------------------------------
// Receipts
// ------------------------------------------------------------------

/**
 * Split an amount across a company's bills, oldest due first -- the order a
 * company's accountant expects a payment to be applied in.
 */
function allocateOldestFirst(stays, amount) {
  let left = round(amount);
  const out = [];
  for (const s of stays) {
    if (left <= PENNY) break;
    if (s.phase !== 'billed' || s.balance <= PENNY) continue;
    const take = round(Math.min(left, s.balance));
    out.push({ reservationId: s.reservationId, amount: take });
    left = round(left - take);
  }
  return out;
}

/**
 * Check the allocations a desk chose, or work them out oldest first. Each
 * must be a bill of this company still owing at least that much, and
 * together they cannot exceed what is being applied.
 */
function settleAllocations(statement, amount, requested) {
  if (!Array.isArray(requested)) return allocateOldestFirst(statement.stays, amount);

  const byId = new Map(statement.stays.map((s) => [s.reservationId, s]));
  const out = [];
  let sum = 0;
  for (const a of requested) {
    const value = round(Number(a.amount));
    if (!value) continue;
    if (!Number.isFinite(value) || value < 0) throw new Error('Amounts applied must be more than zero.');
    const stay = byId.get(a.reservationId);
    if (!stay) throw new Error('One of the bookings is not billed to this company.');
    if (value > stay.balance + PENNY) {
      throw new Error(`${stay.reference} only owes ${stay.balance.toLocaleString('en-IN')}.`);
    }
    out.push({ reservationId: stay.reservationId, amount: value });
    sum += value;
  }
  if (sum > amount + PENNY) throw new Error('More is applied than the payment is for.');
  return out;
}

/** The payments a receipt makes on each stay, written together. */
async function writeAllocations(receipt, company, allocations, userId) {
  if (allocations.length === 0) return [];
  const supabase = getSupabaseAdmin();
  const rows = allocations.map((a) => ({
    reservation_id: a.reservationId,
    receipt_id: receipt.id,
    amount: a.amount,
    method: receipt.method,
    reference: receipt.reference,
    // Midday, so the payment falls on the day received on any desk's clock.
    paid_at: `${receipt.received_on}T12:00:00Z`,
    notes: `City ledger — paid by ${company.name}`,
    recorded_by: userId,
  }));
  const { data, error } = await supabase.from('reservation_payments').insert(rows).select('id');
  if (error) throw new Error(`Failed to apply the payment: ${error.message}`);
  return data || [];
}

/**
 * Record money received from a company and apply it to its bills -- the
 * ones chosen, or oldest due first. What is left over stays as credit.
 */
export async function recordReceipt(propertyId, input, userId = null) {
  const amount = round(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter the amount received.');
  const method = RECEIPT_METHODS.includes(input.method) ? input.method : 'bank_transfer';
  const receivedOn = /^\d{4}-\d{2}-\d{2}$/.test(input.received_on || '') ? input.received_on : null;
  if (!receivedOn) throw new Error('Enter the date the money was received.');

  const statement = await getCompanyStatement(propertyId, input.company_id, { tz: input.tz || 0 });
  if (!statement) throw new Error('Company not found.');
  const allocations = settleAllocations(statement, amount, input.allocations);

  const supabase = getSupabaseAdmin();
  const { data: receipt, error } = await supabase
    .from('city_ledger_receipts')
    .insert({
      property_id: propertyId,
      company_id: statement.company.id,
      amount,
      method,
      reference: String(input.reference || '').trim() || null,
      received_on: receivedOn,
      notes: String(input.notes || '').trim() || null,
      recorded_by: userId,
    })
    .select('*')
    .single();
  if (error) {
    if (notMigrated(error)) throw new Error('The city ledger is not switched on for this property yet.');
    throw new Error(`Failed to record the payment: ${error.message}`);
  }

  try {
    await writeAllocations(receipt, statement.company, allocations, userId);
  } catch (err) {
    // A receipt whose payments failed would claim money was applied when it
    // was not, so it is taken back out rather than left half written.
    await supabase.from('city_ledger_receipts').delete().eq('id', receipt.id);
    throw err;
  }

  const applied = round(allocations.reduce((s, a) => s + a.amount, 0));
  return { receipt, applied, unapplied: round(amount - applied), allocations };
}

/** Apply a receipt's remaining credit to bills, chosen or oldest first. */
export async function applyReceiptCredit(propertyId, receiptId, { allocations = null, tz = 0 } = {}, userId = null) {
  const supabase = getSupabaseAdmin();
  const { data: receipt, error } = await supabase
    .from('city_ledger_receipts')
    .select('*')
    .eq('id', receiptId)
    .eq('property_id', propertyId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the receipt: ${error.message}`);
  if (!receipt) throw new Error('Receipt not found.');
  if (receipt.voided_at) throw new Error('That receipt has been voided.');

  const statement = await getCompanyStatement(propertyId, receipt.company_id, { tz });
  const held = statement.receipts.find((r) => r.id === receiptId)?.unapplied || 0;
  if (held <= PENNY) throw new Error('Nothing is left on that receipt to apply.');

  const chosen = settleAllocations(statement, held, allocations);
  if (chosen.length === 0) throw new Error('This company has no bills owing to apply it to.');
  await writeAllocations(receipt, statement.company, chosen, userId);
  const applied = round(chosen.reduce((s, a) => s + a.amount, 0));
  return { applied, unapplied: round(held - applied) };
}

/** Void a receipt and every payment it made; nothing is deleted. */
export async function voidReceipt(propertyId, receiptId, reason, userId = null) {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('city_ledger_receipts')
    .update({ voided_at: now, void_reason: reason?.trim() || null, voided_by: userId })
    .eq('id', receiptId)
    .eq('property_id', propertyId)
    .is('voided_at', null)
    .select('id');
  if (error) throw new Error(`Failed to void the receipt: ${error.message}`);
  if (!data?.length) throw new Error('That receipt was not found, or is already voided.');

  const { error: payError } = await supabase
    .from('reservation_payments')
    .update({ voided_at: now, void_reason: reason?.trim() || 'Receipt voided', voided_by: userId })
    .eq('receipt_id', receiptId)
    .is('voided_at', null);
  if (payError) throw new Error(`The receipt is voided, but its payments could not be: ${payError.message}`);
  return true;
}
