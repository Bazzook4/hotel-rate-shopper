import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import { getPropertyZone } from "@/lib/database";
import { getCityLedger, getCompanyStatement } from "@/lib/cityLedger";

/**
 * The city ledger: every company and agent's balance, aged, with the cash
 * expected and received -- or, with `companyId`, one company's statement.
 */
export async function GET(req) {
  const { error, session } = await pmsGuard(req, ["cityledger"]);
  if (error) return error;

  const params = req.nextUrl.searchParams;
  const propertyId = await resolvePropertyId(session, params.get("propertyId"));
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });
  const tz = await getPropertyZone(propertyId);

  try {
    const companyId = params.get("companyId");
    if (companyId) {
      const statement = await getCompanyStatement(propertyId, companyId, {
        tz,
        all: params.get("all") === "1",
      });
      if (!statement) return NextResponse.json({ error: "Company not found" }, { status: 404 });
      return NextResponse.json(statement);
    }
    return NextResponse.json(await getCityLedger(propertyId, { tz }));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
