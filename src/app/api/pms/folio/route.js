import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId, BOOKING_VIEW_PAGES, WRITE_PAGES } from "@/lib/pmsGuard";
import {
  getReservation,
  getSupabaseAdmin,
  getReservationFolio,
  saveReservationGuest,
  deleteReservationGuest,
  linkNamedGuest,
  addReservationExtra,
  deleteReservationExtra,
  addReservationPayment,
  voidReservationPayment,
  createReservationInvoice,
  voidReservationInvoice,
  setNightRate,
  setSeparateBills,
  setSharer,
  setReservationDiscount,
} from "@/lib/database";
import { walletBalance } from "@/lib/wallets";
import { userEmails } from "@/lib/financeReports";
import { moduleDeniedResponse } from "@/lib/propertyScope";
import { DISCOUNT_REASONS, DISCOUNT_RIGHT } from "@/lib/discounts";

/**
 * Everything hanging off one reservation: guests, nights, extras, payments,
 * invoices.
 *
 * One route rather than four, because the booking modal opens all of them at
 * once and closing four round trips into one is the difference between the
 * modal appearing filled and appearing to load in pieces. Writes name what
 * they are acting on in `kind`, and always answer with the whole folio so the
 * modal's totals cannot drift from the rows it is showing.
 */

async function folioResponse(reservationId) {
  const folio = await getReservationFolio(reservationId);
  // Who made each discount change, by email, as the reports name them.
  const emails = folio.discountLog.length
    ? await userEmails(folio.discountLog.map((d) => d.changed_by)).catch(() => ({}))
    : {};
  const discountLog = folio.discountLog.map((d) => ({ ...d, changed_by_email: emails[d.changed_by] || null }));
  return NextResponse.json({ ...folio, discountLog, wallets: await folioWallets(folio.reservation, folio.sharers) });
}

/**
 * The wallets that may pay this bill -- the guest's own, and the company's
 * or agent's on the booking -- with what each holds. Empty before migration
 * 047, or when nobody on the booking has ever had a wallet.
 */
async function folioWallets(reservation, sharers = []) {
  const out = [];
  try {
    const supabase = getSupabaseAdmin();
    if (reservation.guest_id) {
      const w = await walletBalance(reservation.property_id, { type: "guest", id: reservation.guest_id });
      if (w.credit > 0) {
        const { data } = await supabase.from("guests").select("full_name").eq("id", reservation.guest_id).maybeSingle();
        out.push({ type: "guest", id: reservation.guest_id, name: data?.full_name || reservation.guest_name, balance: w.balance });
      }
    }
    // The booking's company, and any a sharer's bill goes to.
    const companyIds = [...new Set([reservation.company_id, ...sharers.map((s) => s.companyId)].filter(Boolean))];
    for (const companyId of companyIds) {
      const w = await walletBalance(reservation.property_id, { type: "company", id: companyId });
      if (w.credit > 0) {
        const { data } = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle();
        out.push({ type: "company", id: companyId, name: data?.name || "Company", balance: w.balance });
      }
    }
  } catch {
    // A wallet that cannot be read only hides the Pay from wallet option.
  }
  return out;
}

/** A 404 or 403 unless the reservation is at a property this session may act on. */
async function reservationDenied(session, reservationId) {
  const reservation = await getReservation(reservationId).catch(() => null);
  if (!reservation) {
    return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
  }
  if (!(await resolvePropertyId(session, reservation.property_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

const FOLIO_TABLES = {
  guest: "reservation_guests",
  extra: "reservation_extras",
  payment: "reservation_payments",
  invoice: "reservation_invoices",
};

/** Whether a folio row really hangs off this reservation, not another hotel's. */
async function rowBelongs(kind, id, reservationId) {
  const { data } = await getSupabaseAdmin()
    .from(FOLIO_TABLES[kind])
    .select("reservation_id")
    .eq("id", id)
    .maybeSingle();
  return data?.reservation_id === reservationId;
}

export async function GET(req) {
  const { error, session } = await pmsGuard(req, BOOKING_VIEW_PAGES);
  if (error) return error;

  const reservationId = req.nextUrl.searchParams.get("reservationId");
  if (!reservationId) {
    return NextResponse.json({ error: "Reservation id is required" }, { status: 400 });
  }
  const denied = await reservationDenied(session, reservationId);
  if (denied) return denied;

  try {
    return await folioResponse(reservationId);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * Refuses a change to a charge a standing invoice carries. The invoice was
 * issued for the bill as it was; changing the charge under it would leave
 * the GST invoice and the money owed disagreeing. Void the invoice first.
 */
async function refuseIfInvoiced(reservationId, keys) {
  const folio = await getReservationFolio(reservationId);
  const hit = folio.charges.find((c) => c.invoice && c.keys.some((k) => keys.includes(k)));
  if (hit) {
    throw new Error(`That charge is on invoice ${hit.invoice.invoice_number || hit.invoice}. Void the invoice first.`);
  }
}

/** The pages that may make this kind of folio change. */
function writePagesFor(kind) {
  if (kind === "payment") return WRITE_PAGES.payment;
  if (kind === "invoice") return WRITE_PAGES.invoice;
  if (kind === "guest") return WRITE_PAGES.guest;
  return WRITE_PAGES.booking;
}

export async function POST(req) {
  const { error, session } = await pmsGuard(req, BOOKING_VIEW_PAGES);
  if (error) return error;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { kind, reservationId } = body || {};
  if (!reservationId) {
    return NextResponse.json({ error: "Reservation id is required" }, { status: 400 });
  }
  const pageDenied = await moduleDeniedResponse(session, writePagesFor(kind));
  if (pageDenied) return pageDenied;
  const denied = await reservationDenied(session, reservationId);
  if (denied) return denied;

  try {
    switch (kind) {
      case "guest": {
        if (!body.guest?.first_name?.trim()) {
          return NextResponse.json({ error: "First name is required." }, { status: 400 });
        }
        // Everyone named on a booking goes on the guest list, with the ID
        // the desk typed. The record is found here, never taken from the
        // browser; a guest list that cannot be reached never costs the desk
        // the name on the booking.
        const reservation = await getReservation(reservationId);
        let existing = null;
        if (body.guest.id) {
          const { data } = await getSupabaseAdmin()
            .from("reservation_guests")
            .select("*")
            .eq("id", body.guest.id)
            .eq("reservation_id", reservationId)
            .maybeSingle();
          if (!data) return NextResponse.json({ error: "Guest not found on this booking" }, { status: 404 });
          existing = data;
        } else {
          // One named guest per adult and child on the booking.
          const cap = Math.max(1, (Number(reservation.adults) || 0) + (Number(reservation.children) || 0));
          const { count } = await getSupabaseAdmin()
            .from("reservation_guests")
            .select("id", { count: "exact", head: true })
            .eq("reservation_id", reservationId);
          if ((count || 0) >= cap) {
            return NextResponse.json(
              { error: `This booking is for ${cap} guest${cap === 1 ? "" : "s"}. Raise the adults or children on the booking to name another.` },
              { status: 400 }
            );
          }
        }
        let guestId = existing?.guest_id || null;
        try {
          guestId = (await linkNamedGuest(reservation, body.guest, existing)) || guestId;
        } catch (err) {
          console.error("Could not put the guest on the guest list:", err.message);
        }
        await saveReservationGuest(reservationId, body.guest, { guestId: guestId || undefined });
        break;
      }

      case "extra": {
        const line = body.line || {};
        if (!line.extra_id && !line.name?.trim()) {
          return NextResponse.json(
            { error: "Choose an item or give the line a name." },
            { status: 400 }
          );
        }
        if (line.quantity != null && Number(line.quantity) <= 0) {
          return NextResponse.json(
            { error: "Quantity must be more than zero." },
            { status: 400 }
          );
        }
        // Money off a bill is a discount, which has its own right and log.
        if (line.unit_price != null && line.unit_price !== "" && Number(line.unit_price) < 0) {
          return NextResponse.json({ error: "A price cannot be below zero. Use Discount for money off." }, { status: 400 });
        }
        if (line.bill_guest_id && !(await rowBelongs("guest", line.bill_guest_id, reservationId))) {
          return NextResponse.json({ error: "That guest is not on this booking." }, { status: 400 });
        }
        await addReservationExtra(reservationId, line);
        break;
      }

      case "payment": {
        const amount = Number(body.payment?.amount);
        if (!Number.isFinite(amount) || amount === 0) {
          return NextResponse.json(
            { error: "Enter an amount more than zero." },
            { status: 400 }
          );
        }
        // A wallet is paid from through its own route, which takes the
        // money out of the wallet; recorded here it would come from nowhere.
        if (body.payment.method === "wallet") {
          return NextResponse.json({ error: "Pay from a wallet with the wallet button." }, { status: 400 });
        }
        if (body.payment.bill_guest_id && !(await rowBelongs("guest", body.payment.bill_guest_id, reservationId))) {
          return NextResponse.json({ error: "That guest is not on this booking." }, { status: 400 });
        }
        // Stamped now: a payment dated by the browser could be put back into
        // a day already closed or a drawer already counted.
        const { paid_at: _ignored, ...payment } = body.payment;
        await addReservationPayment(reservationId, payment, session.userId);
        break;
      }

      // Giving, changing or taking off the discount needs its own right.
      case "discount": {
        const denied = await moduleDeniedResponse(session, DISCOUNT_RIGHT);
        if (denied) {
          return NextResponse.json({ error: "You do not have the right to give discounts. Ask your admin." }, { status: 403 });
        }
        const d = body.discount;
        if (d) {
          const value = Number(d.value);
          if (!["percent", "amount"].includes(d.kind) || !Number.isFinite(value) || value <= 0) {
            return NextResponse.json({ error: "Enter a discount more than zero." }, { status: 400 });
          }
          if (d.kind === "percent" && value > 100) {
            return NextResponse.json({ error: "A percent discount is 100 at most." }, { status: 400 });
          }
          if (!["before_tax", "after_tax"].includes(d.timing)) {
            return NextResponse.json({ error: "Choose before tax or after tax." }, { status: 400 });
          }
          if (!DISCOUNT_REASONS.some((r) => r.id === d.reason)) {
            return NextResponse.json({ error: "Choose a reason." }, { status: 400 });
          }
          const note = String(d.note || "").trim().slice(0, 300);
          if (d.reason === "other" && !note) {
            return NextResponse.json({ error: "Say why in the note." }, { status: 400 });
          }
          await setReservationDiscount(reservationId, { kind: d.kind, value, timing: d.timing, reason: d.reason, note }, session.userId);
        } else {
          await setReservationDiscount(reservationId, null, session.userId);
        }
        break;
      }

      case "night": {
        const rate = Number(body.rate);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.stay_date || "")) {
          return NextResponse.json({ error: "Which night?" }, { status: 400 });
        }
        if (body.rate === "" || !Number.isFinite(rate) || rate < 0) {
          return NextResponse.json(
            { error: "Enter what the night costs: zero or more." },
            { status: 400 }
          );
        }
        await refuseIfInvoiced(reservationId, [`night:${body.stay_date}`]);
        await setNightRate(reservationId, body.stay_date, rate);
        break;
      }

      case "invoice": {
        // `charges` picks what goes on it; left out, every charge not yet invoiced.
        const charges = Array.isArray(body.charges) ? body.charges.map(String) : null;
        if (charges && charges.length === 0) {
          return NextResponse.json({ error: "Tick at least one charge." }, { status: 400 });
        }
        await createReservationInvoice(reservationId, session.userId, {
          chargeKeys: charges,
          sharerId: body.sharerId || null,
        });
        break;
      }

      // Guests sharing the room, each on a bill of their own.
      case "separate_bills": {
        await setSeparateBills(reservationId, body.on === true);
        break;
      }

      case "sharer": {
        if (!(await rowBelongs("guest", body.guestId, reservationId))) {
          return NextResponse.json({ error: "Guest not found on this booking" }, { status: 404 });
        }
        if (body.bill_company_id) {
          const reservation = await getReservation(reservationId);
          const { data } = await getSupabaseAdmin()
            .from("companies")
            .select("id")
            .eq("id", body.bill_company_id)
            .eq("property_id", reservation.property_id)
            .maybeSingle();
          if (!data) return NextResponse.json({ error: "Company not found" }, { status: 404 });
        }
        await setSharer(reservationId, body.guestId, {
          room_share: body.room_share,
          bill_company_id: body.bill_company_id,
        });
        break;
      }

      default:
        return NextResponse.json({ error: "Unknown folio action" }, { status: 400 });
    }

    return await folioResponse(reservationId);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  const { error, session } = await pmsGuard(req, BOOKING_VIEW_PAGES);
  if (error) return error;

  const params = req.nextUrl.searchParams;
  const kind = params.get("kind");
  const id = params.get("id");
  const reservationId = params.get("reservationId");

  if (!id || !reservationId) {
    return NextResponse.json(
      { error: "Both an id and a reservation id are required" },
      { status: 400 }
    );
  }
  if (!FOLIO_TABLES[kind]) {
    return NextResponse.json({ error: "Unknown folio action" }, { status: 400 });
  }
  const pageDenied = await moduleDeniedResponse(session, writePagesFor(kind));
  if (pageDenied) return pageDenied;
  const denied = await reservationDenied(session, reservationId);
  if (denied) return denied;
  if (!(await rowBelongs(kind, id, reservationId))) {
    return NextResponse.json({ error: "That line is not on this reservation" }, { status: 404 });
  }

  try {
    switch (kind) {
      case "guest":
        await deleteReservationGuest(id);
        break;
      case "extra":
        await refuseIfInvoiced(reservationId, [`extra:${id}`]);
        await deleteReservationExtra(id);
        break;
      case "payment":
        // Voided, never removed -- the cash-up has to be able to see it.
        await voidReservationPayment(id, params.get("reason"), session.userId);
        break;
      case "invoice":
        // Voided, never removed -- see the helper for why.
        await voidReservationInvoice(id, params.get("reason"), session.userId);
        break;
      default:
        return NextResponse.json({ error: "Unknown folio action" }, { status: 400 });
    }

    return await folioResponse(reservationId);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
