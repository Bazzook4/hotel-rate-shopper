import { NextResponse } from "next/server";
import {
  deleteSnapshotById,
  getSnapshotById,
  updateSearchSnapshot,
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

async function ensureOwnership(record, session) {
  if (!record || record.Source !== "hotel_search") {
    return false;
  }
  if (!session?.email) {
    return false;
  }
  const savedEmail = record["Saved By Email"]?.toLowerCase?.();
  return savedEmail === session.email.toLowerCase();
}

export async function PATCH(request, { params }) {
  const session = await getSessionFromRequest(request);
  if (!session?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const record = await getSnapshotById(params.id).catch(() => null);
  if (!(await ensureOwnership(record, session))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const payload = body?.payload;
  const requestParams = body?.params;
  const snapshotDate = body?.snapshotDate || new Date().toISOString();

  if (!payload) {
    return NextResponse.json({ error: "Missing payload" }, { status: 400 });
  }

  const updated = await updateSearchSnapshot(params.id, {
    payload,
    params: requestParams,
    snapshotDate,
  }).catch((err) => {
    console.error("Failed to update search snapshot", err);
    return null;
  });

  if (!updated) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ history: mapSnapshot(updated) });
}

export async function DELETE(request, { params }) {
  const session = await getSessionFromRequest(request);
  if (!session?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const record = await getSnapshotById(params.id).catch(() => null);
  if (!(await ensureOwnership(record, session))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await deleteSnapshotById(params.id).catch((err) => {
    console.error("Failed to delete snapshot", err);
  });

  return NextResponse.json({ ok: true });
}
