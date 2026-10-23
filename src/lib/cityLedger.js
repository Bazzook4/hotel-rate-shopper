import { getSupabaseAdmin } from '@/lib/database';
import { loadFolios, localDay, localToday } from '@/lib/financeReports';
import { DEFAULT_ZONE } from '@/lib/hotelTime';
import { readAll, round } from '@/lib/reports';
import {
  walletBalances,
  walletHistory,
  walletsReady,
  topUpWallet,
  payFromWallet,
  voidWalletTransaction,
  WalletError,
} from '@/lib/wallets';

/**
 * The city ledger: what companies and travel agents owe for stays billed to
 * them, when it falls due, and the money they have sent.
 *
 * What is owed is the folio balance of each stay billed to a company, worked
 * out by `loadFolios` exactly as the folio tab works it out -- never stored,
 * so the ledger and the bill cannot disagree. When guests sharing a room are
 * billed apart, each sharer's bill is its own line, owed by that sharer's
 * company only. A stay owes from the day it is
 * billed: its latest invoice, or check-out if none was issued. It falls due
 * after the company's credit days.
 *
 * Money a company sends goes into its wallet (src/lib/wallets.js), and is
 * applied to its bills as wallet payments. Whatever is not applied is the
 * wallet's balance -- the company's credit -- until it is spent on later
 * bills. One balance, whichever page it is seen from.
 */

/** Differences smaller than this are rounding, not money. */
const PENNY = 0.009;

const STAY_SELECT = '*, room_types(room_type_name), rooms(room_number)';


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
  { id: 'd30', label: '1 to 30 days', upTo: 30 },
  { id: 'd60', label: '31 to 60 days', upTo: 60 },
  { id: 'd90', label: '61 to 90 days', upTo: 90 },
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

/**
 * A stay billed to a company, as a ledger line -- or, with `bill`, one
 * sharer's bill on it.
 */
function stayLine(r, folio, company, today, tz, bill = null) {
  const phase = phaseOf(r);
  const invoice =
    (bill ? folio?.invoices?.find((i) => (i.sharer_id ?? i.snapshot?.sharer_id) === bill.id) : folio?.invoices?.[0]) || null;
  const billedOn =
    phase === 'billed'
      ? invoice?.issued_at
        ? localDay(invoice.issued_at, tz)
        : r.status === 'checked_out'
        ? r.check_out
        : String(r.updated_at || r.check_in).slice(0, 10)
      : null;
  const dueOn = billedOn ? shiftDay(billedOn, Number(company?.credit_days) || 0) : null;
  const totals = bill || folio?.totals || { total: 0, paid: 0, balance: 0 };
  const overdueDays = dueOn && totals.balance > PENNY ? Math.max(0, daysBetween(dueOn, today)) : 0;
  return {
    reservationId: r.id,
    billGuestId: bill?.id || null,
    lineKey: bill ? `${r.id}:${bill.id}` : r.id,
    reference: r.reference,
    guestName: bill ? bill.name : r.guest_name,
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
    currency: r.currency || null,
  };
}

/** Everything the ledger reads, for one company or all of them. */
async function loadLedger(propertyId, { companyId = null, today, tz = DEFAULT_ZONE } = {}) {
  const supabase = getSupabaseAdmin();

  let companyQuery = supabase.from('companies').select('*').eq('property_id', propertyId);
  if (companyId) companyQuery = companyQuery.eq('id', companyId);
  const { data: companies, error: companyError } = await companyQuery.order('name');
  if (companyError) throw new Error(`Failed to load companies: ${companyError.message}`);
  const byId = new Map((companies || []).map((c) => [c.id, c]));

  const direct = await readAll(() => {
    let q = supabase
      .from('reservations')
      .select(STAY_SELECT)
      .eq('property_id', propertyId)
      .eq('bill_to', 'company')
      .not('company_id', 'is', null);
    if (companyId) q = q.eq('company_id', companyId);
    return q.order('id');
  }, 'stays billed to companies');

  // Sharers whose own bill goes to a company (migration 056). Before the
  // migration there are none.
  let sharerStays = [];
  try {
    const rows = await readAll(() => {
      let q = supabase
        .from('reservation_guests')
        .select('reservation_id, reservations!inner(property_id, separate_bills)')
        .eq('reservations.property_id', propertyId)
        .eq('reservations.separate_bills', true)
        .not('bill_company_id', 'is', null);
      if (companyId) q = q.eq('bill_company_id', companyId);
      return q.order('reservation_id');
    }, 'sharers billed to companies');
    const have = new Set(direct.map((r) => r.id));
    const ids = [...new Set(rows.map((x) => x.reservation_id))].filter((id) => !have.has(id));
    if (ids.length) {
      sharerStays = await readAll(
        () => supabase.from('reservations').select(STAY_SELECT).in('id', ids).order('id'),
        'shared stays'
      );
    }
  } catch {
    sharerStays = [];
  }
  const stays = [...direct, ...sharerStays];

  const { folios } = stays.length ? await loadFolios(propertyId, stays) : { folios: new Map() };

  // The company's wallet: its balance is the credit it holds, and its
  // top-ups are the money it sent. Before migration 047 there are none.
  const ids = (companies || []).map((c) => c.id);
  const wallets = ids.length ? await walletBalances(propertyId, 'company', ids) : new Map();
  let topups = [];
  if (ids.length && (await walletsReady())) {
    topups = await readAll(
      () =>
        supabase
          .from('wallet_transactions')
          .select('company_id, cash_amount, credit, received_on')
          .eq('property_id', propertyId)
          .eq('kind', 'topup')
          .is('voided_at', null)
          .in('company_id', ids)
          .order('id'),
      'company top-ups'
    );
  }

  const lines = [];
  for (const r of stays) {
    const folio = folios.get(r.id);
    if (folio?.bills?.length) {
      // Each sharer's bill is owed by their own company, and only theirs.
      for (const b of folio.bills) {
        if (!b.companyId || (companyId && b.companyId !== companyId) || !byId.has(b.companyId)) continue;
        lines.push({ companyId: b.companyId, ...stayLine(r, folio, byId.get(b.companyId), today, tz, b) });
      }
    } else if (r.bill_to === 'company' && r.company_id) {
      lines.push({ companyId: r.company_id, ...stayLine(r, folio, byId.get(r.company_id), today, tz) });
    }
  }

  return { companies: companies || [], lines, wallets, topups };
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
export async function getCityLedger(propertyId, { tz = DEFAULT_ZONE } = {}) {
  const today = localToday(tz);
  const monthStart = `${today.slice(0, 7)}-01`;
  const { companies, lines, wallets, topups } = await loadLedger(propertyId, { today, tz });

  const total = emptyTotals();
  const per = new Map(companies.map((c) => [c.id, emptyTotals()]));
  const lastReceipt = new Map();

  for (const line of lines) {
    addLine(total, line, today);
    if (per.has(line.companyId)) addLine(per.get(line.companyId), line, today);
  }
  for (const [companyId, w] of wallets) {
    if (w.balance > PENNY) {
      total.credit += w.balance;
      if (per.has(companyId)) per.get(companyId).credit += w.balance;
    }
  }
  for (const tp of topups) {
    const t = per.get(tp.company_id);
    const cash = Number(tp.cash_amount) || 0;
    if (tp.received_on >= monthStart && tp.received_on <= today) {
      total.receivedThisMonth += cash;
      if (t) t.receivedThisMonth += cash;
    }
    const last = lastReceipt.get(tp.company_id);
    if (!last || tp.received_on > last.receivedOn) {
      lastReceipt.set(tp.company_id, { receivedOn: tp.received_on, amount: cash });
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
    currency: lines[0]?.currency || null,
    totals: roundTotals(total),
    buckets: AGE_BUCKETS.map(({ id, label }) => ({ id, label })),
    companies: rows,
  };
}

/**
 * One company's statement: every stay billed to it that still has money on
 * it (or every one, with `all`), oldest due first, and its receipts.
 */
export async function getCompanyStatement(propertyId, companyId, { tz = DEFAULT_ZONE, all = false } = {}) {
  const today = localToday(tz);
  const { companies, lines, wallets } = await loadLedger(propertyId, { companyId, today, tz });
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
  const wallet = wallets.get(company.id);
  if (wallet?.balance > PENNY) totals.credit += wallet.balance;
  const history = (await walletsReady())
    ? (await walletHistory(propertyId, { type: 'company', id: company.id })).entries
    : [];

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
    wallet: history,
  };
}

// ------------------------------------------------------------------
// Money received
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
    out.push({ lineKey: s.lineKey, reservationId: s.reservationId, billGuestId: s.billGuestId, amount: take });
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

  const byId = new Map(statement.stays.map((s) => [s.lineKey, s]));
  const out = [];
  let sum = 0;
  for (const a of requested) {
    const value = round(Number(a.amount));
    if (!value) continue;
    if (!Number.isFinite(value) || value < 0) throw new WalletError('Amounts applied must be more than zero.');
    const stay = byId.get(a.lineKey || a.reservationId);
    if (!stay) throw new WalletError('One of the bookings is not billed to this company.');
    if (value > stay.balance + PENNY) {
      throw new WalletError(`${stay.reference} only owes ${stay.balance.toLocaleString('en-IN')}.`);
    }
    out.push({ lineKey: stay.lineKey, reservationId: stay.reservationId, billGuestId: stay.billGuestId, amount: value });
    sum += value;
  }
  if (sum > amount + PENNY) throw new WalletError('More is applied than the wallet holds.');
  return out;
}

/** Pay each chosen bill from the company's wallet. */
async function spendOnBills(propertyId, companyId, allocations, userId) {
  for (const a of allocations) {
    await payFromWallet(propertyId, a.reservationId, { type: 'company', id: companyId }, a.amount, userId, {
      billGuestId: a.billGuestId || null,
    });
  }
  return round(allocations.reduce((s, a) => s + a.amount, 0));
}

/**
 * Money received from a company: it goes into the company's wallet (with
 * any bonus credit the desk gives), then pays its bills -- the ones chosen,
 * or oldest due first. What is left stays in the wallet as credit.
 */
export async function recordReceipt(propertyId, input, userId = null) {
  const statement = await getCompanyStatement(propertyId, input.company_id, { tz: input.tz });
  if (!statement) throw new WalletError('Company not found.');

  const { transaction } = await topUpWallet(
    propertyId,
    { type: 'company', id: statement.company.id },
    {
      cash_amount: input.amount,
      credit: input.credit,
      plan_id: input.plan_id,
      method: input.method,
      reference: input.reference,
      received_on: input.received_on,
      notes: input.notes,
    },
    userId
  );

  const holding = round(Number(transaction.credit) + Number(statement.totals.credit || 0));
  const allocations = settleAllocations(statement, Number(transaction.credit), input.allocations);
  if (allocations.reduce((s, a) => s + a.amount, 0) > holding + PENNY) {
    throw new WalletError('More is applied than the wallet holds.');
  }
  const applied = await spendOnBills(propertyId, statement.company.id, allocations, userId);
  return { transaction, applied, unapplied: round(Number(transaction.credit) - applied), allocations };
}

/** Spend a company's wallet on its bills, chosen or oldest first. */
export async function applyCompanyCredit(propertyId, companyId, { allocations = null, tz = DEFAULT_ZONE } = {}, userId = null) {
  const statement = await getCompanyStatement(propertyId, companyId, { tz });
  if (!statement) throw new WalletError('Company not found.');
  const held = statement.totals.credit;
  if (held <= PENNY) throw new WalletError('This company has no credit to apply.');
  const chosen = settleAllocations(statement, held, allocations);
  if (chosen.length === 0) throw new WalletError('This company has no bills owing to apply it to.');
  const applied = await spendOnBills(propertyId, companyId, chosen, userId);
  return { applied, unapplied: round(held - applied) };
}

/** Void money recorded from a company; see voidWalletTransaction. */
export function voidReceipt(propertyId, transactionId, reason, userId = null) {
  return voidWalletTransaction(propertyId, transactionId, reason, userId);
}
