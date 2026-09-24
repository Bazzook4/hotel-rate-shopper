/**
 * Mock property_details response, shaped exactly like the Aiosell payload
 * documented in docs/AIOSELL_CM_API.md. Used until credentials are configured
 * so the Channel Manager UI can be built and demoed against realistic data.
 */
export const MOCK_PROPERTY = {
  hotel_id: "sandbox-pms",
  hotel_name: "Sea View Resort, Goa",
  property_category: "hotel",
  currency: "INR",
  timezone: "Asia/Kolkata",
  address: {
    line: "India, Goa",
    city: "Goa",
    state: "Goa",
    country_code: "IN",
    location: { latt: "15.2993", long: "74.1240" },
  },
  contact: { phone: "", email: "", website: "" },
  tax_id: "",
  rooms: [
    {
      room_id: "deluxe",
      room_name: "Deluxe Room",
      description: "Sea facing, free wifi",
      count: 18,
      active: true,
      type: "primary",
      min_occ: 1,
      max_occ: 3,
      rateplans: [
        { rateplan_id: "deluxe-d-ep", rateplan_name: "Standard EP", description: "Room Only", occupancy: 2, no_of_meals: 0, extra_adult: 800 },
        { rateplan_id: "deluxe-d-cp", rateplan_name: "Breakfast CP", description: "Incl. breakfast", occupancy: 2, no_of_meals: 1, extra_adult: 800 },
      ],
    },
    {
      room_id: "suite",
      room_name: "Sea View Suite",
      description: "Private balcony",
      count: 6,
      active: true,
      type: "primary",
      min_occ: 1,
      max_occ: 4,
      rateplans: [
        { rateplan_id: "suite-d-ep", rateplan_name: "Standard EP", description: "Room Only", occupancy: 2, no_of_meals: 0, extra_adult: 1200 },
        { rateplan_id: "suite-d-cp", rateplan_name: "Breakfast CP", description: "Incl. breakfast", occupancy: 2, no_of_meals: 1, extra_adult: 1200 },
      ],
    },
  ],
  connected_channels: [
    { operation: "inventory", partner_id: "booking.com", hotel_code: "1182934" },
    { operation: "inventory", partner_id: "gommt", hotel_code: "7734215690" },
    { operation: "inventory", partner_id: "airbnb", hotel_code: "AB-99321" },
    { operation: "inventory", partner_id: "agoda", hotel_code: "452981" },
    { operation: "rates", partner_id: "booking.com", hotel_code: "1182934", rate_multiplier: 1 },
    { operation: "rates", partner_id: "gommt", hotel_code: "7734215690", rate_multiplier: 1.12 },
    { operation: "rates", partner_id: "airbnb", hotel_code: "AB-99321", rate_multiplier: 1.18 },
    { operation: "rates", partner_id: "agoda", hotel_code: "452981", rate_multiplier: 1.1 },
    { operation: "reservation", partner_id: "booking.com", hotel_code: "1182934" },
    { operation: "reservation", partner_id: "gommt", hotel_code: "7734215690" },
  ],
};

/** Deterministic per-date base rate so the grid looks realistic without a backend. */
export function mockRate(roomId, rateplanId, isoDate) {
  const base = roomId === "suite" ? 8200 : 4500;
  const mealUplift = rateplanId.endsWith("-cp") ? 500 : 0;
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  const weekend = day === 5 || day === 6 ? 700 : 0;
  return base + mealUplift + weekend;
}

export function mockInventory(roomId, isoDate) {
  const total = roomId === "suite" ? 6 : 18;
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 5 || day === 6 ? Math.max(2, total - 10) : total - 6;
}
