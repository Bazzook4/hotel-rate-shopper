import { getSupabaseAdmin, getPropertyClock, getReservationFolio } from '@/lib/database';
import { todayInZone } from '@/lib/hotelTime';

/**
 * Wallets: prepaid credit held by a guest, a company or a travel agent
 * (migration 047).
 *
 * In:  a top-up records the money paid (`cash_amount`) and the credit given
 *      (`credit`) -- "pay 10,000, get 11,000" -- usually from a wallet plan.
 *      An adjustment moves credit by hand, with no money changing hands.
 * Out: a payment on a booking's bill with method 'wallet', naming whose
 *      wallet it came from.
 *
 * The balance is worked out, never stored: credit in, less wallet payments
 * that still stand. Voiding a wallet payment on a bill therefore puts the
 * money back by itself. For a company the wallet is its City Ledger credit.
 *
 * An owner is `{ type: 'guest' | 'company', id }`.
 */

const PENNY = 0.009;
export const TOPUP_METHODS = ['cash', 'upi', 'card', 'bank_transfer', 'other'];
export const TIER_TONES = ['gold', 'green', 'blue', 'purple', 'grey'];

const round = (n) => Math.round(n * 100) / 100;
const db = () => getSupabaseAdmin();

const ownerColumn = (owner) => (owner.type === 'company' ? 'company_id' : 'guest_id');
const paymentColumn = (owner) => (owner.type === 'company' ? 'wallet_company_id' : 'wallet_guest_id');

/** A missing table or column from before migration 047. */
function notMigrated(error) {
  return ['PGRST205', 'PGRST200', '42P01', '42703', 'PGRST204'].includes(error?.code);
}

let seen = false;
let checkedAt = 0;

/** Whether migration 047 has run; re-checked at most once a minute until it has. */
export async function walletsReady() {
  if (seen) return true;
  if (Date.now() - checkedAt < 60000) return false;
  checkedAt = Date.now();
  const { error } = await db().from('wallet_transactions').select('id').limit(1);
  seen = !error;
  return seen;
}

export class WalletError extends Error {}

/** The owner's record, checked to belong to this property. */
async function ownerRecord(propertyId, owner) {
  const table = owner.type === 'company' ? 'companies' : 'guests';
  const nameCol = owner.type === 'company' ? 'name' : 'full_name';
  const { data, error } = await db()
    .from(table)
    .select(`id, ${nameCol}`)
    .eq('property_id', propertyId)
    .eq('id', owner.id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the wallet's owner: ${error.message}`);
  if (!data) throw new WalletError(owner.type === 'company' ? 'Company not found.' : 'Guest not found.');
  return { ...data, name: data[nameCol] };
}

/**
 * Balances for many owners of one type at once: credit in, spent, balance.
 * Owners with no wallet activity are left out.
 */
export async function walletBalances(propertyId, type, ids = null) {
  const out = new Map();
  if (!(await walletsReady())) return out;
  const owner = { type };
  const col = ownerColumn(owner);
  const payCol = paymentColumn(owner);
  const get = (id) => {
    if (!out.has(id)) out.set(id, { credit: 0, spent: 0, cash: 0, balance: 0 });
    return out.get(id);
  };

  const PAGE = 1000;
  const scope = (q) => (ids ? q.in(col, ids) : q.not(col, 'is', null));
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await scope(
      db().from('wallet_transactions').select(`${col}, credit, cash_amount`).eq('property_id', propertyId).is('voided_at', null)
    )
      .order('id')
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`Failed to load wallets: ${error.message}`);
    for (const t of data || []) {
      const w = get(t[col]);
      w.credit += Number(t.credit);
      w.cash += Number(t.cash_amount) || 0;
    }
    if (!data || data.length < PAGE) break;
  }

  for (let offset = 0; ; offset += PAGE) {
    let q = db().from('reservation_payments').select(`${payCol}, amount`).eq('method', 'wallet').is('voided_at', null);
    q = ids ? q.in(payCol, ids) : q.not(payCol, 'is', null);
    const { data, error } = await q.order('id').range(offset, offset + PAGE - 1);
    if (error) throw new Error(`Failed to load wallet payments: ${error.message}`);
    for (const p of data || []) get(p[payCol]).spent += Number(p.amount);
    if (!data || data.length < PAGE) break;
  }

  for (const w of out.values()) {
    w.credit = round(w.credit);
    w.spent = round(w.spent);
    w.cash = round(w.cash);
    w.balance = round(w.credit - w.spent);
  }
  return out;
}

export async function walletBalance(propertyId, owner) {
  const map = await walletBalances(propertyId, owner.type, [owner.id]);
  return map.get(owner.id) || { credit: 0, spent: 0, cash: 0, balance: 0 };
}

/**
 * A wallet's history, newest first: top-ups and adjustments, and every bill
 * it paid -- one list, the way a passbook reads.
 */
export async function walletHistory(propertyId, owner, { limit = 200 } = {}) {
  await ownerRecord(propertyId, owner);
  const [{ data: txs, error: txError }, { data: pays, error: payError }] = await Promise.all([
    db()
      .from('wallet_transactions')
      .select('*, wallet_plans(name)')
      .eq('property_id', propertyId)
      .eq(ownerColumn(owner), owner.id)
      .order('created_at', { ascending: false })
      .limit(limit),
    db()
      .from('reservation_payments')
      .select('id, amount, paid_at, voided_at, void_reason, reference, reservation_id, reservations(reference, guest_name)')
      .eq('method', 'wallet')
      .eq(paymentColumn(owner), owner.id)
      .order('paid_at', { ascending: false })
      .limit(limit),
  ]);
  if (txError) throw new Error(`Failed to load the wallet: ${txError.message}`);
  if (payError) throw new Error(`Failed to load the wallet: ${payError.message}`);

  const entries = [
    ...(txs || []).map((t) => ({
      id: t.id,
      kind: t.kind,
      at: t.created_at,
      on: t.received_on,
      credit: Number(t.credit),
      cash: Number(t.cash_amount) || 0,
      method: t.method,
      reference: t.reference,
      plan: t.wallet_plans?.name || null,
      notes: t.notes,
      voided: Boolean(t.voided_at),
      voidReason: t.void_reason,
    })),
    ...(pays || []).map((p) => ({
      id: p.id,
      kind: 'spend',
      at: p.paid_at,
      on: String(p.paid_at).slice(0, 10),
      credit: -Number(p.amount),
      reservationId: p.reservation_id,
      booking: p.reservations?.reference || null,
      guestName: p.reservations?.guest_name || null,
      voided: Boolean(p.voided_at),
      voidReason: p.void_reason,
    })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));

  return { entries, ...(await walletBalance(propertyId, owner)) };
}

/**
 * Add money to a wallet. With a plan, the plan says what is paid and what is
 * credited; without one, the desk says both (credit defaults to the amount
 * paid). Credit below the amount paid is refused -- that is a fee, not a
 * wallet.
 */
export async function topUpWallet(propertyId, owner, input, userId = null) {
  const record = await ownerRecord(propertyId, owner);

  let cash = Number(input.cash_amount);
  let credit = input.credit === '' || input.credit == null ? cash : Number(input.credit);
  let planId = null;
  if (input.plan_id) {
    const { data: plan } = await db()
      .from('wallet_plans')
      .select('*')
      .eq('id', input.plan_id)
      .eq('property_id', propertyId)
      .maybeSingle();
    if (!plan) throw new WalletError('That wallet plan no longer exists.');
    cash = Number(plan.pay_amount);
    credit = Number(plan.credit);
    planId = plan.id;
  }
  if (!Number.isFinite(cash) || cash <= 0) throw new WalletError('Enter the amount paid.');
  if (!Number.isFinite(credit) || credit < cash - PENNY) {
    throw new WalletError('The credit given cannot be less than the amount paid.');
  }

  const receivedOn = /^\d{4}-\d{2}-\d{2}$/.test(input.received_on || '')
    ? input.received_on
    : todayInZone(await getPropertyClock(propertyId));

  const { data, error } = await db()
    .from('wallet_transactions')
    .insert({
      property_id: propertyId,
      [ownerColumn(owner)]: owner.id,
      kind: 'topup',
      credit: round(credit),
      cash_amount: round(cash),
      method: TOPUP_METHODS.includes(input.method) ? input.method : 'cash',
      reference: String(input.reference || '').trim() || null,
      plan_id: planId,
      received_on: receivedOn,
      notes: String(input.notes || '').trim() || null,
      recorded_by: userId,
    })
    .select('*')
    .single();
  if (error) {
    if (notMigrated(error)) throw new WalletError('Wallets are not switched on for this property yet.');
    throw new Error(`Failed to add the money: ${error.message}`);
  }
  return { transaction: data, owner: record };
}

/** Move credit by hand, never below zero. No money changes hands. */
export async function adjustWallet(propertyId, owner, { credit, notes }, userId = null) {
  await ownerRecord(propertyId, owner);
  const amount = round(Number(credit));
  if (!Number.isFinite(amount) || amount === 0) throw new WalletError('Enter how much to add or take off.');
  if (!String(notes || '').trim()) throw new WalletError('Say why the wallet is being adjusted.');
  if (amount < 0) {
    const { balance } = await walletBalance(propertyId, owner);
    if (balance + amount < -PENNY) throw new WalletError(`The wallet only holds ${balance.toLocaleString('en-IN')}.`);
  }
  const { data, error } = await db()
    .from('wallet_transactions')
    .insert({
      property_id: propertyId,
      [ownerColumn(owner)]: owner.id,
      kind: 'adjust',
      credit: amount,
      cash_amount: 0,
      notes: String(notes).trim(),
      recorded_by: userId,
    })
    .select('*')
    .single();
  if (error) throw new Error(`Failed to adjust the wallet: ${error.message}`);
  return data;
}

/**
 * Void a top-up or adjustment. If its credit has already been spent, the
 * wallet's most recent bill payments are voided too, newest first, until the
 * wallet is no longer below zero -- those bills owe that money again. The
 * caller is told which, so nothing is undone silently.
 */
export async function voidWalletTransaction(propertyId, id, reason, userId = null) {
  const { data: tx, error } = await db()
    .from('wallet_transactions')
    .select('*')
    .eq('id', id)
    .eq('property_id', propertyId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the wallet entry: ${error.message}`);
  if (!tx) throw new WalletError('That wallet entry was not found.');
  if (tx.voided_at) throw new WalletError('That entry is already voided.');

  const owner = tx.company_id ? { type: 'company', id: tx.company_id } : { type: 'guest', id: tx.guest_id };
  const why = String(reason || '').trim() || null;
  const now = new Date().toISOString();

  const { balance } = await walletBalance(propertyId, owner);
  let shortfall = round(Number(tx.credit) - balance);
  const undone = [];
  if (shortfall > PENNY) {
    const { data: pays, error: payError } = await db()
      .from('reservation_payments')
      .select('id, amount, reservations(reference)')
      .eq('method', 'wallet')
      .eq(paymentColumn(owner), owner.id)
      .is('voided_at', null)
      .order('paid_at', { ascending: false });
    if (payError) throw new Error(`Failed to load wallet payments: ${payError.message}`);
    for (const p of pays || []) {
      if (shortfall <= PENNY) break;
      const { error: voidError } = await db()
        .from('reservation_payments')
        .update({ voided_at: now, void_reason: why ? `Wallet top-up voided: ${why}` : 'Wallet top-up voided', voided_by: userId })
        .eq('id', p.id);
      if (voidError) throw new Error(`Failed to void a wallet payment: ${voidError.message}`);
      undone.push({ booking: p.reservations?.reference || null, amount: Number(p.amount) });
      shortfall = round(shortfall - Number(p.amount));
    }
  }

  const { error: txVoidError } = await db()
    .from('wallet_transactions')
    .update({ voided_at: now, void_reason: why, voided_by: userId })
    .eq('id', id);
  if (txVoidError) throw new Error(`Failed to void the wallet entry: ${txVoidError.message}`);
  return { undone };
}

/**
 * Pay a booking's bill from a wallet: the guest's own, or the company's or
 * agent's on the booking. Never more than the wallet holds, nor more than
 * the bill still owes.
 */
export async function payFromWallet(propertyId, reservationId, owner, amount, userId = null, { folio = null, billGuestId = null } = {}) {
  const value = round(Number(amount));
  if (!Number.isFinite(value) || value <= 0) throw new WalletError('Enter how much to take from the wallet.');

  const bill = folio || (await getReservationFolio(reservationId));
  const r = bill.reservation;
  if (r.property_id !== propertyId) throw new WalletError('Reservation not found.');
  // With separate bills the payment goes on one sharer's bill: the one named,
  // or the bill of the sharer this company is billed for.
  const sharers = bill.sharers || [];
  const sharer = sharers.length
    ? sharers.find((s) => s.id === billGuestId) ||
      (owner.type === 'company' ? sharers.find((s) => s.companyId === owner.id) : null) ||
      sharers.find((s) => s.isPrimary)
    : null;
  const allowed =
    owner.type === 'company'
      ? r.company_id === owner.id || sharers.some((s) => s.companyId === owner.id)
      : r.guest_id === owner.id;
  if (!allowed) {
    throw new WalletError(
      owner.type === 'company'
        ? "That wallet belongs to a company that is not on this booking."
        : "That wallet belongs to a guest who is not on this booking."
    );
  }

  const { balance } = await walletBalance(propertyId, owner);
  if (value > balance + PENNY) throw new WalletError(`The wallet only holds ${balance.toLocaleString('en-IN')}.`);
  const owes = sharer ? (bill.bills || []).find((b) => b.id === sharer.id)?.balance ?? 0 : bill.totals.balance;
  if (value > owes + PENNY) {
    throw new WalletError(`The bill only owes ${Number(owes).toLocaleString('en-IN')}.`);
  }

  const { data, error } = await db()
    .from('reservation_payments')
    .insert({
      reservation_id: reservationId,
      amount: value,
      method: 'wallet',
      [paymentColumn(owner)]: owner.id,
      notes: owner.type === 'company' ? 'Paid from company wallet' : "Paid from guest's wallet",
      ...(sharer ? { bill_guest_id: sharer.id } : {}),
      paid_at: new Date().toISOString(),
      recorded_by: userId,
    })
    .select('*')
    .single();
  if (error) throw new Error(`Failed to pay from the wallet: ${error.message}`);
  return data;
}

// ------------------------------------------------------------------
// Wallet plans
// ------------------------------------------------------------------

export async function listWalletPlans(propertyId) {
  if (!(await walletsReady())) return [];
  const { data, error } = await db()
    .from('wallet_plans')
    .select('*')
    .eq('property_id', propertyId)
    .order('pay_amount');
  if (error) throw new Error(`Failed to load wallet plans: ${error.message}`);
  return data || [];
}

export async function saveWalletPlan(propertyId, input) {
  const row = {};
  if ('name' in input) row.name = String(input.name || '').trim();
  if ('pay_amount' in input) row.pay_amount = Number(input.pay_amount);
  if ('credit' in input) row.credit = Number(input.credit);
  if ('is_active' in input) row.is_active = input.is_active !== false;
  if ('notes' in input) row.notes = String(input.notes || '').trim() || null;

  if ('name' in row && !row.name) throw new WalletError('Give the plan a name.');
  if ('pay_amount' in row && !(row.pay_amount > 0)) throw new WalletError('Enter what the guest pays.');
  if ('credit' in row && !(row.credit > 0)) throw new WalletError('Enter the credit they get.');

  if (input.id) {
    const { data: before } = await db().from('wallet_plans').select('*').eq('id', input.id).eq('property_id', propertyId).maybeSingle();
    if (!before) throw new WalletError('That plan no longer exists.');
    const merged = { ...before, ...row };
    if (Number(merged.credit) < Number(merged.pay_amount)) throw new WalletError('The credit cannot be less than what is paid.');
    const { data, error } = await db()
      .from('wallet_plans')
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq('id', input.id)
      .select('*')
      .single();
    if (error) throw new Error(`Failed to save the plan: ${error.message}`);
    return data;
  }

  if (!row.name || !(row.pay_amount > 0) || !(row.credit > 0)) {
    throw new WalletError('A plan needs a name, what is paid and the credit given.');
  }
  if (row.credit < row.pay_amount) throw new WalletError('The credit cannot be less than what is paid.');
  const { data, error } = await db()
    .from('wallet_plans')
    .insert({ ...row, property_id: propertyId })
    .select('*')
    .single();
  if (error) {
    if (notMigrated(error)) throw new WalletError('Wallets are not switched on for this property yet.');
    throw new Error(`Failed to save the plan: ${error.message}`);
  }
  return data;
}

export async function deleteWalletPlan(propertyId, id) {
  const { error } = await db().from('wallet_plans').delete().eq('id', id).eq('property_id', propertyId);
  if (error) throw new Error(`Failed to delete the plan: ${error.message}`);
  return true;
}

// ------------------------------------------------------------------
// Guest tiers
// ------------------------------------------------------------------

export async function listGuestTiers(propertyId) {
  if (!(await walletsReady())) return [];
  const { data, error } = await db()
    .from('guest_tiers')
    .select('*')
    .eq('property_id', propertyId)
    .order('sort_order')
    .order('name');
  if (error) throw new Error(`Failed to load tiers: ${error.message}`);
  return data || [];
}

export async function saveGuestTier(propertyId, input) {
  const row = {};
  if ('name' in input) row.name = String(input.name || '').trim();
  if ('tone' in input) row.tone = TIER_TONES.includes(input.tone) ? input.tone : 'gold';
  if ('sort_order' in input) row.sort_order = Math.round(Number(input.sort_order) || 0);
  if ('notes' in input) row.notes = String(input.notes || '').trim() || null;
  if ('name' in row && !row.name) throw new WalletError('Give the tier a name.');

  const query = input.id
    ? db().from('guest_tiers').update({ ...row, updated_at: new Date().toISOString() }).eq('id', input.id).eq('property_id', propertyId)
    : db().from('guest_tiers').insert({ tone: 'gold', ...row, property_id: propertyId });
  if (!input.id && !row.name) throw new WalletError('Give the tier a name.');
  const { data, error } = await query.select('*').single();
  if (error) {
    if (notMigrated(error)) throw new WalletError('Tiers are not switched on for this property yet.');
    throw new Error(`Failed to save the tier: ${error.message}`);
  }
  return data;
}

/** Deleting a tier takes it off its guests; the guests stay. */
export async function deleteGuestTier(propertyId, id) {
  const { error } = await db().from('guest_tiers').delete().eq('id', id).eq('property_id', propertyId);
  if (error) throw new Error(`Failed to delete the tier: ${error.message}`);
  return true;
}
