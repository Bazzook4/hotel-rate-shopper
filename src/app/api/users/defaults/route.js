import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import { getDefaultAdminModules, setDefaultAdminModules } from "@/lib/rights";

/** The rights an onboarded hotel's admin starts with. Super admins only. */
export async function GET(request) {
  const session = await getSessionFromRequest(request);
  if (!session || !isSuperAdmin(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ modules: await getDefaultAdminModules() });
}

export async function PUT(request) {
  const session = await getSessionFromRequest(request);
  if (!session || !isSuperAdmin(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body?.modules)) {
    return NextResponse.json({ error: "modules must be a list" }, { status: 400 });
  }
  try {
    return NextResponse.json({ modules: await setDefaultAdminModules(body.modules) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
