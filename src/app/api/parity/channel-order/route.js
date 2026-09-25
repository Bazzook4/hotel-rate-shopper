import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { resolvePropertyId } from "@/lib/propertyScope";
import { saveParityChannelOrder } from "@/lib/database";
import { channelKey } from "@/lib/parity";

/**
 * Save the order a property wants its parity channels shown in.
 *
 * The whole list is sent and replaces whatever was stored, so the order can
 * never end up half-applied: the grid the hotelier is looking at is exactly
 * what gets saved.
 */
export async function POST(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const propertyId = await resolvePropertyId(session, body?.propertyId);
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected." }, { status: 403 });
  }

  if (!Array.isArray(body?.channelKeys)) {
    return NextResponse.json({ error: "Send the channels in the order you want them." }, { status: 400 });
  }

  // Normalised through the same function that built the keys in the first
  // place, so an order saved from a stale page still matches what the grid
  // stores. Duplicates are dropped rather than rejected: two rows claiming
  // one position is a client bug, not something to make the hotelier fix.
  const seen = new Set();
  const channelKeys = [];
  for (const raw of body.channelKeys) {
    const key = channelKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    channelKeys.push(key);
  }

  // A sane ceiling: a property has a handful of channels, and anything past
  // this is a malformed request rather than a real preference.
  if (channelKeys.length > 100) {
    return NextResponse.json({ error: "That is more channels than we can order." }, { status: 400 });
  }

  try {
    const saved = await saveParityChannelOrder(propertyId, channelKeys);
    return NextResponse.json({ saved });
  } catch (err) {
    console.error("Saving channel order failed:", err.message);
    return NextResponse.json({ error: "Could not save the channel order." }, { status: 500 });
  }
}
