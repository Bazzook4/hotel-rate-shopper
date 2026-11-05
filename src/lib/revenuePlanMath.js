/**
 * The Revenue Planner's sums, shared by the page and the server.
 *
 * A month's goal is occupancy, one overall ADR and the room revenue they make.
 * Any one can be changed and the others follow: occupancy or ADR gives revenue,
 * revenue (with the ADR) gives occupancy. Room nights and RevPAR come from them.
 */

/** The kinds of business a goal is split by, in the order the desk reads them. */
export const SEGMENTS = [
  { key: 'ota', label: 'OTA' },
  { key: 'direct', label: 'Direct' },
  { key: 'corporate', label: 'Corporate' },
  { key: 'agent', label: 'Travel agent' },
  { key: 'group', label: 'Group' },
];

const r2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

/** Room nights available in a month: rooms x days. */
export function nightsAvailable(rooms, days) {
  return Math.max(0, Number(rooms) || 0) * Math.max(0, Number(days) || 0);
}

/**
 * Work the goal out from what was typed. `from` is the field just changed:
 * 'occupancy' | 'adr' | 'revenue'. Returns the three, consistent.
 */
export function solveGoal({ occupancy, adr, revenue }, from, available) {
  let occ = num(occupancy);
  const rate = num(adr);
  let rev = num(revenue);
  if (!(available > 0)) return { occupancy: occ, adr: rate, revenue: rev };

  if (from === 'revenue') {
    if (rev != null && rate > 0) occ = Math.min(100, r2((rev / rate / available) * 100));
  } else if (occ != null && rate != null) {
    rev = r2((available * occ / 100) * rate);
  }
  return { occupancy: occ, adr: rate, revenue: rev };
}

/** Room nights, RevPAR and the rest that follow from a goal. */
export function derive({ occupancy, adr, revenue }, available) {
  const occ = num(occupancy);
  const rev = num(revenue);
  const nights = occ != null && available > 0 ? Math.round((available * occ) / 100) : null;
  return {
    roomNights: nights,
    revpar: rev != null && available > 0 ? r2(rev / available) : null,
    adr: num(adr),
  };
}

/**
 * The mix as room nights and revenue per kind of business. A segment with no
 * ADR of its own takes the overall one. `weightedAdr` is what the segments'
 * rates average to, to compare with the overall goal.
 */
export function splitSegments(segments, roomNights, overallAdr) {
  const list = Array.isArray(segments) ? segments : [];
  const rows = SEGMENTS.map((s) => {
    const own = list.find((x) => x.key === s.key) || {};
    const share = num(own.share) || 0;
    const adr = num(own.adr);
    const rate = adr != null ? adr : num(overallAdr);
    const nights = roomNights != null ? Math.round((roomNights * share) / 100) : null;
    return {
      key: s.key,
      label: s.label,
      share,
      adr,
      roomNights: nights,
      revenue: nights != null && rate != null ? r2(nights * rate) : null,
    };
  });
  const totalShare = r2(rows.reduce((a, s) => a + s.share, 0));
  const nights = rows.reduce((a, s) => a + (s.roomNights || 0), 0);
  const revenue = rows.reduce((a, s) => a + (s.revenue || 0), 0);
  return {
    rows,
    totalShare,
    weightedAdr: nights > 0 ? r2(revenue / nights) : null,
  };
}

/** Clean what comes from the page before it is stored. */
export function cleanSegments(input) {
  const list = Array.isArray(input) ? input : [];
  return SEGMENTS.map((s) => {
    const own = list.find((x) => x && x.key === s.key) || {};
    const share = Math.min(100, Math.max(0, num(own.share) || 0));
    const adr = num(own.adr);
    return { key: s.key, share: r2(share), adr: adr != null && adr >= 0 ? r2(adr) : null };
  }).filter((s) => s.share > 0 || s.adr != null);
}
