import { NextResponse } from "next/server";
import { createSnapshotRecords, getCompsetById, listSnapshotsForCompset } from "@/lib/airtable";
import { getSessionFromRequest } from "@/lib/session";

export async function GET(req, { params }) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const records = await listSnapshotsForCompset(params.id, { limit: 50 });
  return NextResponse.json({
    snapshots: records.map((record) => ({
      id: record.id,
      channel: record.Channel ?? null,
      price: record.Price ?? null,
      currency: record.Currency ?? null,
      date: record["Snapshot Date"] ?? null,
      lastSync: record["Snapshot Date"] ?? null,
      propertyId: Array.isArray(record.Property) ? record.Property[0] : null,
    })),
  });
}

export async function POST(req, { params }) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // body.payload should be what ComparePanel produced
  const body = await req.json().catch(() => ({}));
  const payload = body?.payload;
  if (!payload) return NextResponse.json({ error: "Missing payload" }, { status: 400 });

  // You decide the effective date to store (today or check-in date you used)
  const effectiveDate = body?.date || payload?.check_in_date || new Date().toISOString().slice(0, 10);
  const currency = body?.currency || "INR";

  const compset = await getCompsetById(params.id).catch(() => null);
  const primaryPropertyId = Array.isArray(compset?.["Primary Property"]) ? compset["Primary Property"][0] : session.propertyId;
  const competitorPropertyIds = Array.isArray(compset?.Competitors) ? compset.Competitors : [];

  const rows = [];
  // primary row(s) by channel
  for (const row of payload.rows || []) {
    if (row.primaryPrice != null) {
      rows.push({
        "Comp Set": [params.id],
        Property: primaryPropertyId ? [primaryPropertyId] : undefined,
        Channel: row.channel,
        Price: row.primaryPrice,
        Currency: currency,
        "Snapshot Date": effectiveDate,
        "Saved By": session.userId ? [session.userId] : undefined,
      });
    }
    // competitor rows
    (row.competitorPrices || []).forEach((p, idx) => {
      if (p?.value != null) {
        rows.push({
          "Comp Set": [params.id],
          Property: competitorPropertyIds[idx] ? [competitorPropertyIds[idx]] : undefined,
          Channel: row.channel,
          Price: p.value,
          Currency: currency,
          "Snapshot Date": effectiveDate,
          "Saved By": session.userId ? [session.userId] : undefined,
        });
      }
    });
  }

  if (!rows.length) return NextResponse.json({ ok: true, inserted: 0 });

  await createSnapshotRecords(rows);
  return NextResponse.json({ ok: true, inserted: rows.length });
}
