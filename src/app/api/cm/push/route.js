import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import {
  pushRates,
  pushInventory,
  pushInventoryRestrictions,
  isConfigured,
  defaultHotelCode,
} from "@/lib/aiosell";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateUpdates(updates, key) {
  if (!Array.isArray(updates) || updates.length === 0) {
    return "updates must be a non-empty array";
  }
  for (const u of updates) {
    if (!ISO_DATE.test(u?.startDate) || !ISO_DATE.test(u?.endDate)) {
      return "each update needs startDate and endDate as YYYY-MM-DD";
    }
    if (u.startDate > u.endDate) {
      return `startDate ${u.startDate} is after endDate ${u.endDate}`;
    }
    if (!Array.isArray(u?.[key]) || u[key].length === 0) {
      return `each update needs a non-empty ${key} array`;
    }
  }
  return null;
}

export async function POST(req) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { kind, updates, toChannels, hotelCode = defaultHotelCode() } = body || {};
  const key = kind === "rates" ? "rates" : "rooms";

  if (!["rates", "inventory", "restrictions"].includes(kind)) {
    return NextResponse.json(
      { error: "kind must be one of: rates, inventory, restrictions" },
      { status: 400 }
    );
  }

  const invalid = validateUpdates(updates, key);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }

  if (!isConfigured()) {
    const count = updates.reduce((n, u) => n + u[key].length, 0);
    return NextResponse.json({
      source: "mock",
      message: `Would push ${count} ${kind} entr${count === 1 ? "y" : "ies"}`,
    });
  }

  try {
    let result;
    if (kind === "rates") {
      result = await pushRates(updates, hotelCode);
    } else if (kind === "inventory") {
      result = await pushInventory(updates, hotelCode);
    } else {
      result = await pushInventoryRestrictions(updates, { hotelCode, toChannels });
    }
    return NextResponse.json({ source: "aiosell", result });
  } catch (err) {
    console.error(`Aiosell ${kind} push failed`, err);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
