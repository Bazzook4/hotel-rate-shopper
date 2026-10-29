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
    date: "2026-10-29",
    title: "Booking engine for your website",
    points: [
      {
        page: "bookingengine",
        text: "New Booking Engine page under Rates. Add your UPI ID to get a booking page link to share and a code to paste into your website. Guests see your free rooms and rates with taxes, book, and pay straight to your UPI ID by app or QR code.",
      },
      {
        page: "bookingengine",
        text: "On the same page: add room photos, say what each plan includes and its cancellation terms, hide rooms or plans from your website, run promotions for dates or a promo code, and give money off longer stays. The discount shows on the guest's bill.",
      },
      {
        page: "reservations",
        text: "Website bookings arrive as confirmed bookings and take the room off the OTAs at once. When a guest says they paid, the booking shows it and Today lists it: check your bank, then press Payment received to put it on the bill, or Not found.",
      },
      {
        page: "today",
        text: "Guests can open My booking on your booking page with their booking number and mobile number to see their booking and payment.",
      },
    ],
  },
  {
    date: "2026-10-29",
    title: "Morning report on WhatsApp",
    points: [
      {
        page: "today",
        text: "Ask us and we can send your hotel's contact a WhatsApp at 8 AM each day with today's arrivals and departures, rooms sold tonight and yesterday's revenue. Reply to it any time if you need help.",
      },
    ],
  },
  {
    date: "2026-10-28",
    title: "Channel manager only when connected",
    points: [
      {
        page: "integrations",
        text: "Rates, rooms and bookings now go to and from your channel manager only when your connection is switched on and has your own hotel code. Turning the connection off stops OTA bookings coming in too, and each refused booking is listed so you can see it.",
      },
    ],
  },
  {
    date: "2026-10-28",
    title: "Discounts on a booking",
    points: [
      {
        page: "reservations",
        text: "Give a discount from a booking's Bill: a percent or an amount, before tax (the room price drops and tax is worked out on the lower price) or after tax (taken off the final bill). Pick a reason, and every change is kept with who made it and when.",
      },
      {
        page: "invoicing",
        text: "Invoicing has a Discounts tab listing every discount given, changed or taken off, and the invoice register shows the discount on each invoice. The Night Audit lists the day's discounts too.",
      },
      {
        page: "users",
        text: "Only people with the new Give discounts right can give one. Hotel admins have it; tick it in Users & rights for the staff you trust.",
      },
    ],
  },
  {
    date: "2026-10-28",
    title: "Show me how covers setup too",
    points: [
      {
        text: "Show me how now also walks you through changing your rates, adding a rate plan or a room type, changing room numbers and adding your logo. Search \"generate\" to find Make an invoice.",
      },
    ],
  },
  {
    date: "2026-10-28",
    title: "Show me how: learn a job on the real page",
    points: [
      {
        text: "Press Show me how on the bar at the bottom of any page and pick a job, such as Check a guest in, Take a payment or Bill a company. The page opens and a small card points at what to press. Nothing is done for you, and the practice bookings are never saved. The Booking tour on Explore has moved here.",
      },
    ],
  },
  {
    date: "2026-10-28",
    title: "A practice booking for new staff, and a check on your room count",
    points: [
      {
        page: "explore",
        text: "New staff can try a practice booking that is never saved: two short tips show how to book for a company or travel agent, and how guests and their IDs are kept. It is offered on Today, and anyone can start it from the Booking tour button on Explore.",
      },
      {
        page: "rooms",
        text: "If your room types add up to fewer rooms than your hotel has, Today now says how many are missing so you can add them. A hotel that gave the wrong total at sign-up can lower it to match.",
      },
      {
        page: "rooms",
        text: "Rooms now shows your hotel's total, how many rooms your room types add up to, and how many are still to add, right above the room types.",
      },
    ],
  },
  {
    date: "2026-10-28",
    title: "Take an advance when you make a booking",
    points: [
      {
        page: "calendar",
        text: "A new booking now has an Advance received box under the total. Type what the guest paid and choose Cash, Card, UPI, Bank transfer or Other, and the payment is on the bill as soon as the booking is saved. Leave it empty if nothing was paid.",
      },
    ],
  },
  {
    date: "2026-10-28",
    title: "New booking asks how it was booked, up front",
    points: [
      {
        page: "calendar",
        text: "On a new booking, Booking method, Booking type, Status and Notes now sit on the main form instead of under More details. Choose Corporate or Travel agent and the form asks which company or travel agent it came through (optional), with an Add a company or Add a travel agent button if none is on record yet. You come back to your booking exactly as you left it.",
      },
    ],
  },
  {
    date: "2026-10-24",
    title: "Clean and dirty rooms are easier to spot",
    points: [
      {
        page: "calendar",
        text: "On the calendar, each room's clean or dirty mark now sits in its own column beside the room number, under a broom, so the marks line up in one straight line. A dirty room shows an amber box with a broom, a clean room an empty box, and an inspected room a green tick. Click the box to switch between clean and dirty, as before.",
      },
    ],
  },
  {
    date: "2026-10-24",
    title: "Bookings open from the right",
    points: [
      {
        page: "calendar",
        text: "A booking, new or existing, now slides in from the right side of the screen instead of opening in the middle. Everything inside is where it was. The calendar or list stays in view on the left, and clicking there or pressing Esc closes it as before.",
      },
      {
        page: "calendar",
        text: "Group bookings, taking a room out of order and the check-in form (room, names and IDs) open the same way. Only quick questions, like Are you sure? or choosing a room, still appear in the middle.",
      },
      {
        page: "guests",
        text: "On Guests, the Stays, ID file and Wallet buttons open the guest on the right, with a tab for each, instead of opening rows under the guest. Click a booking in Stays to open it.",
      },
      {
        page: "cityledger",
        text: "On City Ledger, clicking a company or Receive opens its bills and payments on the right, the same as the Ledger tab on Companies & agents.",
      },
    ],
  },
  {
    date: "2026-10-24",
    title: "A clearer Companies & agents page",
    points: [
      {
        page: "companies",
        text: "Companies & agents is now a list showing the business each one brought in over the last 12 months. If you can see the City Ledger, it also shows what was billed to them, what has been collected and what is still to collect, with overdue amounts in red.",
      },
      {
        page: "companies",
        text: "Add company or agent opens a short four-step panel on the right: who, contact, payment terms, then contract rates. Only the name is needed, so you can Save now and fill in the rest later. Typing a GSTIN fills in the state.",
      },
      {
        page: "companies",
        text: "Click a company to open it on the right with three tabs: Details to change it, Contract rates, and Ledger to see its bills and receive a payment.",
      },
    ],
  },
  {
    date: "2026-10-24",
    title: "Print the invoice right after check-out",
    points: [
      {
        page: "reservations",
        text: "After you check a guest out, a message at the bottom of the screen has a Print invoice button. One click issues the invoice and opens it in a new tab, ready to print, so the guest leaves with their bill. The Print button on a booking's Invoices tab opens it the same way, because printing straight from the page came out blank. If you don't need it, just ignore the message.",
      },
    ],
  },
  {
    date: "2026-10-24",
    title: "Buttons that take you straight to setup",
    points: [
      {
        page: "rateplans",
        text: "Where a page used to tell you to go to another setup page, it now has a button that takes you there. For example, Add a day-use plan when booking day use, Set up services when adding a charge to a bill, and Set up rooms on the Calendar, Housekeeping, Channel Manager and Dynamic Pricing when no rooms exist yet.",
      },
      {
        page: "calendar",
        text: "If you leave a booking to set something up, a Back to the booking button waits at the top of the setup page. A new booking comes back with everything you typed, and a bill comes back with Add service open, so nothing has to be entered twice.",
      },
      {
        page: "calendar",
        text: "Until your rooms and rate plans are set up, a short line above the Calendar and Channel Manager shows the next setup step with a Start button. It goes away once those are done.",
      },
    ],
  },
  {
    date: "2026-10-24",
    title: "Checked-in bookings open again",
    points: [
      {
        page: "calendar",
        text: "Opening a checked-in booking that still had money to pay showed \"This page could not open\". It opens normally again, with the Collect and check out button.",
      },
    ],
  },
  {
    date: "2026-10-24",
    title: "New hotels see their rooms on the front desk straight away",
    points: [
      {
        page: "rooms",
        text: "A hotel under 60 rooms that signs up through an onboarding link now has its rooms numbered for it (101, 102 for the first room type, 201, 202 for the next), so the front desk shows them from the first day. The numbers can be changed on the Rooms page.",
      },
    ],
  },
  {
    date: "2026-10-24",
    title: "Invoices say they need no signature",
    points: [
      {
        page: "reservations",
        text: "The bottom of every invoice now says it is a computer-generated invoice and does not need a signature.",
      },
    ],
  },
  {
    date: "2026-10-24",
    title: "No more blank error screen",
    points: [
      {
        text: "If the app was left open while we released a new version, opening a page could show a blank \"Application error\" screen. The app now reloads itself to the new version instead. If a page ever does break, you see a short message with a Reload button, and the menu keeps working.",
      },
    ],
  },
  {
    date: "2026-10-24",
    title: "A tidier date bar on phones",
    points: [
      {
        page: "calendar",
        text: "On a phone the bar above the Calendar now takes two rows instead of three: the date, Today and 14 | 30 days on one line, Normal | Compact on the next. Tap the date to jump further ahead. The colour key now sits behind a Key button, so the rooms start higher up.",
      },
      {
        page: "cm",
        text: "On a phone the bar above Rates now takes two rows instead of four: search sits beside Rates | Min | Max | Stop sell.",
      },
    ],
  },
  {
    date: "2026-10-24",
    title: "The day changes at your night audit time",
    points: [
      {
        page: "setup",
        text: "Today no longer turns over at midnight. Until 2:30 AM the Calendar, Today, the night audit and payments still count as the day before, so a walk-in at 1 AM is tonight's stay and a payment at 1 AM is on that day's audit. Change the time under Day changes at in Property Setup.",
      },
    ],
  },
  {
    date: "2026-10-24",
    title: "Your hotel's own time zone and currency",
    points: [
      {
        page: "setup",
        text: "Property Setup now asks for your hotel's time zone, and new hotels choose it when they sign up. Today, the Calendar, the night audit, reports and every time on screen follow your hotel's clock, wherever you open the app from. Hotels already using the app are set to India time.",
      },
      {
        page: "setup",
        text: "Property Setup also shows the currency your hotel sells in, filled in from your country. New bookings, bills, reports and competitor prices are all shown in it. Hotels already using the app stay in rupees.",
      },
      {
        page: "taxsetup",
        text: "New hotels in India start with GST on rooms already added. Hotels in other countries start with no tax and add their own on the Taxes page.",
      },
    ],
  },
  {
    date: "2026-10-23",
    title: "Calendar shows the right date on each day",
    points: [
      {
        page: "calendar",
        text: "The date number at the top of each day on the Calendar was one day behind (Friday 23 showed as 22), and the weekend shading sat on Friday and Saturday. Each day now shows its own date, and Saturday and Sunday are shaded. Bookings were always on the right nights.",
      },
    ],
  },
  {
    date: "2026-10-23",
    title: "Invoices show your logo, laid out in tables",
    points: [
      {
        page: "reservations",
        text: "Invoices now carry your hotel logo at the top. The invoice number, who it is billed to and the stay sit side by side in one box, and the charges, totals and payments are each in a ruled table that is easy to read and check. Add or change the logo in Property Setup.",
      },
    ],
  },
  {
    date: "2026-10-23",
    title: "Explore: every feature and where to find it",
    points: [
      {
        page: "explore",
        text: "What's new is now Explore, under Home. It lists every page you can open, what it is for and what you can do there, with a button to open it. Type what you want to do, like invoice or stop sell, to find the right page. What's new is still there as its second tab.",
      },
    ],
  },
  {
    date: "2026-10-23",
    title: "Sign-up asks for prices, step by step",
    points: [
      {
        page: "rateplans",
        text: "New hotels now sign up in six steps: hotel details, contact details, room types, rate plans, a price for each room on each plan, then email and password. Rooms, plans and prices are all ready on first sign-in.",
      },
      {
        page: "today",
        text: "Finish setup on the Today page now lists only the steps every hotel needs. Connecting a channel manager and linking your Google listing are no longer on the list; you can still do both whenever you want.",
      },
      {
        page: "today",
        text: "The bar along the bottom now also has Feedback / Feature request, which opens a WhatsApp chat with us so you can tell us what to improve or add.",
      },
    ],
  },
  {
    date: "2026-10-23",
    title: "Send us feedback or ask for a feature",
    points: [
      {
        page: "today",
        text: "The bar along the bottom of every page now also has Feedback / Feature request. It opens a WhatsApp chat with us, your hotel's name already written, so you can tell us what to improve or add.",
      },
    ],
  },
  {
    date: "2026-10-23",
    title: "Ask us for help on WhatsApp",
    points: [
      {
        page: "today",
        text: "A bar along the bottom of every page has Help via WhatsApp, which opens a chat with our support team with your hotel's name already written in the message.",
      },
    ],
  },
  {
    date: "2026-10-23",
    title: "Guests on a booking match its adults and children",
    points: [
      {
        page: "reservations",
        text: "The Guests tab on a booking now lets you name one guest per adult and child on it. When everyone is named, Add guest turns off; raise the adults or children on the booking to add someone else.",
      },
    ],
  },
  {
    date: "2026-10-23",
    title: "Invoices get their own tab, with a preview",
    points: [
      {
        page: "reservations",
        text: "Invoices now have their own tab on the booking, next to Bill. One press of Issue invoice issues the whole bill and shows it on the page to check, instead of downloading it; press Split the bill to put charges on separate invoices. Each invoice has Print, Share (on a phone, send the PDF straight to WhatsApp or email) and Void. The tab shows how many invoices there are and what is still to issue, and the Bill tab tells you when the invoice is still to be issued.",
      },
    ],
  },
  {
    date: "2026-10-23",
    title: "Change your password, and who booked vs who stays",
    points: [
      {
        page: "rateplans",
        text: "New hotels now list their room types (name, how many rooms, how many adults) and tick what they sell (Room Only, Room with Breakfast, Breakfast and One Meal, All Meals) while signing up. The rooms and rate plans are ready on first sign-in; only the prices are left to fill in on Rates & Inventory.",
      },
      {
        page: "reservations",
        text: "Two guests sharing a room can each have their own bill. Name both on the Guests tab, then on the Bill tab press Give each guest their own bill. The room is shared evenly (type a percent to change it), and each guest's invoice can go to their own company with its GSTIN. Each guest's row has its own Service, Collect and Invoice buttons, so nothing lands on the wrong bill. One invoice per guest issues both in one go, and each company's account on City Ledger shows only its own guest's bill.",
      },
      {
        page: "reservations",
        text: "Split a bill over more than one invoice. Open the booking, go to Bill, and press Issue invoice. Everything is ticked; untick the food (or any charge) and issue, and the room goes on that invoice with only its own tax. Or press One invoice per category to issue the room and the food as two invoices in one go. Until every charge is invoiced, the Bill tab tells you what is left. A charge already on an invoice cannot go on another one until you void it.",
      },
      {
        page: "reservations",
        text: "Booking for someone else? Tick Booked by someone else on the booking and type who booked. The guest name stays the person staying. The booker is kept on the booking only and is not added to your guest list.",
      },
      {
        page: "reservations",
        text: "The guest you make a booking for now appears on that booking's Guests tab straight away, so you do not type them twice. Everyone you add there, or at the check-in popup, is saved to your guest list with their ID details, ready for their next stay.",
      },
      {
        page: "guests",
        text: "Upload a guest's photo ID yourself: open the booking, go to Guests, and click Photo ID next to their name. Take a photo or upload a file, just like the online check-in link. The check-in popup also has an Add button on each guest line, so you can photograph the ID while checking them in.",
      },
      {
        text: "New Account button at the top of every page, with Change password and Sign out. Type your current password and the new one twice to change it.",
      },
      {
        page: "users",
        text: "Staff forgot their password? On Users & rights, click Password next to their name and give them a new one. Forgot your own? The sign-in page now says to ask your hotel admin.",
      },
    ],
  },
  {
    date: "2026-10-22",
    title: "Cash book, police report and Form C",
    points: [
      {
        page: "cashbook",
        text: "New Cash & Expenses page under Front desk. It shows how much cash should be in the drawer. Count the cash at each shift change and it tells you at once if the drawer is short or over.",
      },
      {
        page: "cashbook",
        text: "Record every expense with a tag (groceries, laundry, repairs, salary) and see what the money went on, by tag, for any dates. Cash paid into the bank, given to the owner or added to the drawer goes on the same list. A saved line can only be voided, with a reason, never changed.",
      },
      {
        page: "policereport",
        text: "New Police & Form C page under Front desk: every guest who checked in, with their ID, address and nationality, ready to print or download for the police station. Anything missing is marked, and one click opens the booking to fill it in.",
      },
      {
        page: "policereport",
        text: "Hotels with foreign guests get a Form C tab on the same page. It shows when each form is due, within 24 hours of check-in, with Copy buttons for the passport and visa details you already have, and you mark it filed with the FRRO number. Today warns you when one is due.",
      },
      {
        page: "reservations",
        text: "Checking a guest in now asks for each adult's ID type and number in the same window as the room. You can leave it blank and add it later. If everyone's ID is already in, nothing extra is asked.",
      },
      {
        page: "reservations",
        text: "Each guest on a booking's Guests tab now has nationality, ID type, ID number, date of birth and address. Online check-in fills these in when you accept it.",
      },
    ],
  },
  {
    date: "2026-10-22",
    title: "Every button now looks like a button",
    points: [
      {
        page: "reservations",
        text: "Buttons that used to look like plain text, such as Cancel, Night rates, Edit and Add guest, now have an outline on every page, so it is clear what you can click.",
      },
      {
        page: "reservations",
        text: "Close and remove buttons show a proper close mark, and the close button on a booking stands out on the green bar.",
      },
      {
        page: "reservations",
        text: "Online check-in on the Guests tab shows its status as plain text beside the heading, so it is no longer mistaken for a button.",
      },
    ],
  },
  {
    date: "2026-10-22",
    title: "Everything about a booking at a glance",
    points: [
      {
        page: "reservations",
        text: "The top of a booking now shows Status, Stay, Room and Balance in a small table, like every other list, so they no longer look like buttons. Stay gives the dates, nights and guests without opening Details.",
      },
      {
        page: "reservations",
        text: "Under it, one row of buttons: the next step (Check in, Check out), Take payment and Send on WhatsApp. No show and Cancel booking are under More.",
      },
      {
        page: "reservations",
        text: "A room waiting to be cleaned shows as dirty in amber, and one click marks it clean. Check in still works on a dirty room: it asks first, then marks the room clean.",
      },
      {
        page: "reservations",
        text: "When money is owed, a Take payment button sits beside Check in. A booking that arrives later says when check-in opens.",
      },
    ],
  },
  {
    date: "2026-10-22",
    title: "A simpler bill on every booking",
    points: [
      {
        page: "reservations",
        text: "The Bill tab on a booking now reads like the printed bill: the room, each service, taxes, the total, what was paid and what is still owed, each shown once.",
      },
      {
        page: "reservations",
        text: "Add service, Collect payment and Issue invoice are now buttons at the top of the bill. Each opens a short form on the side.",
      },
      {
        page: "reservations",
        text: "Collect payment always starts with the amount owed. Pick Cash, UPI, Card or another method with one tap. Refunds have their own button, so there is no minus sign to type.",
      },
      {
        page: "reservations",
        text: "Issue invoice shows the bill first, then issues and downloads the PDF in one step. To change what a night costs, use Night rates on the room line.",
      },
    ],
  },
  {
    date: "2026-10-22",
    title: "Walk-ins get a room, and dirty rooms no longer block check-in",
    points: [
      {
        page: "today",
        text: "A walk-in now starts with a free clean room already picked. Change it if the guest wants another, then press Save and check in.",
      },
      {
        page: "today",
        text: "A room still marked dirty no longer stops a check-in. If the room is ready, choose Check in and mark clean. Housekeeping shows who marked it clean.",
      },
      {
        page: "today",
        text: "The Collect button now shows how much the guest owes, a refund when they paid too much, Company bill when a company pays, or Paid. Arrivals and departures are now at the top of Today.",
      },
      {
        page: "calendar",
        text: "The Calendar and Reservations pages now have the Walk-in button too.",
      },
      {
        page: "reservations",
        text: "When you pick a room for a new booking, the list shows which rooms are taken on those dates and which are dirty.",
      },
    ],
  },
  {
    date: "2026-10-22",
    title: "Fewer clicks at the front desk",
    points: [
      {
        page: "today",
        text: "What moved: front desk staff now open on Today instead of the Calendar. Today lists who is arriving and leaving, with Check in and Check out next to each guest. The Calendar is still one click away in the menu, and you can pin it as your start page if you prefer.",
      },
      {
        page: "today",
        text: "New Walk-in button at the top of Today. It opens a booking for tonight, already marked as a walk-in. Fill in the guest and press Save and check in to book and check in together.",
      },
      {
        page: "today",
        text: "Each guest on Today now has a Collect button, which goes straight to taking a payment.",
      },
      {
        page: "reservations",
        text: "Any new booking that arrives today has a Save and check in button, so you no longer have to find the guest again to check them in.",
      },
    ],
  },
  {
    date: "2026-10-22",
    title: "Tidier menus, lists and calendars",
    points: [
      {
        page: "calendar",
        text: "The menu that opens when you click empty nights or a booking on the Calendar is cleaner and easier to read, and matches the other menus in the app.",
      },
      {
        page: "calendar",
        text: "Every date box in the app now opens the same new calendar. Weeks start on Monday, today is ringed and the chosen day is filled. Click the month name to jump to another month or year. You can also type a date, such as 21/10/2026 or 21 Oct, or use the arrow keys and Enter.",
      },
      {
        page: "reservations",
        text: "Every list you pick from, on every page, now opens in the same style as the rest of the app. Long lists, such as countries or services, have a search box at the top: start typing to find what you need.",
      },
      {
        page: "reservations",
        text: "On a phone, tapping a date opens the calendar without the keyboard getting in the way, and long lists stay open until you pick.",
      },
    ],
  },
  {
    date: "2026-10-22",
    title: "Rates are set in Rate Plans, with a step by step start",
    points: [
      {
        page: "rooms",
        text: "The Rooms page no longer asks for a price. Rooms only say how many you have and how many adults they take. Every rate is now entered in Rate Plans.",
      },
      {
        page: "rateplans",
        text: "Adding a rate plan now takes you through it: first the plan, then the rate for each room, then sending those rates to your channels for the next year. You can stop after any step and finish later. The first plan you add becomes your main plan.",
      },
      {
        page: "rateplans",
        text: "The rate plan form is shorter and fits on one screen. Pricing details now comes before Restrictions, the four restriction boxes sit on one line, \"Enter rates\" or \"Based on a plan\" is one switch, and Minimum rate shows with the based-on settings it applies to. Press Enter to save.",
      },
    ],
  },
  {
    date: "2026-10-22",
    title: "Room count set at sign-up",
    points: [
      {
        page: "setup",
        text: "New hotels now give their total number of rooms when they sign up, and are no longer asked what kind of property they are. Room Setup and Room numbers show how many of those rooms are used, and will not let you add more than the total. If your hotel has more rooms than that, ask Online Hotelier support to raise it. The kind of property is still under Property Setup if you want to add it.",
      },
    ],
  },
  {
    date: "2026-10-21",
    title: "Plainer text across the app",
    points: [
      {
        text: "Every page now uses plain punctuation. Dates read \"12 Oct to 14 Oct\", menu paths read \"Setup > Rooms\", an empty cell shows \"-\", and short facts are split by commas, such as \"2 nights, Deluxe\". Close, tick, star and move up or down buttons now show small drawn icons that look the same on every phone and computer. Nothing works differently.",
      },
    ],
  },
  {
    date: "2026-10-21",
    title: "Your hotel's name and logo on the guest's check-in page",
    points: [
      {
        page: "setup",
        text: "Property Setup has a new Hotel name & logo card at the top. Upload your logo (PNG, JPG or WebP) and check the hotel name: guests now see both at the top of their online check-in page. The name is the same one printed on your invoices, so change it here if it is not how guests know you.",
      },
    ],
  },
  {
    date: "2026-10-21",
    title: "Online check-in: guests send their details and ID before they arrive",
    points: [
      {
        page: "reservations",
        text: "Open a booking and go to Guests: under Online check-in, press Send on WhatsApp or Copy link to send the guest their own check-in link. On their phone they fill in their name, phone, address and ID, take a photo of the ID, and press Send to hotel. Foreign guests are asked for their passport and visa details. Each adult on the booking fills in their own part. The booking then shows \"Details in, review and accept\": look over the details beside the ID photos and press Accept into guest records, and they are saved on the guest's record with their ID. Today's arrivals and the Reservations list show where each guest's online check-in stands, and the booking confirmation on WhatsApp now carries the link too.",
      },
      {
        page: "setup",
        text: "Property Setup has a new Online check-in card: turn it off, ask for ID from every adult or only the main guest, and choose whether a photo of the ID, the address, and passport and visa details from foreign guests are required. Links that were never accepted are deleted with their ID photos a day after the stay ends.",
      },
    ],
  },
  {
    date: "2026-10-18",
    title: "A booking you are typing is no longer lost by accident",
    points: [
      {
        page: "calendar",
        text: "Pressing Escape or clicking the close button on a new booking, an edited booking or a group booking now asks \"Discard this booking?\" if you have typed anything, so one key no longer throws it away. Choose Keep editing to carry on; a form you have not touched still closes straight away. A click outside the window no longer closes it while you have unsaved changes, and Escape now closes only the top thing on screen: the guest suggestions, a question box, or the check-out payment box, without closing the booking behind it. Moving from Details to the Guests or Bill tab with unsaved changes asks too.",
      },
    ],
  },
  {
    date: "2026-10-18",
    title: "Adults are picked from a list",
    points: [
      {
        page: "reservations",
        text: "In the booking form and in group bookings, Adults is now a list that only goes up to the most adults the room type takes, so a room can no longer be booked for more guests than it holds. Change to a smaller room type and the adults come down to fit. A booking that already has more adults than its room takes, for example one that came from a channel, keeps its number until you change it.",
      },
    ],
  },
  {
    date: "2026-10-18",
    title: "Keep a copy of a guest's ID",
    points: [
      {
        page: "guests",
        text: "On the Guests page you can now keep a photo of a guest's ID. Click Add in the ID file column, then Upload a photo or PDF, or Take photo to use a phone or tablet camera. Add the front and back if the ID has both. Click a picture to see it full size. ID copies are private: only people who can open the Guests page can see them, and they are deleted with the guest.",
      },
    ],
  },
  {
    date: "2026-10-18",
    title: "A guest list, and companies and travel agents with contract rates",
    points: [
      {
        page: "reservations",
        text: "You can now take day-use bookings: a room for a few hours on one day. In the booking form, set Stay to \"Day use (hours)\", pick the date, the day-use plan (for example Day Use 6h) and a start time, and the price is filled in from that plan. Start times are offered every half hour from 6:00 AM, shown with their end time (10:00 AM to 1:00 PM); times another day-use guest already has in that room are greyed out, and the first free time is picked for you. Two day uses can share a room one after the other, but not at the same time. Once you check the guest in, the hours run from check-in and the booking shows when they are due out. The room is taken off sale on the channels for that date when the day use is booked, and goes back on sale as soon as you check the guest out, so you can still sell it for the night.",
      },
      {
        page: "calendar",
        text: "On the Calendar, click a single empty day in a room and choose \"Day use (hours)\" to book it. Day-use bookings show inside their day with their start time and the guest's name (for example \"10a Sharma\"); several in one room sit side by side in time order. Point at one to see its full times. The rooms-sold count above each room type now includes day uses.",
      },
      {
        page: "rateplans",
        text: "Day use is set up as rate plans. In Rate Plan Setup, add a plan, set Sells to \"Day use (hours)\" and enter the hours, for example one plan for 3 hours and one for 6. Assign room types and set its rates in Rates & Inventory like any other plan, or base them on another plan (for example 50% of your room-only rate). Map the plan under Integrations, and day-use bookings from your channels arrive as day use by themselves.",
      },
      {
        page: "reservations",
        text: "When you make a booking, type the guest's name and press Search (or Enter) to find them among past bookings. Guests who match the name, phone number or email you type also appear underneath as you go. Pick one and their name, phone, email and country are filled in for you. The form shows how many times they have stayed, and any note you keep about them. If you picked the wrong person, click \"Not this guest\".",
      },
      {
        page: "guests",
        text: "Front desk has a new Guests page listing everyone who has booked, with how many stays, how much they have spent and their last or next visit. Add an ID, company or note to a guest, and click their number of stays to see and open their bookings. Every booking adds its guest by itself, matched on phone number or email, and bookings from the channels are added too.",
      },
      {
        page: "companies",
        text: "Front desk has a new Companies & agents page. Add each company or travel agent with its GSTIN, billing address and contact, and a commission % for agents. Click \"Add rates\" on a row to enter its contract rates: a fixed price per room type and meal plan, for 1 or 2 adults plus extra adult and child, over dates you choose. Pick weekdays or months to set a weekend or season rate on top; the most specific rate wins.",
      },
      {
        page: "reservations",
        text: "On a booking, choose the company or agent under Company / agent. The price is then quoted at their contract rate, and the form warns you if any night has no contract rate. Choose Bill to: Company and the invoice is addressed to the company with its GSTIN, naming the guest who stayed. For an agent, the commission is shown under the total.",
      },
      {
        page: "cityledger",
        text: "Reports has a new City Ledger page for bookings billed to a company or travel agent. It shows how much is owed to you, how much is overdue, and what is due in the next 7 and 30 days, then each company with its bills split by how late they are. Click a company to see its statement, and press Receive payment to record money it sent (with bonus credit if you give any). It goes into the company's wallet and pays the oldest bills first (you can change the split); anything left stays in the wallet for the next bills. Set each company's credit days and credit limit on the Companies & agents page.",
      },
      {
        page: "guests",
        text: "Guests can now have a wallet. On the Guests page, click a guest's Wallet and press Add money: any amount, or on a wallet plan such as \"pay ₹10,000, get ₹11,000\". Set up your plans with the Wallet plans button. The wallet shows everything added and every bill it paid.",
      },
      {
        page: "guests",
        text: "Give guests a tier: Silver, Gold, VIP or your own names and colours. Set them up with the Tiers button on the Guests page, then pick a guest's tier in the Tier column. The tier shows as a badge on the booking form when that guest books.",
      },
      {
        page: "reservations",
        text: "On a booking's Bill, use Pay from wallet to pay the room and services from the guest's wallet, or from the wallet of the company or agent on the booking. Voiding that payment puts the money back in the wallet.",
      },
      {
        page: "payments",
        text: "The Payments report counts money paid into wallets on the day it is paid. Bills paid from a wallet are listed as \"Paid from wallet\" but not counted again, so your cash-up stays right.",
      },
      {
        page: "taxsetup",
        text: "Enter your hotel's own GSTIN at the bottom of Tax Setup. It is printed on every invoice, which companies need to claim GST back.",
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
        text: "The Channel Manager rates page is easier to read. A room that is not linked to its channel code is flagged once, on the room's own line, not on every rate. Each rate plan's lines are grouped together, and the note saying which plan a rate follows (such as \"↳ EP, +25%\") now sits under the plan name. Hover over a greyed rate to see how it is worked out.",
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
