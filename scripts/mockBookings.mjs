/**
 * Mock booking history, for demonstrating the Booking Performance report.
 *
 *   node scripts/mockBookings.mjs seed  <propertyId> [years=2] [--dry]
 *   node scripts/mockBookings.mjs clear <propertyId>
 *
 * This writes to whatever database .env points at, which for this project is
 * production. Every row it creates is tagged -- reference `MOCK-…`, a note
 * saying so -- and `clear` deletes exactly those, so real bookings are never
 * touched. Nights and extras go with their reservation by cascade.
 *
 * What it makes looks like a mid-size city hotel: busier Monday to Thursday,
 * a December peak and a monsoon dip, a second year a little better than the
 * first, most business through OTAs with their own lead times and
 * cancellation habits. Stays are placed in real rooms, around any stay or
 * out-of-order block already there, and all of them end before today -- so
 * the calendar ahead, and therefore the inventory sent to the channels, is
 * unchanged.
 *
 * The random numbers are seeded, so a clear followed by a seed recreates the
 * same history.
 */

import fs from "fs";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const TAG = "MOCK-";
const NOTE = "Mock data, generated for the booking performance demo. Remove with scripts/mockBookings.mjs clear.";

function loadEnv() {
  const text = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
  return Object.fromEntries(
    text
      .split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      })
  );
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ------------------------------------------------------------------
// Randomness
// ------------------------------------------------------------------

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260927);
const pick = (list) => list[Math.floor(rand() * list.length)];

/** Pick from `[[value, weight], …]`. */
function weighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of pairs) {
    if ((r -= w) <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
}

// ------------------------------------------------------------------
// Dates
// ------------------------------------------------------------------

const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(Date.parse(`${s}T00:00:00Z`) + n * DAY));
const weekday = (s) => new Date(`${s}T00:00:00Z`).getUTCDay();

// ------------------------------------------------------------------
// The shape of the business
// ------------------------------------------------------------------

/** Occupancy the hotel runs at, by month (Jan first). */
const MONTH_OCC = [0.78, 0.72, 0.66, 0.58, 0.55, 0.48, 0.45, 0.5, 0.6, 0.7, 0.76, 0.84];
/** And by day of week (Sun first): a business corridor fills midweek. */
const WEEKDAY_OCC = [0.8, 1.08, 1.12, 1.12, 1.06, 0.92, 0.88];
/** What the rate does with demand, by month. */
const MONTH_RATE = [1.12, 1.05, 1.0, 0.95, 0.92, 0.88, 0.86, 0.9, 0.97, 1.05, 1.1, 1.22];

const CHANNELS = [
  // [source, weight, is OTA, mean lead days, cancellation rate]
  ["Booking.com", 30, true, 21, 0.2],
  ["MakeMyTrip", 20, true, 16, 0.14],
  ["Agoda", 9, true, 24, 0.17],
  ["Goibibo", 7, true, 12, 0.12],
  ["Expedia", 3, true, 35, 0.15],
  ["website", 8, false, 28, 0.08],
  ["phone", 7, false, 9, 0.06],
  ["walkin", 7, false, 0, 0],
  ["corporate", 6, false, 11, 0.05],
  ["travel_agent", 3, false, 30, 0.07],
];

const FIRST = ["Aarav", "Vivaan", "Aditya", "Arjun", "Sai", "Rohan", "Karthik", "Rahul", "Vikram", "Nikhil",
  "Ananya", "Diya", "Priya", "Sneha", "Kavya", "Meera", "Aisha", "Divya", "Pooja", "Neha",
  "Suresh", "Ramesh", "Manoj", "Deepak", "Arun", "Lakshmi", "Shalini", "Harish", "Gautam", "Farhan"];
const LAST = ["Sharma", "Iyer", "Reddy", "Nair", "Rao", "Gupta", "Menon", "Patel", "Kumar", "Singh",
  "Hegde", "Shetty", "Joshi", "Pillai", "Das", "Mehta", "Khan", "Bose", "Kulkarni", "Naidu"];
const FOREIGN = ["James Walker", "Emma Schmidt", "Lucas Martin", "Sofia Rossi", "Kenji Tanaka",
  "Olivia Brown", "Noah Müller", "Chloe Dubois", "Liam O'Brien", "Mei Chen"];

function lengthOfStay() {
  return weighted([[1, 38], [2, 28], [3, 15], [4, 8], [5, 5], [6, 3], [7, 3]]);
}

function leadDays(mean) {
  if (mean === 0) return 0;
  // Exponential: most book close in, a few far out.
  return Math.min(180, Math.round(-Math.log(1 - rand()) * mean));
}

function reference(used) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (;;) {
    let out = TAG;
    for (let i = 0; i < 6; i += 1) out += alphabet[Math.floor(rand() * alphabet.length)];
    if (!used.has(out)) {
      used.add(out);
      return out;
    }
  }
}

function stamp(dateIso, hourFrom, hourTo) {
  const hour = hourFrom + rand() * (hourTo - hourFrom);
  return new Date(Date.parse(`${dateIso}T00:00:00Z`) + hour * 3600000).toISOString();
}

// ------------------------------------------------------------------
// Reads
// ------------------------------------------------------------------

async function readAll(build) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await build().range(offset, offset + 999);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

async function loadProperty(propertyId) {
  const [types, rooms, plans, prices, taken, blocks] = await Promise.all([
    readAll(() => supabase.from("room_types").select("*").eq("property_id", propertyId).order("id")),
    readAll(() => supabase.from("rooms").select("*").eq("property_id", propertyId).eq("is_active", true).order("id")),
    readAll(() => supabase.from("rate_plans").select("id, plan_name").eq("property_id", propertyId).order("id")),
    readAll(() => supabase.from("rate_plan_rooms").select("*").eq("property_id", propertyId).order("id")),
    readAll(() =>
      supabase
        .from("reservation_nights")
        .select("room_id, stay_date, reservations!inner(property_id, status)")
        .eq("reservations.property_id", propertyId)
        .not("room_id", "is", null)
        .order("reservation_id")
        .order("stay_date")
    ),
    readAll(() => supabase.from("room_blocks").select("*").eq("property_id", propertyId).order("id")).catch(() => []),
  ]);
  return { types, rooms, plans, prices, taken, blocks };
}

// ------------------------------------------------------------------
// Seed
// ------------------------------------------------------------------

async function seed(propertyId, years) {
  const { data: existing } = await supabase
    .from("reservations")
    .select("id")
    .eq("property_id", propertyId)
    .like("reference", `${TAG}%`)
    .limit(1);
  if (existing?.length) {
    throw new Error("This property already has mock bookings. Run `clear` first.");
  }

  const { types, rooms, plans, prices, taken, blocks } = await loadProperty(propertyId);
  if (rooms.length === 0) throw new Error("The property has no numbered rooms to place stays in.");

  // Room-nights already spoken for, by real stays or out-of-order blocks.
  const busy = new Set();
  for (const n of taken) {
    if (!["cancelled", "no_show"].includes(n.reservations.status)) busy.add(`${n.room_id}|${n.stay_date}`);
  }
  for (const b of blocks) {
    for (let d = b.start_date; d < b.end_date; d = addDays(d, 1)) busy.add(`${b.room_id}|${d}`);
  }

  const today = iso(new Date());
  const lastNight = addDays(today, -2); // every stay has left by yesterday
  const firstNight = addDays(today, -Math.round(365.25 * years));
  const typeById = Object.fromEntries(types.map((t) => [t.id, t]));
  const plan = plans[0] || null;

  function nightlyRate(roomTypeId, adults, date, channel, yearIndex) {
    const row = prices.find((p) => p.room_type_id === roomTypeId && (!plan || p.rate_plan_id === plan.id));
    const base =
      Number(row?.adult_rates?.[String(adults)]) ||
      Number(row?.full_rate) ||
      Number(typeById[roomTypeId]?.base_price) ||
      2000;
    const month = Number(date.slice(5, 7)) - 1;
    const weekend = [5, 6].includes(weekday(date)) ? 0.96 : 1;
    const deal = channel === "corporate" ? 0.88 : channel === "travel_agent" ? 0.92 : 1;
    // A second year sold a little dearer than the first.
    const growth = 1 + 0.06 * yearIndex;
    const noise = 0.94 + rand() * 0.12;
    return Math.round((base * MONTH_RATE[month] * weekend * deal * growth * noise) / 50) * 50;
  }

  const refs = new Set();
  const reservations = [];
  const nights = [];
  const extras = [];

  function book({ room, checkIn, los, released }) {
    const checkOut = addDays(checkIn, los);
    // A cancelled booking is drawn by how often each channel cancels, so
    // Booking.com carries most of them, as it does in life.
    const [source, , ota, meanLead] = weighted(
      CHANNELS.map((c) => [c, released ? c[1] * c[4] : c[1]])
    );
    const international = rand() < (ota ? 0.1 : 0.04);
    const adults = rand() < 0.72 ? 2 : 1;
    const children = adults === 2 && rand() < 0.12 ? 1 : 0;
    const lead = leadDays(meanLead);
    const bookedOn = addDays(checkIn, -lead);
    const yearIndex = checkIn < addDays(today, -365) ? 0 : 1;
    const comp = !released && !ota && rand() < 0.012;

    const status = !released ? "checked_out" : rand() < 0.1 ? "no_show" : "cancelled";

    const id = crypto.randomUUID();
    const rates = [];
    for (let i = 0; i < los; i += 1) {
      const date = addDays(checkIn, i);
      rates.push(comp ? 0 : nightlyRate(room.room_type_id, adults, date, source, yearIndex));
    }
    const total = rates.reduce((s, r) => s + r, 0);

    reservations.push({
      id,
      property_id: propertyId,
      reference: reference(refs),
      room_type_id: room.room_type_id,
      room_id: room.id,
      rate_plan_id: plan?.id || null,
      guest_name: international ? pick(FOREIGN) : `${pick(FIRST)} ${pick(LAST)}`,
      guest_phone: international ? null : `+91 9${String(Math.floor(rand() * 1e9)).padStart(9, "0")}`,
      check_in: checkIn,
      check_out: checkOut,
      adults,
      children,
      source,
      partner_booking_id: ota ? `${TAG}${source.replace(/\W/g, "").toUpperCase()}-${id.slice(0, 8)}` : null,
      status,
      total_amount: total,
      currency: "INR",
      guest_residency: international ? "international" : "domestic",
      booking_type: comp ? "complimentary" : "standard",
      checked_in_at: status === "checked_out" ? stamp(checkIn, 13, 20) : null,
      checked_out_at: status === "checked_out" ? stamp(checkOut, 7, 12) : null,
      notes: NOTE,
      created_at: stamp(bookedOn, source === "walkin" ? 12 : 3, source === "walkin" ? 20 : 18),
      updated_at: stamp(status === "cancelled" ? addDays(checkIn, -Math.floor(rand() * Math.max(1, lead))) : checkOut, 8, 12),
    });

    rates.forEach((rate, i) =>
      nights.push({
        reservation_id: id,
        stay_date: addDays(checkIn, i),
        room_type_id: room.room_type_id,
        room_id: room.id,
        rate,
      })
    );

    if (status === "checked_out") {
      if (rand() < 0.3) {
        extras.push({
          reservation_id: id,
          name: "Breakfast",
          unit_price: 300,
          quantity: adults * los,
          kind: "extra",
          stay_date: null,
          created_at: stamp(checkIn, 20, 22),
        });
      }
      if (rand() < 0.08) {
        extras.push({
          reservation_id: id,
          name: "Airport transfer",
          unit_price: 1500,
          quantity: 1,
          kind: "extra",
          stay_date: checkIn,
          created_at: stamp(checkIn, 10, 12),
        });
      }
    }
  }

  // Walk the calendar room by room. A free room starts a stay with a
  // probability set by that night's target occupancy -- the chance a stay
  // begins is what keeps the long-run fill near the target once stays of a
  // couple of nights are laid end to end.
  for (const room of rooms) {
    let d = firstNight;
    while (d <= lastNight) {
      if (busy.has(`${room.id}|${d}`)) {
        d = addDays(d, 1);
        continue;
      }
      const month = Number(d.slice(5, 7)) - 1;
      const yearIndex = d < addDays(today, -365) ? 0 : 1;
      const target = Math.min(0.95, MONTH_OCC[month] * WEEKDAY_OCC[weekday(d)] * (0.93 + 0.07 * yearIndex));
      const startChance = target / (2.3 * (1 - target) + target);

      if (rand() < startChance) {
        let los = lengthOfStay();
        // Shorten rather than overlap a stay that is already there, or run
        // past yesterday.
        let fit = 0;
        while (fit < los && addDays(d, fit) <= lastNight && !busy.has(`${room.id}|${addDays(d, fit)}`)) fit += 1;
        los = fit;

        // Some of the business that would have filled these nights cancelled
        // or never turned up first; those bookings are recorded too, and the
        // room still went to someone else.
        if (rand() < 0.13) book({ room, checkIn: d, los, released: true });

        book({ room, checkIn: d, los, released: false });
        for (let i = 0; i < los; i += 1) busy.add(`${room.id}|${addDays(d, i)}`);
        d = addDays(d, los);
      } else {
        d = addDays(d, 1);
      }
    }
  }

  const kept = new Set(reservations.filter((r) => r.status === "checked_out").map((r) => r.id));
  const soldNights = nights.filter((n) => kept.has(n.reservation_id));
  const revenue = soldNights.reduce((s, n) => s + n.rate, 0);
  const days = Math.round((Date.parse(lastNight) - Date.parse(firstNight)) / DAY) + 1;
  const bySource = {};
  for (const r of reservations) bySource[r.source] = (bySource[r.source] || 0) + 1;
  console.log(
    `${firstNight} to ${lastNight}: ${reservations.length} reservations ` +
      `(${kept.size} stayed, ${reservations.length - kept.size} cancelled or no-show), ` +
      `${soldNights.length} room nights, ${extras.length} extras.\n` +
      `Occupancy ${((soldNights.length / (days * rooms.length)) * 100).toFixed(1)}%, ` +
      `ADR ₹${Math.round(revenue / soldNights.length)}, room revenue ₹${Math.round(revenue).toLocaleString("en-IN")}.\n` +
      `By source: ${JSON.stringify(bySource)}`
  );
  if (dryRun) {
    console.log("Dry run: nothing written.");
    return;
  }

  await insert("reservations", reservations);
  await insert("reservation_nights", nights);
  await insert("reservation_extras", extras);
  console.log("Done.");
}

async function insert(table, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + 500));
    if (error) throw new Error(`Inserting into ${table} failed at row ${i}: ${error.message}`);
    process.stdout.write(`\r${table}: ${Math.min(i + 500, rows.length)}/${rows.length}`);
  }
  process.stdout.write("\n");
}

// ------------------------------------------------------------------
// Clear
// ------------------------------------------------------------------

async function clear(propertyId) {
  let removed = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("reservations")
      .select("id")
      .eq("property_id", propertyId)
      .like("reference", `${TAG}%`)
      .eq("notes", NOTE)
      .limit(500);
    if (error) throw new Error(error.message);
    if (!data.length) break;
    const { error: delError } = await supabase.from("reservations").delete().in("id", data.map((r) => r.id));
    if (delError) throw new Error(delError.message);
    removed += data.length;
    process.stdout.write(`\rRemoved ${removed}`);
  }
  console.log(`\nRemoved ${removed} mock reservations and their nights and extras.`);
}

// ------------------------------------------------------------------

const args = process.argv.slice(2);
const dryRun = args.includes("--dry");
const [command, propertyId, years = "2"] = args.filter((a) => a !== "--dry");
if (!["seed", "clear"].includes(command) || !propertyId) {
  console.log("Usage: node scripts/mockBookings.mjs seed|clear <propertyId> [years]");
  process.exit(1);
}
(command === "seed" ? seed(propertyId, Number(years)) : clear(propertyId)).catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
