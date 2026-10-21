/**
 * The most rooms a property may set up.
 *
 * A hotel gives its total number of rooms when it signs up, and that total
 * caps both room counts in setup: the rooms declared on its room types, and
 * the numbered rooms it adds. Only a super admin can change the total, so a
 * hotel cannot grow past what it signed up for on its own. No total set
 * (properties from before onboarding asked) means no cap.
 */

import { getPropertyById } from "@/lib/database";

export async function roomCap(propertyId) {
  const property = await getPropertyById(propertyId);
  const cap = property?.total_rooms;
  return Number.isInteger(cap) && cap > 0 ? cap : null;
}

/**
 * Why `after` rooms would be too many, or null when they fit. Going down is
 * always allowed, so a property already over its total can still trim. No
 * closing full stop: the setup grids join row errors with ". ".
 */
export function capProblem(cap, before, after) {
  if (cap === null || after <= before || after <= cap) return null;
  return `That makes ${after} rooms, over the hotel's total of ${cap}. Ask Online Hotelier support to raise it`;
}

/** How many of the rooms in a numbered range do not exist yet. */
export function newRoomsInRange(current, { from, to, prefix = "" }) {
  const existing = new Set(current.map((r) => r.room_number));
  let count = 0;
  for (let n = Number(from); n <= Number(to); n += 1) {
    if (!existing.has(`${prefix}${n}`)) count += 1;
  }
  return count;
}
