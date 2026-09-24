import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import { listPartners, updatePartner } from "@/lib/database";

/**
 * Partner credentials are the contract between this software and a channel
 * manager, so only a super admin may read or change them. Passwords are
 * never returned.
 */
export async function GET(req) {
  const session = await getSessionFromRequest(req);
  if (!session || !isSuperAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    return NextResponse.json({ partners: await listPartners() });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req) {
  const session = await getSessionFromRequest(req);
  if (!session || !isSuperAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body?.id) {
    return NextResponse.json({ error: "Partner id is required" }, { status: 400 });
  }

  if (body.base_url && !/^https:\/\//i.test(body.base_url)) {
    return NextResponse.json(
      { error: "Base URL must start with https://" },
      { status: 400 }
    );
  }

  try {
    const partner = await updatePartner(body.id, body);
    return NextResponse.json({ partner });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
