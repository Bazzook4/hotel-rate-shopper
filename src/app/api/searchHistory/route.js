import { NextResponse } from "next/server";
import {
  createSearchSnapshot,
  listSearchSnapshots,
} from "@/lib/database";
import { getSessionFromRequest } from "@/lib/session";

function mapSnapshot(record) {
  if (!record) return null;

  return {
    id: record.id,
    query: record.search_query || null,
    snapshotDate: record.snapshot_date || null,
    savedByEmail: record.saved_by_email || null,
    payload: record.payload || null,
    params: record.request_params || null,
  };
}

export async function GET(request) {
  const session = await getSessionFromRequest(request);
  if (!session?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const records = await listSearchSnapshots({ userEmail: session.email.toLowerCase() }).catch(() => []);
  return NextResponse.json({ history: records.map(mapSnapshot).filter(Boolean) });
}

export async function POST(request) {
  const session = await getSessionFromRequest(request);
  if (!session?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const query = body?.query;
  const payload = body?.payload;
  const params = body?.params;
  const snapshotDate = body?.snapshotDate;

  if (!query || !payload) {
    return NextResponse.json({ error: "Missing query or payload" }, { status: 400 });
  }

  const record = await createSearchSnapshot({
    query,
    payload,
    params,
    userId: session.userId,
    userEmail: session.email.toLowerCase(),
    snapshotDate,
  }).catch((err) => {
    console.error("Failed to create search snapshot", err);
    return null;
  });

  if (!record) {
    return NextResponse.json({ error: "Snapshot save failed" }, { status: 500 });
  }

  return NextResponse.json({ history: mapSnapshot(record) }, { status: 201 });
}
