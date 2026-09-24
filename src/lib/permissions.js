/**
 * Role model.
 *
 *   SuperAdmin    - software team. Every property, and may switch between them.
 *   PropertyAdmin - admin of one property. Configures its setup and manages
 *                   its PropertyUsers.
 *   PropertyUser  - normal user of one property.
 *
 * 'Admin' is the pre-migration name for what is now SuperAdmin. It is still
 * accepted here so a session issued before migration 005 keeps working until
 * it expires.
 */

export const ROLES = {
  SUPER_ADMIN: "SuperAdmin",
  PROPERTY_ADMIN: "PropertyAdmin",
  PROPERTY_USER: "PropertyUser",
};

export const ROLE_OPTIONS = [
  { value: ROLES.SUPER_ADMIN, label: "Super Admin", hint: "Software team - all properties" },
  { value: ROLES.PROPERTY_ADMIN, label: "Property Admin", hint: "Admin of one property" },
  { value: ROLES.PROPERTY_USER, label: "Property User", hint: "Standard user" },
];

const LEGACY_SUPER_ADMIN = "Admin";

export function isSuperAdmin(user) {
  const role = user?.role;
  return role === ROLES.SUPER_ADMIN || role === LEGACY_SUPER_ADMIN;
}

export function isPropertyAdmin(user) {
  return user?.role === ROLES.PROPERTY_ADMIN;
}

/** Either admin tier. */
export function isAnyAdmin(user) {
  return isSuperAdmin(user) || isPropertyAdmin(user);
}

/** Configure room types and rate plans. */
export function canManageSetup(user) {
  return isAnyAdmin(user) || user?.can_manage_setup === true || user?.canManageSetup === true;
}

/** See the Manage Users panel at all. */
export function canManageUsers(user) {
  return isAnyAdmin(user);
}

/** Create or delete properties, and run system operations. */
export function canManageProperties(user) {
  return isSuperAdmin(user);
}

/** Switch between properties; a PropertyAdmin is scoped to their own. */
export function canSwitchProperties(user) {
  return isSuperAdmin(user);
}

/** Roles this user may assign. A PropertyAdmin may only create normal users. */
export function assignableRoles(user) {
  if (isSuperAdmin(user)) return ROLE_OPTIONS;
  if (isPropertyAdmin(user)) {
    return ROLE_OPTIONS.filter((r) => r.value === ROLES.PROPERTY_USER);
  }
  return [];
}

/**
 * Whether `actor` may administer `target`.
 * A SuperAdmin may administer anyone; a PropertyAdmin only PropertyUsers
 * within their own property, and never another admin.
 */
export function canAdministerUser(actor, target, actorPropertyId) {
  if (isSuperAdmin(actor)) return true;
  if (!isPropertyAdmin(actor)) return false;
  if (target?.role !== ROLES.PROPERTY_USER) return false;
  const targetProperty = target?.property_id ?? target?.propertyId ?? null;
  return Boolean(actorPropertyId) && targetProperty === actorPropertyId;
}

/**
 * Whether `target` may be managed as a user of a property.
 *
 * Super admins are software team: they may be linked to a property so they
 * can work in it, but they are not its staff and must not be editable or
 * removable from the property's user list, whoever is asking.
 */
export function isPropertyScopedUser(target) {
  return !isSuperAdmin(target);
}
