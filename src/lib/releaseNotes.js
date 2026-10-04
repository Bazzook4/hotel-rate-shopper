/**
 * What's new, in the words a hotelier would use.
 *
 * One entry per release that a hotel would notice, newest first. Add an
 * entry with every push to main that changes what someone sees or does;
 * leave out fixes nobody would notice and anything only the software team
 * touches. Each point names the page it is about, so a reader is only told
 * about pages they can open, and can go straight there.
 *
 * Write it the way you would tell the front desk: what they can now do, and
 * where. No code words (no "API", "migration", "sync", "grid", "component").
 */

export const RELEASE_NOTES = [
  {
    date: "2026-10-04",
    title: "A tidier menu, and help with tonight's price",
    points: [
      {
        page: "pricing",
        text: "Dynamic Pricing now shows the whole coming year as small squares, one per day. Darker means busier, worked out from your own bookings and last year. Tap a day to price that week.",
      },
      {
        text: "The menu now has four groups: Front desk, Rates, Reports and Setup. Every page is still there; the search at the top finds any of them.",
      },
      {
        page: "nightaudit",
        text: "Night Audit is now a checklist. Each problem has a button beside it to fix it there and then, such as check out, collect payment or mark a room clean.",
      },
      {
        page: "cm",
        text: "Rates & Inventory shows your main competitor's price above each date, and a suggested rate you can accept, change or skip.",
      },
      {
        page: "events",
        text: "Holidays and local events now show on every date page, so you can see busy days coming. India's national holidays are already added.",
      },
      {
        page: "pricing",
        text: "Dynamic Pricing is quicker to set up: answer two questions and it works the rest out from your own bookings.",
      },
      {
        page: "housekeeping",
        text: "Housekeeping shows each room with a colour, an icon and a plain word (Clean, Dirty), with big buttons that are easy to tap on a phone.",
      },
      {
        page: "reservations",
        text: "A booking now opens in three tabs: Details, Guests and Bill. The balance is always on top, and you can send the booking to the guest on WhatsApp.",
      },
      {
        page: "today",
        text: "Check guests in and out straight from Today, and settle the bill as they leave.",
      },
      {
        text: "Pages reopen where you left them, and you can pick your own start page with the house icon next to any page in the menu.",
      },
    ],
  },
  {
    date: "2026-10-03",
    title: "Calendar is easier to read",
    points: [
      {
        page: "calendar",
        text: "A small dot beside each room number shows whether it is clean or dirty.",
      },
      {
        page: "calendar",
        text: "Confirmed bookings are blue, so they never look like a guest who has already checked in.",
      },
      {
        page: "calendar",
        text: "You can no longer check a guest into a dirty room by mistake.",
      },
      {
        page: "compshopper",
        text: "Competitor Shopper can refresh a single date, so you can check one night's prices in about a minute instead of waiting for the whole week.",
      },
    ],
  },
  {
    date: "2026-10-02",
    title: "Stop sell on chosen channels, and a home page",
    points: [
      {
        page: "workflow",
        text: "Workflow can stop selling on chosen channels when a night is nearly full, and open them again when rooms free up.",
      },
      {
        page: "cm",
        text: "Stop sell can be set for one rate plan, or on chosen channels only, instead of the whole room.",
      },
      {
        page: "integrations",
        text: "Integrations lists every channel connected to your hotel.",
      },
      {
        page: "today",
        text: "A new Today page shows what needs you now: arrivals, departures, rooms to clean and how the month is going.",
      },
      {
        text: "Press Ctrl+K (Cmd+K on a Mac) to jump to any page or find a booking by guest name.",
      },
      {
        page: "rooms",
        text: "Small properties can number their rooms automatically.",
      },
    ],
  },
  {
    date: "2026-10-01",
    title: "Change rates for many dates at once",
    points: [
      {
        page: "cm",
        text: "Rates & Inventory has a bulk update: change the rate, minimum stay or stop sell across a range of dates in one go.",
      },
      {
        page: "cm",
        text: "Rates & Inventory now follows the property chosen at the top of the screen.",
      },
    ],
  },
];

/** The newest note's date, which is what "seen" is measured against. */
export const LATEST_NOTE = RELEASE_NOTES[0]?.date || "";
