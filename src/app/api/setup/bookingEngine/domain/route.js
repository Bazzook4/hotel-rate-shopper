import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import { approveDomain, getBookingSettings } from "@/lib/bookingEngine";
import { BOOKING_ENGINE_PAGES } from "@/lib/bookingEngineShared";
import { isSuperAdmin } from "@/lib/permissions";
import { domainStatus } from "@/lib/vercelDomains";

/**
 * The hotel's own web address. GET says where it stands (waiting for our
 * approval, waiting for the hotel's record, or live). POST approves it: our
 * team only, since approval puts the address on our hosting.
 */

async function open(req, requested) {
  const { error, session } = await pmsGuard(req, BOOKING_ENGINE_PAGES);
  if (error) return { response: error };
  const propertyId = await resolvePropertyId(session, requested);
  if (!propertyId) return { response: NextResponse.json({ error: "No property selected" }, { status: 400 }) };
  return { session, propertyId };
}

export async function GET(req) {
  const { propertyId, response } = await open(req, req.nextUrl.searchParams.get("propertyId"));
  if (response) return response;
  const { content } = await getBookingSettings(propertyId);
  const { domain, approved } = content.site;
  if (!domain || !approved) return NextResponse.json({ domain, approved: false });
  return NextResponse.json({ domain, approved, ...(await domainStatus(domain)) });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { session, propertyId, response } = await open(req, body.propertyId);
  if (response) return response;
  if (!isSuperAdmin(session)) {
    return NextResponse.json({ error: "Only our team can switch on your web address." }, { status: 403 });
  }
  try {
    const result = await approveDomain(propertyId);
    return NextResponse.json(result, { status: result.error ? 400 : 200 });
  } catch (err) {
    console.error("Domain approval failed:", err.message);
    return NextResponse.json({ error: "Could not approve the address. Please try again." }, { status: 500 });
  }
}
