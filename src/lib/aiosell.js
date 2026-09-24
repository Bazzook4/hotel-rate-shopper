/**
 * Aiosell Channel Manager API client.
 *
 * Server-side only: every call carries Basic auth credentials, so this module
 * must never be imported from a client component.
 *
 * Credentials come from the partners table (the contract between this
 * software and Aiosell, set by a super admin), and the hotel code from each
 * property's integration row. Env vars are still read as a fallback so an
 * existing deployment keeps working.
 *
 * Docs: https://apidocs.aiosell.com/ - see docs/AIOSELL_CM_API.md
 */

const DEFAULT_BASE_URL = "https://live.aiosell.com/api/v2/cm";

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

/**
 * Build a client bound to one partner's credentials and one hotel code.
 *
 * `partner` is a row from the partners table; `hotelCode` comes from the
 * property's integration.
 */
export function createAiosellClient({ partner, hotelCode } = {}) {
  const baseUrl = partner?.base_url || process.env.AIOSELL_BASE_URL || DEFAULT_BASE_URL;
  const user = partner?.api_username || process.env.AIOSELL_USER;
  const password = partner?.api_password || process.env.AIOSELL_PASSWORD;
  const pms = partner?.partner_id || process.env.AIOSELL_PARTNER_ID;
  const hotel = hotelCode || process.env.AIOSELL_HOTEL_CODE;

  // Rates and inventory have separate paths. They are stored per partner so
  // a provider with different routing does not need a code change; {pms} is
  // substituted at call time.
  const ratesPath = partner?.rates_url || "/update-rates/{pms}";
  const inventoryPath = partner?.inventory_url || "/update/{pms}";
  const withPms = (path) => path.replace("{pms}", pms);

  function configured() {
    return Boolean(user && password && pms && hotel);
  }

  function missing() {
    const gaps = [];
    if (!user) gaps.push("API username");
    if (!password) gaps.push("API password");
    if (!pms) gaps.push("partner id");
    if (!hotel) gaps.push("hotel code");
    return gaps;
  }

  async function request(path, { method = "POST", body } = {}) {
    if (!configured()) {
      throw new Error(`Aiosell is not fully configured: missing ${missing().join(", ")}`);
    }

    const headers = {
      Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let res;
    try {
      res = await fetch(`${baseUrl}${path}`, {
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
        // Non-JSON body - surfaced in the error below.
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

  return {
    isConfigured: configured,
    missingFields: missing,
    hotelCode: hotel,

    /** Full property configuration. Call this before any push. */
    getPropertyDetails() {
      const qs = new URLSearchParams({ partnerId: pms });
      return request(`/property_details/${encodeURIComponent(hotel)}?${qs}`, {
        method: "GET",
      });
    },

    /** updates: [{ startDate, endDate, rooms: [{ roomCode, available }] }] */
    pushInventory(updates) {
      return request(withPms(inventoryPath), { body: { hotelCode: hotel, updates } });
    },

    /** updates: [{ startDate, endDate, rates: [{ roomCode, rateplanCode, rate }] }] */
    pushRates(updates) {
      return request(withPms(ratesPath), { body: { hotelCode: hotel, updates } });
    },

    pushInventoryRestrictions(updates, { toChannels } = {}) {
      const body = { hotelCode: hotel, updates };
      if (toChannels?.length) body.toChannels = toChannels;
      return request(withPms(inventoryPath), { body });
    },

    /**
     * Property-wide rate multiplier for the given channels.
     * `multiplier` is a factor: 1.2 = +20%, 0.9 = -10%.
     */
    setChannelMultiplier(multiplier, channels) {
      if (!Array.isArray(channels) || channels.length === 0) {
        throw new Error("channels must be a non-empty array");
      }
      if (typeof multiplier !== "number" || !Number.isFinite(multiplier) || multiplier <= 0) {
        throw new Error("multiplier must be a positive number");
      }
      return request(`/channel_multiplier/${pms}`, {
        body: { hotelCode: hotel, multiplier, channels },
      });
    },
  };
}
