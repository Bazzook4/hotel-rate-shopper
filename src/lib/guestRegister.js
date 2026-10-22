import { getSupabaseAdmin } from '@/lib/database';
import { localDay, shiftDay, userEmails } from '@/lib/financeReports';
import { chunks, notMigrated, readAll } from '@/lib/reports';
import { toCountryCode } from '@/lib/countries';
import { FORM_C_FIELDS, FORM_C_PURPOSES, FORM_C_REQUIRED } from '@/lib/formC';

/**
 * The guest register: everyone who checked in over some days, one row per
 * person, with what the police and the FRRO ask about them.
 *
 * A booking's people are its named guests (the Guests tab, or online
 * check-in). A booking with nobody named is its booker alone, read from the
 * booking and its guest record, since most small-hotel bookings are one name
 * and nobody goes back to type it twice.
 *
 * A person's details come from the booking first (what the desk saw for this
 * stay) and their guest record second, so a returning guest's ID fills in
 * what the desk did not retype.
 *
 * Arrival is the day the desk checked them in, on the desk's clock; a stay
 * checked in through an older path without that moment counts on its
 * check-in date.
 */

const ARRIVED = ['in_house', 'checked_out'];

const STAY_SELECT = 'id, reference, guest_name, guest_phone, guest_email, guest_country, guest_residency, guest_id, adults, children, check_in, check_out, checked_in_at, status, rooms(room_number), room_types(room_type_name)';

const GUEST_SELECT = 'id, full_name, phone, email, country, residency, address, id_type, id_number, travel_details';

const ID_LABELS = {
  aadhaar: 'Aadhaar',
  passport: 'Passport',
  driving_licence: 'Driving licence',
  voter_id: 'Voter ID',
  other: 'Other',
};

const GENDER_LABELS = { male: 'Male', female: 'Female', other: 'Other' };

/** Form C is due within this many hours of arrival. */
const FORM_C_HOURS = 24;

const blank = (v) => v == null || String(v).trim() === '';
const first = (...vals) => vals.find((v) => !blank(v)) ?? null;

async function propertyCountry(propertyId) {
  const { data } = await getSupabaseAdmin().from('properties').select('country').eq('id', propertyId).maybeSingle();
  return toCountryCode(data?.country) || 'IN';
}

/** Stays checked in on these local days, both inclusive. */
async function arrivedStays(propertyId, { start, end, tz }) {
  const supabase = getSupabaseAdmin();
  // A guest checked in a day or two after the booked date still arrived on
  // the day they were checked in, so the booked dates are read a little
  // wider and cut on the moment of check-in.
  const rows = await readAll(
    () =>
      supabase
        .from('reservations')
        .select(STAY_SELECT)
        .eq('property_id', propertyId)
        .in('status', ARRIVED)
        .gte('check_in', shiftDay(start, -7))
        .lte('check_in', shiftDay(end, 1))
        .order('check_in')
        .order('id'),
    'stays'
  );
  return rows
    .map((r) => ({ ...r, arrivalDay: r.checked_in_at ? localDay(r.checked_in_at, tz) : r.check_in }))
    .filter((r) => r.arrivalDay >= start && r.arrivalDay <= end);
}

/** Named guests on these stays, with their guest records where linked. */
async function namedGuests(stayIds) {
  const supabase = getSupabaseAdmin();
  const out = [];
  for (const ids of chunks(stayIds)) {
    const load = (select) =>
      readAll(
        () => supabase.from('reservation_guests').select(select).in('reservation_id', ids).order('is_primary', { ascending: false }).order('created_at').order('id'),
        'named guests'
      );
    try {
      out.push(...(await load(`*, guests(${GUEST_SELECT})`)));
    } catch (err) {
      // Before migration 054 the named guests carry no ID and no link.
      if (!notMigrated(err)) throw err;
      out.push(...(await load('*')));
    }
  }
  return out;
}

async function guestRecords(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const out = {};
  for (const part of chunks(unique)) {
    const { data, error } = await getSupabaseAdmin().from('guests').select(GUEST_SELECT).in('id', part);
    if (error) {
      if (notMigrated(error)) return {};
      throw new Error(`Failed to load guests: ${error.message}`);
    }
    for (const g of data || []) out[g.id] = g;
  }
  return out;
}

function stayFields(r) {
  return {
    reservationId: r.id,
    reference: r.reference,
    bookingName: r.guest_name,
    room: r.rooms?.room_number || null,
    roomType: r.room_types?.room_type_name || null,
    arrivedAt: r.checked_in_at || null,
    arrivalDay: r.arrivalDay,
    checkOut: r.check_out,
    adults: r.adults,
    children: r.children,
    status: r.status,
    // Set for tax on every booking, domestic unless the desk said otherwise.
    residency: r.guest_residency,
  };
}

/** What is missing for the police register. */
function gapsOf(p) {
  const gaps = [];
  if (blank(p.idNumber)) gaps.push('ID number');
  if (blank(p.idType)) gaps.push('ID type');
  if (blank(p.address)) gaps.push('Address');
  if (blank(p.nationality)) gaps.push('Nationality');
  return gaps;
}

/**
 * Everyone who checked in on these days, one row per person, each with the
 * gaps the desk still has to fill. Stays with fewer people named than adults
 * booked say so, since the police register wants every adult.
 */
export async function getGuestRegister(propertyId, { start, end, tz = 0 }) {
  const [country, stays] = await Promise.all([propertyCountry(propertyId), arrivedStays(propertyId, { start, end, tz })]);
  const named = await namedGuests(stays.map((s) => s.id));
  const byStay = new Map();
  for (const g of named) {
    if (!byStay.has(g.reservation_id)) byStay.set(g.reservation_id, []);
    byStay.get(g.reservation_id).push(g);
  }
  // The booker counts as a person on the stay unless one of the named
  // guests is the main guest: a desk that names only the companion has not
  // meant to take the booker off the register.
  const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const bookerStays = new Set(
    stays
      .filter((s) => {
        const list = byStay.get(s.id) || [];
        return !list.some((g) => g.is_primary || sameName([g.first_name, g.last_name].filter(Boolean).join(' '), s.guest_name));
      })
      .map((s) => s.id)
  );
  const bookers = await guestRecords(stays.filter((s) => bookerStays.has(s.id)).map((s) => s.guest_id));

  const people = [];
  const shortStays = [];
  for (const s of stays) {
    const list = byStay.get(s.id) || [];
    if (bookerStays.has(s.id)) {
      const rec = bookers[s.guest_id] || {};
      const travel = rec.travel_details || {};
      people.push({
        ...stayFields(s),
        key: 'booker',
        guestId: s.guest_id || null,
        name: first(rec.full_name, s.guest_name),
        gender: null,
        phone: first(s.guest_phone, rec.phone),
        address: rec.address || null,
        nationality: toCountryCode(first(s.guest_country, rec.country)),
        idType: rec.id_type || null,
        idNumber: rec.id_number || null,
        dateOfBirth: travel.date_of_birth || null,
        travel,
        primary: true,
      });
    }
    for (const g of list) {
      const rec = g.guests || {};
      const nationality = toCountryCode(first(g.nationality, rec.country, g.is_primary ? s.guest_country : null));
      const travel = rec.travel_details || {};
      people.push({
        ...stayFields(s),
        key: g.id,
        guestId: g.guest_id || null,
        name: [g.first_name, g.last_name].filter(Boolean).join(' '),
        gender: GENDER_LABELS[g.gender] || null,
        phone: first(g.phone, rec.phone, g.is_primary ? s.guest_phone : null),
        address: first(g.address, rec.address),
        nationality,
        idType: first(g.id_type, rec.id_type),
        idNumber: first(g.id_number, rec.id_number),
        dateOfBirth: first(g.date_of_birth, travel.date_of_birth),
        travel,
        primary: Boolean(g.is_primary),
      });
    }
    const counted = list.length + (bookerStays.has(s.id) ? 1 : 0);
    if (counted < (s.adults || 0)) shortStays.push({ ...stayFields(s), named: counted });
  }

  for (const p of people) {
    p.idLabel = ID_LABELS[p.idType] || p.idType || null;
    // A domestic booking with no nationality on record is taken as the
    // hotel's own country, or every local guest would be flagged; one
    // booked as international without a nationality is still foreign, for
    // Form C, and still flagged.
    if (!p.nationality && p.residency !== 'international') p.nationality = country;
    p.foreign = p.nationality ? p.nationality !== country : p.residency === 'international';
    p.gaps = gapsOf(p);
  }
  people.sort((a, b) => String(a.arrivedAt || a.arrivalDay).localeCompare(String(b.arrivedAt || b.arrivalDay)) || String(a.room || '').localeCompare(String(b.room || ''), undefined, { numeric: true }));

  return {
    start,
    end,
    country,
    people,
    shortStays,
    summary: {
      stays: stays.length,
      people: people.length,
      foreign: people.filter((p) => p.foreign).length,
      incomplete: people.filter((p) => p.gaps.length).length,
    },
  };
}

// ------------------------------------------------------------------
// Form C
// ------------------------------------------------------------------

async function formCRows(propertyId, stayIds) {
  const out = [];
  if (!stayIds.length) {
    // Nothing to read, but whether the table is there still decides what
    // the page says.
    const { error } = await getSupabaseAdmin().from('form_c_records').select('id').limit(1);
    if (error) {
      if (notMigrated(error)) return null;
      throw new Error(`Failed to load Form C records: ${error.message}`);
    }
    return out;
  }
  for (const ids of chunks(stayIds)) {
    const { data, error } = await getSupabaseAdmin().from('form_c_records').select('*').eq('property_id', propertyId).in('reservation_id', ids);
    if (error) {
      if (notMigrated(error)) return null;
      throw new Error(`Failed to load Form C records: ${error.message}`);
    }
    out.push(...(data || []));
  }
  return out;
}

/** What the hotel already knows about a person, for the form's blanks. */
function prefill(p) {
  const t = p.travel || {};
  return {
    date_of_birth: p.dateOfBirth || null,
    passport_number: p.idType === 'passport' ? p.idNumber : null,
    passport_expiry: t.passport_expiry || null,
    visa_number: t.visa_number || null,
    visa_expiry: t.visa_expiry || null,
    arrived_from: t.arrived_from || null,
    next_destination: t.next_destination || null,
    address_abroad: p.address || null,
  };
}

/** Every foreign guest who arrived on these days, with their Form C as it stands. */
export async function getFormC(propertyId, { start, end, tz = 0 }) {
  const register = await getGuestRegister(propertyId, { start, end, tz });
  const foreign = register.people.filter((p) => p.foreign);
  const records = await formCRows(propertyId, [...new Set(foreign.map((p) => p.reservationId))]);
  const byKey = new Map((records || []).map((r) => [`${r.reservation_id}|${r.person_key}`, r]));
  const emails = await userEmails((records || []).map((r) => r.submitted_by));
  const now = Date.now();

  const rows = foreign.map((p) => {
    const rec = byKey.get(`${p.reservationId}|${p.key}`);
    const known = prefill(p);
    const stored = rec?.details || {};
    const details = {};
    for (const f of FORM_C_FIELDS) details[f] = first(stored[f], known[f]);
    const arrived = Date.parse(p.arrivedAt || `${p.arrivalDay}T12:00:00Z`);
    const dueAt = new Date(arrived + FORM_C_HOURS * 3600000).toISOString();
    const missing = FORM_C_REQUIRED.filter((f) => blank(details[f]));
    return {
      id: `${p.reservationId}|${p.key}`,
      reservationId: p.reservationId,
      personKey: p.key,
      reference: p.reference,
      name: p.name,
      gender: p.gender,
      nationality: p.nationality,
      room: p.room,
      arrivalDay: p.arrivalDay,
      arrivedAt: p.arrivedAt,
      checkOut: p.checkOut,
      phone: p.phone,
      ...details,
      missing,
      dueAt,
      overdue: !rec?.submitted_at && Date.parse(dueAt) < now,
      frro_reference: rec?.frro_reference || '',
      submittedAt: rec?.submitted_at || null,
      submittedBy: emails[rec?.submitted_by] || null,
    };
  });

  return {
    start,
    end,
    ready: records !== null,
    rows,
    summary: {
      guests: rows.length,
      submitted: rows.filter((r) => r.submittedAt).length,
      overdue: rows.filter((r) => r.overdue).length,
    },
  };
}

const DATE_FIELDS = new Set(['date_of_birth', 'passport_issue_date', 'passport_expiry', 'visa_issue_date', 'visa_expiry', 'arrived_in_india']);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** A Form C's fields as the desk sent them, checked and trimmed. */
export function cleanFormCDetails(raw) {
  const out = {};
  for (const f of FORM_C_FIELDS) {
    if (!(f in (raw || {}))) continue;
    const v = raw[f] == null ? '' : String(raw[f]).trim().slice(0, 300);
    if (DATE_FIELDS.has(f) && v && !ISO.test(v)) throw new Error('A date on the form is not a real date.');
    if (f === 'purpose' && v && !FORM_C_PURPOSES.some((p) => p.id === v)) throw new Error('Choose a purpose of visit from the list.');
    out[f] = v || null;
  }
  return out;
}

/**
 * Save one guest's Form C. `submitted` true marks it filed on the FRRO site
 * (now, by this user), false takes the mark back off; left out, it stays as
 * it was. Fields not sent keep what was stored.
 */
export async function saveFormC(propertyId, { reservationId, personKey, details, frroReference, submitted }, userId) {
  const supabase = getSupabaseAdmin();
  const { data: stay } = await supabase.from('reservations').select('id, property_id').eq('id', reservationId).maybeSingle();
  if (!stay || stay.property_id !== propertyId) throw new Error('That booking was not found.');

  const { data: existing, error: readError } = await supabase
    .from('form_c_records')
    .select('*')
    .eq('reservation_id', reservationId)
    .eq('person_key', personKey)
    .maybeSingle();
  if (readError) {
    if (notMigrated(readError)) {
      console.error('Form C needs migration 054_cash_police_formc.sql');
      throw new Error('Form C is not switched on yet. Ask your OnlineHotelier contact.');
    }
    throw new Error(`Failed to load Form C: ${readError.message}`);
  }

  const now = new Date().toISOString();
  const row = {
    property_id: propertyId,
    reservation_id: reservationId,
    person_key: personKey,
    details: { ...(existing?.details || {}), ...cleanFormCDetails(details) },
    updated_by: userId || null,
    updated_at: now,
  };
  if (frroReference !== undefined) row.frro_reference = String(frroReference || '').trim().slice(0, 100) || null;
  if (submitted === true && !(row.frro_reference ?? existing?.frro_reference)) {
    throw new Error('Enter the FRRO number before marking the form filed.');
  }
  if (submitted === true && !existing?.submitted_at) {
    row.submitted_at = now;
    row.submitted_by = userId || null;
  }
  if (submitted === false) {
    row.submitted_at = null;
    row.submitted_by = null;
  }

  const { error } = await supabase.from('form_c_records').upsert(row, { onConflict: 'reservation_id,person_key' });
  if (error) throw new Error(`Failed to save Form C: ${error.message}`);
}
