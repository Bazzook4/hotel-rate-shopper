import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { isAnyAdmin } from "@/lib/permissions";
import {
  listRoomTypes,
  listPricingBounds,
  savePricingBounds,
  getPricingStrategy,
  savePricingStrategy,
} from "@/lib/database";
import { resolvePropertyId } from "@/lib/propertyScope";

/** Floor and ceiling per room, plus how the algorithm is weighted. */
export async function GET(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const propertyId = await resolvePropertyId(session, searchParams.get("propertyId"));
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected." }, { status: 403 });
  }

  const [roomTypes, bounds, strategy] = await Promise.all([
    listRoomTypes(propertyId),
    listPricingBounds(propertyId),
    getPricingStrategy(propertyId),
  ]);

  const boundsByRoom = new Map(bounds.map((b) => [b.room_type_id, b]));

  return NextResponse.json({
    propertyId,
    rooms: roomTypes.map((r) => ({
      roomTypeId: r.id,
      name: r.room_type_name,
      basePrice: r.base_price == null ? null : Number(r.base_price),
      floor: boundsByRoom.get(r.id)?.floor_rate ?? null,
      ceiling: boundsByRoom.get(r.id)?.ceiling_rate ?? null,
    })),
    strategy,
  });
}

export async function PUT(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAnyAdmin(session)) {
    return NextResponse.json(
      { error: "You do not have permission to change pricing settings." },
      { status: 403 }
    );
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

  // Checked here as well as by the database constraint, so the message names
  // the room rather than surfacing a constraint violation.
  for (const row of body?.bounds || []) {
    const floor = row.floor_rate == null || row.floor_rate === "" ? null : Number(row.floor_rate);
    const ceiling = row.ceiling_rate == null || row.ceiling_rate === "" ? null : Number(row.ceiling_rate);
    if (floor != null && floor < 0) {
      return NextResponse.json({ error: "A floor rate cannot be negative." }, { status: 400 });
    }
    if (floor != null && ceiling != null && ceiling < floor) {
      return NextResponse.json(
        { error: `${row.name || "A room"} has a ceiling below its floor.` },
        { status: 400 }
      );
    }
  }

  try {
    const saved = {};
    if (Array.isArray(body?.bounds)) {
      saved.bounds = await savePricingBounds(propertyId, body.bounds);
    }
    if (body?.strategy) {
      const s = body.strategy;
      saved.strategy = await savePricingStrategy(propertyId, {
        weight_compset: Number(s.weight_compset ?? 1),
        weight_occupancy: Number(s.weight_occupancy ?? 1),
        weight_weekday: Number(s.weight_weekday ?? 0.5),
        weight_pickup: Number(s.weight_pickup ?? 1),
        weight_adr_90: Number(s.weight_adr_90 ?? 0.5),
        weight_adr_ly: Number(s.weight_adr_ly ?? 0.5),
        weight_events: Number(s.weight_events ?? 1),
        max_change_pct: Number(s.max_change_pct ?? 25),
      });
    }
    return NextResponse.json(saved);
  } catch (err) {
    console.error("Saving pricing settings failed:", err.message);
    return NextResponse.json({ error: "Could not save your pricing settings." }, { status: 500 });
  }
}
