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
  return parts.join(" · ");
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
      service_id: roomServiceId,
      date: n.stay_date,
      unit_price: Number(n.rate) || 0,
      quantity: 1,
    })),
    ...extras
      .filter((e) => e.kind !== "inclusion")
      .map((e) => ({
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
  const credit = (serviceId, amount, inclusive) => {
    const key = serviceId || "none";
    byService[key] = byService[key] || { added: 0, included: 0 };
    byService[key][inclusive ? "included" : "added"] += amount;
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
        shares.push([eligible[0], value * people]);
      } else {
        // Units in date order, up to the cap on chargeable nights.
        let left = tax.max_nights ? Number(tax.max_nights) : Infinity;
        for (const l of eligible) {
          const units = Math.min(l.quantity, left);
          if (units <= 0) break;
          left -= units;
          shares.push([l, value * units * people]);
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
        ]);
      }
    }

    const amount = round2(shares.reduce((s, [, a]) => s + a, 0));
    if (amount === 0) continue;

    for (const [l, a] of shares) {
      if (!inclusive) l.taxSoFar += a;
      credit(l.service_id, a, inclusive);
    }

    const base = round2(shares.reduce((s, [l]) => s + l.unit_price * l.quantity, 0));
    out.push({
      tax_id: tax.id || null,
      name: tax.name,
      amount,
      inclusive,
      detail:
        tax.calc_type === "fixed"
          ? `${value} × ${round2(amount / value)}`
          : `${value}% of ${base}`,
    });
  }

  for (const key of Object.keys(byService)) {
    byService[key] = {
      added: round2(byService[key].added),
      included: round2(byService[key].included),
    };
  }

  return {
    lines: out,
    added: round2(out.filter((l) => !l.inclusive).reduce((s, l) => s + l.amount, 0)),
    included: round2(out.filter((l) => l.inclusive).reduce((s, l) => s + l.amount, 0)),
    byService,
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
