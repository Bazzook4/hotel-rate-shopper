import { createClient } from '@supabase/supabase-js';
// The Channel Manager's own resolver. Shared rather than reimplemented so a
// booking and the grid cannot drift to different prices for the same night.
import { resolveAllRates } from '@/lib/ratePlanPricing';

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
    room_name: r.room_name || null,
    free_cancellation: r.free_cancellation === true,
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

// ============================================
// DYNAMIC PRICING
// ============================================

/** Floor and ceiling per room type. */
export async function listPricingBounds(propertyId) {
  const { data, error } = await supabase
    .from('pricing_bounds')
    .select('*')
    .eq('property_id', propertyId);

  if (error) throw new Error(`Failed to load pricing bounds: ${error.message}`);
  return data || [];
}

/**
 * Save bounds for several room types at once.
 *
 * A row with neither bound set is deleted rather than stored: "no floor and
 * no ceiling" is the absence of a rule, not a rule.
 */
export async function savePricingBounds(propertyId, rows) {
  const keep = [];
  const drop = [];

  for (const row of rows || []) {
    if (!row.room_type_id) continue;
    const floor = row.floor_rate === "" || row.floor_rate == null ? null : Number(row.floor_rate);
    const ceiling = row.ceiling_rate === "" || row.ceiling_rate == null ? null : Number(row.ceiling_rate);
    if (floor == null && ceiling == null) {
      drop.push(row.room_type_id);
    } else {
      keep.push({
        property_id: propertyId,
        room_type_id: row.room_type_id,
        floor_rate: floor,
        ceiling_rate: ceiling,
        updated_at: new Date().toISOString(),
      });
    }
  }

  if (drop.length > 0) {
    const { error } = await supabase
      .from('pricing_bounds')
      .delete()
      .eq('property_id', propertyId)
      .in('room_type_id', drop);
    if (error) throw new Error(`Failed to clear pricing bounds: ${error.message}`);
  }

  if (keep.length > 0) {
    const { error } = await supabase
      .from('pricing_bounds')
      .upsert(keep, { onConflict: 'property_id,room_type_id' });
    if (error) throw new Error(`Failed to save pricing bounds: ${error.message}`);
  }

  return listPricingBounds(propertyId);
}

/**
 * The property's strategy, or the defaults it has not overridden yet.
 *
 * Returns a usable strategy rather than null, so the engine never has to
 * decide what an unconfigured property means.
 */
export async function getPricingStrategy(propertyId) {
  const { data, error } = await supabase
    .from('pricing_strategy')
    .select('*')
    .eq('property_id', propertyId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load pricing strategy: ${error.message}`);

  return (
    data || {
      property_id: propertyId,
      weight_compset: 1.0,
      weight_occupancy: 1.0,
      weight_weekday: 0.5,
      weight_pickup: 1.0,
      weight_adr_90: 0.5,
      weight_adr_ly: 0.5,
      weight_events: 1.0,
      max_change_pct: 25.0,
    }
  );
}

export async function savePricingStrategy(propertyId, updates) {
  const row = {
    property_id: propertyId,
    ...updates,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('pricing_strategy')
    .upsert(row, { onConflict: 'property_id' })
    .select()
    .single();

  if (error) throw new Error(`Failed to save pricing strategy: ${error.message}`);
  return data;
}

export async function listPricingRecommendations(propertyId, startDate, endDate) {
  const { data, error } = await supabase
    .from('pricing_recommendations')
    .select('*')
    .eq('property_id', propertyId)
    .gte('stay_date', startDate)
    .lte('stay_date', endDate)
    .order('stay_date', { ascending: true });

  if (error) throw new Error(`Failed to load recommendations: ${error.message}`);
  return data || [];
}

/**
 * Replace the recommendations for the cells just recalculated.
 *
 * A cell a hotelier has already decided on is left alone: recalculating
 * should not quietly reopen a decision they made, nor discard a rate they
 * accepted but that has not yet been pushed.
 */
export async function savePricingRecommendations(propertyId, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  const now = new Date().toISOString();
  const payload = rows.map((r) => ({
    property_id: propertyId,
    room_type_id: r.room_type_id,
    stay_date: r.stay_date,
    current_rate: r.current_rate ?? null,
    recommended_rate: r.recommended_rate,
    reasons: r.reasons || null,
    bounded_by: r.bounded_by || null,
    status: 'pending',
    decided_by: null,
    decided_at: null,
    updated_at: now,
  }));

  const { error } = await supabase
    .from('pricing_recommendations')
    .upsert(payload, { onConflict: 'property_id,room_type_id,stay_date' });

  if (error) throw new Error(`Failed to save recommendations: ${error.message}`);
  return payload.length;
}

/** Mark recommendations decided, by a person or by automation. */
export async function decideRecommendations(propertyId, ids, status, decidedBy = 'manual') {
  if (!Array.isArray(ids) || ids.length === 0) return [];

  const { data, error } = await supabase
    .from('pricing_recommendations')
    .update({
      status,
      decided_by: decidedBy,
      decided_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('property_id', propertyId)
    .in('id', ids)
    .select();

  if (error) throw new Error(`Failed to update recommendations: ${error.message}`);
  return data || [];
}

/**
 * The channel order a property has chosen for its parity grid.
 *
 * Returns a map of channel_key -> position. Empty when the property has
 * never reordered, which the grid reads as "fall back to cheapest first".
 */
export async function getParityChannelOrder(propertyId) {
  const { data, error } = await supabase
    .from('parity_channel_order')
    .select('channel_key, position')
    .eq('property_id', propertyId)
    .order('position', { ascending: true });

  if (error) {
    throw new Error(`Failed to load channel order: ${error.message}`);
  }

  const order = {};
  for (const row of data || []) order[row.channel_key] = row.position;
  return order;
}

/**
 * Save a property's channel order.
 *
 * Replaces the whole order rather than patching positions: the client sends
 * the list as the hotelier arranged it, and renumbering from scratch keeps
 * the stored positions dense and unambiguous. A channel dropped from the list
 * loses its row and returns to the default ordering.
 */
export async function saveParityChannelOrder(propertyId, channelKeys) {
  const { error: clearError } = await supabase
    .from('parity_channel_order')
    .delete()
    .eq('property_id', propertyId);

  if (clearError) {
    throw new Error(`Failed to clear channel order: ${clearError.message}`);
  }

  const rows = (channelKeys || [])
    .filter(Boolean)
    .map((channel_key, position) => ({
      property_id: propertyId,
      channel_key,
      position,
      updated_at: new Date().toISOString(),
    }));

  if (rows.length === 0) return 0;

  const { error } = await supabase.from('parity_channel_order').insert(rows);
  if (error) {
    throw new Error(`Failed to save channel order: ${error.message}`);
  }
  return rows.length;
}

// ============================================
// PMS — ROOMS, RESERVATIONS, NIGHTS
// ============================================

/**
 * Every night of a stay: check-in through the night before check-out.
 *
 * Departure day is not a night slept, so a one-night stay yields one date.
 * Dates are handled as plain YYYY-MM-DD strings throughout the PMS rather
 * than Date objects, because a stay date is a calendar fact about the hotel
 * and must not shift when the server's timezone differs from the property's.
 */
export function nightsBetween(checkIn, checkOut) {
  const nights = [];
  const end = new Date(`${checkOut}T00:00:00Z`);
  for (
    let d = new Date(`${checkIn}T00:00:00Z`);
    d < end;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    nights.push(d.toISOString().slice(0, 10));
  }
  return nights;
}

/** The physical rooms a property owns, with the type each belongs to. */
export async function listRooms(propertyId, { includeInactive = true } = {}) {
  let query = supabase
    .from('rooms')
    .select('*, room_types(id, room_type_name)')
    .eq('property_id', propertyId);

  if (!includeInactive) query = query.eq('is_active', true);

  const { data, error } = await query.order('room_number', { ascending: true });
  if (error) throw new Error(`Failed to load rooms: ${error.message}`);
  return data || [];
}

export async function createRoom(row) {
  const { data, error } = await supabase
    .from('rooms')
    .insert(row)
    .select('*, room_types(id, room_type_name)')
    .single();

  // The unique index on (property_id, room_number) is the real guard against
  // two rooms sharing a door; translate it into something a hotelier reads.
  if (error) {
    if (error.code === '23505') {
      throw new Error(`Room ${row.room_number} already exists at this property.`);
    }
    throw new Error(`Failed to create room: ${error.message}`);
  }
  return data;
}

export async function updateRoom(id, updates) {
  const { data, error } = await supabase
    .from('rooms')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*, room_types(id, room_type_name)')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error(`Room ${updates.room_number} already exists at this property.`);
    }
    throw new Error(`Failed to update room: ${error.message}`);
  }
  return data;
}

export async function deleteRoom(id) {
  const { error } = await supabase.from('rooms').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete room: ${error.message}`);
  return true;
}

/**
 * Create rooms in bulk from a numeric range.
 *
 * Numbering 231 rooms one at a time is not work a hotelier should have to do.
 * Rooms whose number already exists are skipped rather than failing the whole
 * range, so re-running a range that partly exists fills in only the gaps.
 */
export async function createRoomRange({
  property_id,
  room_type_id,
  from,
  to,
  prefix = '',
  floor = null,
}) {
  const existing = new Set(
    (await listRooms(property_id)).map((r) => r.room_number)
  );

  const rows = [];
  for (let n = Number(from); n <= Number(to); n += 1) {
    const room_number = `${prefix}${n}`;
    if (existing.has(room_number)) continue;
    rows.push({ property_id, room_type_id, room_number, floor });
  }

  if (rows.length === 0) return [];

  const { data, error } = await supabase.from('rooms').insert(rows).select('*');
  if (error) throw new Error(`Failed to create rooms: ${error.message}`);
  return data || [];
}

/**
 * A short booking reference the front desk can read out.
 *
 * Shaped as RS-XXXXX from an alphabet with no O/0 or I/1, because these get
 * spoken over the phone and misheard characters cost a phone call. Collisions
 * are handled by the unique constraint and a retry in createReservation
 * rather than by a lookup here, which would race anyway.
 */
export function generateReservationReference() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 5; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `RS-${out}`;
}

/** The statuses that still hold a room. A cancelled stay frees its nights. */
const OCCUPYING_STATUSES = ['confirmed', 'in_house', 'checked_out'];

/**
 * Rooms sold per room type per date, across a window.
 *
 * Counts nights rather than reservations, which is why the nights table
 * exists: a stay spanning the window's edge must still count on the dates it
 * covers. Cancellations and no-shows are excluded -- they released the room.
 *
 * Returns a map of `<roomTypeId>|<date>` -> count.
 */
export async function getSoldCounts(propertyId, startDate, endDate) {
  const { data, error } = await supabase
    .from('reservation_nights')
    .select('stay_date, room_type_id, reservations!inner(property_id, status)')
    .eq('reservations.property_id', propertyId)
    .in('reservations.status', OCCUPYING_STATUSES)
    .gte('stay_date', startDate)
    .lte('stay_date', endDate);

  if (error) throw new Error(`Failed to load occupancy: ${error.message}`);

  const sold = {};
  for (const row of data || []) {
    const key = `${row.room_type_id}|${row.stay_date}`;
    sold[key] = (sold[key] || 0) + 1;
  }
  return sold;
}

/**
 * Whether a room type has a room free on every night of a stay.
 *
 * Checks against the number of physical rooms of that type, falling back to
 * the type's own `number_of_rooms` when no physical rooms have been set up --
 * a property can take bookings before it has numbered its doors.
 *
 * `ignoreReservationId` lets an edit re-check its own dates without counting
 * itself as a competitor for the room.
 */
export async function checkAvailability(
  propertyId,
  roomTypeId,
  checkIn,
  checkOut,
  { ignoreReservationId = null } = {}
) {
  const nights = nightsBetween(checkIn, checkOut);
  if (nights.length === 0) return { available: false, reason: 'Stay must be at least one night.' };

  const { data: roomType, error: typeError } = await supabase
    .from('room_types')
    .select('id, room_type_name, number_of_rooms')
    .eq('id', roomTypeId)
    .single();

  if (typeError) throw new Error(`Failed to load room type: ${typeError.message}`);

  const physical = (await listRooms(propertyId, { includeInactive: false }))
    .filter((r) => r.room_type_id === roomTypeId).length;
  const capacity = physical || Number(roomType?.number_of_rooms) || 0;

  let query = supabase
    .from('reservation_nights')
    .select('stay_date, reservation_id, reservations!inner(property_id, status)')
    .eq('reservations.property_id', propertyId)
    .eq('room_type_id', roomTypeId)
    .in('reservations.status', OCCUPYING_STATUSES)
    .gte('stay_date', nights[0])
    .lte('stay_date', nights[nights.length - 1]);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to check availability: ${error.message}`);

  const sold = {};
  for (const row of data || []) {
    if (ignoreReservationId && row.reservation_id === ignoreReservationId) continue;
    sold[row.stay_date] = (sold[row.stay_date] || 0) + 1;
  }

  // Report the first night that fails, since that is what the front desk
  // needs to tell the guest -- not merely that something was unavailable.
  for (const night of nights) {
    if ((sold[night] || 0) >= capacity) {
      return {
        available: false,
        reason: `${roomType?.room_type_name || 'That room type'} is fully booked on ${night}.`,
        date: night,
        capacity,
      };
    }
  }

  return { available: true, capacity };
}

/** Reservations for a property, newest arrival first, with the joins the list needs. */
export async function listReservations(
  propertyId,
  { status = null, from = null, to = null, search = null, limit = 200 } = {}
) {
  let query = supabase
    .from('reservations')
    .select(
      '*, room_types(id, room_type_name), rooms(id, room_number), rate_plans(id, plan_name)'
    )
    .eq('property_id', propertyId);

  if (status) query = query.eq('status', status);
  // A stay overlaps the window when it starts before the window ends and
  // ends after the window starts -- not when check_in alone falls inside it,
  // which would hide guests already in house on the first day.
  if (to) query = query.lt('check_in', to);
  if (from) query = query.gt('check_out', from);
  if (search) {
    const term = `%${search}%`;
    query = query.or(
      `guest_name.ilike.${term},reference.ilike.${term},guest_email.ilike.${term},guest_phone.ilike.${term}`
    );
  }

  const { data, error } = await query
    .order('check_in', { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Failed to load reservations: ${error.message}`);
  return data || [];
}

export async function getReservation(id) {
  const { data, error } = await supabase
    .from('reservations')
    .select(
      '*, room_types(id, room_type_name), rooms(id, room_number), rate_plans(id, plan_name), reservation_nights(stay_date, rate, room_id)'
    )
    .eq('id', id)
    .single();

  if (error) throw new Error(`Failed to load reservation: ${error.message}`);
  return data;
}

/**
 * Write the nights for a stay, replacing whatever was there.
 *
 * Called on create and on any edit that moves the dates. Replacing wholesale
 * rather than diffing keeps the nights table a pure function of the
 * reservation's dates, which is the property the availability count relies on.
 *
 * `rates` maps a date to what that night costs. Dates it does not cover fall
 * back to an even share of the total, which is the honest answer when the
 * price was only ever recorded as one figure.
 */
async function writeNights(reservation, { rate = null, rates = null } = {}) {
  const { error: clearError } = await supabase
    .from('reservation_nights')
    .delete()
    .eq('reservation_id', reservation.id);

  if (clearError) {
    throw new Error(`Failed to clear nights: ${clearError.message}`);
  }

  const nights = nightsBetween(reservation.check_in, reservation.check_out);

  // With no per-night breakdown, spread the total evenly so a night-by-night
  // view still shows something honest. The reservation's own total stays the
  // authority on what is owed.
  const perNight =
    rate ??
    (reservation.total_amount != null && nights.length > 0
      ? Number(reservation.total_amount) / nights.length
      : null);

  const rows = nights.map((stay_date) => {
    const own = rates?.[stay_date];
    const value = own != null && Number.isFinite(Number(own)) ? Number(own) : perNight;
    return {
      reservation_id: reservation.id,
      stay_date,
      room_type_id: reservation.room_type_id,
      room_id: reservation.room_id || null,
      rate: value != null ? Number(value.toFixed(2)) : null,
    };
  });

  if (rows.length === 0) return 0;

  const { error } = await supabase.from('reservation_nights').insert(rows);
  if (error) throw new Error(`Failed to save nights: ${error.message}`);
  return rows.length;
}

/**
 * A night-by-night breakdown the caller supplied, if it can be trusted.
 *
 * Accepted only when it covers exactly the stay's nights and adds up to the
 * stay's total -- a breakdown that disagrees with the total it came with would
 * make the folio's arithmetic lie, which is the thing it exists not to do.
 * Returns a date -> rate map, or null to fall back to spreading the total.
 */
export function acceptNightRates(nightRates, checkIn, checkOut, total) {
  if (!Array.isArray(nightRates) || total == null || total === '') return null;

  const dates = nightsBetween(checkIn, checkOut);
  const map = {};
  for (const n of nightRates) {
    const value = Number(n?.rate);
    if (!n?.stay_date || !Number.isFinite(value) || value < 0) return null;
    map[n.stay_date] = value;
  }

  if (dates.length !== Object.keys(map).length) return null;
  if (!dates.every((d) => d in map)) return null;

  const sum = dates.reduce((acc, d) => acc + map[d], 0);
  return Math.abs(sum - Number(total)) < 0.01 ? map : null;
}

/**
 * Create a reservation and the nights it occupies.
 *
 * The reference can collide, so a duplicate is retried with a fresh one
 * rather than surfacing a constraint error the hotelier cannot act on.
 */
export async function createReservation(row, { rate = null, rates = null } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = { ...row, reference: row.reference || generateReservationReference() };

    const { data, error } = await supabase
      .from('reservations')
      .insert(candidate)
      .select('*')
      .single();

    if (!error) {
      await writeNights(data, { rate, rates });
      return getReservation(data.id);
    }

    // 23505 is a unique violation; only the reference is worth retrying,
    // and only when the caller did not pin one.
    if (error.code === '23505' && !row.reference) {
      lastError = error;
      continue;
    }
    throw new Error(`Failed to create reservation: ${error.message}`);
  }

  throw new Error(
    `Failed to create reservation: could not allocate a booking reference (${lastError?.message}).`
  );
}

/**
 * Update a reservation, rewriting its nights when the stay moved.
 *
 * Dates, room type and assigned room all feed the nights rows, so a change to
 * any of them makes the stored nights stale.
 *
 * What each night costs is carried across rather than re-spread wherever the
 * edit did not change it. The Details form re-sends every field on save, and
 * re-spreading the total on every save would flatten a weekend rate or a
 * night the desk re-priced by hand into an average nobody chose.
 *
 *   `rates` given          the caller priced the stay night by night
 *   same dates, same total each night keeps what it cost
 *   same dates, new total  each night is scaled, so the shape survives
 *   anything else          the total is spread evenly, as before
 */
export async function updateReservation(id, updates, { rates = null } = {}) {
  const before = await getReservation(id);

  const { data, error } = await supabase
    .from('reservations')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to update reservation: ${error.message}`);

  const touchesNights = ['check_in', 'check_out', 'room_type_id', 'room_id', 'total_amount'].some(
    (k) => k in updates
  );

  if (touchesNights) {
    let carried = rates;

    const sameDates =
      before.check_in === data.check_in && before.check_out === data.check_out;
    const oldRates = {};
    for (const n of before.reservation_nights || []) {
      if (n.rate != null) oldRates[n.stay_date] = Number(n.rate);
    }
    const oldCount = Object.keys(oldRates).length;
    const oldSum = Object.values(oldRates).reduce((a, b) => a + b, 0);
    const complete = oldCount > 0 && oldCount === (before.reservation_nights || []).length;

    if (!carried && sameDates && complete) {
      const newTotal = data.total_amount == null ? null : Number(data.total_amount);
      if (newTotal == null || Math.abs(newTotal - oldSum) < 0.01) {
        carried = oldRates;
      } else if (oldSum > 0) {
        carried = scaleRates(oldRates, newTotal);
      }
    }

    await writeNights(data, { rates: carried });
  }

  return getReservation(id);
}

/**
 * Scale a date -> rate map to a new total, keeping its proportions.
 *
 * Rounded to the paisa, with the rounding left over put on the last night so
 * the nights still add up to exactly the total they were scaled to.
 */
function scaleRates(rates, total) {
  const dates = Object.keys(rates).sort();
  const sum = dates.reduce((acc, d) => acc + rates[d], 0);
  const out = {};
  let running = 0;
  dates.forEach((d, i) => {
    if (i === dates.length - 1) {
      out[d] = Number((total - running).toFixed(2));
    } else {
      out[d] = Number(((rates[d] / sum) * total).toFixed(2));
      running += out[d];
    }
  });
  return out;
}

/**
 * What each night of a stay costs, as the stay stands now.
 *
 * Nights recorded without a rate -- an OTA booking that arrived as one total
 * -- are given an even share of that total, the same way the nights were
 * written in the first place.
 */
function currentNightRates(reservation) {
  const nights = [...(reservation.reservation_nights || [])].sort((a, b) =>
    a.stay_date.localeCompare(b.stay_date)
  );
  const total = Number(reservation.total_amount) || 0;
  const share = nights.length > 0 ? total / nights.length : 0;
  return nights.map((n) => ({
    stay_date: n.stay_date,
    rate: n.rate != null ? Number(n.rate) : Number(share.toFixed(2)),
  }));
}

/**
 * What changing a stay's dates does to its price, before anything is saved.
 *
 * The calendar used to move a stay and leave its total alone, so dragging a
 * three-night bar out to five gave the guest two nights free without anyone
 * deciding that. This works the change out night by night instead:
 *
 *   A move that keeps the length (drag the whole bar) carries each night's
 *   rate across in order. It is the same stay on different dates, and the desk
 *   did not ask for it to be re-priced.
 *
 *   A resize keeps the nights that survive at what they cost, prices each new
 *   night from the Channel Manager exactly as a new booking would be quoted,
 *   and lists the nights that fall away with what they were worth.
 *
 * The desk then chooses: adjust the total by the difference, or keep it. The
 * result carries both outcomes so the dialog can show real figures for each.
 */
export async function planStayChange(reservation, { check_in, check_out, room_type_id }) {
  const current = currentNightRates(reservation);
  const oldTotal = Number(reservation.total_amount) || 0;
  const newDates = nightsBetween(check_in, check_out);
  const typeId = room_type_id || reservation.room_type_id;

  // Same length: the stay slid along the chart. Night i keeps night i's rate.
  if (newDates.length === current.length) {
    return {
      lengthChanged: false,
      nights: newDates.map((stay_date, i) => ({
        stay_date,
        rate: current[i]?.rate ?? 0,
        state: 'kept',
      })),
      added: [],
      removed: [],
      currentTotal: oldTotal,
      adjustedTotal: oldTotal,
      delta: 0,
    };
  }

  const byDate = {};
  for (const n of current) byDate[n.stay_date] = n.rate;

  const addedDates = newDates.filter((d) => !(d in byDate));
  const removed = current.filter((n) => !newDates.includes(n.stay_date));

  // New nights are quoted exactly as a new booking would be, so an extension
  // is charged what the channels are selling that night for.
  let quoted = {};
  let source = null;
  if (addedDates.length > 0) {
    const quote = await quoteReservation({
      property_id: reservation.property_id,
      room_type_id: typeId,
      rate_plan_id: reservation.rate_plan_id,
      check_in,
      check_out,
      adults: reservation.adults,
      children: reservation.children,
    }).catch(() => null);
    for (const n of quote?.nights || []) {
      if (n.rate != null) quoted[n.stay_date] = n.rate;
    }
    source = quote?.source || null;
  }

  // A night nothing is configured for is priced at the stay's own average
  // night, and flagged, rather than silently becoming free.
  const average = current.length > 0 ? oldTotal / current.length : 0;

  const nights = newDates.map((stay_date) => {
    if (stay_date in byDate) return { stay_date, rate: byDate[stay_date], state: 'kept' };
    const hit = quoted[stay_date];
    return hit != null
      ? { stay_date, rate: hit, state: 'added' }
      : { stay_date, rate: Number(average.toFixed(2)), state: 'added', estimated: true };
  });

  const added = nights.filter((n) => n.state === 'added');
  const adjustedTotal = Number(nights.reduce((sum, n) => sum + n.rate, 0).toFixed(2));

  return {
    lengthChanged: true,
    nights,
    added,
    removed,
    source,
    currentTotal: oldTotal,
    adjustedTotal,
    delta: Number((adjustedTotal - oldTotal).toFixed(2)),
  };
}

/**
 * Apply a planned stay change, with the pricing the desk chose.
 *
 *   'adjust'  the total becomes the sum of the new nights
 *   'keep'    the guest pays what they were paying: added nights go on at
 *             nothing, and nights taken away are kept as a retention charge
 *             on the folio, so the total stands and the breakdown still says
 *             where every rupee comes from
 *
 * In both cases the reservation's total is the sum of its nights, which is
 * what lets the Inclusions tab show how the total was arrived at.
 */
export async function applyStayChange(id, updates, plan, pricing = 'adjust') {
  const keep = pricing === 'keep' && plan.lengthChanged;

  const rates = {};
  for (const n of plan.nights) {
    rates[n.stay_date] = keep && n.state === 'added' ? 0 : n.rate;
  }
  const total = Number(Object.values(rates).reduce((a, b) => a + b, 0).toFixed(2));

  const reservation = await updateReservation(
    id,
    { ...updates, total_amount: total },
    { rates }
  );

  if (keep && plan.removed.length > 0) {
    const retained = plan.removed.reduce((sum, n) => sum + n.rate, 0);
    if (retained > 0) {
      const readable = (d) =>
        new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          timeZone: 'UTC',
        });
      const first = readable(plan.removed[0].stay_date);
      const last = readable(plan.removed[plan.removed.length - 1].stay_date);
      await addReservationExtra(id, {
        name: `Retained — shortened stay (${first === last ? first : `${first} to ${last}`})`,
        unit_price: Number(retained.toFixed(2)),
        quantity: 1,
        kind: 'extra',
      });
    }
  }

  return reservation;
}

/**
 * Re-price one night of a stay by hand.
 *
 * The total follows: it is the sum of the nights, and letting the two drift
 * apart would make the folio's "how this adds up" a claim rather than a sum.
 */
export async function setNightRate(reservationId, stayDate, rate) {
  const value = Number(rate);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('A night cannot cost less than nothing.');
  }

  const { data, error } = await supabase
    .from('reservation_nights')
    .update({ rate: Number(value.toFixed(2)) })
    .eq('reservation_id', reservationId)
    .eq('stay_date', stayDate)
    .select('stay_date');

  if (error) throw new Error(`Failed to save the night: ${error.message}`);
  if (!data || data.length === 0) throw new Error('That night is not part of this stay.');

  const { data: nights, error: nightsError } = await supabase
    .from('reservation_nights')
    .select('rate')
    .eq('reservation_id', reservationId);

  if (nightsError) throw new Error(`Failed to re-total the stay: ${nightsError.message}`);

  const total = (nights || []).reduce((sum, n) => sum + (Number(n.rate) || 0), 0);

  const { error: totalError } = await supabase
    .from('reservations')
    .update({ total_amount: Number(total.toFixed(2)), updated_at: new Date().toISOString() })
    .eq('id', reservationId);

  if (totalError) throw new Error(`Failed to re-total the stay: ${totalError.message}`);
  return true;
}

/**
 * Move a reservation through its lifecycle.
 *
 * Check-in and check-out stamp the time they actually happened, which is what
 * separates a guest who has arrived from one who is merely expected today.
 */
export async function setReservationStatus(id, status, { roomId = undefined } = {}) {
  const updates = { status, updated_at: new Date().toISOString() };

  if (status === 'in_house') updates.checked_in_at = new Date().toISOString();
  if (status === 'checked_out') updates.checked_out_at = new Date().toISOString();
  if (roomId !== undefined) updates.room_id = roomId;

  const { data, error } = await supabase
    .from('reservations')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to update reservation: ${error.message}`);

  // A room assigned at check-in has to reach the nights too, or the room grid
  // will show the guest as unassigned for their whole stay.
  if (roomId !== undefined) {
    const { error: nightsError } = await supabase
      .from('reservation_nights')
      .update({ room_id: roomId })
      .eq('reservation_id', id);
    if (nightsError) {
      throw new Error(`Failed to assign room to nights: ${nightsError.message}`);
    }
  }

  return getReservation(data.id);
}

export async function deleteReservation(id) {
  // Nights cascade with the reservation, so this is the whole delete.
  const { error } = await supabase.from('reservations').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete reservation: ${error.message}`);
  return true;
}

/**
 * Turn inbound partner bookings into PMS reservations.
 *
 * `partner_reservations` is a raw log of what the channel manager sent: one
 * row per webhook call, including modifications and cancellations of a stay
 * already recorded. A reservation is the current state of that stay, so
 * adoption folds the log down rather than copying it row for row -- the
 * newest row per booking id wins, and its action decides what happens.
 *
 * Bookings missing dates are skipped and reported rather than guessed at: a
 * stay with no arrival is not something the front desk can work with, and
 * inventing one would quietly corrupt availability.
 */
export async function adoptPartnerReservations(propertyId, { limit = 200 } = {}) {
  const { data: inbound, error } = await supabase
    .from('partner_reservations')
    .select('*')
    .eq('property_id', propertyId)
    .order('received_at', { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Failed to load partner reservations: ${error.message}`);

  // Ascending order means a later row overwrites an earlier one, leaving the
  // most recent state of each booking.
  const latest = new Map();
  for (const row of inbound || []) {
    if (!row.partner_booking_id) continue;
    latest.set(row.partner_booking_id, row);
  }

  if (latest.size === 0) {
    return { created: 0, updated: 0, cancelled: 0, skipped: 0, reasons: [] };
  }

  const { data: existingRows, error: existingError } = await supabase
    .from('reservations')
    .select('id, partner_booking_id, status')
    .eq('property_id', propertyId)
    .in('partner_booking_id', [...latest.keys()]);

  if (existingError) {
    throw new Error(`Failed to match existing reservations: ${existingError.message}`);
  }

  const existing = new Map(
    (existingRows || []).map((r) => [r.partner_booking_id, r])
  );

  // An OTA booking names a room type only in free text, if at all, so the
  // adopted stay lands on the property's first room type and is flagged for
  // the front desk to correct. Guessing by name matching would be worse:
  // a wrong match is harder to notice than an obvious default.
  const roomTypes = await listRoomTypes(propertyId);
  const fallbackRoomType = roomTypes[0];

  const result = { created: 0, updated: 0, cancelled: 0, skipped: 0, reasons: [] };

  for (const [bookingId, row] of latest) {
    const match = existing.get(bookingId);

    if (row.action === 'cancel') {
      if (match && match.status !== 'cancelled') {
        await setReservationStatus(match.id, 'cancelled');
        result.cancelled += 1;
      } else if (!match) {
        // A cancellation for a stay never adopted is not an error -- there is
        // simply nothing to cancel.
        result.skipped += 1;
      }
      continue;
    }

    if (!row.check_in || !row.check_out) {
      result.skipped += 1;
      result.reasons.push(`${bookingId}: no stay dates in the booking`);
      continue;
    }

    if (!fallbackRoomType) {
      result.skipped += 1;
      result.reasons.push(`${bookingId}: the property has no room types set up`);
      continue;
    }

    const fields = {
      guest_name: row.guest_name || 'OTA guest',
      check_in: row.check_in,
      check_out: row.check_out,
      total_amount: row.amount,
      currency: row.currency || 'INR',
      source: row.channel || 'OTA',
    };

    if (match) {
      await updateReservation(match.id, fields);
      result.updated += 1;
    } else {
      await createReservation({
        ...fields,
        property_id: propertyId,
        room_type_id: fallbackRoomType.id,
        partner_booking_id: bookingId,
        status: 'confirmed',
        notes: `Adopted from ${row.channel || 'the channel manager'} — confirm the room type.`,
      });
      result.created += 1;
    }
  }

  return result;
}

/**
 * The calendar's per-date picture: capacity, sold and free per room type.
 *
 * Built from the same nights rows the availability check uses, so the
 * calendar and a booking attempt can never disagree about whether a date is
 * full.
 */
export async function getAvailabilityGrid(propertyId, startDate, endDate) {
  const [roomTypes, rooms, sold] = await Promise.all([
    listRoomTypes(propertyId),
    listRooms(propertyId, { includeInactive: false }),
    getSoldCounts(propertyId, startDate, endDate),
  ]);

  const physicalByType = {};
  for (const room of rooms) {
    physicalByType[room.room_type_id] = (physicalByType[room.room_type_id] || 0) + 1;
  }

  const dates = nightsBetween(startDate, endDate);
  // nightsBetween excludes its end date, but a calendar window is inclusive
  // of the last day the hotelier asked to see.
  if (!dates.includes(endDate)) dates.push(endDate);

  return {
    dates,
    roomTypes: roomTypes.map((rt) => {
      const capacity = physicalByType[rt.id] || Number(rt.number_of_rooms) || 0;
      return {
        id: rt.id,
        name: rt.room_type_name,
        capacity,
        days: dates.map((date) => {
          const count = sold[`${rt.id}|${date}`] || 0;
          return { date, sold: count, free: Math.max(0, capacity - count) };
        }),
      };
    }),
  };
}

// ============================================
// PMS — THE FOLIO: GUESTS, EXTRAS, PAYMENTS, INVOICES
// ============================================

/** Named guests on a booking, primary first. */
export async function listReservationGuests(reservationId) {
  const { data, error } = await supabase
    .from('reservation_guests')
    .select('*')
    .eq('reservation_id', reservationId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to load guests: ${error.message}`);
  return data || [];
}

/**
 * Add or update a guest on a booking.
 *
 * The primary guest's name is mirrored onto the reservation, because every
 * list and search reads it from there rather than joining.
 */
export async function saveReservationGuest(reservationId, guest) {
  const row = {
    reservation_id: reservationId,
    first_name: guest.first_name?.trim(),
    last_name: guest.last_name?.trim() || null,
    email: guest.email?.trim() || null,
    phone: guest.phone?.trim() || null,
    gender: guest.gender || null,
    is_primary: guest.is_primary === true,
  };

  // Only one guest may be primary, so promoting this one demotes the rest
  // before the write rather than letting the partial index reject it.
  if (row.is_primary) {
    const { error: demoteError } = await supabase
      .from('reservation_guests')
      .update({ is_primary: false })
      .eq('reservation_id', reservationId)
      .neq('id', guest.id || '00000000-0000-0000-0000-000000000000');
    if (demoteError) {
      throw new Error(`Failed to update guests: ${demoteError.message}`);
    }
  }

  const query = guest.id
    ? supabase.from('reservation_guests').update(row).eq('id', guest.id)
    : supabase.from('reservation_guests').insert(row);

  const { data, error } = await query.select('*').single();
  if (error) throw new Error(`Failed to save guest: ${error.message}`);

  if (data.is_primary) {
    const name = [data.first_name, data.last_name].filter(Boolean).join(' ');
    await supabase
      .from('reservations')
      .update({
        guest_name: name,
        guest_email: data.email,
        guest_phone: data.phone,
        updated_at: new Date().toISOString(),
      })
      .eq('id', reservationId);
  }

  return data;
}

export async function deleteReservationGuest(id) {
  const { error } = await supabase.from('reservation_guests').delete().eq('id', id);
  if (error) throw new Error(`Failed to remove guest: ${error.message}`);
  return true;
}

/** The property's menu of extras and inclusions. */
export async function listPropertyExtras(propertyId) {
  const { data, error } = await supabase
    .from('property_extras')
    .select('*')
    .eq('property_id', propertyId)
    .eq('is_active', true)
    .order('kind', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw new Error(`Failed to load extras: ${error.message}`);
  return data || [];
}

export async function savePropertyExtra(row) {
  const query = row.id
    ? supabase.from('property_extras').update(row).eq('id', row.id)
    : supabase.from('property_extras').insert(row);

  const { data, error } = await query.select('*').single();
  if (error) {
    if (error.code === '23505') {
      throw new Error(`“${row.name}” is already on the list.`);
    }
    throw new Error(`Failed to save extra: ${error.message}`);
  }
  return data;
}

export async function listReservationExtras(reservationId) {
  const { data, error } = await supabase
    .from('reservation_extras')
    .select('*')
    .eq('reservation_id', reservationId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to load extras: ${error.message}`);
  return data || [];
}

/**
 * Put a line on a stay's folio.
 *
 * The name and price are copied from the menu rather than referenced, so
 * re-pricing breakfast next month cannot rewrite what this guest was charged.
 * A `per_night` item is multiplied out here, at the one moment the stay's
 * length is known to be what the line was priced against.
 */
export async function addReservationExtra(reservationId, line) {
  let { name, unit_price, quantity = 1, kind = 'extra', extra_id = null, stay_date = null } = line;

  if (extra_id) {
    const { data: menuItem, error } = await supabase
      .from('property_extras')
      .select('*')
      .eq('id', extra_id)
      .single();

    if (error) throw new Error(`Failed to read the extras list: ${error.message}`);

    name = name || menuItem.name;
    unit_price = unit_price ?? menuItem.unit_price;
    kind = menuItem.kind;

    if (menuItem.charge_type === 'per_night' && !line.quantity) {
      const reservation = await getReservation(reservationId);
      quantity = Math.max(1, nightsBetween(reservation.check_in, reservation.check_out).length);
    }
  }

  const { data, error } = await supabase
    .from('reservation_extras')
    .insert({
      reservation_id: reservationId,
      extra_id,
      name,
      unit_price: Number(unit_price) || 0,
      quantity: Number(quantity) || 1,
      kind,
      stay_date,
    })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to add the line: ${error.message}`);
  return data;
}

export async function deleteReservationExtra(id) {
  const { error } = await supabase.from('reservation_extras').delete().eq('id', id);
  if (error) throw new Error(`Failed to remove the line: ${error.message}`);
  return true;
}

export async function listReservationPayments(reservationId) {
  const { data, error } = await supabase
    .from('reservation_payments')
    .select('*')
    .eq('reservation_id', reservationId)
    .order('paid_at', { ascending: true });

  if (error) throw new Error(`Failed to load payments: ${error.message}`);
  return data || [];
}

export async function addReservationPayment(reservationId, payment, userId = null) {
  const { data, error } = await supabase
    .from('reservation_payments')
    .insert({
      reservation_id: reservationId,
      amount: Number(payment.amount),
      method: payment.method || 'cash',
      reference: payment.reference?.trim() || null,
      notes: payment.notes?.trim() || null,
      paid_at: payment.paid_at || new Date().toISOString(),
      recorded_by: userId,
    })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to record the payment: ${error.message}`);
  return data;
}

export async function deleteReservationPayment(id) {
  const { error } = await supabase.from('reservation_payments').delete().eq('id', id);
  if (error) throw new Error(`Failed to remove the payment: ${error.message}`);
  return true;
}

/**
 * What a stay owes, worked out from the rows beneath it.
 *
 * Computed rather than stored. A stored balance is a number that can quietly
 * disagree with the lines it came from, and once it does there is no way to
 * tell which one is lying.
 */
export async function getReservationFolio(reservationId) {
  const [reservation, extras, payments, guests, invoices] = await Promise.all([
    getReservation(reservationId),
    listReservationExtras(reservationId),
    listReservationPayments(reservationId),
    listReservationGuests(reservationId),
    listReservationInvoices(reservationId),
  ]);

  const room = Number(reservation.total_amount) || 0;
  // Inclusions come with the rate, so they are shown but never charged.
  const extrasTotal = extras
    .filter((e) => e.kind === 'extra')
    .reduce((sum, e) => sum + Number(e.unit_price) * Number(e.quantity), 0);
  const paid = payments.reduce((sum, p) => sum + Number(p.amount), 0);

  const total = room + extrasTotal;

  // The room charge night by night, which is how the total is arrived at.
  // `matches` is false only for a stay whose total was edited apart from its
  // nights before nights carried their own rates; the tab says so rather than
  // presenting a breakdown that does not add up.
  const nights = [...(reservation.reservation_nights || [])]
    .sort((a, b) => a.stay_date.localeCompare(b.stay_date))
    .map((n) => ({ stay_date: n.stay_date, rate: n.rate == null ? null : Number(n.rate) }));
  const nightsSum = nights.reduce((sum, n) => sum + (n.rate || 0), 0);

  return {
    reservation,
    guests,
    extras,
    payments,
    invoices,
    nights,
    nightsMatch: nights.every((n) => n.rate != null) && Math.abs(nightsSum - room) < 0.01,
    totals: {
      room,
      extras: Number(extrasTotal.toFixed(2)),
      total: Number(total.toFixed(2)),
      paid: Number(paid.toFixed(2)),
      balance: Number((total - paid).toFixed(2)),
    },
  };
}

export async function listReservationInvoices(reservationId) {
  const { data, error } = await supabase
    .from('reservation_invoices')
    .select('*')
    .eq('reservation_id', reservationId)
    .order('issued_at', { ascending: false });

  if (error) throw new Error(`Failed to load invoices: ${error.message}`);
  return data || [];
}

/**
 * Issue an invoice for a stay.
 *
 * The document is frozen into `snapshot` rather than recomputed when opened:
 * an invoice must keep saying what it said on the day it was issued, even if
 * the stay is later extended, re-priced or paid off.
 *
 * Numbering is sequential per property. The count could race under two
 * simultaneous issues, so the unique constraint is the real guard and a
 * collision is retried with the next number up.
 */
export async function createReservationInvoice(reservationId, userId = null) {
  const folio = await getReservationFolio(reservationId);
  const { reservation, totals } = folio;
  const property = await getPropertyById(reservation.property_id).catch(() => null);
  const roomName = reservation.room_types?.room_type_name || 'room';

  // One line per night where the nights add up to the room charge, so the
  // invoice shows how the total was reached; one line for the stay otherwise.
  const roomLines = folio.nightsMatch && folio.nights.length > 0
    ? folio.nights.map((n) => ({
        description: `Accommodation — ${roomName}, night of ${n.stay_date}`,
        quantity: 1,
        unit_price: n.rate,
        amount: n.rate,
      }))
    : [
        {
          description: `Accommodation — ${roomName} (${folio.nights.length} night${
            folio.nights.length === 1 ? '' : 's'
          })`,
          amount: totals.room,
        },
      ];

  const year = new Date().getFullYear();

  const { count, error: countError } = await supabase
    .from('reservation_invoices')
    .select('*', { count: 'exact', head: true })
    .eq('property_id', reservation.property_id);

  if (countError) {
    throw new Error(`Failed to allocate an invoice number: ${countError.message}`);
  }

  const snapshot = {
    // The issuer as it stood on the day: a hotel that later changes its
    // address must not change what an old invoice says it was issued from.
    property: property
      ? {
          name: property.name,
          address: property.address,
          city: property.city,
          state: property.state,
          postal_code: property.postal_code,
          country: property.country,
          phone: property.phone,
          email: property.email,
        }
      : null,
    currency: reservation.currency || 'INR',
    guest_name: reservation.guest_name,
    guest_email: reservation.guest_email,
    guest_phone: reservation.guest_phone,
    reference: reservation.reference,
    check_in: reservation.check_in,
    check_out: reservation.check_out,
    room_type: reservation.room_types?.room_type_name || null,
    room_number: reservation.rooms?.room_number || null,
    adults: reservation.adults,
    children: reservation.children,
    rate_plan: reservation.rate_plans?.plan_name || null,
    lines: [
      ...roomLines,
      ...folio.extras
        .filter((e) => e.kind === 'extra')
        .map((e) => ({
          description: e.name,
          quantity: Number(e.quantity),
          unit_price: Number(e.unit_price),
          amount: Number(e.unit_price) * Number(e.quantity),
        })),
    ],
    totals,
    payments: folio.payments.map((p) => ({
      amount: Number(p.amount),
      method: p.method,
      paid_at: p.paid_at,
      reference: p.reference,
    })),
  };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const invoice_number = `INV-${year}-${String((count || 0) + 1 + attempt).padStart(4, '0')}`;

    const { data, error } = await supabase
      .from('reservation_invoices')
      .insert({
        reservation_id: reservationId,
        property_id: reservation.property_id,
        invoice_number,
        total_amount: totals.total,
        currency: reservation.currency || 'INR',
        snapshot,
        created_by: userId,
      })
      .select('*')
      .single();

    if (!error) return data;
    if (error.code !== '23505') {
      throw new Error(`Failed to issue the invoice: ${error.message}`);
    }
  }

  throw new Error('Failed to issue the invoice: could not allocate a number.');
}

export async function getReservationInvoice(id) {
  const { data, error } = await supabase
    .from('reservation_invoices')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw new Error(`Failed to load the invoice: ${error.message}`);
  return data;
}

/**
 * Void an invoice.
 *
 * Never deleted: an issued invoice that vanishes leaves a gap in the number
 * sequence that nobody can later account for.
 */
export async function voidReservationInvoice(id, reason) {
  const { data, error } = await supabase
    .from('reservation_invoices')
    .update({ voided_at: new Date().toISOString(), void_reason: reason || null })
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to void the invoice: ${error.message}`);
  return data;
}

/**
 * The tape chart: every room as a row, with the stays that fall in the window.
 *
 * Rooms with no bookings still come back -- an empty row is the point, since
 * it is what tells the desk the room is free. Unassigned stays are returned
 * separately rather than being dropped, because a booking with no room yet is
 * exactly what the desk needs to see and place.
 */
export async function getTapeChart(propertyId, startDate, endDate) {
  const [rooms, roomTypes, reservations] = await Promise.all([
    listRooms(propertyId),
    listRoomTypes(propertyId),
    listReservations(propertyId, { from: startDate, to: endDate, limit: 1000 }),
  ]);

  const live = reservations.filter(
    (r) => r.status !== 'cancelled' && r.status !== 'no_show'
  );

  const byRoom = {};
  const unassigned = [];
  for (const r of live) {
    if (r.room_id) (byRoom[r.room_id] = byRoom[r.room_id] || []).push(r);
    else unassigned.push(r);
  }

  const typeName = {};
  for (const rt of roomTypes) typeName[rt.id] = rt.room_type_name;

  return {
    // Grouped by type so the chart can show "Deluxe" once above its rooms.
    roomTypes: roomTypes.map((rt) => ({
      id: rt.id,
      name: rt.room_type_name,
      rooms: rooms
        .filter((room) => room.room_type_id === rt.id)
        .map((room) => ({
          ...room,
          room_type_name: typeName[room.room_type_id],
          reservations: byRoom[room.id] || [],
        })),
    })),
    unassigned,
  };
}

/**
 * What a stay costs, priced exactly as the Channel Manager prices it.
 *
 * The desk was typing every total by hand while the system already held the
 * answer -- and the answer that matters is the one the channels are selling,
 * not a figure derived some other way. A direct booking quoted off a stale
 * base price undercuts or overcharges against the same room on the OTAs,
 * which is the parity problem this product exists to stop.
 *
 * So this resolves through the same path as `/api/cm/grid`, in the same
 * order, using the same shared resolver:
 *
 *   daily_rates       the rate set for that plan, room and date in the grid,
 *                     including anything pushed to the channels
 *   rate_plan_rooms   the plan's assigned rate for the room, per occupancy
 *   derivation        a derived plan follows its master, via resolveAllRates
 *   room base_price   only where a plan has no assignment at all
 *
 * The derivation step is the one that cannot be skipped: a plan priced as
 * "master minus 10%" has no rate of its own, so reading its assignment alone
 * yields nothing and the booking silently falls back to a base price the
 * channels never see.
 */
export async function quoteReservation({
  property_id,
  room_type_id,
  rate_plan_id,
  check_in,
  check_out,
  adults = 2,
  children = 0,
}) {
  const nights = nightsBetween(check_in, check_out);
  if (!property_id || !room_type_id || nights.length === 0) {
    return { total: null, nights: [], source: null, reason: 'Nothing to price yet.' };
  }

  const occupancy = Math.max(1, Number(adults) || 1);
  const lastNight = nights[nights.length - 1];

  const [ratePlans, assignments, stored, roomTypes] = await Promise.all([
    listRatePlans(property_id).catch(() => []),
    listRatePlanRooms(property_id).catch(() => []),
    listDailyRates(property_id, check_in, lastNight).catch(() => []),
    listRoomTypes(property_id).catch(() => []),
  ]);

  const room = roomTypes.find((r) => r.id === room_type_id) || null;
  const baseAdults = Math.max(1, Number(room?.base_adults) || 0);

  const assignmentFor = {};
  for (const a of assignments) {
    assignmentFor[`${a.rate_plan_id}|${a.room_type_id}`] = a;
  }

  // The grid's stored rates, keyed as the CM keys them. A row written against
  // no room applies to every room, which is what older rows mean.
  const dailyRates = {};
  for (const row of stored) {
    dailyRates[
      `${row.rate_plan_id}|${row.room_type_id || ''}|${row.occupancy}|${row.stay_date}`
    ] = Number(row.rate);
  }

  const dailyFor = (planId, stay_date, occ) => {
    for (const roomKey of [room_type_id, '']) {
      for (const occKey of [occ, 1]) {
        const hit = dailyRates[`${planId}|${roomKey}|${occKey}|${stay_date}`];
        if (Number.isFinite(hit)) return hit;
      }
    }
    return null;
  };

  /**
   * A plan's standing rate in this room, before derivation.
   *
   * Only a real assignment counts. The CM grid falls back to the room's base
   * price here so that a property which has not assigned rooms yet still
   * renders a grid, but a booking must not quietly adopt that number: it
   * would arrive labelled as a rate plan price while being nothing of the
   * sort, which is exactly the laundering that hides a missing assignment.
   *
   * Returning null instead lets a derived plan resolve to null too, and the
   * caller falls back to the base price once, in the open, where it is
   * labelled for what it is.
   */
  const baseRateFor = (plan) => {
    const a = assignmentFor[`${plan.id}|${room_type_id}`];
    if (a && a.full_rate !== null && a.full_rate !== undefined) return Number(a.full_rate);

    // An assignment that carries only per-adult rates still prices the room;
    // full_rate is optional where every occupancy is priced individually.
    const perAdult = a?.adult_rates || null;
    if (perAdult) {
      const atBase = Number(perAdult[baseAdults] ?? perAdult[String(baseAdults)]);
      if (Number.isFinite(atBase)) return atBase;
      const any = Object.values(perAdult)
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0);
      if (any.length > 0) return Math.max(...any);
    }

    return null;
  };

  // Derived plans follow their master, resolved in THIS room -- the same call
  // the CM grid makes, so the two cannot drift apart.
  const baseRates = {};
  for (const p of ratePlans) baseRates[p.id] = baseRateFor(p);
  const resolved = resolveAllRates(ratePlans, baseRates);

  /**
   * The rate for a given occupancy, following the CM's rule: within base
   * occupancy a room is priced per adult, since a single and a double are
   * different prices rather than the same room half empty; beyond it, each
   * further adult adds the extra-person rate.
   */
  const rateForOccupancy = (planId, base, occ) => {
    const a = assignmentFor[`${planId}|${room_type_id}`];
    const perAdult = a?.adult_rates || null;

    if (perAdult && occ <= baseAdults) {
      const own = Number(perAdult[occ] ?? perAdult[String(occ)]);
      if (Number.isFinite(own)) return own;
    }

    if (base === null || base === undefined || !Number.isFinite(Number(base))) return null;

    const atBase = perAdult
      ? Number(perAdult[baseAdults] ?? perAdult[String(baseAdults)] ?? base)
      : Number(base);
    const extra = Number(a?.extra_adult_rate);
    if (!Number.isFinite(extra) || !Number.isFinite(atBase)) return Number(base);
    return atBase + Math.max(0, occ - baseAdults) * extra;
  };

  // Children are charged where the plan says so; the CM grid prices adults
  // only, so this is additive rather than a divergence from it.
  const link = assignmentFor[`${rate_plan_id}|${room_type_id}`];
  const perNightChildren = (Number(children) || 0) * (Number(link?.extra_child_rate) || 0);

  const plan = ratePlans.find((p) => p.id === rate_plan_id) || null;
  const sources = new Set();

  const breakdown = nights.map((stay_date) => {
    let rate = null;

    if (plan) {
      // The grid wins: it is what was priced for that date and pushed out.
      const fromGrid = dailyFor(plan.id, stay_date, occupancy);
      if (fromGrid != null) {
        rate = fromGrid;
        sources.add('daily_rates');
      } else {
        const fromPlan = rateForOccupancy(plan.id, resolved[plan.id], occupancy);
        if (fromPlan != null) {
          rate = fromPlan;
          sources.add(plan.derive_from_id ? 'derived' : 'rate_plan');
        }
      }
    }

    // No plan chosen, or nothing configured for it: the room's own price.
    if (rate == null && room && Number.isFinite(Number(room.base_price))) {
      rate = Number(room.base_price);
      sources.add('base_price');
    }

    return {
      stay_date,
      rate: rate == null ? null : Number((rate + perNightChildren).toFixed(2)),
    };
  });

  const priced = breakdown.filter((n) => n.rate != null);
  if (priced.length === 0) {
    return {
      total: null,
      nights: breakdown,
      source: null,
      reason:
        'No rate is configured for this room type and plan. Set one in the Channel Manager grid or Rate Plan Setup, or enter the total by hand.',
    };
  }

  /**
   * Why a quote fell back to the base price.
   *
   * "It came from the base price" is a symptom; the desk needs the cause, and
   * so does anyone reading a bug report about it. There are only three, and
   * each has a different fix, so they are named rather than lumped together.
   */
  let diagnosis = null;
  if (sources.has('base_price')) {
    if (!rate_plan_id) {
      diagnosis = 'No rate plan chosen — pick one to use its channel rate.';
    } else if (!plan) {
      diagnosis = 'That rate plan is no longer configured for this property.';
    } else if (!assignmentFor[`${rate_plan_id}|${room_type_id}`]) {
      diagnosis =
        'This room type is not assigned to that rate plan, so it has no channel rate. Assign it in Rate Plan Setup.';
    } else {
      diagnosis =
        'That rate plan has no rate set for this room type. Set one in the Channel Manager grid.';
    }
  }

  return {
    total: Number(priced.reduce((sum, n) => sum + n.rate, 0).toFixed(2)),
    nights: breakdown,
    diagnosis,
    source: sources.has('daily_rates')
      ? 'daily_rates'
      : sources.has('derived')
        ? 'derived'
        : sources.has('rate_plan')
          ? 'rate_plan'
          : 'base_price',
    partial: priced.length !== breakdown.length,
    reason: null,
  };
}
