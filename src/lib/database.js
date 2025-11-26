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
