/**
 * The room types and rate plans a hotel gives when it signs up.
 *
 * Kept to what a hotelier knows off the top of their head: each room type's
 * name, how many rooms and how many adults, and which meal plans they sell.
 * Prices come later, in Rates & Inventory. Shared by the sign-up form and
 * the server, so both refuse the same things.
 */

export const MAX_ROOM_TYPES = 20;
export const MAX_ADULTS = 10;

/** The plans offered as ticks, named the way a guest would say them. */
export const STARTER_PLANS = [
  { code: "EP", name: "Room Only" },
  { code: "CP", name: "Room with Breakfast" },
  { code: "MAP", name: "Breakfast and One Meal" },
  { code: "AP", name: "All Meals" },
];

export const STARTER_PLAN_CODES = STARTER_PLANS.map((p) => p.code);

export const DEFAULT_PLAN_CODES = ["EP", "CP"];

export function emptyRoomType() {
  return { name: "", rooms: "", baseAdults: "2", maxAdults: "3" };
}

const whole = (v) => (/^\d+$/.test(String(v ?? "").trim()) ? Number(v) : NaN);

/**
 * The room types and plan codes cleaned up, or the first thing wrong with
 * them. `totalRooms` caps the rooms across every type.
 */
export function validateStarterSetup({ roomTypes, planCodes }, totalRooms) {
  const list = Array.isArray(roomTypes) ? roomTypes : [];
  if (list.length === 0) return { error: "Add at least one room type." };
  if (list.length > MAX_ROOM_TYPES) {
    return { error: `At most ${MAX_ROOM_TYPES} room types. Add more later in Room Setup.` };
  }

  const cleaned = [];
  const names = new Set();
  for (const [i, r] of list.entries()) {
    const label = `Room type ${i + 1}`;
    const name = String(r?.name ?? "").trim().slice(0, 80);
    const rooms = whole(r?.rooms);
    const baseAdults = whole(r?.baseAdults);
    const maxAdults = whole(r?.maxAdults);
    if (!name) return { error: `${label} needs a name.` };
    if (names.has(name.toLowerCase())) return { error: `Two room types are called ${name}.` };
    names.add(name.toLowerCase());
    if (!(rooms >= 1)) return { error: `${name} needs at least 1 room.` };
    if (!(baseAdults >= 1 && baseAdults <= MAX_ADULTS)) {
      return { error: `${name}: adults must be from 1 to ${MAX_ADULTS}.` };
    }
    if (!(maxAdults >= baseAdults && maxAdults <= MAX_ADULTS)) {
      return { error: `${name}: most adults must be from ${baseAdults} to ${MAX_ADULTS}.` };
    }
    cleaned.push({ name, rooms, baseAdults, maxAdults });
  }

  const sum = cleaned.reduce((n, r) => n + r.rooms, 0);
  if (Number.isInteger(totalRooms) && sum > totalRooms) {
    return { error: `Room types add up to ${sum} rooms, more than the ${totalRooms} total.` };
  }

  const codes = STARTER_PLAN_CODES.filter((c) => (planCodes || []).includes(c));
  if (codes.length === 0) return { error: "Tick at least one rate plan." };

  return { roomTypes: cleaned, planCodes: codes };
}
