/**
 * Aiosell Channel Manager API client.
 *
 * Server-side only: every call carries Basic auth credentials, so this module
 * must never be imported from a client component.
 *
 * Docs: https://apidocs.aiosell.com/ — see docs/AIOSELL_CM_API.md
 */

const BASE_URL = process.env.AIOSELL_BASE_URL || "https://live.aiosell.com/api/v2/cm";

/** Aiosell channel slug -> display name shown in the UI. */
export const CHANNEL_LABELS = {
  "booking.com": "Booking.com",
  gommt: "MakeMyTrip",
  agoda: "Agoda",
  airbnb: "Airbnb",
  google: "Google",
  expedia: "Expedia",
};

export function channelLabel(slug) {
  return CHANNEL_LABELS[slug] || slug;
}

export function isConfigured() {
  return Boolean(
    process.env.AIOSELL_USER &&
      process.env.AIOSELL_PASSWORD &&
      process.env.AIOSELL_PARTNER_ID
  );
}

function authHeader() {
  const user = process.env.AIOSELL_USER;
  const password = process.env.AIOSELL_PASSWORD;
  if (!user || !password) {
    throw new Error("AIOSELL_USER / AIOSELL_PASSWORD are not configured");
  }
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

function partnerId() {
  const pms = process.env.AIOSELL_PARTNER_ID;
  if (!pms) {
    throw new Error("AIOSELL_PARTNER_ID is not configured");
  }
  return pms;
}

export function defaultHotelCode() {
  return process.env.AIOSELL_HOTEL_CODE || "sandbox-pms";
}

async function request(path, { method = "POST", body } = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = { Authorization: authHeader() };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch (err) {
    throw new Error(`Aiosell request failed (${method} ${path}): ${err.message}`);
  }

  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      // Non-JSON body — surface the raw text in the error below.
    }
  }

  if (!res.ok) {
    const detail = json?.message || text?.slice(0, 200) || res.statusText;
    throw new Error(`Aiosell ${method} ${path} -> ${res.status}: ${detail}`);
  }

  // Aiosell signals failure in-band as { success: false } or { status: false }.
  if (json && (json.success === false || json.status === false)) {
    throw new Error(json.message || `Aiosell ${method} ${path} reported failure`);
  }

  return json;
}

/**
 * Full property configuration: room ids, rateplan ids and connected channels.
 * Call this before any push — its ids are the codes every other endpoint needs.
 */
export function getPropertyDetails(hotelCode = defaultHotelCode()) {
  const qs = new URLSearchParams({ partnerId: partnerId() });
  return request(`/property_details/${encodeURIComponent(hotelCode)}?${qs}`, {
    method: "GET",
  });
}

/** updates: [{ startDate, endDate, rooms: [{ roomCode, available }] }] */
export function pushInventory(updates, hotelCode = defaultHotelCode()) {
  return request(`/update/${partnerId()}`, {
    body: { hotelCode, updates },
  });
}

/** updates: [{ startDate, endDate, rates: [{ roomCode, rateplanCode, rate }] }] */
export function pushRates(updates, hotelCode = defaultHotelCode()) {
  return request(`/update-rates/${partnerId()}`, {
    body: { hotelCode, updates },
  });
}

/**
 * updates: [{ startDate, endDate, rooms: [{ roomCode, restrictions }] }]
 * toChannels is optional; when present it limits the update to those channels.
 */
export function pushInventoryRestrictions(
  updates,
  { hotelCode = defaultHotelCode(), toChannels } = {}
) {
  const body = { hotelCode, updates };
  if (toChannels?.length) body.toChannels = toChannels;
  return request(`/update/${partnerId()}`, { body });
}

/**
 * Property-wide rate multiplier for the given channels.
 * `multiplier` is a factor, not a percentage: 1.2 = +20%, 0.9 = -10%.
 * `channels` must be non-empty — an empty list is rejected, it does not mean "all".
 */
export function setChannelMultiplier(
  multiplier,
  channels,
  hotelCode = defaultHotelCode()
) {
  if (!Array.isArray(channels) || channels.length === 0) {
    throw new Error("channels must be a non-empty array");
  }
  if (typeof multiplier !== "number" || !Number.isFinite(multiplier) || multiplier <= 0) {
    throw new Error("multiplier must be a positive number");
  }
  return request(`/channel_multiplier/${partnerId()}`, {
    body: { hotelCode, multiplier, channels },
  });
}
