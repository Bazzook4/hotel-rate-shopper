import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");
}

if (!SUPABASE_SERVICE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
}

// Create Supabase client with service role key for server-side operations
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Export Supabase admin client for use in other modules
export function getSupabaseAdmin() {
  return supabase;
}

// ============================================
// USER FUNCTIONS
// ============================================

export async function findUserByEmail(email) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .ilike('email', email)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to find user: ${error.message}`);
  }

  return data;
}

export async function getUserById(id) {
  if (!id) return null;

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get user: ${error.message}`);
  }

  return data;
}

export async function createUser({ email, passwordHash, role = 'PropertyUser', status = 'Active', propertyIds = [] }) {
  const { data: user, error: userError } = await supabase
    .from('users')
    .insert({
      email,
      password_hash: passwordHash,
      role,
      status,
    })
    .select()
    .single();

  if (userError) {
    throw new Error(`Failed to create user: ${userError.message}`);
  }

  // Link user to properties if provided
  if (propertyIds?.length) {
    const userProperties = propertyIds.map(propertyId => ({
      user_id: user.id,
      property_id: propertyId,
    }));

    const { error: linkError } = await supabase
      .from('user_properties')
      .insert(userProperties);

    if (linkError) {
      throw new Error(`Failed to link user to properties: ${linkError.message}`);
    }
  }

  return user;
}

export async function getUserPropertyId(userId) {
  if (!userId) return null;

  const { data, error } = await supabase
    .from('user_properties')
    .select('property_id')
    .eq('user_id', userId)
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching user property:', error);
    return null;
  }

  return data?.property_id || null;
}

// ============================================
// PROPERTY FUNCTIONS
// ============================================

export async function listProperties() {
  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .order('name', { ascending: true });

  if (error) {
    throw new Error(`Failed to list properties: ${error.message}`);
  }

  return data || [];
}

export async function getPropertyById(id) {
  if (!id) return null;

  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get property: ${error.message}`);
  }

  return data;
}

export async function updateProperty(id, updates) {
  const { data, error } = await supabase
    .from('properties')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update property: ${error.message}`);
  }

  return data;
}

// ============================================
// COMPSET FUNCTIONS
// ============================================

export async function getCompsetById(id) {
  if (!id) return null;

  const { data, error } = await supabase
    .from('compsets')
    .select('*')
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get compset: ${error.message}`);
  }

  return data;
}

export async function getCompsetsForProperty(propertyId) {
  if (!propertyId) return [];

  const { data, error } = await supabase
    .from('compsets')
    .select('*')
    .eq('property_id', propertyId);

  if (error) {
    throw new Error(`Failed to get compsets: ${error.message}`);
  }

  return data || [];
}

// ============================================
// SNAPSHOT FUNCTIONS
// ============================================

export async function listSnapshotsForCompset(compSetId, { limit = 50 } = {}) {
  const { data, error } = await supabase
    .from('snapshots')
    .select('*')
    .eq('compset_id', compSetId)
    .order('snapshot_date', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list snapshots: ${error.message}`);
  }

  return data || [];
}

export async function createSnapshotRecords(records) {
  if (!Array.isArray(records) || records.length === 0) return;

  const { error } = await supabase
    .from('snapshots')
    .insert(records);

  if (error) {
    throw new Error(`Failed to create snapshots: ${error.message}`);
  }
}

export async function createSearchSnapshot({
  query,
  payload,
  params,
  userId,
  userEmail,
  source = 'hotel_search',
  snapshotDate,
}) {
  if (!query) {
    throw new Error('query is required to create a search snapshot');
  }

  const snapshot = {
    source,
    search_query: query,
    payload: payload || null,
    request_params: params || null,
    saved_by_user_id: userId || null,
    saved_by_email: userEmail || null,
    snapshot_date: snapshotDate || new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('snapshots')
    .insert(snapshot)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create search snapshot: ${error.message}`);
  }

  return data;
}

export async function listSearchSnapshots({ userEmail, limit = 20 } = {}) {
  let query = supabase
    .from('snapshots')
    .select('*')
    .eq('source', 'hotel_search')
    .order('snapshot_date', { ascending: false })
    .limit(limit);

  if (userEmail) {
    query = query.ilike('saved_by_email', userEmail);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list search snapshots: ${error.message}`);
  }

  return data || [];
}

export async function getSnapshotById(id) {
  if (!id) return null;

  const { data, error } = await supabase
    .from('snapshots')
    .select('*')
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get snapshot: ${error.message}`);
  }

  return data;
}

export async function updateSearchSnapshot(id, { payload, params, snapshotDate } = {}) {
  if (!id) {
    throw new Error('id is required to update a search snapshot');
  }

  const updates = {};
  if (payload !== undefined) updates.payload = payload;
  if (params !== undefined) updates.request_params = params;
  if (snapshotDate !== undefined) updates.snapshot_date = snapshotDate;

  if (Object.keys(updates).length === 0) {
    return getSnapshotById(id);
  }

  const { data, error } = await supabase
    .from('snapshots')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update snapshot: ${error.message}`);
  }

  return data;
}

export async function deleteSnapshotById(id) {
  if (!id) {
    throw new Error('id is required to delete a snapshot');
  }

  const { error } = await supabase
    .from('snapshots')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`Failed to delete snapshot: ${error.message}`);
  }
}

// ============================================
// ROOM TYPE FUNCTIONS
// ============================================

export async function createRoomType({ property_id, room_type_name, base_price, number_of_rooms, base_adults, max_adults, description, amenities }) {
  const roomTypeId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const roomType = {
    room_type_id: roomTypeId,
    property_id: property_id,
    room_type_name: room_type_name,
    base_price: Number(base_price),
    number_of_rooms: Number(number_of_rooms),
    base_adults: base_adults ? Number(base_adults) : null,
    max_adults: max_adults ? Number(max_adults) : null,
    description: description || '',
    amenities: amenities || [],
  };

  const { data, error } = await supabase
    .from('room_types')
    .insert(roomType)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create room type: ${error.message}`);
  }

  return data;
}

export async function listRoomTypes(propertyId) {
  const { data, error } = await supabase
    .from('room_types')
    .select('*')
    .eq('property_id', propertyId)
    .order('rank', { ascending: true, nullsFirst: false });

  if (error) {
    throw new Error(`Failed to list room types: ${error.message}`);
  }

  return data || [];
}

export async function updateRoomType(id, updates) {
  // Sanitize numeric fields
  const sanitizedUpdates = { ...updates };

  if (sanitizedUpdates.base_price !== undefined) {
    sanitizedUpdates.base_price = Number(sanitizedUpdates.base_price);
  }
  if (sanitizedUpdates.number_of_rooms !== undefined) {
    sanitizedUpdates.number_of_rooms = Number(sanitizedUpdates.number_of_rooms);
  }
  if (sanitizedUpdates.base_adults !== undefined) {
    sanitizedUpdates.base_adults =
      sanitizedUpdates.base_adults === '' || !sanitizedUpdates.base_adults
        ? null
        : Number(sanitizedUpdates.base_adults);
  }
  if (sanitizedUpdates.max_adults !== undefined) {
    if (sanitizedUpdates.max_adults === '' || !sanitizedUpdates.max_adults) {
      sanitizedUpdates.max_adults = null;
    } else {
      sanitizedUpdates.max_adults = Number(sanitizedUpdates.max_adults);
    }
  }

  const { data, error } = await supabase
    .from('room_types')
    .update(sanitizedUpdates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update room type: ${error.message}`);
  }

  return data;
}

export async function deleteRoomType(id) {
  const { error } = await supabase
    .from('room_types')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`Failed to delete room type: ${error.message}`);
  }
}

// ============================================
// RATE PLAN FUNCTIONS
// ============================================

export async function createRatePlan({ property_id, plan_name, multiplier, cost_per_adult, pricing_type, description }) {
  const ratePlanId = `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const ratePlan = {
    rate_plan_id: ratePlanId,
    property_id: property_id,
    plan_name: plan_name,
    pricing_type: pricing_type || 'multiplier',
    multiplier: multiplier ? Number(multiplier) : null,
    cost_per_adult: cost_per_adult ? Number(cost_per_adult) : null,
    description: description || '',
  };

  const { data, error } = await supabase
    .from('rate_plans')
    .insert(ratePlan)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create rate plan: ${error.message}`);
  }

  return data;
}

export async function listRatePlans(propertyId) {
  const { data, error } = await supabase
    .from('rate_plans')
    .select('*')
    .eq('property_id', propertyId);

  if (error) {
    throw new Error(`Failed to list rate plans: ${error.message}`);
  }

  return data || [];
}

export async function updateRatePlan(id, updates) {
  const { data, error } = await supabase
    .from('rate_plans')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update rate plan: ${error.message}`);
  }

  return data;
}

export async function deleteRatePlan(id) {
  const { error } = await supabase
    .from('rate_plans')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`Failed to delete rate plan: ${error.message}`);
  }
}

// ============================================
// PRICING FACTORS FUNCTIONS
// ============================================

export async function createOrUpdatePricingFactors(propertyId, factors) {
  // Check if factors already exist
  const { data: existing } = await supabase
    .from('pricing_factors')
    .select('*')
    .eq('property_id', propertyId)
    .single();

  if (existing) {
    // Update existing
    const { data, error } = await supabase
      .from('pricing_factors')
      .update(factors)
      .eq('property_id', propertyId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update pricing factors: ${error.message}`);
    }

    return data;
  } else {
    // Create new
    const factorId = `factor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newFactors = {
      factor_id: factorId,
      property_id: propertyId,
      ...factors,
    };

    const { data, error } = await supabase
      .from('pricing_factors')
      .insert(newFactors)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create pricing factors: ${error.message}`);
    }

    return data;
  }
}

export async function getPricingFactors(propertyId) {
  const { data, error } = await supabase
    .from('pricing_factors')
    .select('*')
    .eq('property_id', propertyId)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get pricing factors: ${error.message}`);
  }

  return data;
}

// ============================================
// PRICING SNAPSHOT FUNCTIONS
// ============================================

export async function createPricingSnapshot(snapshotData) {
  const snapshotId = `snapshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const snapshot = {
    snapshot_id: snapshotId,
    ...snapshotData,
  };

  const { data, error } = await supabase
    .from('pricing_snapshots')
    .insert(snapshot)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create pricing snapshot: ${error.message}`);
  }

  return data;
}

export async function listPricingSnapshots(propertyId, { limit = 50 } = {}) {
  const { data, error } = await supabase
    .from('pricing_snapshots')
    .select('*')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list pricing snapshots: ${error.message}`);
  }

  return data || [];
}

// ============================================
// USER MODULES / PERMISSIONS FUNCTIONS
// ============================================

export async function setUserModules(userId, moduleIds) {
  if (!userId || !Array.isArray(moduleIds)) {
    throw new Error('userId and moduleIds array are required');
  }

  // First, delete existing modules for this user
  await supabase
    .from('user_modules')
    .delete()
    .eq('user_id', userId);

  // Insert new modules
  if (moduleIds.length > 0) {
    const modules = moduleIds.map(moduleId => ({
      user_id: userId,
      module_id: moduleId,
      enabled: true,
    }));

    const { error } = await supabase
      .from('user_modules')
      .insert(modules);

    if (error) {
      throw new Error(`Failed to set user modules: ${error.message}`);
    }
  }
}

export async function getUserModules(userId) {
  if (!userId) return [];

  const { data, error } = await supabase
    .from('user_modules')
    .select('module_id, enabled')
    .eq('user_id', userId)
    .eq('enabled', true);

  if (error) {
    throw new Error(`Failed to get user modules: ${error.message}`);
  }

  return data?.map(m => m.module_id) || [];
}

export async function checkUserModuleAccess(userId, moduleId) {
  if (!userId || !moduleId) return false;

  const { data, error } = await supabase
    .from('user_modules')
    .select('enabled')
    .eq('user_id', userId)
    .eq('module_id', moduleId)
    .eq('enabled', true)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Error checking module access:', error);
    return false;
  }

  return !!data;
}

// ============================================
// HELPER FUNCTIONS FOR BACKWARD COMPATIBILITY
// ============================================

// Map Supabase field names to Airtable-style field names for compatibility
function mapToAirtableFormat(record) {
  if (!record) return null;

  const mapped = { ...record };

  // Map common fields
  if (mapped.password_hash !== undefined) {
    mapped['Password Hash'] = mapped.password_hash;
  }
  if (mapped.email !== undefined) {
    mapped.Email = mapped.email;
  }
  if (mapped.role !== undefined) {
    mapped.Role = mapped.role;
  }
  if (mapped.status !== undefined) {
    mapped.Status = mapped.status;
  }
  if (mapped.name !== undefined) {
    mapped.Name = mapped.name;
  }

  return mapped;
}

// Wrap findUserByEmail to return Airtable-style format
const originalFindUserByEmail = findUserByEmail;
export { originalFindUserByEmail as findUserByEmailRaw };

// Override to maintain backward compatibility
export async function findUserByEmailCompat(email) {
  const user = await originalFindUserByEmail(email);
  return mapToAirtableFormat(user);
}

// ============================================
// SETUP ADMIN + RATE PLAN MASTER LINKING
// ============================================

/**
 * Whether a user may create or edit room types and rate plans.
 * Global Admins always may; other users need can_manage_setup.
 */
const SETUP_ROLES = ['SuperAdmin', 'PropertyAdmin', 'Admin'];

export async function canManageSetup(userId) {
  // can_manage_setup is added by migration 004. Selecting it before that
  // migration has run makes the whole query fail, which would deny access to
  // an admin who legitimately has it, so the role is read on its own first.
  const { data, error } = await supabase
    .from('users')
    .select('role')
    .eq('id', userId)
    .single();

  if (error || !data) return false;

  // 'Admin' is the pre-migration name for SuperAdmin and is still honoured.
  if (SETUP_ROLES.includes(data.role)) return true;

  // Otherwise fall back to the per-user grant, treating a missing column as
  // "not granted" rather than as an error.
  const { data: flag } = await supabase
    .from('users')
    .select('can_manage_setup')
    .eq('id', userId)
    .single();

  return flag?.can_manage_setup === true;
}

export async function setUserCanManageSetup(userId, canManage) {
  const { data, error } = await supabase
    .from('users')
    .update({ can_manage_setup: Boolean(canManage), updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select('id, email, role, can_manage_setup')
    .single();

  if (error) {
    throw new Error(`Failed to update setup permission: ${error.message}`);
  }

  return data;
}

/** Create a rate plan, including its master-derivation fields. */
export async function createRatePlanWithDerivation({
  property_id,
  room_type_id = null,
  plan_name,
  description = '',
  meal_plan = null,
  refundable = true,
  stop_sell = false,
  min_stay = null,
  max_stay = null,
  release_period = null,
  is_master = false,
  derive_from_id = null,
  derive_method = null,
  derive_value = null,
}) {
  const ratePlanId = `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const payload = {
    rate_plan_id: ratePlanId,
    property_id,
    room_type_id,
    plan_name,
    description,
    meal_plan,
    refundable: refundable !== false,
    stop_sell: Boolean(stop_sell),
    min_stay: min_stay === null || min_stay === '' ? null : Number(min_stay),
    max_stay: max_stay === null || max_stay === '' ? null : Number(max_stay),
    release_period:
      release_period === null || release_period === '' ? null : Number(release_period),
    is_master: Boolean(is_master),
    derive_from_id: derive_from_id || null,
    derive_method: derive_from_id ? derive_method : null,
    derive_value: derive_from_id ? Number(derive_value) : null,
  };

  const { data, error } = await supabase
    .from('rate_plans')
    .insert(payload)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create rate plan: ${error.message}`);
  }

  return data;
}

/** Update a rate plan's derivation, clearing the fields when unlinked. */
export async function updateRatePlanDerivation(id, updates) {
  const patch = { updated_at: new Date().toISOString() };

  if ('plan_name' in updates) patch.plan_name = updates.plan_name;
  if ('description' in updates) patch.description = updates.description;
  for (const key of [
    'meal_plan',
    'refundable',
    'stop_sell',
    'min_stay',
    'max_stay',
    'release_period',
    'close_on_arrival',
    'close_on_departure',
  ]) {
    if (key in updates) patch[key] = updates[key];
  }
  if ('room_type_id' in updates) patch.room_type_id = updates.room_type_id || null;
  if ('is_master' in updates) patch.is_master = Boolean(updates.is_master);

  if ('derive_from_id' in updates) {
    patch.derive_from_id = updates.derive_from_id || null;
    if (patch.derive_from_id) {
      patch.derive_method = updates.derive_method || null;
      patch.derive_value =
        updates.derive_value === null || updates.derive_value === undefined
          ? null
          : Number(updates.derive_value);
    } else {
      patch.derive_method = null;
      patch.derive_value = null;
    }
  }

  const { data, error } = await supabase
    .from('rate_plans')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update rate plan: ${error.message}`);
  }

  return data;
}

/**
 * Users visible to an actor.
 *
 * A SuperAdmin sees everyone; anyone else is scoped to a single property.
 * The user -> property link lives in user_properties, so the rows are
 * gathered from there and merged onto each user.
 */
export async function listUsersForActor({ propertyId = null } = {}) {
  let userIds = null;

  if (propertyId) {
    const { data: links, error: linkError } = await supabase
      .from('user_properties')
      .select('user_id')
      .eq('property_id', propertyId);

    if (linkError) {
      throw new Error(`Failed to list property users: ${linkError.message}`);
    }
    userIds = (links || []).map((l) => l.user_id);
    if (userIds.length === 0) return [];
  }

  let query = supabase
    .from('users')
    .select('id, email, role, status, created_at')
    .order('created_at', { ascending: false });

  if (userIds) {
    query = query.in('id', userIds);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to list users: ${error.message}`);
  }

  const users = data || [];
  if (users.length === 0) return [];

  // Attach each user's properties in one round trip.
  const { data: allLinks } = await supabase
    .from('user_properties')
    .select('user_id, property_id, properties(name)')
    .in('user_id', users.map((u) => u.id));

  const byUser = {};
  for (const link of allLinks || []) {
    (byUser[link.user_id] ||= []).push({
      id: link.property_id,
      name: link.properties?.name || null,
    });
  }

  return users.map((u) => ({ ...u, properties: byUser[u.id] || [] }));
}

/**
 * Update a user's role, status and property link.
 * Modules are handled separately by setUserModules.
 */
export async function updateUserAccount(userId, { role, status, propertyId } = {}) {
  const patch = { updated_at: new Date().toISOString() };
  if (role !== undefined) patch.role = role;
  if (status !== undefined) patch.status = status;

  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', userId)
    .select('id, email, role, status')
    .single();

  if (error) {
    throw new Error(`Failed to update user: ${error.message}`);
  }

  // A user belongs to one property here, so the link is replaced wholesale.
  if (propertyId !== undefined) {
    const { error: delError } = await supabase
      .from('user_properties')
      .delete()
      .eq('user_id', userId);

    if (delError) {
      throw new Error(`Failed to clear property link: ${delError.message}`);
    }

    if (propertyId) {
      const { error: insError } = await supabase
        .from('user_properties')
        .insert({ user_id: userId, property_id: propertyId });

      if (insError) {
        throw new Error(`Failed to link property: ${insError.message}`);
      }
    }
  }

  return data;
}

/** Users attached to one property, with their module grants. */
export async function listUsersForProperty(propertyId) {
  if (!propertyId) return [];

  const { data: links, error: linkError } = await supabase
    .from('user_properties')
    .select('user_id')
    .eq('property_id', propertyId);

  if (linkError) {
    throw new Error(`Failed to list property users: ${linkError.message}`);
  }

  const ids = (links || []).map((l) => l.user_id);
  if (ids.length === 0) return [];

  const { data: allUsers, error } = await supabase
    .from('users')
    .select('id, email, role, status, created_at')
    .in('id', ids)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to list users: ${error.message}`);
  }

  // Super admins are software team, not staff of a property. They may be
  // linked to one so they can work in it, but they are not listed as its
  // users and cannot be edited or removed from here. Filtered in JS rather
  // than with a PostgREST `not.in` so the quoting cannot silently exclude
  // everyone.
  const users = (allUsers || []).filter(
    (u) => u.role !== 'SuperAdmin' && u.role !== 'Admin'
  );

  const { data: mods } = await supabase
    .from('user_modules')
    .select('user_id, module_id, enabled')
    .in('user_id', ids);

  const byUser = {};
  for (const m of mods || []) {
    if (m.enabled !== false) (byUser[m.user_id] ||= []).push(m.module_id);
  }

  return (users || []).map((u) => ({ ...u, modules: byUser[u.id] || [] }));
}

// ============================================
// PARTNERS + PROPERTY INTEGRATIONS
// ============================================

/** All partners, without secrets. Safe to send to the browser. */
export async function listPartners() {
  const { data, error } = await supabase
    .from('partners')
    // Selecting '*' rather than naming columns, so a column added by a
    // migration that has not run yet cannot fail the whole query. Secrets are
    // stripped below instead of being excluded by the select.
    .select('*')
    .order('name');

  if (error) {
    throw new Error(`Failed to list partners: ${error.message}`);
  }

  // Never expose the password; say only whether one is set.
  return (data || []).map(({ api_password, ...p }) => ({
    ...p,
    has_password: Boolean(api_password),
  }));
}

/** A partner including its password. Server-side use only. */
export async function getPartnerBySlug(slug) {
  const { data, error } = await supabase
    .from('partners')
    .select('*')
    .eq('slug', slug)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get partner: ${error.message}`);
  }

  return data || null;
}

export async function updatePartner(id, updates) {
  const patch = { updated_at: new Date().toISOString() };
  for (const key of ['name', 'base_url', 'rates_url', 'inventory_url', 'api_username', 'partner_id', 'enabled', 'notes']) {
    if (key in updates) patch[key] = updates[key];
  }
  // An empty password means "leave unchanged", so it is only written when set.
  if (updates.api_password) patch.api_password = updates.api_password;

  const { data, error } = await supabase
    .from('partners')
    .update(patch)
    .eq('id', id)
    .select('id, slug, name, base_url, partner_id, api_username, enabled, notes')
    .single();

  if (error) {
    throw new Error(`Failed to update partner: ${error.message}`);
  }

  return data;
}

/** A property's integration with one partner, including its code map. */
export async function getPropertyIntegration(propertyId, partnerSlug) {
  const partner = await getPartnerBySlug(partnerSlug);
  if (!partner) return null;

  const { data: integration, error } = await supabase
    .from('property_integrations')
    .select('*')
    .eq('property_id', propertyId)
    .eq('partner_id', partner.id)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get integration: ${error.message}`);
  }

  if (!integration) return { partner, integration: null, codeMap: [] };

  const { data: codeMap } = await supabase
    .from('integration_code_map')
    .select('*')
    .eq('integration_id', integration.id);

  return { partner, integration, codeMap: codeMap || [] };
}

export async function upsertPropertyIntegration({
  propertyId,
  partnerId,
  hotelCode,
  enabled,
  ratesOut,
  inventoryOut,
  reservationsIn,
}) {
  const { data, error } = await supabase
    .from('property_integrations')
    .upsert(
      {
        property_id: propertyId,
        partner_id: partnerId,
        hotel_code: hotelCode ?? null,
        enabled: Boolean(enabled),
        rates_out: Boolean(ratesOut),
        inventory_out: Boolean(inventoryOut),
        reservations_in: Boolean(reservationsIn),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'property_id,partner_id' }
    )
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to save integration: ${error.message}`);
  }

  return data;
}

/** Replace an integration's code map wholesale. */
export async function saveIntegrationCodeMap(integrationId, rows) {
  const { error: delError } = await supabase
    .from('integration_code_map')
    .delete()
    .eq('integration_id', integrationId);

  if (delError) {
    throw new Error(`Failed to clear code map: ${delError.message}`);
  }

  const clean = (rows || []).filter(
    (r) => r.partner_room_code || r.partner_rateplan_code
  );
  if (clean.length === 0) return [];

  const { data, error } = await supabase
    .from('integration_code_map')
    .insert(
      clean.map((r) => ({
        integration_id: integrationId,
        room_type_id: r.room_type_id || null,
        rate_plan_id: r.rate_plan_id || null,
        partner_room_code: r.partner_room_code || null,
        partner_rateplan_code: r.partner_rateplan_code || null,
        occupancy: Number.isFinite(Number(r.occupancy)) ? Number(r.occupancy) : null,
        extra_adult: Number.isFinite(Number(r.extra_adult)) ? Number(r.extra_adult) : null,
        no_of_meals: Number.isFinite(Number(r.no_of_meals)) ? Number(r.no_of_meals) : null,
      }))
    )
    .select();

  if (error) {
    throw new Error(`Failed to save code map: ${error.message}`);
  }

  return data || [];
}

/** Find an integration by the secret in its inbound webhook URL. */
export async function getIntegrationByWebhookToken(token) {
  if (!token) return null;

  const { data, error } = await supabase
    .from('property_integrations')
    .select('*')
    .eq('webhook_token', token)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to resolve webhook: ${error.message}`);
  }

  return data || null;
}

/** Issue (or re-issue) the secret for a property's inbound webhook URL. */
export async function setWebhookToken(integrationId, token) {
  const { data, error } = await supabase
    .from('property_integrations')
    .update({ webhook_token: token, updated_at: new Date().toISOString() })
    .eq('id', integrationId)
    .select('id, webhook_token')
    .single();

  if (error) {
    throw new Error(`Failed to set webhook token: ${error.message}`);
  }

  return data;
}

/** Record a reservation pushed to us by a partner. */
export async function recordPartnerReservation(row) {
  const { data, error } = await supabase
    .from('partner_reservations')
    .insert(row)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to record reservation: ${error.message}`);
  }

  await supabase
    .from('property_integrations')
    .update({ last_reservation_at: new Date().toISOString() })
    .eq('id', row.integration_id);

  return data;
}

export async function listPartnerReservations(propertyId, { limit = 50 } = {}) {
  const { data, error } = await supabase
    .from('partner_reservations')
    .select('*')
    .eq('property_id', propertyId)
    .order('received_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list reservations: ${error.message}`);
  }

  return data || [];
}

// ============================================
// DAILY RATES
// ============================================

/** Stored rates for a property across a date window. */
export async function listDailyRates(propertyId, startDate, endDate) {
  const { data, error } = await supabase
    .from('daily_rates')
    .select('rate_plan_id, room_type_id, occupancy, stay_date, rate, pushed_at')
    .eq('property_id', propertyId)
    .gte('stay_date', startDate)
    .lte('stay_date', endDate);

  if (error) {
    throw new Error(`Failed to list rates: ${error.message}`);
  }

  return data || [];
}

/**
 * Save edited rates. Each row is one (rate plan, occupancy, date), so an
 * edit to one day does not disturb the rest.
 */
export async function saveDailyRates(propertyId, rows) {
  const clean = (rows || [])
    .filter((r) => r.rate_plan_id && r.stay_date && Number.isFinite(Number(r.rate)))
    .map((r) => ({
      property_id: propertyId,
      rate_plan_id: r.rate_plan_id,
      // A rate belongs to one room. NULL means the plan's own room, which is
      // what rows written before rooms were assignable meant.
      room_type_id: r.room_type_id || null,
      occupancy: Number(r.occupancy) || 2,
      stay_date: r.stay_date,
      rate: Number(r.rate),
      updated_at: new Date().toISOString(),
    }));

  if (clean.length === 0) return [];

  // Uniqueness is enforced by two partial indexes -- one for rows with a room
  // and one for rows without -- which PostgREST cannot name in onConflict. The
  // matching row is therefore updated directly, and only a miss inserts.
  const saved = [];
  for (const row of clean) {
    let find = supabase
      .from('daily_rates')
      .select('id')
      .eq('property_id', propertyId)
      .eq('rate_plan_id', row.rate_plan_id)
      .eq('occupancy', row.occupancy)
      .eq('stay_date', row.stay_date);
    find = row.room_type_id
      ? find.eq('room_type_id', row.room_type_id)
      : find.is('room_type_id', null);

    const { data: existing, error: findError } = await find.maybeSingle();
    if (findError) {
      throw new Error(`Failed to save rates: ${findError.message}`);
    }

    const { data, error } = existing
      ? await supabase
          .from('daily_rates')
          .update({ rate: row.rate, updated_at: row.updated_at, pushed_at: null })
          .eq('id', existing.id)
          .select()
          .single()
      : await supabase.from('daily_rates').insert(row).select().single();

    if (error) {
      throw new Error(`Failed to save rates: ${error.message}`);
    }
    saved.push(data);
  }

  return saved;
}

/** Mark rows as sent, so the grid can distinguish pending from pushed. */
export async function markRatesPushed(propertyId, rows) {
  const now = new Date().toISOString();
  for (const r of rows || []) {
    let query = supabase
      .from('daily_rates')
      .update({ pushed_at: now })
      .eq('property_id', propertyId)
      .eq('rate_plan_id', r.rate_plan_id)
      .eq('occupancy', Number(r.occupancy) || 2)
      .eq('stay_date', r.stay_date);
    query = r.room_type_id
      ? query.eq('room_type_id', r.room_type_id)
      : query.is('room_type_id', null);
    await query;
  }
}

// ============================================
// DAILY RESTRICTIONS
// ============================================

/** Stored per-date restrictions for a property across a date window. */
export async function listDailyRestrictions(propertyId, startDate, endDate) {
  const { data, error } = await supabase
    .from('daily_restrictions')
    .select('rate_plan_id, room_type_id, stay_date, stop_sell, min_stay, max_stay, pushed_at')
    .eq('property_id', propertyId)
    .gte('stay_date', startDate)
    .lte('stay_date', endDate);

  if (error) {
    throw new Error(`Failed to list restrictions: ${error.message}`);
  }

  return data || [];
}

/**
 * Save edited restrictions. Each row is one (rate plan, date).
 *
 * A field left undefined is stored as NULL, meaning "nothing set for this
 * date" -- the rate plan's own value then applies. That is why the numbers
 * are not coerced with `|| null`: 0 is invalid here, but undefined and null
 * both legitimately mean "unset".
 */
export async function saveDailyRestrictions(propertyId, rows) {
  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  };

  const clean = (rows || [])
    .filter((r) => r.rate_plan_id && r.stay_date)
    .map((r) => ({
      property_id: propertyId,
      rate_plan_id: r.rate_plan_id,
      room_type_id: r.room_type_id || null,
      stay_date: r.stay_date,
      stop_sell:
        r.stop_sell === null || r.stop_sell === undefined
          ? null
          : Boolean(r.stop_sell),
      min_stay: num(r.min_stay),
      max_stay: num(r.max_stay),
      updated_at: new Date().toISOString(),
    }));

  if (clean.length === 0) return [];

  // As with rates, uniqueness comes from partial indexes that onConflict
  // cannot name, so the matching row is updated directly.
  const saved = [];
  for (const row of clean) {
    let find = supabase
      .from('daily_restrictions')
      .select('id')
      .eq('property_id', propertyId)
      .eq('rate_plan_id', row.rate_plan_id)
      .eq('stay_date', row.stay_date);
    find = row.room_type_id
      ? find.eq('room_type_id', row.room_type_id)
      : find.is('room_type_id', null);

    const { data: existing, error: findError } = await find.maybeSingle();
    if (findError) {
      throw new Error(`Failed to save restrictions: ${findError.message}`);
    }

    const patch = {
      stop_sell: row.stop_sell,
      min_stay: row.min_stay,
      max_stay: row.max_stay,
      updated_at: row.updated_at,
      pushed_at: null,
    };

    const { data, error } = existing
      ? await supabase
          .from('daily_restrictions')
          .update(patch)
          .eq('id', existing.id)
          .select()
          .single()
      : await supabase.from('daily_restrictions').insert(row).select().single();

    if (error) {
      throw new Error(`Failed to save restrictions: ${error.message}`);
    }
    saved.push(data);
  }

  return saved;
}

/** Mark restriction rows as sent, mirroring markRatesPushed. */
export async function markRestrictionsPushed(propertyId, rows) {
  const now = new Date().toISOString();
  for (const r of rows || []) {
    let query = supabase
      .from('daily_restrictions')
      .update({ pushed_at: now })
      .eq('property_id', propertyId)
      .eq('rate_plan_id', r.rate_plan_id)
      .eq('stay_date', r.stay_date);
    query = r.room_type_id
      ? query.eq('room_type_id', r.room_type_id)
      : query.is('room_type_id', null);
    await query;
  }
}

// ============================================
// RATE PLAN ROOM ASSIGNMENTS
// ============================================

/**
 * Which room types are assigned to a property's rate plans, and at what rate.
 *
 * A rate plan is property-level: it says what the guest is buying. The rate
 * differs per room, which is what these rows carry.
 */
export async function listRatePlanRooms(propertyId) {
  const { data, error } = await supabase
    .from('rate_plan_rooms')
    .select('id, rate_plan_id, room_type_id, full_rate, adult_rates, included_occupancy, extra_adult_rate, extra_child_rate')
    .eq('property_id', propertyId);

  if (error) {
    throw new Error(`Failed to list rate plan rooms: ${error.message}`);
  }

  return data || [];
}

/**
 * Replace a rate plan's room assignments.
 *
 * The supplied rows become the whole set: a room left out is unassigned, so
 * clearing a checkbox in the form removes the room rather than leaving a
 * stale row behind. Rooms still listed are upserted, so their rates update
 * without the assignment being torn down and recreated.
 */
export async function saveRatePlanRooms(propertyId, ratePlanId, rows) {
  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  /**
   * The per-adult rates, keyed by adult count: {"1": 3500, "2": 4000}.
   *
   * Entries outside 1..baseAdults are dropped, so lowering a room's base
   * adults does not leave rates for occupancies it no longer sells.
   */
  const adultRates = (value, baseAdults) => {
    if (!value || typeof value !== 'object') return null;
    const out = {};
    const limit = Number.isFinite(Number(baseAdults)) ? Number(baseAdults) : null;
    for (const [k, v] of Object.entries(value)) {
      const adults = Number(k);
      if (!Number.isInteger(adults) || adults < 1) continue;
      if (limit !== null && adults > limit) continue;
      const rate = num(v);
      if (rate !== null) out[adults] = rate;
    }
    return Object.keys(out).length > 0 ? out : null;
  };

  const clean = (rows || [])
    .filter((r) => r.room_type_id)
    .map((r) => {
      const rates = adultRates(r.adult_rates, r.base_adults);
      // full_rate stays written as the rate at base occupancy, so anything
      // still reading it -- and the fallback for rooms with no per-adult
      // rates -- keeps working.
      const atBase =
        rates && r.base_adults != null && rates[Number(r.base_adults)] != null
          ? rates[Number(r.base_adults)]
          : rates
          ? Math.max(...Object.values(rates))
          : num(r.full_rate);

      return {
        property_id: propertyId,
        rate_plan_id: ratePlanId,
        room_type_id: r.room_type_id,
        full_rate: atBase,
        adult_rates: rates,
        included_occupancy:
          r.included_occupancy === null ||
          r.included_occupancy === undefined ||
          r.included_occupancy === ''
            ? null
            : Math.max(1, Math.trunc(Number(r.included_occupancy))) || null,
        extra_adult_rate: num(r.extra_adult_rate),
        extra_child_rate: num(r.extra_child_rate),
        updated_at: new Date().toISOString(),
      };
    });

  const keep = clean.map((r) => r.room_type_id);

  // Drop assignments the caller no longer lists. Done before the upsert so a
  // room removed and re-added in one save ends up with the new rates.
  let del = supabase
    .from('rate_plan_rooms')
    .delete()
    .eq('property_id', propertyId)
    .eq('rate_plan_id', ratePlanId);
  if (keep.length > 0) {
    del = del.not('room_type_id', 'in', `(${keep.join(',')})`);
  }
  const { error: delError } = await del;
  if (delError) {
    throw new Error(`Failed to update room assignments: ${delError.message}`);
  }

  if (clean.length === 0) return [];

  const { data, error } = await supabase
    .from('rate_plan_rooms')
    .upsert(clean, { onConflict: 'rate_plan_id,room_type_id' })
    .select();

  if (error) {
    throw new Error(`Failed to assign rooms: ${error.message}`);
  }

  return data || [];
}

// ============================================
// SYNC LOGS
// ============================================

/** JSON stored per log row is capped so one push cannot bloat the table. */
const LOG_JSON_LIMIT = 20000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Trim a payload down to something worth keeping.
 *
 * A year-long push is far larger than anyone reads, so the body is truncated
 * rather than refused: a clipped record still settles "what did we send".
 */
function trimForLog(value) {
  if (value === null || value === undefined) return null;
  try {
    const json = JSON.stringify(value);
    if (json.length <= LOG_JSON_LIMIT) return value;
    return {
      truncated: true,
      original_bytes: json.length,
      preview: json.slice(0, LOG_JSON_LIMIT),
    };
  } catch {
    return { truncated: true, error: "payload could not be serialised" };
  }
}

/**
 * Write one activity-log row.
 *
 * Never throws: a failed log must not fail the push it describes. Callers get
 * the row back, or null if the write did not land.
 */
export async function recordSyncLog(entry) {
  try {
    const row = {
      property_id: entry.property_id || null,
      integration_id: entry.integration_id || null,
      kind: entry.kind,
      direction: entry.direction || "out",
      status: entry.status,
      source: entry.source || null,
      // Dev sessions carry a non-UUID user id, and the column is a real
      // foreign key, so anything that is not a uuid is kept as the email only.
      user_id: UUID_RE.test(entry.user_id || "") ? entry.user_id : null,
      user_email: entry.user_email || null,
      date_from: entry.date_from || null,
      date_to: entry.date_to || null,
      entry_count: Number.isFinite(entry.entry_count) ? entry.entry_count : null,
      summary: entry.summary || null,
      error: entry.error ? String(entry.error).slice(0, 2000) : null,
      duration_ms: Number.isFinite(entry.duration_ms) ? entry.duration_ms : null,
      request: trimForLog(entry.request),
      response: trimForLog(entry.response),
    };

    const { data, error } = await supabase
      .from('sync_logs')
      .insert(row)
      .select()
      .single();

    if (error) {
      console.error("Failed to write sync log:", error.message);
      return null;
    }

    return data;
  } catch (err) {
    console.error("Failed to write sync log:", err.message);
    return null;
  }
}

/**
 * Read the log for a property, newest first.
 *
 * `kinds` filters to given activities; `status` to success/failed/skipped.
 * Returns the page of rows plus the total, so the UI can page through.
 */
export async function listSyncLogs(
  propertyId,
  { kinds, status, from, to, limit = 100, offset = 0 } = {}
) {
  let query = supabase
    .from('sync_logs')
    .select('*', { count: 'exact' })
    .eq('property_id', propertyId);

  if (Array.isArray(kinds) && kinds.length > 0) query = query.in('kind', kinds);
  if (status) query = query.eq('status', status);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`Failed to list sync logs: ${error.message}`);
  }

  return { rows: data || [], total: count ?? (data || []).length };
}

// ============================================
// RATE PARITY
// ============================================

/**
 * Every stored observation for a property across a date window.
 *
 * Returned flat and grouped by the caller: the grid needs them keyed by
 * channel then date, but the CSV export wants them as rows, so neither shape
 * is imposed here.
 */
export async function listParityRates(propertyId, startDate, endDate, { nights = 1, guests = 2 } = {}) {
  const { data, error } = await supabase
    .from('parity_rates')
    .select('*')
    .eq('property_id', propertyId)
    .eq('nights', nights)
    .eq('guests', guests)
    .gte('stay_date', startDate)
    .lte('stay_date', endDate)
    .order('stay_date', { ascending: true });

  if (error) {
    throw new Error(`Failed to load parity rates: ${error.message}`);
  }

  return data || [];
}

/**
 * Replace the observations for the cells a refresh just covered.
 *
 * Upserted on the unique cell index rather than deleted and re-inserted, so a
 * refresh that fails part way leaves the earlier rates on screen instead of
 * blanking the grid.
 */
export async function saveParityRates(propertyId, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  const now = new Date().toISOString();
  const payload = rows.map((r) => ({
    property_id: propertyId,
    stay_date: r.stay_date,
    nights: r.nights ?? 1,
    guests: r.guests ?? 2,
    channel: r.channel,
    channel_key: r.channel_key,
    channel_logo: r.channel_logo || null,
    link: r.link || null,
    rate: r.rate ?? null,
    currency: r.currency || 'INR',
    includes_tax: r.includes_tax === true,
    sold_out: r.sold_out === true,
    checked_at: now,
  }));

  const { error } = await supabase
    .from('parity_rates')
    .upsert(payload, { onConflict: 'property_id,stay_date,nights,guests,channel_key' });

  if (error) {
    throw new Error(`Failed to save parity rates: ${error.message}`);
  }

  return payload.length;
}

/**
 * Drop observations for dates a refresh covered but that returned no channel
 * at all. Without this a channel that stops selling a night keeps showing its
 * last known rate forever, which reads as current data.
 */
export async function clearParityRatesForDates(propertyId, dates, { nights = 1, guests = 2 } = {}) {
  if (!Array.isArray(dates) || dates.length === 0) return;

  const { error } = await supabase
    .from('parity_rates')
    .delete()
    .eq('property_id', propertyId)
    .eq('nights', nights)
    .eq('guests', guests)
    .in('stay_date', dates);

  if (error) {
    throw new Error(`Failed to clear parity rates: ${error.message}`);
  }
}

// ============================================
// COMPETITOR SHOPPER
// ============================================

export async function listCompetitors(propertyId) {
  const { data, error } = await supabase
    .from('competitors')
    .select('*')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load competitors: ${error.message}`);
  }

  return data || [];
}

/**
 * Replace the competitor list in one go.
 *
 * The Manage competitors panel edits the whole set and saves once, so this
 * mirrors that: rows the hotelier removed are deleted, the rest upserted.
 * Deleting a competitor takes its stored rates with it via the foreign key,
 * which is intended -- rates for a hotel nobody is tracking are noise.
 */
export async function saveCompetitors(propertyId, rows) {
  const keep = (rows || []).filter((r) => r.property_token && r.name);

  // Remove anything no longer on the list before inserting, so a swap that
  // takes the list back to its cap does not trip the limit mid-save.
  const tokens = keep.map((r) => r.property_token);
  let remove = supabase.from('competitors').delete().eq('property_id', propertyId);
  if (tokens.length > 0) {
    remove = remove.not('property_token', 'in', `(${tokens.map((t) => `"${t}"`).join(',')})`);
  }
  const { error: deleteError } = await remove;
  if (deleteError) {
    throw new Error(`Failed to update competitors: ${deleteError.message}`);
  }

  if (keep.length === 0) return [];

  const payload = keep.map((r) => ({
    property_id: propertyId,
    property_token: r.property_token,
    name: r.name,
    address: r.address || null,
    hotel_class: r.hotel_class || null,
    latitude: r.latitude ?? null,
    longitude: r.longitude ?? null,
    added_via: r.added_via === 'manual' ? 'manual' : 'suggested',
  }));

  const { data, error } = await supabase
    .from('competitors')
    .upsert(payload, { onConflict: 'property_id,property_token' })
    .select();

  if (error) {
    throw new Error(`Failed to save competitors: ${error.message}`);
  }

  return data || [];
}

/** Stored competitor rates across a date window. */
export async function listCompetitorRates(propertyId, startDate, endDate, { nights = 1, guests = 2 } = {}) {
  const { data, error } = await supabase
    .from('competitor_rates')
    .select('*')
    .eq('property_id', propertyId)
    .eq('nights', nights)
    .eq('guests', guests)
    .gte('stay_date', startDate)
    .lte('stay_date', endDate);

  if (error) {
    throw new Error(`Failed to load competitor rates: ${error.message}`);
  }

  return data || [];
}

/** Upserted one cell at a time, so a part-finished refresh keeps what it got. */
export async function saveCompetitorRates(propertyId, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  const now = new Date().toISOString();
  const payload = rows.map((r) => ({
    property_id: propertyId,
    competitor_id: r.competitor_id,
    stay_date: r.stay_date,
    nights: r.nights ?? 1,
    guests: r.guests ?? 2,
    rate: r.rate ?? null,
    currency: r.currency || 'INR',
    channel: r.channel || null,
    link: r.link || null,
    sold_out: r.sold_out === true,
    checked_at: now,
  }));

  const { error } = await supabase
    .from('competitor_rates')
    .upsert(payload, { onConflict: 'competitor_id,stay_date,nights,guests' });

  if (error) {
    throw new Error(`Failed to save competitor rates: ${error.message}`);
  }

  return payload.length;
}
