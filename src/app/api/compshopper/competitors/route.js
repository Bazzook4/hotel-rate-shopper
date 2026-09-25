import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { isAnyAdmin } from "@/lib/permissions";
import { listCompetitors, saveCompetitors } from "@/lib/database";
import { resolvePropertyId } from "@/lib/propertyScope";
import { MAX_COMPETITORS } from "@/lib/competitors";

/** The competitors this property tracks. */
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

  const competitors = await listCompetitors(propertyId);
  return NextResponse.json({ propertyId, competitors, max: MAX_COMPETITORS });
}

/** Replace the list. The panel edits the whole set and saves once. */
export async function PUT(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAnyAdmin(session)) {
    return NextResponse.json(
      { error: "You do not have permission to change competitors." },
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

  const rows = Array.isArray(body?.competitors) ? body.competitors : [];

  // Enforced here as well as in the UI, since the cap is what keeps a
  // refresh inside its time budget rather than a cosmetic limit.
  if (rows.length > MAX_COMPETITORS) {
    return NextResponse.json(
      { error: `You can track up to ${MAX_COMPETITORS} competitors. Remove one before adding another.` },
      { status: 400 }
    );
  }

  // The same hotel twice would double its weight in the median.
  const tokens = new Set();
  for (const row of rows) {
    if (!row?.property_token || !row?.name) {
      return NextResponse.json(
        { error: "Every competitor needs a hotel selected from the search results." },
        { status: 400 }
      );
    }
    if (tokens.has(row.property_token)) {
      return NextResponse.json(
        { error: `${row.name} is already on your competitor list.` },
        { status: 400 }
      );
    }
    tokens.add(row.property_token);
  }

  try {
    const saved = await saveCompetitors(propertyId, rows);
    return NextResponse.json({ competitors: saved, max: MAX_COMPETITORS });
  } catch (err) {
    console.error("Saving competitors failed:", err.message);
    return NextResponse.json({ error: "Could not save your competitor list." }, { status: 500 });
  }
}
