/**
 * Working out the taxes on a stay, service by service.
 *
 * Everything billed is a service -- the room, breakfast, a pickup -- and each
 * service carries its own tax rules. So a tax is computed over the lines of
 * the services it is attached to, not over "the bill": GST at the room's slab
 * lands on the room nights, GST on food lands on the breakfast, and a rule
 * attached to nothing charges nothing.
 *
 * Pure: no database, no dates from the clock. The folio, the invoice and the
 * preview on the Tax Setup page all call `computeTaxes`, so the figure a
 * hotelier checks while setting a rule up is the figure the guest is charged.
 *
 * A line is one unit price times a quantity on a date: each room night is a
 * line of its own, which is what lets a GST slab be judged night by night and
 * a rule start or end part-way through a stay.
 */

import { chargedRate, discountByNight, discountOf, discountAmount } from "@/lib/discounts";

export const TAX_BASES = [
  { id: "per_night", label: "Per night / per unit" },
  { id: "per_stay", label: "Per booking" },
  { id: "per_adult_per_night", label: "Per adult, per night / unit" },
  { id: "per_guest_per_night", label: "Per guest, per night / unit" },
  { id: "per_adult_per_stay", label: "Per adult, per booking" },
  { id: "per_guest_per_stay", label: "Per guest, per booking" },
];

export const TAX_SCOPES = [
  { id: "all", label: "All guests" },
  { id: "domestic", label: "Domestic guests only" },
  { id: "international", label: "International guests only" },
];

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function num(value) {
  return value === null || value === undefined || value === "" ? null : Number(value);
}

/** Whether a rule is in force on a stay date. Open ends are unbounded. */
export function inForce(tax, date) {
  if (!date) return true;
  if (tax.valid_from && date < tax.valid_from) return false;
  if (tax.valid_to && date > tax.valid_to) return false;
  return true;
}

/** Whether a unit price falls in a rule's price band. */
export function inBand(tax, price) {
  const above = num(tax.rate_above);
  const upTo = num(tax.rate_up_to);
  const p = Number(price) || 0;
  if (above !== null && !(p > above)) return false;
  if (upTo !== null && !(p <= upTo)) return false;
  return true;
}

/** Whether a rule applies to this guest at all. */
export function appliesToGuest(tax, residency) {
  if (!tax.guest_scope || tax.guest_scope === "all") return true;
  return tax.guest_scope === (residency || "domestic");
}

/** A short description of a rule, as the setup list shows it. */
export function describeTax(tax, money = (v) => String(v)) {
  const parts = [];
  if (tax.calc_type === "fixed") {
    const basis = TAX_BASES.find((b) => b.id === tax.basis)?.label.toLowerCase();
    parts.push(`${money(tax.value)} ${basis || ""}`.trim());
  } else {
    parts.push(`${Number(tax.value)}%`);
  }

  const above = num(tax.rate_above);
  const upTo = num(tax.rate_up_to);
  if (above !== null && upTo !== null) {
    parts.push(`priced above ${money(above)} up to ${money(upTo)}`);
  } else if (above !== null) {
    parts.push(`priced above ${money(above)}`);
  } else if (upTo !== null) {
    parts.push(`priced up to ${money(upTo)}`);
  }

  if (tax.guest_scope === "international") parts.push("international guests");
  if (tax.guest_scope === "domestic") parts.push("domestic guests");
  if (tax.max_nights) parts.push(`first ${tax.max_nights} night${tax.max_nights === 1 ? "" : "s"}`);
  if (tax.is_compound) parts.push("on top of earlier taxes");
  if (tax.is_inclusive) parts.push("included in the price");
  return parts.join(", ");
}

/**
 * The lines of a stay, in the shape `computeTaxes` reads.
 *
 * Room nights become lines of the room service; charged extras become lines
 * of the service they were sold as. Inclusions are part of the room price and
 * are not lines of their own. An extra with no service (typed in by hand
 * before services existed) is still a line, but carries no taxes.
 */
export function stayLines({ nights = [], extras = [], roomServiceId = null }) {
  const sorted = [...nights]
    .filter((n) => n && n.stay_date)
    .sort((a, b) => a.stay_date.localeCompare(b.stay_date));
  const firstNight = sorted[0]?.stay_date || null;

  return [
    ...sorted.map((n) => ({
      key: `night:${n.stay_date}`,
      service_id: roomServiceId,
      date: n.stay_date,
      unit_price: Number(n.rate) || 0,
      quantity: 1,
    })),
    ...extras
      .filter((e) => e.kind !== "inclusion")
      .map((e) => ({
        key: e.id ? `extra:${e.id}` : null,
        service_id: e.extra_id || null,
        date: e.stay_date || firstNight,
        unit_price: Number(e.unit_price) || 0,
        quantity: Number(e.quantity) || 1,
      })),
  ];
}

/**
 * The taxes on a set of lines.
 *
 * @param taxes         the property's rules (inactive ones are skipped)
 * @param serviceTaxes  { [service_id]: [tax_id, ...] } -- what each service carries
 * @param lines         from `stayLines`
 * @param guest         { adults, children, residency }
 * @returns {
 *   lines:     [{ tax_id, name, amount, inclusive, detail }]  (zero amounts dropped)
 *   added:     sum of exclusive taxes -- what goes on top of the bill
 *   included:  sum of inclusive taxes -- already inside the price
 *   byService: { [service_id]: { added, included } }
 *   byDate:    { [date]: { [tax name]: { amount, inclusive } } } -- which night
 *              each tax fell on, for posting one day's tax in the night audit
 *   byKey:     { [line key]: [{ tax_id, name, inclusive, calc_type, value,
 *              amount, base, units }] } -- each line's own share of each rule,
 *              unrounded, so a split invoice can carry the tax on just its lines
 * }
 */
export function computeTaxes(taxes, serviceTaxes, lines, guest = {}) {
  const adults = Math.max(0, Number(guest.adults) || 0);
  const guests = adults + Math.max(0, Number(guest.children) || 0);

  const carried = {};
  for (const [serviceId, taxIds] of Object.entries(serviceTaxes || {})) {
    carried[serviceId] = new Set(taxIds);
  }

  const rules = [...(taxes || [])]
    .filter((t) => t.is_active !== false)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  // Each line remembers the exclusive tax charged on it so far, which is
  // what a compound rule is charged on top of.
  const work = [...(lines || [])]
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .map((l) => ({ ...l, taxSoFar: 0 }));

  const out = [];
  const byService = {};
  const byDate = {};
  const byKey = {};
  const credit = (serviceId, amount, inclusive) => {
    const key = serviceId || "none";
    byService[key] = byService[key] || { added: 0, included: 0 };
    byService[key][inclusive ? "included" : "added"] += amount;
  };
  const date = (line, name, amount, inclusive) => {
    const day = (byDate[line.date || "none"] = byDate[line.date || "none"] || {});
    day[name] = day[name] || { amount: 0, inclusive };
    day[name].amount += amount;
  };

  for (const tax of rules) {
    if (!appliesToGuest(tax, guest.residency)) continue;

    const eligible = work.filter(
      (l) =>
        l.service_id &&
        carried[l.service_id]?.has(tax.id) &&
        inForce(tax, l.date) &&
        inBand(tax, l.unit_price)
    );
    if (eligible.length === 0) continue;

    const value = Number(tax.value) || 0;
    const inclusive = tax.calc_type === "percent" && tax.is_inclusive === true;
    // Per-line amounts, unrounded, so rounding happens once per rule.
    const shares = [];

    if (tax.calc_type === "fixed") {
      const perStay = tax.basis === "per_stay" || tax.basis?.endsWith("_per_stay");
      const people = tax.basis?.startsWith("per_adult")
        ? adults
        : tax.basis?.startsWith("per_guest")
          ? guests
          : 1;

      if (perStay) {
        shares.push([eligible[0], value * people, 1]);
      } else {
        // Units in date order, up to the cap on chargeable nights.
        let left = tax.max_nights ? Number(tax.max_nights) : Infinity;
        for (const l of eligible) {
          const units = Math.min(l.quantity, left);
          if (units <= 0) break;
          left -= units;
          shares.push([l, value * units * people, units]);
        }
      }
    } else {
      let left = tax.max_nights ? Number(tax.max_nights) : Infinity;
      for (const l of eligible) {
        const units = Math.min(l.quantity, left);
        if (units <= 0) break;
        left -= units;
        const base = l.unit_price * units + (tax.is_compound ? l.taxSoFar : 0);
        shares.push([
          l,
          inclusive ? base - base / (1 + value / 100) : (base * value) / 100,
          units,
        ]);
      }
    }

    const amount = round2(shares.reduce((s, [, a]) => s + a, 0));
    if (amount === 0) continue;

    for (const [l, a, units] of shares) {
      if (!inclusive) l.taxSoFar += a;
      credit(l.service_id, a, inclusive);
      date(l, tax.name, a, inclusive);
      if (l.key) {
        (byKey[l.key] = byKey[l.key] || []).push({
          tax_id: tax.id || null,
          name: tax.name,
          inclusive,
          calc_type: tax.calc_type,
          value,
          amount: a,
          base: l.unit_price * units,
          units,
        });
      }
    }

    const base = round2(shares.reduce((s, [l]) => s + l.unit_price * l.quantity, 0));
    out.push({
      tax_id: tax.id || null,
      name: tax.name,
      amount,
      inclusive,
      detail:
        tax.calc_type === "fixed"
          ? `${value} x ${round2(amount / value)}`
          : `${value}% of ${base}`,
    });
  }

  for (const key of Object.keys(byService)) {
    byService[key] = {
      added: round2(byService[key].added),
      included: round2(byService[key].included),
    };
  }
  for (const day of Object.values(byDate)) {
    for (const t of Object.values(day)) t.amount = round2(t.amount);
  }

  return {
    lines: out,
    added: round2(out.filter((l) => !l.inclusive).reduce((s, l) => s + l.amount, 0)),
    included: round2(out.filter((l) => l.inclusive).reduce((s, l) => s + l.amount, 0)),
    byService,
    byDate,
    byKey,
  };
}

/**
 * The tax lines for part of a bill: the rules' shares on the given line keys
 * only, in the same shape as `computeTaxes(...).lines`. Used for an invoice
 * that carries some of a stay's charges and leaves the rest to another.
 *
 * A key may come as { key, weight } to carry only part of a line -- a
 * sharer's share of a night -- and that part of its tax.
 */
export function taxLinesFor(byKey, keys) {
  const out = new Map();
  for (const entry of keys) {
    const key = typeof entry === "string" ? entry : entry.key;
    const weight = typeof entry === "string" ? 1 : Number(entry.weight ?? 1);
    for (const raw of byKey?.[key] || []) {
      const s = { ...raw, amount: raw.amount * weight, base: raw.base * weight, units: raw.units * weight };
      const id = `${s.tax_id || s.name}`;
      if (!out.has(id)) {
        out.set(id, { tax_id: s.tax_id, name: s.name, inclusive: s.inclusive, calc_type: s.calc_type, value: s.value, amount: 0, base: 0, units: 0 });
      }
      const t = out.get(id);
      t.amount += s.amount;
      t.base += s.base;
      t.units += s.units;
    }
  }
  return [...out.values()]
    .map((t) => ({
      tax_id: t.tax_id,
      name: t.name,
      amount: round2(t.amount),
      inclusive: t.inclusive,
      detail:
        t.calc_type === "fixed"
          ? `${t.value} x ${t.value ? round2(t.amount / t.value) : t.units}`
          : `${t.value}% of ${round2(t.base)}`,
    }))
    .filter((t) => t.amount !== 0);
}

/**
 * What a stay owes, from its rows: the folio's arithmetic, in one place.
 *
 * The folio modal and every finance report call this, so a balance on the
 * outstanding-balances report is by construction the balance the desk sees
 * when it opens the stay. Two copies of this sum would, sooner or later,
 * disagree.
 *
 * A voided payment is kept on the folio but no longer counts as paid.
 * Nights without a rate of their own take an even share of the room total,
 * as they do everywhere else.
 */
export function folioTotals({ reservation, nights = [], extras = [], payments = [], taxRules = [], services = [] }) {
  const roomBefore = Number(reservation.total_amount) || 0;
  // A discount before tax lowers every night by the same share, and the tax
  // is worked out on what is left; one after tax comes off the final bill.
  const discount = discountOf(reservation);
  // A website offer for some nights only says what comes off each night.
  const nightOff = discountByNight(reservation);
  const evenRate = roomBefore / Math.max(1, nights.length);
  const roomDiscount = nightOff
    ? round2(nights.reduce((s, n) => s + Math.min(Number(nightOff[n.stay_date]) || 0, n.rate ?? evenRate), 0))
    : discount?.timing === "before_tax"
      ? discountAmount(discount, roomBefore)
      : 0;
  const keep = roomBefore > 0 ? (roomBefore - roomDiscount) / roomBefore : 1;
  const room = round2(roomBefore - roomDiscount);
  // Inclusions come with the rate, so they are shown but never charged.
  const extrasTotal = extras
    .filter((e) => e.kind === "extra")
    .reduce((sum, e) => sum + Number(e.unit_price) * Number(e.quantity), 0);
  const paid = payments
    .filter((p) => !p.voided_at)
    .reduce((sum, p) => sum + Number(p.amount), 0);

  const roomService = services.find((sv) => sv.is_room) || null;
  const serviceTaxes = {};
  for (const sv of services) serviceTaxes[sv.id] = sv.tax_ids || [];

  // A day use holds no night, but its price is still the room charge, taxed
  // as one unit on the day -- a 6-hour slot at 1,800 is in the 5% slab, as a
  // night at 1,800 would be.
  const roomUnits =
    nights.length === 0 && reservation.stay_kind === "day_use" && roomBefore > 0
      ? [{ stay_date: reservation.check_in, rate: roomBefore }]
      : nights;
  // Each night as charged, after any discount before tax.
  const chargedNights = roomUnits.map((n) => ({
    ...n,
    rate: chargedRate(n.rate ?? roomBefore / Math.max(1, roomUnits.length), n.stay_date, keep, nightOff),
  }));

  const tax = computeTaxes(
    taxRules,
    serviceTaxes,
    stayLines({
      nights: chargedNights,
      extras,
      roomServiceId: roomService?.id || null,
    }),
    {
      adults: reservation.adults,
      children: reservation.children,
      residency: reservation.guest_residency,
    }
  );

  const beforeDiscount = room + extrasTotal + tax.added;
  const billDiscount = discount?.timing === "after_tax" ? discountAmount(discount, round2(beforeDiscount)) : 0;
  const grandTotal = beforeDiscount - billDiscount;
  return {
    tax,
    roomService,
    discount,
    // The share of each night's rate that is charged: 1 with no discount
    // before tax. The folio's charges and the reports price nights with it,
    // or with `nightOff`, the money off each night, when that is set.
    keep,
    nightOff,
    totals: {
      // The room as charged. `roomBefore` is the price before a discount
      // before tax, and `discount` the money off, before or after tax.
      room,
      roomBefore: round2(roomBefore),
      discount: round2(roomDiscount + billDiscount),
      discountTiming: discount ? discount.timing : null,
      extras: round2(extrasTotal),
      // Exclusive taxes, added to the bill. Inclusive ones are already inside
      // the room and extras figures and are reported separately.
      tax: tax.added,
      taxIncluded: tax.included,
      total: round2(grandTotal),
      paid: round2(paid),
      balance: round2(grandTotal - paid),
    },
  };
}

/**
 * Indian GST on hotel accommodation, as it stands from 22 September 2025.
 *
 * The rate is set by the tariff per room per night: nil up to 1,000, 5% above
 * that up to 7,500, and 18% above 7,500. Accommodation is taxed where the
 * hotel is, so it is always CGST + SGST in equal halves, never IGST. Offered
 * as a starting point, not advice -- the page says to confirm with the
 * property's accountant. Attached to the room service when it is added.
 */
export function indianGstPreset() {
  const from = "2025-09-22";
  const row = (name, value, rate_above, rate_up_to, sort_order) => ({
    name,
    calc_type: "percent",
    value,
    rate_above,
    rate_up_to,
    guest_scope: "all",
    is_inclusive: false,
    is_compound: false,
    valid_from: from,
    sort_order,
  });
  return [
    row("CGST 2.5%", 2.5, 1000, 7500, 10),
    row("SGST 2.5%", 2.5, 1000, 7500, 20),
    row("CGST 9%", 9, 7500, null, 30),
    row("SGST 9%", 9, 7500, null, 40),
  ];
}
