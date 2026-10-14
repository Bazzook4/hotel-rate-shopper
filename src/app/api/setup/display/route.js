import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { canManageSetup, getSupabaseAdmin } from "@/lib/database";
import { resolvePropertyId } from "@/lib/pmsGuard";
import { cleanDemand } from "@/lib/demandColours";

/**
 * How the hotel wants its screens to look (properties.display_prefs).
 *
 * Anyone signed in may read their own hotel's choices -- the Calendar and
 * Rates & Inventory follow them -- but only someone who may change setup may
 * change them. Before migration 044 the column is missing: reading falls back
 * to the defaults (everything off) and saving says what to run.
 */

const NEEDS_MIGRATION =
  "Display settings need migration 044_display_prefs.sql. Run it in the Supabase SQL editor, then save again.";

const missingColumn = (error) => /display_prefs/.test(error?.message || "");

export async function GET(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const propertyId = await resolvePropertyId(session, req.nextUrl.searchParams.get("propertyId"));
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });

  const { data, error } = await getSupabaseAdmin()
    .from("properties")
    .select("display_prefs")
    .eq("id", propertyId)
    .maybeSingle();
  if (error && !missingColumn(error)) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ demand: cleanDemand(data?.display_prefs?.demand) });
}

export async function PUT(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canManageSetup(session.userId))) {
    return NextResponse.json(
      { error: "You do not have permission to change property setup." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const propertyId = await resolvePropertyId(session, body.propertyId);
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: current, error: readError } = await supabase
    .from("properties")
    .select("display_prefs")
    .eq("id", propertyId)
    .maybeSingle();
  if (readError) {
    const missing = missingColumn(readError);
    return NextResponse.json(
      { error: missing ? NEEDS_MIGRATION : readError.message },
      { status: missing ? 409 : 500 }
    );
  }

  // Other display choices stored beside this one are kept as they are.
  const demand = cleanDemand(body.demand);
  const { error } = await supabase
    .from("properties")
    .update({
      display_prefs: { ...(current?.display_prefs || {}), demand },
      updated_at: new Date().toISOString(),
    })
    .eq("id", propertyId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ demand });
}
