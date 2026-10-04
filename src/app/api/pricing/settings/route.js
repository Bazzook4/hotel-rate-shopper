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
import { moduleDeniedResponse } from "@/lib/propertyScope";
import {
  cleanScales,
  cleanAdjustments,
  DEFAULT_SCALES,
  DEFAULT_ADJUSTMENTS,
} from "@/lib/pricingScales";

/** Defaults are stored as null, so a property on them follows any improvement. */
function orNull(value, defaults) {
  return value == null || JSON.stringify(value) === JSON.stringify(defaults) ? null : value;
}

/** Floor and ceiling per room, plus how the algorithm is weighted. */
export async function GET(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await moduleDeniedResponse(session, "pricing");
  if (denied) return denied;

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
  const denied = await moduleDeniedResponse(session, "pricing");
  if (denied) return denied;
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

  const s = body?.strategy;
  if (s) {
    const floorPct = Number(s.floor_pct ?? 70);
    const ceilingPct = Number(s.ceiling_pct ?? 250);
    if (!(floorPct > 0) || !(ceilingPct >= floorPct)) {
      return NextResponse.json(
        { error: "The lowest rate must be above 0% and below the highest." },
        { status: 400 }
      );
    }
    const maxChange = Number(s.max_change_pct ?? 20);
    if (!(maxChange > 0 && maxChange <= 100)) {
      return NextResponse.json(
        { error: "The most a rate may move must be between 1% and 100%." },
        { status: 400 }
      );
    }
  }

  const scales = s ? cleanScales(s.scales) : { value: null };
  if (scales.error) return NextResponse.json({ error: scales.error }, { status: 400 });
  const adjustments = s ? cleanAdjustments(s.adjustments) : { value: null };
  if (adjustments.error) return NextResponse.json({ error: adjustments.error }, { status: 400 });

  try {
    const saved = {};
    if (Array.isArray(body?.bounds)) {
      saved.bounds = await savePricingBounds(propertyId, body.bounds);
    }
    if (s) {
      saved.strategy = await savePricingStrategy(propertyId, {
        weights_mode: s.weights_mode === "custom" ? "custom" : "auto",
        floor_pct: Number(s.floor_pct ?? 70),
        ceiling_pct: Number(s.ceiling_pct ?? 250),
        weight_compset: Number(s.weight_compset ?? 0.5),
        weight_occupancy: Number(s.weight_occupancy ?? 1),
        weight_weekday: Number(s.weight_weekday ?? 0.5),
        weight_pickup: Number(s.weight_pickup ?? 1),
        weight_adr_90: Number(s.weight_adr_90 ?? 0.5),
        weight_adr_ly: Number(s.weight_adr_ly ?? 0.5),
        weight_events: Number(s.weight_events ?? 1),
        weight_pace: Number(s.weight_pace ?? 1),
        max_change_pct: Number(s.max_change_pct ?? 20),
        scales: orNull(scales.value, DEFAULT_SCALES),
        adjustments: orNull(adjustments.value, DEFAULT_ADJUSTMENTS),
      });
    }
    return NextResponse.json(saved);
  } catch (err) {
    console.error("Saving pricing settings failed:", err.message);
    const pending = /update 043/.test(err.message);
    return NextResponse.json(
      {
        error: pending
          ? "Your other settings are saved, but scales and rules need a database update first. Ask your administrator to run update 043."
          : "Could not save your pricing settings.",
      },
      { status: 500 }
    );
  }
}
