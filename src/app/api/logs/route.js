import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import { listSyncLogs, getUserPropertyId } from "@/lib/database";

const KINDS = ["rates", "inventory", "restrictions", "multiplier", "reservation"];
const STATUSES = ["success", "failed", "skipped"];
const MAX_LIMIT = 200;

/**
 * The activity log for one property.
 *
 * A property admin only ever sees their own property; a super admin may ask
 * for another one by id.
 */
export async function GET(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  const own =
    session.property_id ||
    (await getUserPropertyId(session.userId).catch(() => null));
  const requested = params.get("propertyId");

  const propertyId = isSuperAdmin(session)
    ? requested || own
    : !requested || requested === own
    ? own
    : null;

  if (!propertyId) {
    return NextResponse.json(
      { error: "You can only view logs for your own property." },
      { status: 403 }
    );
  }

  // An unknown kind would silently return everything, so it is rejected.
  const kinds = (params.get("kinds") || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const badKind = kinds.find((k) => !KINDS.includes(k));
  if (badKind) {
    return NextResponse.json(
      { error: `Unknown kind "${badKind}"` },
      { status: 400 }
    );
  }

  const status = params.get("status") || null;
  if (status && !STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `Unknown status "${status}"` },
      { status: 400 }
    );
  }

  const limit = Math.min(
    Math.max(Number(params.get("limit")) || 50, 1),
    MAX_LIMIT
  );
  const offset = Math.max(Number(params.get("offset")) || 0, 0);

  try {
    const { rows, total } = await listSyncLogs(propertyId, {
      kinds,
      status,
      from: params.get("from") || null,
      to: params.get("to") || null,
      limit,
      offset,
    });

    return NextResponse.json({ logs: rows, total, limit, offset });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
