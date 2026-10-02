import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import { runWorkflows } from "@/lib/workflow";

/**
 * Check one property's workflow rules now: the page's "Run now". The daily
 * check of every property is /api/workflow/cron.
 */

export async function POST(req) {
  const { error, session } = await pmsGuard(req, "workflow");
  if (error) return error;

  let body = {};
  try {
    body = await req.json();
  } catch {
    // No body runs the caller's own property.
  }

  const propertyId = await resolvePropertyId(session, body.propertyId);
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });

  const result = await runWorkflows(propertyId);
  return NextResponse.json({ result });
}
