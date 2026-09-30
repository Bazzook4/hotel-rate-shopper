import { getSupabaseAdmin, getUserModules } from "@/lib/database";
import { GRANTABLE_MODULES, normaliseGrants } from "@/app/dashboard/modules";
import { ROLES, isSuperAdmin } from "@/lib/permissions";

/**
 * Who may use which pages.
 *
 *   SuperAdmin    - every page.
 *   PropertyAdmin - exactly the pages a super admin gave them.
 *   PropertyUser  - the pages their property admin gave them, but never more
 *                   than the property's admins hold between them. Taking a
 *                   page away from the admins takes it from their users at
 *                   once, because the cap is applied when rights are read,
 *                   not only when they are saved.
 *
 * A property with no PropertyAdmin is run by a super admin directly, so
 * there is nobody's rights to cap its users by.
 */

export const ALL_MODULE_IDS = GRANTABLE_MODULES.map((m) => m.id);

/** What an onboarded hotel's admin gets until a super admin changes the default. */
const FALLBACK_DEFAULT = ALL_MODULE_IDS.filter((id) => id !== "parity" && id !== "compshopper");

const DEFAULT_KEY = "default_admin_modules";

const onlyGrantable = (ids) => normaliseGrants(ids).filter((id) => ALL_MODULE_IDS.includes(id));

/** The rights given to the admin of a hotel that signs up by onboarding link. */
export async function getDefaultAdminModules() {
  const { data, error } = await getSupabaseAdmin()
    .from("app_settings")
    .select("value")
    .eq("key", DEFAULT_KEY)
    .maybeSingle();
  if (error || !Array.isArray(data?.value)) return FALLBACK_DEFAULT;
  return onlyGrantable(data.value);
}

export async function setDefaultAdminModules(ids) {
  const value = onlyGrantable(ids);
  const { error } = await getSupabaseAdmin()
    .from("app_settings")
    .upsert({ key: DEFAULT_KEY, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Failed to save default rights: ${error.message}`);
  return value;
}

/**
 * The most a PropertyUser at this property may hold: every page any of its
 * PropertyAdmins holds. Null when the property has no PropertyAdmin, which
 * means no cap.
 */
export async function propertyCeiling(propertyId) {
  if (!propertyId) return null;
  const supabase = getSupabaseAdmin();

  const { data: links, error: linkError } = await supabase
    .from("user_properties")
    .select("user_id")
    .eq("property_id", propertyId);
  if (linkError) throw new Error(`Failed to read property users: ${linkError.message}`);
  const ids = (links || []).map((l) => l.user_id);
  if (!ids.length) return null;

  const { data: admins, error: adminError } = await supabase
    .from("users")
    .select("id")
    .in("id", ids)
    .eq("role", ROLES.PROPERTY_ADMIN);
  if (adminError) throw new Error(`Failed to read property admins: ${adminError.message}`);
  if (!admins?.length) return null;

  const { data: grants, error: grantError } = await supabase
    .from("user_modules")
    .select("module_id")
    .in("user_id", admins.map((a) => a.id))
    .eq("enabled", true);
  if (grantError) throw new Error(`Failed to read admin rights: ${grantError.message}`);

  return onlyGrantable((grants || []).map((g) => g.module_id));
}

/** A user's rights as they apply right now, capped where they must be. */
export async function effectiveModules(user, propertyId) {
  if (!user) return [];
  if (isSuperAdmin(user)) return ALL_MODULE_IDS;

  const own = onlyGrantable(await getUserModules(user.id));
  if (user.role !== ROLES.PROPERTY_USER) return own;

  const ceiling = await propertyCeiling(propertyId);
  return ceiling ? own.filter((id) => ceiling.includes(id)) : own;
}
