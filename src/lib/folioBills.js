import { dayUseLabel } from '@/lib/dayUse';
import { chargedRate } from '@/lib/discounts';

/**
 * A stay's bill as charges, and -- when guests sharing a room each want a bill
 * of their own -- as one bill per guest.
 *
 * Pure: the folio tab, the invoice and the city ledger all call it, so the
 * figure a sharer is invoiced is the figure their company is chased for.
 *
 * Separate bills (migration 056) are switched on per booking. Every named
 * guest is then a sharer: the room is divided night by night by their share
 * (even unless the desk set one), and each service and payment belongs to one
 * sharer's bill -- the primary guest's when nobody was chosen. Tax is worked
 * out on the whole room, as the law reads the tariff, and divided the same way.
 */

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function fullName(g) {
  return [g.first_name, g.last_name].filter(Boolean).join(' ');
}

/**
 * The sharers on a booking, with each one's share of the room in percent.
 * Empty unless separate bills are on and at least two guests are named.
 *
 * Shares the desk set are kept; the rest of the room is divided evenly among
 * the guests without one. Shares that do not come to 100 are scaled to it.
 */
export function sharersOf(reservation, guests = []) {
  if (!reservation?.separate_bills || guests.length < 2) return [];
  const ordered = [...guests].sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  const set = ordered.filter((g) => g.room_share != null && g.room_share !== '');
  const setSum = set.reduce((s, g) => s + Number(g.room_share), 0);
  const unset = ordered.length - set.length;
  const each = unset > 0 ? Math.max(0, 100 - setSum) / unset : 0;
  const raw = ordered.map((g) => (g.room_share != null && g.room_share !== '' ? Number(g.room_share) : each));
  const sum = raw.reduce((s, v) => s + v, 0);

  return ordered.map((g, i) => ({
    id: g.id,
    name: fullName(g) || 'Guest',
    email: g.email || null,
    phone: g.phone || null,
    isPrimary: Boolean(g.is_primary) || (i === 0 && !ordered.some((x) => x.is_primary)),
    share: sum > 0 ? (raw[i] * 100) / sum : 100 / ordered.length,
    shareSet: g.room_share != null && g.room_share !== '',
    // The primary guest bills the booking's company unless given their own.
    companyId:
      g.bill_company_id ||
      ((g.is_primary || i === 0) && reservation.bill_to === 'company' ? reservation.company_id : null) ||
      null,
  }));
}

/** Whose bill a service or payment is on: its own sharer, or the primary guest's. */
export function ownerOf(row, sharers) {
  if (sharers.length === 0) return null;
  if (row.bill_guest_id && sharers.some((s) => s.id === row.bill_guest_id)) return row.bill_guest_id;
  return (sharers.find((s) => s.isPrimary) || sharers[0]).id;
}

/**
 * Divide an amount by the sharers' shares, to the paisa, the last sharer
 * with a share taking what rounding leaves so the parts add up exactly.
 */
function divide(amount, sharers) {
  const withShare = sharers.filter((s) => s.share > 0);
  const out = new Map();
  let left = round2(amount);
  withShare.forEach((s, i) => {
    const part = i === withShare.length - 1 ? left : round2((amount * s.share) / 100);
    out.set(s.id, part);
    left = round2(left - part);
  });
  return out;
}

/**
 * The charges an invoice can carry, each with the invoice it is already on.
 *
 * `keys` are the tax lines behind a charge (see `stayLines`) and `weight` the
 * part of them it carries -- 1, or a sharer's share of a night -- which is how
 * an invoice carries the tax on its own charges and no others. One room charge
 * stands for every night when the nights do not add up to it.
 */
export function folioCharges({ reservation, nights, nightsMatch, extras, invoices = [], tax, roomCategory, categoryOf, room, sharers = [], keep = 1, nightOff = null, totals = null }) {
  const roomName = reservation.room_types?.room_type_name || 'room';
  const base = [];
  // `room` is the room as charged, after any discount before tax, and
  // `keep` the share of each night's rate that leaves, or `nightOff` the
  // money off each night when the discount is kept by night.
  const discounted = keep < 1 ? ', after discount' : '';

  if (nightsMatch && nights.length > 0) {
    // The last night takes what rounding leaves, so the nights add up to the room.
    let left = round2(room);
    nights.forEach((n, i) => {
      const rate = keep < 1 ? (i === nights.length - 1 ? left : round2(chargedRate(n.rate, n.stay_date, keep, nightOff))) : n.rate;
      left = round2(left - rate);
      base.push({
        key: `night:${n.stay_date}`,
        keys: [`night:${n.stay_date}`],
        category: roomCategory,
        description: `Accommodation: ${roomName}, night of ${n.stay_date}${nightOff && !(Number(nightOff[n.stay_date]) > 0) ? '' : discounted}`,
        quantity: 1,
        unit_price: rate,
        amount: rate,
        room: true,
      });
    });
  } else if (room > 0 || nights.length > 0) {
    const dayUse = reservation.stay_kind === 'day_use';
    const keys = nights.length > 0
      ? nights.map((n) => `night:${n.stay_date}`)
      : dayUse
        ? [`night:${reservation.check_in}`]
        : ['room'];
    base.push({
      key: 'room',
      keys,
      category: roomCategory,
      description: dayUse
        ? `Day use: ${roomName}, ${dayUseLabel(reservation.day_use_hours)} on ${reservation.check_in}`
        : `Accommodation: ${roomName} (${nights.length} night${nights.length === 1 ? '' : 's'})${discounted}`,
      quantity: dayUse ? 1 : undefined,
      unit_price: dayUse ? room : undefined,
      amount: room,
      room: true,
    });
  }

  for (const e of extras.filter((x) => x.kind === 'extra')) {
    base.push({
      key: `extra:${e.id}`,
      keys: [`extra:${e.id}`],
      category: categoryOf(e.extra_id),
      description: e.name,
      quantity: Number(e.quantity),
      unit_price: Number(e.unit_price),
      amount: Number(e.unit_price) * Number(e.quantity),
      owner: ownerOf(e, sharers),
    });
  }

  // A discount after tax is a charge of its own, below zero and untaxed, so
  // it goes on an invoice and a sharer's bill like any other charge.
  if (totals?.discountTiming === 'after_tax' && totals.discount > 0) {
    base.push({
      key: 'discount',
      keys: [],
      category: 'Discount',
      description: 'Discount after tax',
      amount: -totals.discount,
      discount: true,
      divide: true,
    });
  }

  // With sharers the room is divided: each night becomes one charge per
  // sharer, carrying that sharer's part of the night and of its tax. A
  // discount after tax is divided the same way.
  const out = [];
  for (const c of base) {
    if ((!c.room && !c.divide) || sharers.length === 0) {
      out.push({ ...c, weight: 1, owner: c.owner || null });
      continue;
    }
    const parts = divide(c.amount, sharers);
    for (const s of sharers) {
      if (!parts.has(s.id)) continue;
      out.push({
        ...c,
        key: `${c.key}@${s.id}`,
        description: `${c.description}, ${Math.round(s.share * 100) / 100}% share`,
        quantity: c.quantity,
        unit_price: c.unit_price == null ? undefined : parts.get(s.id),
        amount: parts.get(s.id),
        weight: c.amount ? parts.get(s.id) / c.amount : s.share / 100,
        owner: s.id,
      });
    }
  }

  // What the standing invoices already carry. One issued before invoices
  // could be split carried the whole bill.
  const covered = new Map();
  let wholeBill = null;
  for (const inv of [...invoices].reverse()) {
    if (inv.voided_at) continue;
    const keys = inv.snapshot?.charge_keys;
    if (!Array.isArray(keys)) wholeBill = wholeBill || inv.invoice_number;
    else for (const k of keys) covered.set(k, inv.invoice_number);
  }
  const suffix = (key) => (key.includes('@') ? key.slice(key.indexOf('@')) : '');
  const stem = (key) => (key.includes('@') ? key.slice(0, key.indexOf('@')) : key);

  return out.map((c) => {
    const exclusive = c.keys.reduce(
      (sum, k) => sum + (tax.byKey[k] || []).filter((t) => !t.inclusive).reduce((s, t) => s + t.amount, 0),
      0
    ) * c.weight;
    const s = suffix(c.key);
    const k = stem(c.key);
    return {
      ...c,
      amount: round2(c.amount),
      tax: round2(exclusive),
      // A room charged as one line, invoiced before its nights were priced
      // one by one, still covers those nights, and the other way round.
      invoice:
        wholeBill ||
        covered.get(c.key) ||
        (k.startsWith('night:') ? covered.get(`room${s}`) : null) ||
        (k === 'room' ? c.keys.map((x) => covered.get(`${x}${s}`)).find(Boolean) : null) ||
        null,
    };
  });
}

/**
 * Each sharer's bill: their charges, the tax on them, what they paid and
 * what they still owe. The bill with the most tax takes what rounding leaves, so
 * the bills add up to the stay's own total.
 */
export function sharerBills({ sharers, charges, payments, totals }) {
  if (sharers.length === 0) return [];
  const bills = sharers.map((s) => {
    const mine = charges.filter((c) => c.owner === s.id);
    const paid = payments
      .filter((p) => !p.voided_at && ownerOf(p, sharers) === s.id)
      .reduce((sum, p) => sum + Number(p.amount), 0);
    return {
      ...s,
      charges: round2(mine.reduce((sum, c) => sum + c.amount, 0)),
      tax: round2(mine.reduce((sum, c) => sum + c.tax, 0)),
      paid: round2(paid),
    };
  });
  const biggest = bills.reduce((a, b) => (b.tax > a.tax ? b : a), bills[0]);
  biggest.tax = round2(totals.tax - bills.filter((b) => b !== biggest).reduce((s, b) => s + b.tax, 0));
  for (const b of bills) {
    b.total = round2(b.charges + b.tax);
    b.balance = round2(b.total - b.paid);
  }
  return bills;
}
