import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/serverSession";
import { markTourDone } from "@/lib/database";

/** The booking tour was finished or skipped, so it is not offered again. */
export async function POST(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await markTourDone(session.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
