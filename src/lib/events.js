import { getSupabaseAdmin } from "@/lib/database";
import {
  EVENT_CATEGORIES,
  IMPACTS,
  cleanPropertyTypes,
  eventMatchesProfile,
  impactOf,
} from "@/lib/eventTags";
import { normaliseCity, normaliseState } from "@/lib/places";
import { toCountryCode } from "@/lib/countries";

/**
 * Reading and writing events, and finding the ones a hotel should see.
 *
 * The matching rule itself lives in eventTags.js so the browser can apply it
 * too; this file only fetches. Both the Events page and the pricing engine
 * go through `eventsForProperty`, so a hotel is never priced on an event its
 * own calendar does not show.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Before migration 039 there is no table, which reads as "no events". */
function missingEventsTable(error) {
  return /events|property_types|country_code/.test(error?.message || "") &&
    /does not exist|schema cache|column/.test(error?.message || "");
}
const NEEDS_MIGRATION = "Events need migration 039_events.sql to be run in Supabase first.";

// ---------------------------------------------------------------------------
// The property profile
// ---------------------------------------------------------------------------

/** The tags a property is matched on. */
export async function getPropertyProfile(propertyId) {
  const { data, error } = await getSupabaseAdmin()
    .from("properties")
    .select("*")
    .eq("id", propertyId)
    .single();
  if (error) throw new Error(`Failed to read property: ${error.message}`);
  return {
    // A property from before migration 039 has only the free-text country.
    country_code: data.country_code || toCountryCode(data.country) || null,
    state: data.state || "",
    city: data.city || "",
    property_types: data.property_types || [],
  };
}

/** A problem with a profile as sent, or the clean values to store. */
export function validateProfile(input) {
  const country_code = toCountryCode(input?.country_code);
  if (!country_code) return { error: "Choose the country the hotel is in." };
  const state = normaliseState(country_code, input?.state);
  const city = normaliseCity(country_code, input?.city);
  if (!city) return { error: "Give the city or town the hotel is in." };
  const property_types = cleanPropertyTypes(input?.property_types);
  if (!property_types.length) return { error: "Choose at least one kind of property." };
  return { profile: { country_code, state: state || null, city, property_types } };
}

export async function savePropertyProfile(propertyId, profile) {
  const { error } = await getSupabaseAdmin()
    .from("properties")
    .update({ ...profile, updated_at: new Date().toISOString() })
    .eq("id", propertyId);
  if (error) {
    if (missingEventsTable(error)) throw new Error(NEEDS_MIGRATION);
    throw new Error(`Failed to save property profile: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * Every event a property should see that overlaps the dates: its own
 * private events, and the public events its profile matches.
 *
 * Public events are narrowed by country and date in the database, and by
 * state, city and type here -- places are compared through their normalised
 * names, which SQL equality cannot do.
 */
export async function eventsForProperty(propertyId, startDate, endDate, profile = null) {
  const supabase = getSupabaseAdmin();
  const tags = profile || (await getPropertyProfile(propertyId));

  const overlap = (q) => q.lte("start_date", endDate).gte("end_date", startDate);
  const [own, pub] = await Promise.all([
    overlap(supabase.from("events").select("*").eq("property_id", propertyId)),
    tags.country_code
      ? overlap(
          supabase.from("events").select("*").is("property_id", null).eq("country_code", tags.country_code)
        )
      : Promise.resolve({ data: [] }),
  ]);
  for (const res of [own, pub]) {
    if (res.error) {
      if (missingEventsTable(res.error)) return [];
      throw new Error(`Failed to read events: ${res.error.message}`);
    }
  }

  return [...(own.data || []), ...(pub.data || []).filter((e) => eventMatchesProfile(e, tags))].sort(
    (a, b) => a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name)
  );
}

/** Every public event overlapping the dates, for a super admin to manage. */
export async function listPublicEvents(startDate, endDate) {
  const { data, error } = await getSupabaseAdmin()
    .from("events")
    .select("*")
    .is("property_id", null)
    .lte("start_date", endDate)
    .gte("end_date", startDate)
    .order("start_date", { ascending: true });
  if (error) {
    if (missingEventsTable(error)) return [];
    throw new Error(`Failed to read events: ${error.message}`);
  }
  return data || [];
}

/**
 * The states and cities shared events already name in a country, for
 * suggestions. A country with no place list of its own gains one this way
 * as its calendar fills, and the next person picks the spelling already used
 * rather than inventing another.
 */
export async function knownPlaces(countryCode) {
  const { data, error } = await getSupabaseAdmin()
    .from("events")
    .select("state, city")
    .is("property_id", null)
    .eq("country_code", countryCode)
    .limit(5000);
  if (error) {
    if (missingEventsTable(error)) return { states: [], cities: [] };
    throw new Error(`Failed to read places: ${error.message}`);
  }
  const states = new Set();
  const cities = new Set();
  for (const row of data || []) {
    if (row.state) states.add(row.state);
    if (row.city) cities.add(row.city);
  }
  const sort = (set) => [...set].sort((a, b) => a.localeCompare(b));
  return { states: sort(states), cities: sort(cities) };
}

export async function getEvent(id) {
  if (!UUID_RE.test(id || "")) return null;
  const { data, error } = await getSupabaseAdmin().from("events").select("*").eq("id", id).maybeSingle();
  if (error) {
    if (missingEventsTable(error)) return null;
    throw new Error(`Failed to read event: ${error.message}`);
  }
  return data;
}

/**
 * A problem with an event as sent, or the clean row to store.
 *
 * `scope` is "private" (this hotel only) or "public" (every matching hotel).
 * A private event drops any tags sent with it: they would never be read,
 * and keeping them would suggest otherwise.
 */
export function validateEvent(input, { scope, propertyId }) {
  const row = {};
  row.name = String(input?.name || "").trim();
  if (!row.name) return { error: "Give the event a name." };
  if (row.name.length > 120) return { error: "Keep the name under 120 characters." };

  row.category = EVENT_CATEGORIES.some((c) => c.id === input?.category) ? input.category : "other";
  row.impact = IMPACTS.some((i) => i.id === input?.impact) ? input.impact : "medium";
  row.notes = String(input?.notes || "").trim().slice(0, 500) || null;

  if (!DATE_RE.test(input?.start_date || "")) return { error: "Give the date the event starts." };
  row.start_date = input.start_date;
  row.end_date = DATE_RE.test(input?.end_date || "") ? input.end_date : row.start_date;
  if (row.end_date < row.start_date) return { error: "The event cannot end before it starts." };
  const days = (Date.parse(row.end_date) - Date.parse(row.start_date)) / 86400000;
  if (days > 90) return { error: "An event can run for 90 days at most. Split a longer season into parts." };

  if (scope === "public") {
    row.property_id = null;
    row.country_code = toCountryCode(input?.country_code);
    if (!row.country_code) return { error: "Choose the country the event is in." };
    row.state = normaliseState(row.country_code, input?.state) || null;
    row.city = normaliseCity(row.country_code, input?.city) || null;
    row.property_types = cleanPropertyTypes(input?.property_types);
  } else {
    row.property_id = propertyId;
    row.country_code = null;
    row.state = null;
    row.city = null;
    row.property_types = [];
  }
  return { row };
}

export async function saveEvent(id, row, userId = null) {
  const supabase = getSupabaseAdmin();
  const stamped = { ...row, updated_at: new Date().toISOString() };
  const query = id
    ? supabase.from("events").update(stamped).eq("id", id)
    : supabase.from("events").insert({ ...stamped, created_by: UUID_RE.test(userId || "") ? userId : null });
  const { data, error } = await query.select().single();
  if (error) {
    if (missingEventsTable(error)) throw new Error(NEEDS_MIGRATION);
    throw new Error(`Failed to save event: ${error.message}`);
  }
  return data;
}

export async function deleteEvent(id) {
  const { error } = await getSupabaseAdmin().from("events").delete().eq("id", id);
  if (error) throw new Error(`Failed to delete event: ${error.message}`);
}

/** An event in the shape the pricing signal reads. */
export function toPricingEvent(event) {
  return { ...event, expected_lift_pct: impactOf(event.impact).liftPct };
}
