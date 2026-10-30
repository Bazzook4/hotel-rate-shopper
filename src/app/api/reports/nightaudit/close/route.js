import { NextResponse } from "next/server";
import { getNightAudit } from "@/lib/financeReports";
import { getSupabaseAdmin, getUserById } from "@/lib/database";
import { dayRequest } from "../../params";

/**
 * Closing a business day (migration 068).
 *
 * The audit itself is worked out live, so it moves when a stay on the day is
 * edited later. Closing keeps a copy of it as it stands, with who closed it
 * and the cash they counted, so the owner has a fixed record of the day.
 * One close per date; the copy is never changed.
 */

const TABLE = "day_closes";

function notMigrated(error) {
  return /day_closes/.test(error?.message || "") || error?.code === "42P01";
}

async function closeFor(propertyId, date) {
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .select("*")
    .eq("property_id", propertyId)
    .eq("business_date", date)
    .maybeSingle();
  if (error) {
    if (notMigrated(error)) return { ready: false, close: null };
    throw new Error(`Failed to read the day close: ${error.message}`);
  }
  if (!data) return { ready: true, close: null };
  const user = data.closed_by ? await getUserById(data.closed_by).catch(() => null) : null;
  return {
    ready: true,
    close: { ...data, closed_by_name: user?.email ? String(user.email).split("@")[0] : null },
  };
}

export async function GET(req) {
  const ctx = await dayRequest(req, "nightaudit");
  if (ctx.error) return ctx.error;
  try {
    return NextResponse.json(await closeFor(ctx.propertyId, ctx.date));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  const ctx = await dayRequest(req, "nightaudit");
  if (ctx.error) return ctx.error;
  const body = await req.json().catch(() => ({}));
  const cash = body?.cash_counted === "" || body?.cash_counted == null ? null : Number(body.cash_counted);
  if (cash !== null && (!Number.isFinite(cash) || cash < 0)) {
    return NextResponse.json({ error: "Enter the cash counted: zero or more." }, { status: 400 });
  }

  try {
    const { ready, close } = await closeFor(ctx.propertyId, ctx.date);
    if (!ready) {
      return NextResponse.json({ error: "Closing the day is not switched on yet. Ask your admin." }, { status: 409 });
    }
    if (close) return NextResponse.json({ error: "This day is already closed." }, { status: 409 });

    const snapshot = await getNightAudit(ctx.propertyId, { date: ctx.date, tz: ctx.tz });
    const { error } = await getSupabaseAdmin().from(TABLE).insert({
      property_id: ctx.propertyId,
      business_date: ctx.date,
      closed_by: ctx.session?.userId || null,
      cash_counted: cash,
      snapshot,
    });
    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "This day is already closed." }, { status: 409 });
      throw new Error(`Failed to close the day: ${error.message}`);
    }
    return NextResponse.json(await closeFor(ctx.propertyId, ctx.date));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
