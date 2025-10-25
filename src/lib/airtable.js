import Airtable from "airtable";

const API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = process.env.AIRTABLE_BASE_ID;

if (!API_KEY) {
  throw new Error("AIRTABLE_API_KEY is not configured");
}

if (!BASE_ID) {
  throw new Error("AIRTABLE_BASE_ID is not configured");
}

const base = new Airtable({ apiKey: API_KEY }).base(BASE_ID);

const TABLES = {
  users: process.env.AIRTABLE_USERS_TABLE || "Users",
  properties: process.env.AIRTABLE_PROPERTIES_TABLE || "Properties",
  compsets: process.env.AIRTABLE_COMPSETS_TABLE || "CompSets",
  snapshots: process.env.AIRTABLE_SNAPSHOTS_TABLE || "Snapshots",
  dynamicPricingHotels: process.env.AIRTABLE_DYNAMIC_PRICING_HOTELS_TABLE || "DynamicPricingHotels",
  roomTypes: process.env.AIRTABLE_ROOM_TYPES_TABLE || "RoomTypes",
  ratePlans: process.env.AIRTABLE_RATE_PLANS_TABLE || "RatePlans",
  pricingFactors: process.env.AIRTABLE_PRICING_FACTORS_TABLE || "PricingFactors",
  pricingSnapshots: process.env.AIRTABLE_PRICING_SNAPSHOTS_TABLE || "PricingSnapshots",
};

function tablePath(table) {
  return encodeURIComponent(table);
}

function recordPath(table, id) {
  return `${encodeURIComponent(table)}/${id}`;
}

function buildUrl(path) {
  return `https://api.airtable.com/v0/${BASE_ID}/${path}`;
}

function escapeFormulaValue(value) {
  return String(value).replace(/'/g, "\\'");
}

async function airtableRequest(path, { method = "GET", params, body } = {}) {
  const url = new URL(buildUrl(path));
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, String(value));
      }
    });
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable request failed (${res.status}): ${text}`);
  }

  return res.json();
}

function normaliseRecord(record) {
  if (!record) return null;
  return { id: record.id, ...record.fields };
}

export async function listProperties() {
  const data = await airtableRequest(tablePath(TABLES.properties), {
    params: {
      "sort[0][field]": "Name",
      "sort[0][direction]": "asc",
    },
  });
  return (data.records || []).map(normaliseRecord);
}

export async function findUserByEmail(email) {
  const formula = `LOWER({Email})='${escapeFormulaValue(email.toLowerCase())}'`;
  const data = await airtableRequest(tablePath(TABLES.users), {
    params: {
      filterByFormula: formula,
      maxRecords: 1,
    },
  });
  return normaliseRecord(data.records?.[0]);
}

export async function getUserById(id) {
  if (!id) return null;
  const data = await airtableRequest(recordPath(TABLES.users, id));
  return normaliseRecord(data);
}

export async function getPropertyById(id) {
  if (!id) return null;
  const data = await airtableRequest(recordPath(TABLES.properties, id));
  return normaliseRecord(data);
}

export async function getCompsetById(id) {
  if (!id) return null;
  const data = await airtableRequest(recordPath(TABLES.compsets, id));
  return normaliseRecord(data);
}

export async function getCompsetsForProperty(propertyId) {
  if (!propertyId) return [];
  const formula = `{Primary Property}='${escapeFormulaValue(propertyId)}'`;
  const data = await airtableRequest(tablePath(TABLES.compsets), {
    params: {
      filterByFormula: formula,
    },
  });
  return (data.records || []).map(normaliseRecord);
}

export async function listSnapshotsForCompset(compSetId, { limit = 50 } = {}) {
  const formula = `{Comp Set}='${escapeFormulaValue(compSetId)}'`;
  const data = await airtableRequest(tablePath(TABLES.snapshots), {
    params: {
      filterByFormula: formula,
      "sort[0][field]": "Snapshot Date",
      "sort[0][direction]": "desc",
      maxRecords: limit,
    },
  });
  return (data.records || []).map(normaliseRecord);
}

export async function createSnapshotRecords(records) {
  if (!Array.isArray(records) || records.length === 0) return;
  const chunkSize = 10;
  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    await airtableRequest(tablePath(TABLES.snapshots), {
      method: "POST",
      body: {
        records: chunk.map((fields) => ({ fields })),
      },
    });
  }
}

export async function createUser({ email, passwordHash, role = "PropertyUser", status = "Active", propertyIds = [] }) {
  const fields = {
    Email: email,
    "Password Hash": passwordHash,
    Role: role,
    Status: status,
  };
  if (propertyIds?.length) {
    fields.Properties = propertyIds;
  }

  const data = await airtableRequest(tablePath(TABLES.users), {
    method: "POST",
    body: {
      records: [{ fields }],
    },
  });

  return normaliseRecord(data.records?.[0]);
}

export async function createSearchSnapshot({
  query,
  payload,
  params,
  userId,
  userEmail,
  source = "hotel_search",
  snapshotDate,
}) {
  if (!query) {
    throw new Error("query is required to create a search snapshot");
  }

  let payloadString = null;
  let paramsString = null;
  try {
    payloadString = payload === undefined ? null : JSON.stringify(payload);
  } catch (err) {
    throw new Error(`Failed to serialise payload: ${err.message}`);
  }
  try {
    paramsString = params === undefined ? null : JSON.stringify(params);
  } catch (err) {
    throw new Error(`Failed to serialise params: ${err.message}`);
  }

  const fields = {
    Source: source,
    "Search Query": query,
    Payload: payloadString,
    "Request Params": paramsString,
    "Snapshot Date": snapshotDate || new Date().toISOString(),
  };

  if (userId) {
    fields["Saved By"] = [userId];
  }
  if (userEmail) {
    fields["Saved By Email"] = userEmail;
  }

  const data = await airtableRequest(tablePath(TABLES.snapshots), {
    method: "POST",
    body: {
      records: [{ fields }],
    },
  });

  return normaliseRecord(data.records?.[0]);
}

export async function listSearchSnapshots({ userEmail, limit = 20 } = {}) {
  const filters = ["{Source}='hotel_search'"];
  if (userEmail) {
    filters.push(`LOWER({Saved By Email})='${escapeFormulaValue(userEmail.toLowerCase())}'`);
  }
  const filterByFormula = filters.length === 1 ? filters[0] : `AND(${filters.join(',')})`;

  const data = await airtableRequest(tablePath(TABLES.snapshots), {
    params: {
      filterByFormula,
      "sort[0][field]": "Snapshot Date",
      "sort[0][direction]": "desc",
      maxRecords: limit,
    },
  });

  return (data.records || []).map(normaliseRecord);
}

export async function getSnapshotById(id) {
  if (!id) return null;
  const data = await airtableRequest(recordPath(TABLES.snapshots, id));
  return normaliseRecord(data);
}

export async function updateSearchSnapshot(id, { payload, params, snapshotDate } = {}) {
  if (!id) {
    throw new Error("id is required to update a search snapshot");
  }

  const fields = {};

  if (payload !== undefined) {
    try {
      fields.Payload = payload === null ? null : JSON.stringify(payload);
    } catch (err) {
      throw new Error(`Failed to serialise payload: ${err.message}`);
    }
  }

  if (params !== undefined) {
    try {
      fields["Request Params"] = params === null ? null : JSON.stringify(params);
    } catch (err) {
      throw new Error(`Failed to serialise params: ${err.message}`);
    }
  }

  if (snapshotDate) {
    fields["Snapshot Date"] = snapshotDate;
  }

  if (Object.keys(fields).length === 0) {
    return getSnapshotById(id);
  }

  const data = await airtableRequest(recordPath(TABLES.snapshots, id), {
    method: "PATCH",
    body: { fields },
  });

  return normaliseRecord(data);
}

export async function deleteSnapshotById(id) {
  if (!id) {
    throw new Error("id is required to delete a snapshot");
  }
  await airtableRequest(recordPath(TABLES.snapshots, id), { method: "DELETE" });
}

// Dynamic Pricing Hotel Functions
export async function createDynamicPricingHotel({ templateName, hotelName, location, propertyId, copyFromTemplateId }) {
  const hotelId = `hotel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const fields = {
    hotelId,
    templateName: templateName || hotelName,
    hotelName,
    location,
    propertyId: propertyId || "",
    copyFromTemplateId: copyFromTemplateId || "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const data = await airtableRequest(tablePath(TABLES.dynamicPricingHotels), {
    method: "POST",
    body: {
      records: [{ fields }],
    },
  });

  return normaliseRecord(data.records?.[0]);
}

export async function getDynamicPricingHotelById(hotelId) {
  if (!hotelId) return null;
  const formula = `{hotelId}='${escapeFormulaValue(hotelId)}'`;
  const data = await airtableRequest(tablePath(TABLES.dynamicPricingHotels), {
    params: {
      filterByFormula: formula,
      maxRecords: 1,
    },
  });
  return normaliseRecord(data.records?.[0]);
}

export async function listDynamicPricingHotels({ propertyId } = {}) {
  const params = {
    "sort[0][field]": "createdAt",
    "sort[0][direction]": "desc",
  };

  if (propertyId) {
    params.filterByFormula = `{propertyId}='${escapeFormulaValue(propertyId)}'`;
  }

  const data = await airtableRequest(tablePath(TABLES.dynamicPricingHotels), { params });
  return (data.records || []).map(normaliseRecord);
}

export async function updateDynamicPricingHotel(recordId, updates) {
  const fields = {
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  const data = await airtableRequest(recordPath(TABLES.dynamicPricingHotels, recordId), {
    method: "PATCH",
    body: { fields },
  });

  return normaliseRecord(data);
}

// Room Type Functions
export async function createRoomType({ hotelId, roomTypeName, basePrice, numberOfRooms, description, amenities }) {
  const roomTypeId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const fields = {
    roomTypeId,
    hotelId,
    roomTypeName,
    basePrice: Number(basePrice),
    numberOfRooms: Number(numberOfRooms),
    description: description || "",
    amenities: amenities || [],
    createdAt: new Date().toISOString(),
  };

  const data = await airtableRequest(tablePath(TABLES.roomTypes), {
    method: "POST",
    body: {
      records: [{ fields }],
    },
  });

  return normaliseRecord(data.records?.[0]);
}

export async function listRoomTypes(hotelId) {
  const formula = `{hotelId}='${escapeFormulaValue(hotelId)}'`;
  const data = await airtableRequest(tablePath(TABLES.roomTypes), {
    params: {
      filterByFormula: formula,
    },
  });
  return (data.records || []).map(record => {
    const normalized = normaliseRecord(record);
    // Parse occupancyPricing JSON if it exists
    if (normalized.occupancyPricing && typeof normalized.occupancyPricing === 'string') {
      try {
        normalized.occupancyPricing = JSON.parse(normalized.occupancyPricing);
      } catch (e) {
        console.error('Failed to parse occupancyPricing:', e);
        normalized.occupancyPricing = null;
      }
    }
    return normalized;
  });
}

export async function updateRoomType(recordId, updates) {
  const data = await airtableRequest(recordPath(TABLES.roomTypes, recordId), {
    method: "PATCH",
    body: { fields: updates },
  });
  return normaliseRecord(data);
}

export async function deleteRoomType(recordId) {
  await airtableRequest(recordPath(TABLES.roomTypes, recordId), { method: "DELETE" });
}

// Rate Plan Functions
export async function createRatePlan({ hotelId, planName, multiplier, description }) {
  const ratePlanId = `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const fields = {
    ratePlanId,
    hotelId,
    planName,
    multiplier: Number(multiplier),
    description: description || "",
    createdAt: new Date().toISOString(),
  };

  const data = await airtableRequest(tablePath(TABLES.ratePlans), {
    method: "POST",
    body: {
      records: [{ fields }],
    },
  });

  return normaliseRecord(data.records?.[0]);
}

export async function listRatePlans(hotelId) {
  const formula = `{hotelId}='${escapeFormulaValue(hotelId)}'`;
  const data = await airtableRequest(tablePath(TABLES.ratePlans), {
    params: {
      filterByFormula: formula,
    },
  });
  return (data.records || []).map(normaliseRecord);
}

export async function updateRatePlan(recordId, updates) {
  const data = await airtableRequest(recordPath(TABLES.ratePlans, recordId), {
    method: "PATCH",
    body: { fields: updates },
  });
  return normaliseRecord(data);
}

export async function deleteRatePlan(recordId) {
  await airtableRequest(recordPath(TABLES.ratePlans, recordId), { method: "DELETE" });
}

// Pricing Factors Functions
export async function createOrUpdatePricingFactors(hotelId, factors) {
  // Check if factors already exist for this hotel
  const formula = `{hotelId}='${escapeFormulaValue(hotelId)}'`;
  const existing = await airtableRequest(tablePath(TABLES.pricingFactors), {
    params: {
      filterByFormula: formula,
      maxRecords: 1,
    },
  });

  const fields = {
    hotelId,
    ...factors,
  };

  if (existing.records?.[0]) {
    // Update existing - remove hotelId and factorId from updates
    const { hotelId: _hId, factorId: _fId, ...updateFields } = fields;
    const data = await airtableRequest(recordPath(TABLES.pricingFactors, existing.records[0].id), {
      method: "PATCH",
      body: { fields: updateFields },
    });
    return normaliseRecord(data);
  } else {
    // Create new
    const factorId = `factor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    fields.factorId = factorId;

    const data = await airtableRequest(tablePath(TABLES.pricingFactors), {
      method: "POST",
      body: {
        records: [{ fields }],
      },
    });
    return normaliseRecord(data.records?.[0]);
  }
}

export async function getPricingFactors(hotelId) {
  const formula = `{hotelId}='${escapeFormulaValue(hotelId)}'`;
  const data = await airtableRequest(tablePath(TABLES.pricingFactors), {
    params: {
      filterByFormula: formula,
      maxRecords: 1,
    },
  });
  return normaliseRecord(data.records?.[0]);
}

// Pricing Snapshot Functions
export async function createPricingSnapshot(snapshotData) {
  const snapshotId = `snapshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const fields = {
    snapshotId,
    ...snapshotData,
    createdAt: new Date().toISOString(),
  };

  const data = await airtableRequest(tablePath(TABLES.pricingSnapshots), {
    method: "POST",
    body: {
      records: [{ fields }],
    },
  });

  return normaliseRecord(data.records?.[0]);
}

export async function listPricingSnapshots(hotelId, { limit = 50 } = {}) {
  const formula = `{hotelId}='${escapeFormulaValue(hotelId)}'`;
  const data = await airtableRequest(tablePath(TABLES.pricingSnapshots), {
    params: {
      filterByFormula: formula,
      "sort[0][field]": "createdAt",
      "sort[0][direction]": "desc",
      maxRecords: limit,
    },
  });
  return (data.records || []).map(normaliseRecord);
}

export { TABLES };

export function table(name) {
  if (!name) {
    throw new Error("table name is required");
  }
  const lowerName = typeof name === "string" ? name.toLowerCase() : name;
  const tableName = TABLES[lowerName] || TABLES[name] || name;
  return base(tableName);
}
