import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import {
  companiesReady,
  getCompany,
  listCompanyRates,
  saveCompanyRate,
  deleteCompanyRate,
} from "@/lib/database";
import { COMPANY_EDIT_PAGES, COMPANIES_NOT_READY } from "@/lib/companyAccess";

/**
 * A company's or agent's contracted rates, one line per room type, meal
 * plan and period. Read and written only from the Companies & agents page;
 * a booking reaches them through the quote.
 */

async function scope(req, requestedProperty) {
  const { error, session } = await pmsGuard(req, COMPANY_EDIT_PAGES);
  if (error) return { error };
  const propertyId = await resolvePropertyId(session, requestedProperty);
  if (!propertyId) {
    return { error: NextResponse.json({ error: "No property selected" }, { status: 400 }) };
  }
  if (!(await companiesReady())) {
    return { error: NextResponse.json({ error: COMPANIES_NOT_READY }, { status: 409 }) };
  }
  return { propertyId };
}

/** A save that failed on the line's own content is the desk's to fix: 400. */
const failure = (err) =>
  NextResponse.json(
    { error: err.message },
    { status: /^Failed to/.test(err.message) ? 500 : 400 }
  );

export async function GET(req) {
  const params = req.nextUrl.searchParams;
  const { error, propertyId } = await scope(req, params.get("propertyId"));
  if (error) return error;

  const companyId = params.get("companyId");
  if (!companyId) return NextResponse.json({ error: "Company id is required" }, { status: 400 });

  try {
    if (!(await getCompany(propertyId, companyId))) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }
    const rates = await listCompanyRates(companyId);
    return NextResponse.json({ rates });
  } catch (err) {
    return failure(err);
  }
}

async function save(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { error, propertyId } = await scope(req, body.property_id);
  if (error) return error;
  if (!body.company_id) return NextResponse.json({ error: "Company id is required" }, { status: 400 });

  try {
    const { company_id, property_id, ...line } = body;
    const rate = await saveCompanyRate(propertyId, company_id, line);
    return NextResponse.json({ rate });
  } catch (err) {
    return failure(err);
  }
}

export const POST = save;
export const PATCH = save;

export async function DELETE(req) {
  const params = req.nextUrl.searchParams;
  const { error, propertyId } = await scope(req, params.get("propertyId"));
  if (error) return error;

  const id = params.get("id");
  const companyId = params.get("companyId");
  if (!id || !companyId) {
    return NextResponse.json({ error: "Rate line and company are required" }, { status: 400 });
  }

  try {
    await deleteCompanyRate(propertyId, companyId, id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return failure(err);
  }
}
