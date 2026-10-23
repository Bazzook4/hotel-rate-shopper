import { randomBytes } from "crypto";
import {
  getSupabaseAdmin,
  guestsReady,
  guestPhoneKey,
  findGuestMatch,
  createGuest,
  updateGuest,
  linkGuestForBooking,
  listReservationGuests,
  saveReservationGuest,
} from "@/lib/database";
import { todayInZone } from "@/lib/hotelTime";
import { toCountryCode } from "@/lib/countries";
import {
  storeCheckinFile,
  removeStoredFiles,
  signedFileLinks,
  adoptIdFiles,
} from "@/lib/guestIdPhotos";
import {
  CHECKIN_ID_TYPES,
  MAX_CHECKIN_FILES_PER_GUEST,
  checkinGaps,
  checkinGuestCount,
  checkinStatus,
  cleanCheckinPrefs,
  isForeignGuest,
} from "@/lib/onlineCheckinShared";

/**
 * Online check-in (migration 053): the link a guest opens before arrival to
 * fill in their details and upload their ID, and the desk's side of it.
 *
 * The guest's page has no sign-in; the link is the key. So it shows only
 * what the guest needs to recognise their own booking, never hands back the
 * ID files it was sent, and closes once the guest has arrived, the desk has
 * accepted the details, or the stay is over.
 *
 * Nothing the guest types reaches the guest records until the desk has
 * looked at it and pressed Accept: a typo in an ID number is caught at the
 * desk, not copied into the hotel's records.
 */

const TABLE = "reservation_checkins";
const OPEN_STATUSES = new Set(["inquiry", "confirmed"]);

let tableSeen = false;
let checkedAt = 0;

/** Whether migration 053 has run; re-checked at most once a minute until it has. */
export async function checkinReady() {
  if (tableSeen) return true;
  if (Date.now() - checkedAt < 60000) return false;
  checkedAt = Date.now();
  const { error } = await getSupabaseAdmin().from(TABLE).select("id").limit(1);
  tableSeen = !error;
  return tableSeen;
}

export const CHECKIN_NOT_READY =
  "Online check-in needs migration 053_online_checkin.sql. Run it in the Supabase SQL editor, then try again.";

// ------------------------------------------------------------------
// The hotel's choices
// ------------------------------------------------------------------

/** The hotel's online check-in choices; the defaults before migration 053. */
export async function getCheckinPrefs(propertyId) {
  const { data, error } = await getSupabaseAdmin()
    .from("properties")
    .select("checkin_prefs")
    .eq("id", propertyId)
    .maybeSingle();
  if (error && !/checkin_prefs/.test(error.message)) throw new Error(error.message);
  return cleanCheckinPrefs(data?.checkin_prefs);
}

export async function saveCheckinPrefs(propertyId, input) {
  const prefs = cleanCheckinPrefs(input);
  const { error } = await getSupabaseAdmin()
    .from("properties")
    .update({ checkin_prefs: prefs, updated_at: new Date().toISOString() })
    .eq("id", propertyId);
  if (error) {
    throw new Error(/checkin_prefs/.test(error.message) ? CHECKIN_NOT_READY : error.message);
  }
  return prefs;
}

// ------------------------------------------------------------------
// The link
// ------------------------------------------------------------------

export async function getCheckinForReservation(reservationId) {
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .select("*")
    .eq("reservation_id", reservationId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load online check-in: ${error.message}`);
  return data;
}

/** The booking's link, made now if it has none. */
export async function ensureCheckin(reservation, userId) {
  const existing = await getCheckinForReservation(reservation.id);
  if (existing) return existing;
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .insert({
      property_id: reservation.property_id,
      reservation_id: reservation.id,
      token: randomBytes(24).toString("base64url"),
      created_by: userId || null,
    })
    .select("*")
    .single();
  // Two clicks at once: the second insert loses on the unique booking.
  if (error?.code === "23505") return getCheckinForReservation(reservation.id);
  if (error) throw new Error(`Failed to create the link: ${error.message}`);
  return data;
}

function allFilePaths(row) {
  return (row?.details?.guests || []).flatMap((g) => (g.files || []).map((f) => f.path));
}

/**
 * Switches a link off: the link stops working and what was sent through it
 * is deleted. Files already accepted live on the guest record and stay.
 */
export async function deleteCheckin(row) {
  if (!row.accepted_at) await removeStoredFiles(allFilePaths(row));
  const { error } = await getSupabaseAdmin().from(TABLE).delete().eq("id", row.id);
  if (error) throw new Error(`Failed to switch the link off: ${error.message}`);
}

// ------------------------------------------------------------------
// The guest's page
// ------------------------------------------------------------------

/** The check-in behind a link with its booking and hotel, or null. */
export async function findCheckinByToken(token) {
  if (!token || typeof token !== "string" || token.length > 100) return null;
  const supabase = getSupabaseAdmin();
  const { data: row, error } = await supabase.from(TABLE).select("*").eq("token", token).maybeSingle();
  if (error || !row) return null;

  const [{ data: reservation }, { data: property }] = await Promise.all([
    supabase
      .from("reservations")
      .select("id, property_id, reference, guest_id, guest_name, guest_phone, guest_email, check_in, check_out, status, adults, children, stay_kind, room_types(room_type_name)")
      .eq("id", row.reservation_id)
      .maybeSingle(),
    // Every column, so a property without display choices (migration 044) still opens.
    supabase.from("properties").select("*").eq("id", row.property_id).maybeSingle(),
  ]);
  if (!reservation || !property) return null;
  return { row, reservation, property, prefs: await getCheckinPrefs(property.id) };
}

/**
 * Why the guest can no longer change what they sent, or null while they
 * still can. `zone` is the hotel's: a stay is past once its check-out day
 * has gone by at the hotel.
 */
export function closedReason(row, reservation, zone) {
  if (row.accepted_at) return "accepted";
  if (reservation.status === "in_house" || reservation.status === "checked_out") return "arrived";
  if (!OPEN_STATUSES.has(reservation.status)) return "cancelled";
  if (reservation.check_out < todayInZone(zone)) return "past";
  return null;
}

/** The first look at a link is when the guest opened it. */
export async function markOpened(row) {
  if (row.opened_at) return;
  await getSupabaseAdmin()
    .from(TABLE)
    .update({ opened_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("opened_at", null);
}

/** A file as the guest's page sees it: a name, never a link to the ID itself. */
const fileForGuest = (f) => ({ id: f.path.split("/").pop(), name: f.name, size: f.size, type: f.type });

/**
 * What the guest's page is given. Only what the guest needs to recognise
 * their booking and pick up where they left off.
 */
export function guestView({ row, reservation, property, prefs }) {
  const count = checkinGuestCount(prefs, reservation.adults);
  const saved = row.details?.guests || [];
  const guests = Array.from({ length: count }, (_, i) => {
    const g = saved[i] || {};
    const { files = [], guest_id: _guestId, ...fields } = g;
    if (i === 0 && !saved[0]) {
      fields.full_name = reservation.guest_name || "";
      fields.phone = reservation.guest_phone || "";
      fields.email = reservation.guest_email || "";
    }
    return { ...fields, files: files.map(fileForGuest) };
  });
  return {
    hotel: { name: property.name, logoUrl: property.display_prefs?.logoUrl || null, country: toCountryCode(property.country) || null },
    booking: {
      reference: reservation.reference,
      guestName: reservation.guest_name,
      checkIn: reservation.check_in,
      checkOut: reservation.check_out,
      dayUse: reservation.stay_kind === "day_use",
      roomType: reservation.room_types?.room_type_name || null,
      adults: reservation.adults,
      children: reservation.children,
    },
    prefs,
    guests,
    arrivalTime: row.details?.arrival_time || "",
    requests: row.details?.requests || "",
    submittedAt: row.submitted_at,
    closed: closedReason(row, reservation, property.timezone),
  };
}

const PERSON_FIELDS = {
  full_name: 120,
  phone: 30,
  email: 160,
  address: 300,
  nationality: 2,
  id_type: 30,
  id_number: 40,
  date_of_birth: 10,
  passport_expiry: 10,
  visa_number: 40,
  visa_expiry: 10,
  arrived_from: 120,
  next_destination: 120,
};
const DATE_FIELDS = new Set(["date_of_birth", "passport_expiry", "visa_expiry"]);
const ID_TYPE_IDS = new Set(CHECKIN_ID_TYPES.map((t) => t.id));

/** Only the fields a guest may send, trimmed and capped; anything else is dropped. */
function cleanPerson(input) {
  const out = {};
  for (const [field, max] of Object.entries(PERSON_FIELDS)) {
    let v = String(input?.[field] ?? "").trim().slice(0, max);
    if (DATE_FIELDS.has(field) && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) v = "";
    if (field === "nationality") v = toCountryCode(v) || "";
    if (field === "id_type" && v && !ID_TYPE_IDS.has(v)) v = "other";
    out[field] = v;
  }
  return out;
}

/**
 * Saves what the guest typed. `submit` sends it to the hotel, after checking
 * nothing required is missing; without it the details are kept to finish
 * later. Files are kept from the stored copy, never taken from the browser.
 */
export async function saveGuestDetails(found, input, { submit }) {
  const { row, reservation, property, prefs } = found;
  const count = checkinGuestCount(prefs, reservation.adults);
  const stored = row.details?.guests || [];
  const sent = Array.isArray(input?.guests) ? input.guests : [];
  const guests = Array.from({ length: count }, (_, i) => {
    const g = cleanPerson(sent[i]);
    if (isForeignGuest(g, toCountryCode(property.country), prefs)) g.id_type = "passport";
    return { ...g, files: stored[i]?.files || [] };
  });

  const details = {
    ...row.details,
    guests,
    arrival_time: String(input?.arrivalTime ?? "").trim().slice(0, 20),
    requests: String(input?.requests ?? "").trim().slice(0, 1000),
  };
  const now = new Date().toISOString();
  const update = { details, updated_at: now };

  if (submit) {
    const [gap] = checkinGaps(guests, {
      prefs,
      country: toCountryCode(property.country),
      consent: input?.consent === true,
    });
    if (gap) {
      const who = gap.index !== null && guests.length > 1 ? `Guest ${gap.index + 1}: ` : "";
      return { error: `${who}${gap.message}`, gap };
    }
    details.consent_at = now;
    update.submitted_at = now;
  }

  const { error } = await getSupabaseAdmin().from(TABLE).update(update).eq("id", row.id);
  if (error) throw new Error(`Could not save your details: ${error.message}`);
  return { ok: true };
}

/** Adds an ID file to one guest on the link. Returns that guest's files as the page sees them. */
export async function addGuestFile(found, index, file) {
  const { row, reservation, prefs } = found;
  const count = checkinGuestCount(prefs, reservation.adults);
  if (!Number.isInteger(index) || index < 0 || index >= count) return { error: "That guest is not on this booking." };

  const guests = [...(row.details?.guests || [])];
  while (guests.length <= index) guests.push({ files: [] });
  const files = guests[index].files || [];
  if (files.length >= MAX_CHECKIN_FILES_PER_GUEST) {
    return { error: `Up to ${MAX_CHECKIN_FILES_PER_GUEST} files per guest. Remove one first.` };
  }

  const entry = await storeCheckinFile(row.property_id, row.id, file);
  guests[index] = { ...guests[index], files: [...files, entry] };
  const { error } = await getSupabaseAdmin()
    .from(TABLE)
    .update({ details: { ...row.details, guests }, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) {
    await removeStoredFiles([entry.path]);
    throw new Error(`Could not save the file: ${error.message}`);
  }
  return { files: guests[index].files.map(fileForGuest) };
}

/** Removes one of the files the guest sent, by the id their page was given. */
export async function removeGuestFile(found, fileId) {
  const { row } = found;
  const guests = (row.details?.guests || []).map((g) => ({ ...g, files: g.files || [] }));
  const index = guests.findIndex((g) => g.files.some((f) => f.path.endsWith(`/${fileId}`)));
  if (index < 0) return { error: "That file is not on this booking." };

  const file = guests[index].files.find((f) => f.path.endsWith(`/${fileId}`));
  guests[index].files = guests[index].files.filter((f) => f !== file);
  const { error } = await getSupabaseAdmin()
    .from(TABLE)
    .update({ details: { ...row.details, guests }, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) throw new Error(`Could not remove the file: ${error.message}`);
  await removeStoredFiles([file.path]);
  return { index, files: guests[index].files.map(fileForGuest) };
}

// ------------------------------------------------------------------
// The desk's side
// ------------------------------------------------------------------

/**
 * A booking's check-in as the desk sees it. ID files come with short-lived
 * links only for someone who may open the Guests page, as on that page.
 */
export async function deskView(row, { reservation, withFiles, zone }) {
  if (!row) return { status: "none", guests: [] };
  const people = row.details?.guests || [];
  let links = new Map();
  if (withFiles) links = await signedFileLinks(allFilePaths(row)).catch(() => new Map());
  return {
    id: row.id,
    status: checkinStatus(row),
    token: row.token,
    createdAt: row.created_at,
    openedAt: row.opened_at,
    submittedAt: row.submitted_at,
    acceptedAt: row.accepted_at,
    closed: closedReason(row, reservation, zone),
    guests: row.submitted_at
      ? people.map((g) => ({
          ...g,
          files: (g.files || []).map((f) => ({
            name: f.name,
            type: f.type,
            size: f.size,
            url: withFiles ? links.get(f.path) || null : null,
          })),
        }))
      : [],
    arrivalTime: row.details?.arrival_time || "",
    requests: row.details?.requests || "",
  };
}

function splitName(full) {
  const parts = String(full || "").trim().split(/\s+/);
  return { first_name: parts[0] || "Guest", last_name: parts.slice(1).join(" ") || null };
}

const sameName = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

async function saveDetails(row, guests) {
  const { error } = await getSupabaseAdmin()
    .from(TABLE)
    .update({ details: { ...row.details, guests }, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) throw new Error(`Failed to save online check-in: ${error.message}`);
}

/**
 * The desk has checked what the guest sent: each guest goes onto a guest
 * record, found or made, with their ID details and files, and is named on
 * the booking.
 *
 * The booker is the booking's own guest. Anyone else is matched on their
 * own phone or email -- never one they share with the booker, which is
 * usually the booker's -- and is a new guest otherwise; never on a name.
 *
 * Saved guest by guest, so a failure part-way can be retried without moving
 * anyone's files twice.
 */
export async function acceptCheckin(row, reservation, userId) {
  if (row.accepted_at) return;
  if (!row.submitted_at) throw new Error("The guest has not sent their details yet.");
  if (!(await guestsReady())) throw new Error("The guest list is not switched on for this property yet.");

  const supabase = getSupabaseAdmin();
  const propertyId = reservation.property_id;
  const { data: property } = await supabase.from("properties").select("country").eq("id", propertyId).maybeSingle();
  const country = toCountryCode(property?.country);
  const prefs = await getCheckinPrefs(propertyId);

  const people = (row.details?.guests || []).map((g) => ({ ...g }));
  const named = await listReservationGuests(reservation.id);
  let hasPrimary = named.some((g) => g.is_primary);
  const bookerPhone = guestPhoneKey(people[0]?.phone || reservation.guest_phone);
  const bookerEmail = String(people[0]?.email || reservation.guest_email || "").trim().toLowerCase();

  for (const [i, p] of people.entries()) {
    if (p.guest_id) continue;

    let guestId;
    let contact;
    if (i === 0) {
      contact = { phone: p.phone, email: p.email };
      guestId =
        reservation.guest_id ||
        (await linkGuestForBooking(propertyId, {
          guest_name: reservation.guest_name,
          guest_phone: p.phone || reservation.guest_phone,
          guest_email: p.email || reservation.guest_email,
        }));
      if (guestId && !reservation.guest_id) {
        await supabase.from("reservations").update({ guest_id: guestId }).eq("id", reservation.id);
      }
    } else {
      contact = {
        phone: p.phone && guestPhoneKey(p.phone) !== bookerPhone ? p.phone : null,
        email: p.email && p.email.trim().toLowerCase() !== bookerEmail ? p.email : null,
      };
      const match = contact.phone || contact.email ? await findGuestMatch(propertyId, contact) : null;
      guestId = match?.id || (await createGuest(propertyId, { full_name: p.full_name, ...contact })).id;
    }
    if (!guestId) throw new Error(`Could not find or make a guest record for ${p.full_name}.`);

    // What the guest gave, now checked by the desk, written onto their
    // record. Blank answers leave what the record already says.
    const foreign = isForeignGuest(p, country, prefs);
    const fields = {
      phone: contact.phone,
      email: contact.email,
      address: p.address,
      country: p.nationality,
      id_type: p.id_type,
      id_number: p.id_number,
    };
    const updates = Object.fromEntries(Object.entries(fields).filter(([, v]) => v));
    if (p.nationality) updates.residency = foreign ? "international" : "domestic";
    if (Object.keys(updates).length) await updateGuest(propertyId, guestId, updates);
    if (foreign) {
      const travel = {
        date_of_birth: p.date_of_birth || null,
        passport_expiry: p.passport_expiry || null,
        visa_number: p.visa_number || null,
        visa_expiry: p.visa_expiry || null,
        arrived_from: p.arrived_from || null,
        next_destination: p.next_destination || null,
      };
      const { error } = await supabase.from("guests").update({ travel_details: travel }).eq("id", guestId);
      if (error) console.error("Passport and visa details not saved:", error.message);
    }

    const files = await adoptIdFiles(propertyId, guestId, p.files || []);

    // Who they are, for the police register and Form C.
    const identity = {
      nationality: p.nationality || null,
      id_type: foreign ? "passport" : p.id_type || null,
      id_number: p.id_number || null,
      address: p.address || null,
      date_of_birth: p.date_of_birth || null,
    };
    const already = named.find((g) => sameName(`${g.first_name} ${g.last_name || ""}`, p.full_name));
    if (!already) {
      const primary = i === 0 && !hasPrimary && sameName(p.full_name, reservation.guest_name);
      await saveReservationGuest(
        reservation.id,
        { ...splitName(p.full_name), email: contact.email || null, phone: contact.phone || null, is_primary: primary, ...identity },
        { guestId }
      );
      if (primary) hasPrimary = true;
    } else if (!already.id_number) {
      // Named by the desk before the details came in: the ID goes onto that
      // line rather than a second one with the same name.
      await saveReservationGuest(reservation.id, { ...already, ...identity }, { guestId });
    }

    people[i] = { ...p, guest_id: guestId, files };
    await saveDetails(row, people);
  }

  const { error } = await supabase
    .from(TABLE)
    .update({ accepted_at: new Date().toISOString(), accepted_by: userId || null })
    .eq("id", row.id);
  if (error) throw new Error(`Failed to mark the details checked: ${error.message}`);
}

/** Each booking's check-in status, for lists. Empty before migration 053. */
export async function checkinStatuses(reservationIds) {
  if (!reservationIds.length || !(await checkinReady())) return {};
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .select("reservation_id, opened_at, submitted_at, accepted_at")
    .in("reservation_id", reservationIds);
  if (error) return {};
  return Object.fromEntries((data || []).map((r) => [r.reservation_id, checkinStatus(r)]));
}

/**
 * Links whose stay ended more than a day ago without the desk accepting
 * them are deleted with their ID files, so copies of IDs do not pile up
 * where nobody looks. Run by the daily job.
 */
export async function purgeStaleCheckins() {
  if (!(await checkinReady())) return 0;
  const supabase = getSupabaseAdmin();
  const cutoff = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from(TABLE)
    .select("id, details, accepted_at, reservations!inner(check_out)")
    .is("accepted_at", null)
    .lt("reservations.check_out", cutoff)
    .limit(500);
  if (error) throw new Error(`Failed to find old check-in links: ${error.message}`);
  for (const row of data || []) await deleteCheckin(row);
  return (data || []).length;
}
