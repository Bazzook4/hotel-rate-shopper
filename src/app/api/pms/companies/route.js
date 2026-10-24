import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import { COMPANY_LOOKUP_PAGES, COMPANY_EDIT_PAGES, COMPANIES_NOT_READY } from "@/lib/companyAccess";
import { sessionRights } from "@/lib/propertyScope";
import { businessByCompany } from "@/lib/companyBusiness";
import { ledgerByCompany } from "@/lib/cityLedger";
import {
  getPropertyClock,
  companiesReady,
  listCompanies,
  getCompany,
  createCompany,
  updateCompany,
  deleteCompany,
} from "@/lib/database";

/** Companies and travel agents: the list, and each one's details. */

/** Checks a company must pass, as a message the desk can act on. */
function validate(body, { creating }) {
  if (creating || "name" in body) {
    if (!String(body.name || "").trim()) return "Company name is required.";
  }
  if (body.gstin) {
    const gstin = String(body.gstin).toUpperCase().replace(/\s+/g, "");
    if (!/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) {
      return "A GSTIN is 15 characters and starts with the two-digit state code.";
    }
  }
  if (body.email && !/^\S+@\S+\.\S+$/.test(String(body.email).trim())) {
    return "That email address does not look right.";
  }
  if (body.commission_percent != null && body.commission_percent !== "") {
    const c = Number(body.commission_percent);
    if (!Number.isFinite(c) || c < 0 || c > 100) return "Commission must be between 0 and 100%.";
  }
  for (const [f, label] of [["credit_days", "Credit days"], ["credit_limit", "Credit limit"]]) {
    if (body[f] == null || body[f] === "") continue;
    const n = Number(body[f]);
    if (!Number.isFinite(n) || n < 0) return `${label} must be zero or more.`;
  }
  return null;
}

async function readBody(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function GET(req) {
  const { error, session } = await pmsGuard(req, COMPANY_LOOKUP_PAGES);
  if (error) return error;

  const params = req.nextUrl.searchParams;
  const propertyId = await resolvePropertyId(session, params.get("propertyId"));
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });

  // Before the tables exist there is simply nobody to choose, and the
  // booking form carries on as it always has.
  if (!(await companiesReady())) return NextResponse.json({ companies: [], notReady: true });

  try {
    const companies = await listCompanies(propertyId, {
      includeInactive: params.get("active") !== "1",
    });
    if (params.get("summary") !== "1") return NextResponse.json({ companies });

    // The list page's figures: business done for whoever runs this page,
    // money owed and collected only for those who may see the City Ledger.
    const { rights } = await sessionRights(session);
    const tz = await getPropertyClock(propertyId);
    const [business, ledger] = await Promise.all([
      rights.includes("companies") ? businessByCompany(propertyId, { tz }) : null,
      rights.includes("cityledger") ? ledgerByCompany(propertyId, { tz }) : null,
    ]);
    return NextResponse.json({
      companies: companies.map((c) => ({
        ...c,
        ...(business ? { business: business.byCompany.get(c.id) || { bookings: 0, nights: 0, value: 0 } } : {}),
        ...(ledger ? { ledger: ledger.get(c.id) || null } : {}),
      })),
      businessFrom: business?.from || null,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  const { error, session } = await pmsGuard(req, COMPANY_EDIT_PAGES);
  if (error) return error;

  const body = await readBody(req);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const propertyId = await resolvePropertyId(session, body.property_id);
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });
  if (!(await companiesReady())) return NextResponse.json({ error: COMPANIES_NOT_READY }, { status: 409 });

  const invalid = validate(body, { creating: true });
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  try {
    const company = await createCompany(propertyId, body);
    return NextResponse.json({ company });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req) {
  const { error, session } = await pmsGuard(req, COMPANY_EDIT_PAGES);
  if (error) return error;

  const body = await readBody(req);
  if (!body?.id) return NextResponse.json({ error: "Company id is required" }, { status: 400 });
  const propertyId = await resolvePropertyId(session, body.property_id);
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });
  if (!(await companiesReady())) return NextResponse.json({ error: COMPANIES_NOT_READY }, { status: 409 });

  const invalid = validate(body, { creating: false });
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  try {
    if (!(await getCompany(propertyId, body.id))) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }
    const { id, property_id, ...changes } = body;
    const company = await updateCompany(propertyId, id, changes);
    return NextResponse.json({ company });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  const { error, session } = await pmsGuard(req, COMPANY_EDIT_PAGES);
  if (error) return error;

  const params = req.nextUrl.searchParams;
  const id = params.get("id");
  if (!id) return NextResponse.json({ error: "Company id is required" }, { status: 400 });
  const propertyId = await resolvePropertyId(session, params.get("propertyId"));
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });
  if (!(await companiesReady())) return NextResponse.json({ error: COMPANIES_NOT_READY }, { status: 409 });

  try {
    if (!(await getCompany(propertyId, id))) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }
    await deleteCompany(propertyId, id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
