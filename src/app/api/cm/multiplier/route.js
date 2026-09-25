import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { resolveChannelManager } from "@/lib/cmResolver";
import { recordSyncLog } from "@/lib/database";

export async function POST(req) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { multiplier, channels, propertyId } = body || {};

  if (typeof multiplier !== "number" || !Number.isFinite(multiplier) || multiplier <= 0) {
    return NextResponse.json(
      { error: "multiplier must be a positive number (1.2 = +20%)" },
      { status: 400 }
    );
  }
  if (!Array.isArray(channels) || channels.length === 0) {
    return NextResponse.json(
      { error: "channels must be a non-empty array" },
      { status: 400 }
    );
  }

  const cm = await resolveChannelManager(session, { propertyId });
  const { client, ready, integration } = cm;

  const logBase = {
    property_id: cm.propertyId || null,
    integration_id: integration?.id || null,
    kind: "multiplier",
    direction: "out",
    user_id: session.userId,
    user_email: session.email,
    entry_count: channels.length,
    summary: `${multiplier}x on ${channels.join(", ")}`,
  };

  if (!ready) {
    const message = `Would set ${multiplier}x on ${channels.join(", ")}`;
    await recordSyncLog({
      ...logBase,
      status: "skipped",
      source: "mock",
      summary: `${message} — connection not live`,
      request: { multiplier, channels },
    });
    return NextResponse.json({ source: "mock", message });
  }

  const startedAt = Date.now();

  try {
    const result = await client.setChannelMultiplier(multiplier, channels);
    await recordSyncLog({
      ...logBase,
      status: "success",
      source: "aiosell",
      duration_ms: Date.now() - startedAt,
      request: { multiplier, channels },
      response: result,
    });
    return NextResponse.json({ source: "aiosell", result });
  } catch (err) {
    console.error("Aiosell channel_multiplier failed", err);
    await recordSyncLog({
      ...logBase,
      status: "failed",
      source: "aiosell",
      error: err.message,
      duration_ms: Date.now() - startedAt,
      request: { multiplier, channels },
    });
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
