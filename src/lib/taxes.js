/**
 * Working out the taxes and fees on a stay from the property's rules.
 *
 * Pure: no database, no dates from the clock. The folio, the invoice and the
 * preview on the Tax Setup page all call this one function, so the figure a
 * hotelier checks while setting a rule up is the figure the guest is charged.
 *
 * Rules are applied in `sort_order`. Each is judged night by night where
 * that means something -- a GST slab depends on the night's tariff, and a
 * rule can start or end part-way through a stay -- and once for the stay
 * where it does not.
 *
 * Tariff bands (`rate_above` / `rate_up_to`) are judged against room nights
 * only. An extra has no nightly tariff to judge, so a percentage on extras
 * ignores the band and applies to every charged extra in its dates.
 */

export const TAX_BASES = [
  { id: "per_night", label: "Per room, per night" },
  { id: "per_stay", label: "Per booking" },
  { id: "per_adult_per_night", label: "Per adult, per night" },
  { id: "per_guest_per_night", label: "Per guest, per night" },
  { id: "per_adult_per_stay", label: "Per adult, per booking" },
  { id: "per_guest_per_stay", label: "Per guest, per booking" },
];

export const TAX_APPLIES_TO = [
  { id: "room", label: "Room charge" },
  { id: "extras", label: "Extras" },
  { id: "room_and_extras", label: "Room and extras" },
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

/** Whether a night's room rate falls in a rule's tariff band. */
export function inBand(tax, rate) {
  const above = num(tax.rate_above);
  const upTo = num(tax.rate_up_to);
  const r = Number(rate) || 0;
  if (above !== null && !(r > above)) return false;
  if (upTo !== null && !(r <= upTo)) return false;
  return true;
}

/** Whether a rule applies to this guest at all. */
export function appliesToGuest(tax, residency) {
  if (!tax.guest_scope || tax.guest_scope === "all") return true;
  return tax.guest_scope === (residency || "domestic");
}

/** A short description of a rule, as the setup list and folio show it. */
export function describeTax(tax, money = (v) => String(v)) {
  const parts = [];
  if (tax.calc_type === "fixed") {
    const basis = TAX_BASES.find((b) => b.id === tax.basis)?.label.toLowerCase();
    parts.push(`${money(tax.value)} ${basis || ""}`.trim());
  } else {
    const on = TAX_APPLIES_TO.find((a) => a.id === tax.applies_to)?.label.toLowerCase();
    parts.push(`${Number(tax.value)}% of ${on || "room charge"}`);
  }

  const above = num(tax.rate_above);
  const upTo = num(tax.rate_up_to);
  if (above !== null && upTo !== null) {
    parts.push(`nights above ${money(above)} up to ${money(upTo)}`);
  } else if (above !== null) {
    parts.push(`nights above ${money(above)}`);
  } else if (upTo !== null) {
    parts.push(`nights up to ${money(upTo)}`);
  }

  if (tax.guest_scope === "international") parts.push("international guests");
  if (tax.guest_scope === "domestic") parts.push("domestic guests");
  if (tax.max_nights) parts.push(`first ${tax.max_nights} night${tax.max_nights === 1 ? "" : "s"}`);
  if (tax.is_compound) parts.push("on top of earlier taxes");
  if (tax.is_inclusive) parts.push("included in the price");
  return parts.join(" · ");
}

/**
 * The taxes on a stay.
 *
 * @param taxes   the property's rules (inactive ones are skipped)
 * @param stay    {
 *                  nights:    [{ stay_date, rate }]
 *                  extras:    [{ unit_price, quantity, kind, stay_date }]
 *                  adults, children
 *                  residency: 'domestic' | 'international'
 *                }
 * @returns {
 *   lines:     [{ tax_id, name, amount, inclusive, detail }]  (zero lines dropped)
 *   added:     sum of exclusive lines -- what goes on top of the bill
 *   included:  sum of inclusive lines -- already inside the price
 * }
 */
export function computeTaxes(taxes, stay) {
  const nights = [...(stay.nights || [])]
    .filter((n) => n && n.stay_date)
    .sort((a, b) => a.stay_date.localeCompare(b.stay_date));
  const extras = (stay.extras || []).filter((e) => e.kind !== "inclusion");
  const adults = Math.max(0, Number(stay.adults) || 0);
  const guests = adults + Math.max(0, Number(stay.children) || 0);
  const firstNight = nights[0]?.stay_date || null;

  const rules = [...(taxes || [])]
    .filter((t) => t.is_active !== false)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  const lines = [];
  // Running total of exclusive taxes so far, for compound rules.
  let taxSoFar = 0;

  for (const tax of rules) {
    if (!appliesToGuest(tax, stay.residency)) continue;

    const value = Number(tax.value) || 0;
    const cap = tax.max_nights ? Number(tax.max_nights) : Infinity;

    // The nights this rule reaches: in force that night and inside the band,
    // up to the cap on chargeable nights.
    const eligible = nights
      .filter((n) => inForce(tax, n.stay_date) && inBand(tax, n.rate))
      .slice(0, cap);

    let amount = 0;
    let detail = "";

    if (tax.calc_type === "fixed") {
      const perStay = tax.basis?.endsWith("_per_stay") || tax.basis === "per_stay";
      // A per-booking fee is in force if it is in force on arrival.
      const stayCounts = perStay ? (inForce(tax, firstNight) ? 1 : 0) : eligible.length;
      const people =
        tax.basis?.startsWith("per_adult") ? adults : tax.basis?.startsWith("per_guest") ? guests : 1;
      const units = stayCounts * people;
      amount = value * units;
      detail = units > 0 ? `${units} × ${value}` : "";
    } else {
      let base = 0;
      if (tax.applies_to === "room" || tax.applies_to === "room_and_extras") {
        base += eligible.reduce((sum, n) => sum + (Number(n.rate) || 0), 0);
      }
      if (tax.applies_to === "extras" || tax.applies_to === "room_and_extras") {
        base += extras
          .filter((e) => inForce(tax, e.stay_date || firstNight))
          .reduce((sum, e) => sum + Number(e.unit_price) * Number(e.quantity), 0);
      }
      if (tax.is_compound) base += taxSoFar;

      amount = tax.is_inclusive
        ? base - base / (1 + value / 100)
        : (base * value) / 100;
      detail = `${value}% of ${round2(base)}`;
    }

    amount = round2(amount);
    if (amount === 0) continue;

    const inclusive = tax.calc_type === "percent" && tax.is_inclusive === true;
    if (!inclusive) taxSoFar += amount;

    lines.push({ tax_id: tax.id || null, name: tax.name, amount, inclusive, detail });
  }

  return {
    lines,
    added: round2(lines.filter((l) => !l.inclusive).reduce((s, l) => s + l.amount, 0)),
    included: round2(lines.filter((l) => l.inclusive).reduce((s, l) => s + l.amount, 0)),
  };
}

/**
 * Indian GST on hotel accommodation, as it stands from 22 September 2025.
 *
 * The rate is set by the tariff per room per night: nil up to 1,000, 5% above
 * that up to 7,500, and 18% above 7,500. Accommodation is taxed where the
 * hotel is, so it is always CGST + SGST in equal halves, never IGST. Offered
 * as a starting point, not advice -- the page says to confirm with the
 * property's accountant.
 */
export function indianGstPreset() {
  const from = "2025-09-22";
  const row = (name, value, rate_above, rate_up_to, sort_order) => ({
    name,
    calc_type: "percent",
    value,
    applies_to: "room",
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
