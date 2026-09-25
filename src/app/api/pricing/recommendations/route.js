import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { listRoomTypes, listPricingRecommendations, listPricingBounds } from "@/lib/database";
import { resolvePropertyId } from "@/lib/propertyScope";
import { addDays, clampToToday, formatDateISO, parseDateISO } from "@/lib/date";

const DEFAULT_DAYS = 14;

/** The stored recommendation grid. Reads only; calculating is its own route. */
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

  const start = parseDateISO(clampToToday(searchParams.get("start"))) || new Date();
  const days = Math.min(Math.max(Number(searchParams.get("days")) || DEFAULT_DAYS, 1), 60);
  const startISO = formatDateISO(start);
  const endISO = formatDateISO(addDays(start, days - 1));
  const dates = Array.from({ length: days }, (_, i) => formatDateISO(addDays(start, i)));

  let roomTypes;
  let recommendations;
  let bounds;
  try {
    [roomTypes, recommendations, bounds] = await Promise.all([
      listRoomTypes(propertyId),
      listPricingRecommendations(propertyId, startISO, endISO),
      listPricingBounds(propertyId),
    ]);
  } catch (err) {
    console.error("Pricing recommendations read failed:", err.message);
    return NextResponse.json(
      { error: "Could not load pricing recommendations. Please try again." },
      { status: 500 }
    );
  }

  const boundsByRoom = new Map(bounds.map((b) => [b.room_type_id, b]));

  const rows = roomTypes.map((room) => ({
    roomTypeId: room.id,
    name: room.room_type_name,
    basePrice: room.base_price == null ? null : Number(room.base_price),
    floor: boundsByRoom.get(room.id)?.floor_rate ?? null,
    ceiling: boundsByRoom.get(room.id)?.ceiling_rate ?? null,
    cells: {},
  }));
  const byRoom = new Map(rows.map((r) => [r.roomTypeId, r]));

  for (const rec of recommendations) {
    const row = byRoom.get(rec.room_type_id);
    if (!row) continue;
    row.cells[rec.stay_date] = {
      id: rec.id,
      current: rec.current_rate == null ? null : Number(rec.current_rate),
      recommended: Number(rec.recommended_rate),
      reasons: rec.reasons || [],
      boundedBy: rec.bounded_by,
      status: rec.status,
      decidedBy: rec.decided_by,
      decidedAt: rec.decided_at,
    };
  }

  const calculatedAt = recommendations.reduce(
    (latest, r) => (!latest || r.updated_at > latest ? r.updated_at : latest),
    null
  );

  return NextResponse.json({
    propertyId,
    start: startISO,
    end: endISO,
    dates,
    rooms: rows,
    pending: recommendations.filter((r) => r.status === "pending").length,
    calculatedAt,
  });
}
