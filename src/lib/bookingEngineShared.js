/**
 * Booking engine (migration 066): what the guest's booking page, the desk and
 * the hotel's settings all need to agree on. No server imports, so the
 * browser can load it too.
 */

export const DEFAULT_BOOKING_PREFS = {
  enabled: false,
  // The hotel's own UPI ID, as it is written in its UPI app: name@bank.
  upiId: "",
  // The name the guest's UPI app shows before they pay, so they can see the
  // money is going to the hotel.
  payeeName: "",
  // Lets a guest book now and pay when they arrive.
  payAtHotel: false,
  // A line the hotel wants every guest to read before booking.
  note: "",
};

/** UPI IDs are name@handle; the handle is letters only (okaxis, ybl, paytm). */
export function isUpiId(value) {
  return /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(String(value || "").trim());
}

export function cleanBookingPrefs(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  const text = (v, max) => String(v || "").trim().replace(/\s+/g, " ").slice(0, max);
  return {
    enabled: p.enabled === true,
    upiId: text(p.upiId, 120).replace(/\s/g, ""),
    payeeName: text(p.payeeName, 80),
    payAtHotel: p.payAtHotel === true,
    note: text(p.note, 300),
  };
}

/** Where a booking's payment stands, in the words the desk sees. */
export const PAYMENT_STATUS_LABEL = {
  awaiting: "Not paid yet",
  guest_paid: "Guest says paid",
  received: "Payment received",
  not_received: "Payment not found",
  at_hotel: "Pays at the hotel",
};

/** The same, in the words the guest sees. */
export const GUEST_PAYMENT_TEXT = {
  awaiting: "Waiting for your payment",
  guest_paid: "The hotel is checking your payment",
  received: "Payment received. Thank you!",
  not_received: "The hotel could not find your payment. Please call the hotel.",
  at_hotel: "You pay at the hotel when you arrive",
};

/**
 * The link a UPI app opens to pay: the hotel's ID and name, the amount and a
 * note carrying the booking number, so the hotel can match the money in its
 * bank statement. The amount is fixed by the link; the guest cannot change it.
 */
export function upiPayLink({ upiId, payeeName, amount, reference }) {
  const params = [
    ["pa", upiId],
    ["pn", payeeName || "Hotel"],
    ["am", Number(amount).toFixed(2)],
    ["cu", "INR"],
    ["tn", `Booking ${reference}`],
  ];
  return `upi://pay?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}

/** A UPI reference (UTR) is 12 digits; anything else typed is kept as typed, cut short. */
export function cleanPaymentReference(value) {
  return String(value || "").replace(/\s+/g, "").slice(0, 40);
}

/** The most a guest can book in one go, so a typo does not hold a room for a year. */
export const MAX_NIGHTS = 30;
export const MAX_DAYS_AHEAD = 500;
