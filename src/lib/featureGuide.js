/**
 * Explore: what every page is for and when to use it, in the words a
 * hotelier would use.
 *
 * One entry per page id in the navigation (src/app/dashboard/modules.js).
 * `what` is one sentence on what the page is; `use` is the jobs someone
 * opens it for. Explore shows a reader only the pages they can open, under
 * the area each page sits in, so a page left out here is simply not listed.
 *
 * Written the way you would tell the front desk, like the release notes:
 * no code words (no "API", "sync", "grid", "module").
 */

export const FEATURE_GUIDE = {
  today: {
    what: "Your home page: what needs doing now and how the hotel is doing.",
    use: [
      "See today's arrivals, departures and rooms to clean at a glance",
      "Compare tonight with the same night last week, and the month with last year",
      "Finish the setup steps a new hotel still has left",
    ],
  },

  calendar: {
    what: "Every room down the side and every night across, with each stay drawn on it.",
    use: [
      "Click or drag across empty nights to book or hold a room",
      "Move a stay to another room or other dates by dragging it",
      "Mark a room out of order so it cannot be sold",
    ],
  },
  reservations: {
    what: "Every booking, with the desk's daily lists of arrivals, departures and guests in house.",
    use: [
      "Check guests in and out, and assign their rooms",
      "Add charges, take payments and issue the invoice",
      "Find any booking by guest name, phone or booking number",
      "Send a guest the online check-in link on WhatsApp",
    ],
  },
  guests: {
    what: "Everyone who has stayed or is booked, filled in by the bookings themselves.",
    use: [
      "Look up a returning guest and their past stays",
      "Add an ID, an ID photo, an address or a company name to a guest",
      "Top up a guest's wallet or give them a tier",
    ],
  },
  companies: {
    what: "The companies and travel agents who book for guests, and their agreed rates.",
    use: [
      "Add a company with its GSTIN so its bills are made out to it",
      "Set a contract rate for a company on chosen rooms and dates",
      "Record an agent's commission",
    ],
  },
  housekeeping: {
    what: "Every room, whether it is clean, and who is leaving or arriving to it today.",
    use: [
      "See which dirty rooms have a guest arriving, and clean those first",
      "Mark rooms clean, inspected or out of order",
    ],
  },
  nightaudit: {
    what: "The close of one business day, in the order the night desk works.",
    use: [
      "Fix what is left open: guests not checked in or out, rooms without a guest, unpaid bills",
      "See the day's rooms sold, average rate, earnings and money collected",
    ],
  },
  cashbook: {
    what: "The cash drawer and what the hotel spent.",
    use: [
      "See what the drawer should hold, and count it each shift",
      "Record expenses with a tag, cash paid into the bank or given to the owner",
      "See spending by tag for any period",
    ],
  },
  policereport: {
    what: "The guest register the police ask for, made from the bookings, with Form C for foreign guests.",
    use: [
      "Print or download the register for the police station",
      "See which guests are missing ID or address details, and fill them in",
      "Copy a foreign guest's details for Form C on the FRRO website",
    ],
  },

  cm: {
    what: "Your rates and rooms for sale on every night, sent to all your online channels.",
    use: [
      "Change a rate for one night or a whole range at once",
      "Set minimum or maximum nights",
      "Stop selling a room or a plan, on all channels or just one",
    ],
  },
  bookingengine: {
    what: "Your own booking page for your website, where guests book and pay you by UPI.",
    use: [
      "Copy your booking page link or the code for your website",
      "Add room photos and say what each plan includes and its cancellation terms",
      "Run promotions for dates or a promo code, and give money off longer stays",
    ],
  },
  pricing: {
    what: "Suggested rates for each room and night, worked out from your bookings, events and competitors.",
    use: [
      "See the rate suggested for each night and why",
      "Accept the suggestions you agree with and send them out",
      "Set your floor and ceiling rates and your own pricing rules",
      "See the busy and quiet days of the year at a glance",
    ],
  },
  compshopper: {
    what: "What the hotels around you charge on Google, night by night.",
    use: [
      "Compare your rate with your competitors' median rate for each night",
      "Choose which nearby hotels to watch",
      "Refresh one day or a week of prices when you need them",
    ],
  },
  parity: {
    what: "Your own rate on each booking site, side by side, as Google shows them.",
    use: [
      "Spot a site selling your rooms cheaper than the others",
      "Follow how your rates on the sites have moved over time",
    ],
  },
  events: {
    what: "Festivals, holidays, fairs and wedding seasons that bring guests or keep them away.",
    use: [
      "See what is coming up near your hotel in the next months",
      "Add your own event, like a local conference or a wedding at the hotel",
      "Events show on every date screen and feed the suggested rates",
    ],
  },
  workflow: {
    what: "Rules that stop selling on chosen sites by themselves when a night fills up.",
    use: [
      "Stop selling Deluxe on one site once 5 are sold, for example",
      "Keep your last rooms for direct bookings or for the sites that cost you least",
    ],
  },

  performance: {
    what: "How your bookings add up over any period, against an earlier one.",
    use: [
      "See room nights, revenue, average rate and occupancy",
      "See which channels, countries, rooms and plans your business comes from",
      "See cancellations, lead time and length of stay",
    ],
  },
  invoicing: {
    what: "Every invoice issued, what is still owed, and stays never invoiced.",
    use: [
      "Give your accountant the invoice register with tax for the GST return",
      "See which guests still owe money, and who is owed a refund",
      "Catch stays that left without an invoice",
    ],
  },
  payments: {
    what: "All money taken over a period, by method, by day and by staff member.",
    use: [
      "Match cash, card and UPI with the drawer, the card machine and the bank",
      "See voided payments and why they were voided",
    ],
  },
  cityledger: {
    what: "What companies and travel agents owe for stays billed to them.",
    use: [
      "See what is owed, overdue and coming in this week",
      "Open a company's statement of bills and payments",
      "Record a payment a company sends",
    ],
  },

  users: {
    what: "Your staff's logins and which pages each one can open.",
    use: [
      "Add a staff member and tick the pages they need",
      "Take away a page, or turn a login off",
    ],
  },
  setup: {
    what: "Your hotel's name, logo and profile, and how its screens look.",
    use: [
      "Change the hotel name, logo and profile details",
      "Turn on online check-in and choose what guests are asked",
      "Link your Google listing for competitor and booking site prices",
      "Choose occupancy colours for the date screens",
    ],
  },
  rooms: {
    what: "Your room types and the rooms of each, in the order you walk the building.",
    use: [
      "Add or rename a room type and set how many guests it takes",
      "Add room numbers and floors, and put them in order",
    ],
  },
  rateplans: {
    what: "Your rate plans, like room only or with breakfast, and the price of each room on each plan.",
    use: [
      "Add a plan and choose which rooms it is sold in",
      "Set a plan's meals, terms, minimum rate and how its rates follow another plan",
      "Set day-use plans with their time slots",
    ],
  },
  servicesetup: {
    what: "Everything you can charge a guest for, like food, laundry or an extra bed, with its tax.",
    use: [
      "Add a service and its price, grouped by category",
      "Tick the taxes each service carries",
    ],
  },
  taxsetup: {
    what: "Your tax rules, such as GST on rooms and food.",
    use: [
      "Add Indian GST on rooms in one step",
      "Try a rule on a made-up stay before any guest is charged by it",
    ],
  },
  integrations: {
    what: "The channel manager and other tools your hotel connects to.",
    use: ["Connect your channel manager so bookings come in and rates go out"],
  },
  logs: {
    what: "Every message sent to and from your channel manager.",
    use: ["Check whether a rate, a room count or a booking went through, and why not if it failed"],
  },
};
