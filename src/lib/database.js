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

export async function createRoomType({ property_id, room_type_name, base_price, number_of_rooms, max_adults, description, amenities }) {
  const roomTypeId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const roomType = {
    room_type_id: roomTypeId,
    property_id: property_id,
    room_type_name: room_type_name,
    base_price: Number(base_price),
    number_of_rooms: Number(number_of_rooms),
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

  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, role, status, created_at')
    .in('id', ids)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to list users: ${error.message}`);
  }

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
