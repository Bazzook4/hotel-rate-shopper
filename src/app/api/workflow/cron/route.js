import { NextResponse } from "next/server";
import { listPropertiesWithWorkflows } from "@/lib/database";
import { runWorkflows } from "@/lib/workflow";
import { purgeStaleCheckins } from "@/lib/onlineCheckin";

/**
 * The daily check of every property's workflow rules (vercel.json, 06:00
 * IST). A rule that looks seven nights ahead gains a night each morning with
 * no booking to trigger it, so each property with a rule on is checked once
 * a day.
 *
 * There is no session: Vercel sends CRON_SECRET as a bearer token. Without
 * the secret set, the call is refused rather than left open.
 */
export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const properties = await listPropertiesWithWorkflows();
  const results = [];
  for (const propertyId of properties) {
    results.push({ propertyId, ...(await runWorkflows(propertyId)) });
  }

  // Online check-in links whose stay is over without the desk accepting
  // them are deleted with the ID copies sent through them.
  let checkinsPurged = 0;
  try {
    checkinsPurged = await purgeStaleCheckins();
  } catch (err) {
    console.error("Old check-in links not purged:", err.message);
  }

  return NextResponse.json({ checked: results.length, results, checkinsPurged });
}
