import { NextResponse } from "next/server";
import {
  createSearchSnapshot,
  listSearchSnapshots,
} from "@/lib/airtable";
import { getSessionFromRequest } from "@/lib/session";

function mapSnapshot(record) {
  if (!record) return null;
  let payload = null;
  let params = null;

  if (typeof record.Payload === "string" && record.Payload.length) {
    try {
      payload = JSON.parse(record.Payload);
    } catch (err) {
      payload = record.Payload;
    }
  }

  if (typeof record["Request Params"] === "string" && record["Request Params"].length) {
    try {
      params = JSON.parse(record["Request Params"]);
    } catch (err) {
      params = record["Request Params"];
    }
  }

  return {
    id: record.id,
    query: record["Search Query"] || null,
    snapshotDate: record["Snapshot Date"] || null,
    savedByEmail: record["Saved By Email"] || null,
    payload,
    params,
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
