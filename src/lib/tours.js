/**
 * Show me how: short tours of the desk's everyday jobs, named the way the
 * desk would ask ("Take a payment"), not by page.
 *
 * A tour opens its page (with `view`, the list it starts on) and walks a few
 * tips, each pointing at something on screen:
 *   "tour:name"  an element marked data-tour="name"
 *   "text:Label" a button, tab or heading whose words are Label (exact,
 *                else starts with); "exact:Label" only exact
 * The first match on screen wins. `waitFor` moves on by itself once that
 * appears, so a tip that says "open a booking" follows the desk's click.
 * `none` is said instead when there is nothing to point at, like a day
 * with no arrivals.
 *
 * Tours point and explain; the desk does the job for real. Only the
 * `practice` tours run on a practice booking that is never saved.
 *
 * Words for the search sit in `words`, so "money" finds Take a payment.
 */

export const TOURS = [
  {
    id: "book",
    title: "Book a room or walk-in",
    words: "new booking reservation walk-in walkin reserve",
    page: "calendar",
    practice: true,
    steps: [
      {
        title: "Company or travel agent",
        text: "Pick the dates and a room; the price fills in. For a company or agent, set Booking method.",
        point: ["tour:company", "tour:method"],
      },
      {
        title: "Guest and ID",
        text: "Guests are saved by phone number and come up next time. The ID photo is added at check-in.",
        point: ["tour:phone"],
      },
    ],
  },
  {
    id: "checkin",
    title: "Check a guest in",
    words: "arrival arrive check-in room key id",
    page: "reservations",
    view: "arrivals",
    steps: [
      {
        text: "Press Check in on the guest's row. You are asked for a room and the ID.",
        point: ["text:Check in"],
        none: "Each arriving guest's row has a Check in button. A dirty room is marked clean first.",
      },
    ],
  },
  {
    id: "checkout",
    title: "Check a guest out",
    words: "departure leave check-out bill settle",
    page: "reservations",
    view: "departures",
    steps: [
      {
        text: "Press Check out on the guest's row. Anything still owed is asked for.",
        point: ["text:Check out"],
        none: "Each leaving guest's row has a Check out button.",
      },
    ],
  },
  {
    id: "payment",
    title: "Take a payment",
    words: "money cash card upi advance collect receipt refund",
    page: "reservations",
    view: "current",
    steps: [
      {
        text: "Press Edit on the guest's row to open their booking.",
        point: ["text:Edit"],
        waitFor: "exact:Bill",
        none: "Open the guest's booking with Edit on their row.",
      },
      {
        text: "Open the Bill tab.",
        point: ["exact:Bill"],
        waitFor: "text:Collect payment",
      },
      {
        text: "Press Collect payment, then type the amount and how they paid.",
        point: ["text:Collect payment", "text:Give a refund"],
      },
    ],
  },
  {
    id: "invoice",
    title: "Make an invoice",
    words: "invoice generate create bill gst tax print receipt",
    page: "reservations",
    view: "current",
    steps: [
      {
        text: "Press Edit on the guest's row to open their booking.",
        point: ["text:Edit"],
        waitFor: "text:Invoices",
        none: "Open the guest's booking with Edit on their row.",
      },
      {
        text: "Open the Invoices tab.",
        point: ["text:Invoices"],
        waitFor: "text:Issue invoice",
      },
      {
        text: "Press Issue invoice. A stay billed to a company carries its GSTIN.",
        point: ["text:Issue invoice", "text:Invoice the rest"],
      },
    ],
  },
  {
    id: "billcompany",
    title: "Bill a company",
    words: "corporate company gstin bill to agent travel agent",
    page: "calendar",
    practice: true,
    steps: [
      {
        title: "Booked through a company",
        text: "Set Booking method to Corporate, then pick the company, or add a new one.",
        point: ["tour:company", "tour:method"],
      },
      {
        title: "Who pays",
        text: "Set Bill to Company. The invoice is made out to the company with its GSTIN.",
        point: ["tour:billto", "tour:company", "tour:method"],
      },
    ],
  },
  {
    id: "addcompany",
    title: "Add a company or travel agent",
    words: "company agent corporate contract rate commission gstin",
    page: "companies",
    steps: [
      {
        text: "Press Add company or agent. Only the name is needed.",
        point: ["text:Add company or agent"],
      },
    ],
  },
  {
    id: "moveroom",
    title: "Move a guest to another room",
    words: "move change room shift extend dates drag",
    page: "calendar",
    steps: [
      {
        text: "Drag a stay to another room, or sideways to change dates. Drag an end for more nights.",
        point: ["tour:stay"],
        none: "Drag a stay on the calendar to another room, or sideways to change dates.",
      },
    ],
  },
  {
    id: "clean",
    title: "Mark rooms clean",
    words: "housekeeping dirty clean inspected room ready",
    page: "housekeeping",
    steps: [
      {
        text: "Press Mark clean once a room is ready. Rooms with a guest arriving come first.",
        point: ["tour:markclean"],
        none: "Each dirty room has a Mark clean button. Rooms with a guest arriving come first.",
      },
    ],
  },
  {
    id: "nightaudit",
    title: "Close the day (night audit)",
    words: "night audit end of day close day report",
    page: "nightaudit",
    steps: [
      {
        text: "Fix what is open first: guests not checked in or out, unpaid bills, guests without a room.",
        point: ["text:Before closing the day"],
      },
      {
        text: "Below are the day's rooms, earnings and money collected, for the owner.",
        point: ["text:Revenue posted"],
      },
    ],
  },
  // Setup and changes, for whoever looks after the hotel's setup.
  {
    id: "rates",
    title: "Change the rates",
    words: "rate price tariff change update publish channel ota bulk",
    page: "cm",
    steps: [
      {
        text: "Type the new rate in a date's cell. For many dates at once, use Bulk update.",
        point: ["text:Bulk update"],
      },
      {
        text: "Press Publish. The new rates go to your channels.",
        point: ["text:Publish"],
      },
    ],
  },
  {
    id: "rateplan",
    title: "Add a rate plan",
    words: "rate plan meal plan breakfast room only package new plan",
    page: "rateplans",
    steps: [
      {
        text: "Press Add rate plan. Name it, pick the meal plan, then the rooms it is sold in and their prices.",
        point: ["text:Add rate plan"],
      },
    ],
  },
  {
    id: "roomtype",
    title: "Add a room type",
    words: "room type category deluxe suite new room inventory",
    page: "rooms",
    steps: [
      {
        text: "Press Add room type, type its name and how many rooms, then Save. Its price is set in Rate Plan Setup.",
        point: ["text:Add room type"],
      },
    ],
  },
  {
    id: "roomnumbers",
    title: "Change the room numbers",
    words: "room number renumber floor rename add room range",
    page: "rooms",
    steps: [
      {
        text: "Type over a room's number, then Save. Add more with Add room or Add a range.",
        point: ["text:Room numbers"],
      },
    ],
  },
  {
    id: "logo",
    title: "Add your logo",
    words: "logo brand picture image hotel name invoice",
    page: "setup",
    steps: [
      {
        text: "Press Upload logo and pick a PNG, JPG or WebP picture. It shows on invoices and the guest check-in page.",
        point: ["text:Upload logo", "text:Change logo"],
      },
    ],
  },
];

/** Tours whose words or title hold every word typed, in any order. */
export function findTours(tours, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return tours;
  return tours.filter((t) => {
    const hay = `${t.title} ${t.words}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
