import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { resolveChannelManager } from "@/lib/cmResolver";

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

  const { client, ready } = await resolveChannelManager(session, { propertyId });

  if (!ready) {
    return NextResponse.json({
      source: "mock",
      message: `Would set ${multiplier}x on ${channels.join(", ")}`,
    });
  }

  try {
    const result = await client.setChannelMultiplier(multiplier, channels);
    return NextResponse.json({ source: "aiosell", result });
  } catch (err) {
    console.error("Aiosell channel_multiplier failed", err);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
