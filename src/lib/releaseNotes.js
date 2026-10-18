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
    date: "2026-10-18",
    title: "A guest list, so returning guests are never retyped",
    points: [
      {
        page: "reservations",
        text: "When you make a booking, start typing the guest's name, phone number or email and guests who have booked before appear underneath. Pick one and their name, phone, email and country are filled in for you. The form shows how many times they have stayed, and any note you keep about them. If you picked the wrong person, click \"Not this guest\".",
      },
      {
        page: "guests",
        text: "Front desk has a new Guests page listing everyone who has booked, with how many stays, how much they have spent and their last or next visit. Add an ID, company or note to a guest, and click their number of stays to see and open their bookings. Every booking adds its guest by itself, matched on phone number or email, and bookings from the channels are added too.",
      },
    ],
  },
  {
    date: "2026-10-14",
    title: "See how full each night is, in your own colours",
    points: [
      {
        page: "setup",
        text: "Property Setup has a new Occupancy colours card. Turn it on to colour each date on the Calendar and the Rates & Inventory page by how many rooms are sold: Low, Normal, Good or High. You choose which pages show it, where each level starts and each colour. It is off until you turn it on.",
      },
      {
        page: "calendar",
        text: "With occupancy colours on, each date at the top of the Calendar shows the percentage of rooms sold and is coloured to match. Hover over a date to see the rooms sold out of rooms available.",
      },
      {
        page: "cm",
        text: "With occupancy colours on, the dates on the Rates & Inventory page show the same colours and percentage, so you can see busy nights while you set rates.",
      },
    ],
  },
  {
    date: "2026-10-14",
    title: "A calmer rates page",
    points: [
      {
        page: "cm",
        text: "The Channel Manager rates page is easier to read. A room that is not linked to its channel code is flagged once, on the room's own line, not on every rate. Each rate plan's lines are grouped together, and the note saying which plan a rate follows (such as \"↳ EP · +25%\") now sits under the plan name. Hover over a greyed rate to see how it is worked out.",
      },
      {
        page: "cm",
        text: "A rate plan's name no longer repeats its meal plan. A non-refundable EP called \"EP MIN 2\" now shows a small NR tag before its name, not \"NR EP\".",
      },
      {
        page: "cm",
        text: "On a laptop or desktop, the rates page is more compact, so three room types with two rate plans each fit on one screen. The line under your mouse is lightly tinted, so you keep your place along a row. Phones and tablets keep the bigger rows, which are easier to tap.",
      },
    ],
  },
  {
    date: "2026-10-05",
    title: "Set your own discounts and premiums",
    points: [
      {
        page: "pricing",
        text: "Dynamic Pricing settings have a new Scales & rules tab. Add your own rules, such as 10% off within 3 days of arrival, more for bookings made over 90 days ahead, or a discount on short gaps between bookings.",
      },
      {
        page: "pricing",
        text: "You can now see and change how pricing reacts to how full you are, with a table by days before arrival. It also compares this year's bookings with the same point last year. Every table starts with the numbers pricing already used, so nothing changes unless you change it.",
      },
      {
        page: "pricing",
        text: "A Try it line shows what a room would cost on any date as you change the tables, before you save.",
      },
    ],
  },
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
