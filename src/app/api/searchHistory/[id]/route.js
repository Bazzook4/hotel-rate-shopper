import { NextResponse } from "next/server";
import {
  deleteSnapshotById,
  getSnapshotById,
  updateSearchSnapshot,
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

async function ensureOwnership(record, session) {
  if (!record || record.source !== "hotel_search") {
    return false;
  }
  if (!session?.email) {
    return false;
  }
  const savedEmail = record.saved_by_email?.toLowerCase?.();
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
