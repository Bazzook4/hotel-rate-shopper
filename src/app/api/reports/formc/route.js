import { NextResponse } from "next/server";
import { getFormC, saveFormC } from "@/lib/guestRegister";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import { periodRequest } from "../params";

/**
 * Form C: every foreign guest who checked in, the form's details for each,
 * and whether it has been filed on the FRRO site.
 */

const MAX_DAYS = 120;

export async function GET(req) {
  const ctx = await periodRequest(req, "policereport", MAX_DAYS);
  if (ctx.error) return ctx.error;

  try {
    return NextResponse.json(await getFormC(ctx.propertyId, { start: ctx.start, end: ctx.end, tz: ctx.tz }));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** Mark one guest's form filed (with the FRRO number) or not filed. */
export async function PUT(req) {
  const { error, session } = await pmsGuard(req, ["policereport"]);
  if (error) return error;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const propertyId = await resolvePropertyId(session, body?.propertyId);
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });
  if (!body?.reservationId || !body?.personKey) {
    return NextResponse.json({ error: "Say which guest the form is for." }, { status: 400 });
  }

  try {
    await saveFormC(
      propertyId,
      {
        reservationId: body.reservationId,
        personKey: String(body.personKey),
        details: body.details || {},
        frroReference: body.frroReference,
        submitted: typeof body.submitted === "boolean" ? body.submitted : undefined,
      },
      session.userId
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
