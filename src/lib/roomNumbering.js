/**
 * Auto-numbering rooms for a small property that has room types but no doors.
 *
 * Each room type, in its Room Setup order, gets its own hundred: the first
 * type 101, 102…, the second 201, 202…. The prefix is the first letter of the
 * type's first and last words, so "Super Standard Room" numbers SR101, SR102.
 * The hundred, not the prefix, keeps types apart -- "Standard" and "Suite"
 * are S101 and S201.
 *
 * Pure, so the page can preview exactly what the server will create.
 */

/** Only properties smaller than this are numbered automatically. */
export const AUTO_NUMBER_MAX_ROOMS = 60;

/** One hundred per type, 101 to 999. */
const MAX_TYPES = 9;

export function roomNumberPrefix(name) {
  const words = String(name || "")
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/gi, ""))
    .filter(Boolean);
  if (words.length === 0) return "";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return `${first}${last}`.toUpperCase();
}

/**
 * What auto-numbering would create.
 *
 * `roomTypes` must be in Room Setup order. A type's hundred comes from its
 * position among all types, not just the ones being numbered, so numbering a
 * type added later does not shift the numbers of the ones before it. Types
 * that already have rooms are left alone.
 *
 * Returns `{ total, allowed, plan, skipped }`; `plan` holds one
 * `{ room_type_id, name, prefix, from, to }` per type to number.
 */
export function planAutoNumbering(roomTypes, rooms) {
  const total = roomTypes.reduce((sum, rt) => sum + (Number(rt.number_of_rooms) || 0), 0);
  const numbered = new Set(rooms.map((r) => r.room_type_id));
  const plan = [];
  const skipped = [];

  roomTypes.forEach((rt, i) => {
    const count = Number(rt.number_of_rooms) || 0;
    const name = rt.room_type_name;
    if (numbered.has(rt.id) || count === 0) return;
    if (i >= MAX_TYPES) {
      skipped.push(`${name} (only ${MAX_TYPES} room types can be numbered this way)`);
      return;
    }
    const from = (i + 1) * 100 + 1;
    plan.push({ room_type_id: rt.id, name, prefix: roomNumberPrefix(name), from, to: from + count - 1 });
  });

  return { total, allowed: total < AUTO_NUMBER_MAX_ROOMS, plan, skipped };
}
