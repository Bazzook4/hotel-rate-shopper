import { NextResponse } from "next/server";
import { SETUP_READ_PAGES, pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import {
  canManageSetup,
  listPropertyTaxes,
  savePropertyTax,
  deletePropertyTax,
  setTaxServices,
  listServiceTaxes,
  getPropertyClock,
} from "@/lib/database";
import { todayInZone } from "@/lib/hotelTime";

/** What a rule charges. Changing any of these changes past bills. */
const MONEY_FIELDS = [
  "calc_type",
  "value",
  "basis",
  "rate_above",
  "rate_up_to",
  "is_inclusive",
  "is_compound",
  "guest_scope",
  "max_nights",
];

function dayBefore(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Whether a rule was in force on any night before today. */
function usedBefore(rule, today) {
  return !rule.valid_from || rule.valid_from < today;
}

/**
 * The property's tax and fee rules.
 *
 * Reading them is front-desk work -- the folio shows what each one added --
 * but changing them changes what every open booking owes, so writes need the
 * setup permission, as the services list does.
 *
 * A rule charges nothing on its own: it applies to the services it is
 * attached to. A save may carry `service_ids` to set that link from the
 * rule's side; the Services page sets it from the service's side.
 */

async function requireSetup(req) {
  // The page's own right, as well as the setup permission: a super admin
  // unticking taxsetup closes its changes here too, not only the menu.
  const { error, session } = await pmsGuard(req, ["taxsetup"]);
  if (error) return { error };

  if (!(await canManageSetup(session.userId))) {
    return {
      error: NextResponse.json(
        { error: "You do not have permission to change taxes." },
        { status: 403 }
      ),
    };
  }
  return { session };
}

const BASES = [
  "per_night",
  "per_stay",
  "per_adult_per_night",
  "per_guest_per_night",
  "per_adult_per_stay",
  "per_guest_per_stay",
];
const SCOPES = ["all", "domestic", "international"];

function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function optionalNumber(value) {
  return value === "" || value === null || value === undefined ? null : Number(value);
}

/**
 * A rule as the client sent it, checked and reduced to the columns a client
 * may set. Returns `{ error }` with something the hotelier can act on, or
 * `{ row }`.
 */
function toRow(body, propertyId) {
  const name = body.name?.trim();
  if (!name) return { error: "Give the tax a name, as it should print on the invoice." };

  const calc_type = body.calc_type === "fixed" ? "fixed" : "percent";
  const value = Number(body.value);
  if (!Number.isFinite(value) || value < 0) return { error: "Enter a rate of zero or more." };
  if (calc_type === "percent" && value > 100) return { error: "A percentage cannot be over 100." };

  const rate_above = optionalNumber(body.rate_above);
  const rate_up_to = optionalNumber(body.rate_up_to);
  if ([rate_above, rate_up_to].some((n) => n !== null && (!Number.isFinite(n) || n < 0))) {
    return { error: "Tariff band limits must be amounts of zero or more." };
  }
  if (rate_above !== null && rate_up_to !== null && rate_up_to <= rate_above) {
    return { error: "The band's upper limit must be above its lower limit." };
  }

  const max_nights = optionalNumber(body.max_nights);
  if (max_nights !== null && (!Number.isInteger(max_nights) || max_nights < 1)) {
    return { error: "The night cap must be a whole number of nights, 1 or more." };
  }

  const valid_from = isDate(body.valid_from) ? body.valid_from : null;
  const valid_to = isDate(body.valid_to) ? body.valid_to : null;
  if (valid_from && valid_to && valid_to < valid_from) {
    return { error: "The end date must be on or after the start date." };
  }

  return {
    row: {
      ...(body.id ? { id: body.id } : {}),
      property_id: propertyId,
      name,
      calc_type,
      value,
      basis: BASES.includes(body.basis) ? body.basis : "per_night",
      rate_above,
      rate_up_to,
      guest_scope: SCOPES.includes(body.guest_scope) ? body.guest_scope : "all",
      // A fixed fee is always added on top; see the migration.
      is_inclusive: calc_type === "percent" && body.is_inclusive === true,
      is_compound: calc_type === "percent" && body.is_compound === true,
      max_nights,
      valid_from,
      valid_to,
      sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
      is_active: body.is_active !== false,
    },
  };
}

export async function GET(req) {
  const { error, session } = await pmsGuard(req, SETUP_READ_PAGES);
  if (error) return error;

  const propertyId = await resolvePropertyId(
    session,
    req.nextUrl.searchParams.get("propertyId")
  );
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }

  try {
    const taxes = await listPropertyTaxes(propertyId, { includeInactive: true });
    return NextResponse.json({ taxes });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** Save one rule, or several at once (`rules`), which is how a preset lands. */
export async function POST(req) {
  const { error, session } = await requireSetup(req);
  if (error) return error;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const propertyId = await resolvePropertyId(session, body.property_id);
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }

  const incoming = Array.isArray(body.rules) ? body.rules : [body];
  const rows = [];
  for (const rule of incoming) {
    const { row, error: invalid } = toRow(rule, propertyId);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
    rows.push({ row, serviceIds: Array.isArray(rule.service_ids) ? rule.service_ids : null });
  }

  try {
    // Taxes are worked out on every read, so editing what a rule charges
    // would change every bill it was ever on, the night audits and the
    // ledger with it. A rule already used keeps its old figures up to
    // yesterday, and the new figures start today as a rule of their own.
    const today = todayInZone(await getPropertyClock(propertyId));
    const existing = rows.some(({ row }) => row.id)
      ? await listPropertyTaxes(propertyId, { includeInactive: true })
      : [];
    const links = rows.some(({ row }) => row.id) ? await listServiceTaxes(propertyId) : {};
    const saved = [];
    for (const { row, serviceIds } of rows) {
      const old = row.id ? existing.find((t) => t.id === row.id) : null;
      const moneyChanged =
        old && MONEY_FIELDS.some((f) => f in row && String(row[f] ?? "") !== String(old[f] ?? ""));
      if (old && moneyChanged && usedBefore(old, today)) {
        await savePropertyTax({ id: old.id, property_id: propertyId, valid_to: dayBefore(today) });
        const { id: _old, ...fresh } = row;
        const startsOn = row.valid_from && row.valid_from > today ? row.valid_from : today;
        const tax = await savePropertyTax({ ...fresh, valid_from: startsOn });
        const carried = serviceIds || Object.keys(links).filter((sid) => links[sid].includes(old.id));
        await setTaxServices(tax.id, carried);
        saved.push(tax);
        continue;
      }
      const tax = await savePropertyTax(row);
      if (serviceIds) await setTaxServices(tax.id, serviceIds);
      saved.push(tax);
    }
    return NextResponse.json({ taxes: saved });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * Delete a rule outright.
 *
 * For a rule entered by mistake. A rule that was right until now should be
 * ended with a `valid_to` date instead, which keeps it on the nights it
 * covered -- the page offers that as the normal way out.
 */
export async function DELETE(req) {
  const { error, session } = await requireSetup(req);
  if (error) return error;

  const params = req.nextUrl.searchParams;
  const id = params.get("id");
  if (!id) {
    return NextResponse.json({ error: "Tax id is required" }, { status: 400 });
  }

  const propertyId = await resolvePropertyId(session, params.get("propertyId"));
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }

  try {
    // A rule used on past nights is ended yesterday instead of deleted, so
    // the bills it was on keep their tax. Only a rule never used goes.
    const today = todayInZone(await getPropertyClock(propertyId));
    const rule = (await listPropertyTaxes(propertyId, { includeInactive: true })).find((t) => t.id === id);
    if (!rule) return NextResponse.json({ error: "Tax not found" }, { status: 404 });
    if (usedBefore(rule, today)) {
      if (!rule.valid_to || rule.valid_to >= today) {
        await savePropertyTax({ id, property_id: propertyId, valid_to: dayBefore(today) });
      }
      return NextResponse.json({
        success: true,
        ended: true,
        message: "This tax was used on past bills, so it was ended yesterday instead of deleted.",
      });
    }
    await deletePropertyTax(id, propertyId);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
