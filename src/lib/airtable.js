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

export { TABLES };

export function table(name) {
  if (!name) {
    throw new Error("table name is required");
  }
  const lowerName = typeof name === "string" ? name.toLowerCase() : name;
  const tableName = TABLES[lowerName] || TABLES[name] || name;
  return base(tableName);
}
