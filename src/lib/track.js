/**
 * What people do once a page is open, for Admin > Usage (migration 061).
 * Never who: the server adds the role, and the dashboard tells us the page,
 * the job profile and the hotel. Events wait in a short queue and go in one
 * request, every few seconds or as the tab is hidden; a lost batch only
 * means a few clicks were not counted.
 */

const FLUSH_MS = 10000;
const MAX_QUEUE = 50;

let context = { page: null, profile: "other", propertyId: null };
let queue = [];
let timer = null;
// The page open now: seconds on it so far, since when it has been in
// view, and how many clicks it has had. A hidden tab's time is not counted.
let visit = null;

const newVisit = (page) => ({ page, seconds: 0, since: Date.now(), clicks: 0 });

function flush() {
  clearTimeout(timer);
  timer = null;
  if (!queue.length) return;
  const body = JSON.stringify({ events: queue });
  queue = [];
  try {
    fetch("/api/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Not counted; nothing else changes.
  }
}

/** Counts one event on the page open now. */
export function track(kind, { target = null, value = null, clicks = null, page } = {}) {
  if (typeof window === "undefined") return;
  queue.push({
    kind,
    page: page ?? context.page,
    profile: context.profile,
    propertyId: context.propertyId,
    target: target ? String(target).slice(0, 60) : null,
    value: Number.isFinite(value) ? Math.round(value) : null,
    clicks: Number.isFinite(clicks) ? clicks : null,
  });
  if (queue.length >= MAX_QUEUE) flush();
  else if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

/** Closes the visit to the page open now: seconds on it and clicks made. */
function endVisit() {
  if (!visit) return;
  const seconds = visit.seconds + (visit.since ? (Date.now() - visit.since) / 1000 : 0);
  track("visit", { page: visit.page, value: seconds, clicks: visit.clicks });
  visit = null;
}

/** The dashboard says which page is open; a new page closes the last visit. */
export function setTrackContext({ page, profile, propertyId }) {
  if (page !== context.page) {
    endVisit();
    if (page) visit = newVisit(page);
  }
  context = { page, profile: profile || "other", propertyId: propertyId || null };
}

const CLICKABLE = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [data-track]';
// A list or table row holds a guest, a booking or an amount: a click there
// is counted by its column, never by the words in it.
const ROW = 'tbody tr, [role="row"], [role="option"], [role="listbox"] li';

function words(el) {
  return (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
}

/** What a click is counted as, or null when it is not counted at all. */
function labelOf(el) {
  if (el.dataset.track) return el.dataset.track;
  const row = el.closest(ROW);
  if (row) {
    const cell = el.closest("td");
    const table = el.closest("table");
    if (cell && table) {
      const th = table.querySelectorAll("thead th")[cell.cellIndex];
      const column = th ? words(th) : "";
      if (column) return `Row: ${column}`;
    }
    return "Row";
  }
  // Only buttons and tabs keep their words: those are the app's own. A
  // plain link or a clickable panel may show a guest's name.
  const own = el.matches('.btn, [role="tab"], [role="menuitem"], nav button, aside button');
  if (!own) return null;
  const text = words(el).replace(/\d+/g, "#").slice(0, 40);
  return text || "Icon button";
}

function onClick(e) {
  if (!visit) return;
  const el = e.target?.closest?.(CLICKABLE);
  if (!el || el.closest("[data-no-track]")) return;
  visit.clicks += 1;
  const label = labelOf(el);
  if (label) track("click", { target: label });
}

// A hidden tab pauses the visit's clock and sends what is waiting, since a
// phone may never come back to say the page was left.
function onVisibility() {
  if (!visit) return;
  if (document.visibilityState === "hidden") {
    if (visit.since) visit.seconds += (Date.now() - visit.since) / 1000;
    visit.since = null;
    flush();
  } else if (!visit.since) {
    visit.since = Date.now();
  }
}

function onLeave() {
  endVisit();
  flush();
}

/** Starts listening; returns the clean-up for the dashboard's effect. */
export function startTracking() {
  document.addEventListener("click", onClick, true);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onLeave);
  return () => {
    onLeave();
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onLeave);
  };
}
