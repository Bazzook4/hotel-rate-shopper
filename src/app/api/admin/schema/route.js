import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import { getSupabaseAdmin } from "@/lib/database";

/**
 * Which migrations still need running.
 *
 * Code deploys in minutes; a migration runs only when someone pastes it in.
 * That gap is what produces "column ... does not exist" errors, so this
 * reports it plainly instead of leaving it to be discovered by a failure.
 *
 * Each entry names one column a migration adds, and is probed by selecting
 * it: an error means the migration has not run.
 */
const CHECKS = [
  { migration: "002_user_modules_permissions", table: "user_modules", column: "module_id" },
  { migration: "004_rate_plan_master_link", table: "rate_plans", column: "is_master" },
  { migration: "005_three_tier_roles", table: "users", column: "can_manage_setup" },
  { migration: "007_partners_and_integrations", table: "partners", column: "slug" },
  { migration: "008_partner_activities", table: "partners", column: "supports_rates_out" },
  { migration: "009_partner_endpoints", table: "partners", column: "rates_url" },
  { migration: "009_partner_endpoints", table: "partner_reservations", column: "payload" },
];

export async function GET(req) {
  const session = await getSessionFromRequest(req);
  if (!session || !isSuperAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  const pending = [];

  for (const check of CHECKS) {
    const { error } = await supabase
      .from(check.table)
      .select(check.column)
      .limit(1);

    if (error) {
      pending.push({ ...check, detail: error.message });
    }
  }

  return NextResponse.json({
    ok: pending.length === 0,
    pending,
    // De-duplicated, in the order they must be applied.
    migrations: [...new Set(pending.map((p) => p.migration))].sort(),
  });
}
