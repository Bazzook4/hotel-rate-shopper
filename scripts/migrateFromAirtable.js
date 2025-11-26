#!/usr/bin/env node

/**
 * Airtable to Supabase Migration Script
 *
 * This script migrates all data from your Airtable base to Supabase.
 *
 * Usage:
 *   node scripts/migrateFromAirtable.js
 *
 * Prerequisites:
 *   - Both Airtable and Supabase credentials configured in .env
 *   - Supabase schema already created (run 001_initial_schema.sql first)
 */

require('dotenv').config();
const Airtable = require('airtable');
const { createClient } = require('@supabase/supabase-js');

// ============================================
// CONFIGURATION
// ============================================

const airtableConfig = {
  apiKey: process.env.AIRTABLE_API_KEY,
  baseId: process.env.AIRTABLE_BASE_ID,
  tables: {
    users: process.env.AIRTABLE_USERS_TABLE || 'Users',
    properties: process.env.AIRTABLE_PROPERTIES_TABLE || 'Properties',
    compsets: process.env.AIRTABLE_COMPSETS_TABLE || 'Compsets',
    snapshots: process.env.AIRTABLE_SNAPSHOTS_TABLE || 'Snapshots',
    roomTypes: process.env.AIRTABLE_ROOM_TYPES_TABLE || 'RoomTypes',
    ratePlans: process.env.AIRTABLE_RATE_PLANS_TABLE || 'RatePlans',
    pricingFactors: process.env.AIRTABLE_PRICING_FACTORS_TABLE || 'PricingFactors',
    pricingSnapshots: process.env.AIRTABLE_PRICING_SNAPSHOTS_TABLE || 'PricingSnapshots',
  },
};

const supabaseConfig = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

// Validate configuration
if (!airtableConfig.apiKey || !airtableConfig.baseId) {
  console.error('❌ Missing Airtable configuration');
  process.exit(1);
}

if (!supabaseConfig.url || !supabaseConfig.serviceKey) {
  console.error('❌ Missing Supabase configuration');
  process.exit(1);
}

// Initialize clients
const airtable = new Airtable({ apiKey: airtableConfig.apiKey }).base(airtableConfig.baseId);
const supabase = createClient(supabaseConfig.url, supabaseConfig.serviceKey);

// ============================================
// HELPER FUNCTIONS
// ============================================

async function fetchAllFromAirtable(tableName) {
  const records = [];
  try {
    await airtable(tableName)
      .select()
      .eachPage((pageRecords, fetchNextPage) => {
        records.push(...pageRecords.map(r => ({ id: r.id, ...r.fields })));
        fetchNextPage();
      });
  } catch (err) {
    console.error(`Error fetching from ${tableName}:`, err.message);
  }
  return records;
}

// ============================================
// MIGRATION FUNCTIONS
// ============================================

async function migrateUsers() {
  console.log('\n📝 Migrating Users...');
  const users = await fetchAllFromAirtable(airtableConfig.tables.users);

  if (users.length === 0) {
    console.log('  ⚠️  No users found in Airtable');
    return { airtableIds: {}, supabaseIds: {} };
  }

  const airtableToSupabase = {};
  const supabaseToAirtable = {};

  for (const user of users) {
    // Skip if user already exists (like admin@admin.com)
    const { data: existing } = await supabase
      .from('users')
      .select('id, email')
      .ilike('email', user.Email)
      .single();

    if (existing) {
      console.log(`  ⏭️  Skipping ${user.Email} (already exists)`);
      airtableToSupabase[user.id] = existing.id;
      supabaseToAirtable[existing.id] = user.id;
      continue;
    }

    const { data, error } = await supabase
      .from('users')
      .insert({
        email: user.Email,
        password_hash: user['Password Hash'] || '',
        role: user.Role || 'PropertyUser',
        status: user.Status || 'Active',
      })
      .select()
      .single();

    if (error) {
      console.error(`  ❌ Failed to migrate user ${user.Email}:`, error.message);
    } else {
      airtableToSupabase[user.id] = data.id;
      supabaseToAirtable[data.id] = user.id;
      console.log(`  ✅ Migrated ${user.Email}`);
    }
  }

  return { airtableIds: airtableToSupabase, supabaseIds: supabaseToAirtable };
}

async function migrateProperties() {
  console.log('\n🏨 Migrating Properties...');
  const properties = await fetchAllFromAirtable(airtableConfig.tables.properties);

  if (properties.length === 0) {
    console.log('  ⚠️  No properties found in Airtable');
    return { airtableIds: {}, supabaseIds: {} };
  }

  const airtableToSupabase = {};
  const supabaseToAirtable = {};

  for (const property of properties) {
    const { data, error } = await supabase
      .from('properties')
      .insert({
        name: property.Name || 'Unnamed Property',
        address: property.Address || null,
        city: property.City || null,
        state: property.State || null,
        country: property.Country || null,
        postal_code: property['Postal Code'] || null,
        phone: property.Phone || null,
        email: property.Email || null,
        website: property.Website || null,
        description: property.Description || null,
        amenities: property.Amenities || [],
        star_rating: property['Star Rating'] || null,
        total_rooms: property['Total Rooms'] || null,
        pricing_enabled: property.pricingEnabled || false,
        base_pricing_mode: property.basePricingMode || null,
      })
      .select()
      .single();

    if (error) {
      console.error(`  ❌ Failed to migrate property ${property.Name}:`, error.message);
    } else {
      airtableToSupabase[property.id] = data.id;
      supabaseToAirtable[data.id] = property.id;
      console.log(`  ✅ Migrated ${property.Name}`);
    }
  }

  return { airtableIds: airtableToSupabase, supabaseIds: supabaseToAirtable };
}

async function migrateUserProperties(userMapping, propertyMapping) {
  console.log('\n🔗 Migrating User-Property Relationships...');
  const users = await fetchAllFromAirtable(airtableConfig.tables.users);

  let count = 0;
  for (const user of users) {
    if (!user.Properties || !Array.isArray(user.Properties)) continue;

    const supabaseUserId = userMapping.airtableIds[user.id];
    if (!supabaseUserId) continue;

    for (const propertyId of user.Properties) {
      const supabasePropertyId = propertyMapping.airtableIds[propertyId];
      if (!supabasePropertyId) continue;

      const { error } = await supabase
        .from('user_properties')
        .insert({
          user_id: supabaseUserId,
          property_id: supabasePropertyId,
        });

      if (error && error.code !== '23505') { // Ignore duplicate errors
        console.error(`  ❌ Failed to link user-property:`, error.message);
      } else {
        count++;
      }
    }
  }

  console.log(`  ✅ Migrated ${count} user-property relationships`);
}

async function migrateRoomTypes(propertyMapping) {
  console.log('\n🛏️  Migrating Room Types...');
  const roomTypes = await fetchAllFromAirtable(airtableConfig.tables.roomTypes);

  if (roomTypes.length === 0) {
    console.log('  ⚠️  No room types found in Airtable');
    return;
  }

  for (const roomType of roomTypes) {
    const supabasePropertyId = propertyMapping.airtableIds[roomType.propertyId];
    if (!supabasePropertyId) {
      console.log(`  ⏭️  Skipping room type ${roomType.roomTypeName} (property not migrated)`);
      continue;
    }

    const { error } = await supabase
      .from('room_types')
      .insert({
        room_type_id: roomType.roomTypeId,
        property_id: supabasePropertyId,
        room_type_name: roomType.roomTypeName,
        base_price: roomType.basePrice,
        number_of_rooms: roomType.numberOfRooms,
        max_adults: roomType.maxAdults || null,
        description: roomType.description || null,
        amenities: roomType.amenities || [],
        occupancy_pricing: roomType.occupancyPricing || null,
        rank: roomType.rank || null,
      });

    if (error) {
      console.error(`  ❌ Failed to migrate room type ${roomType.roomTypeName}:`, error.message);
    } else {
      console.log(`  ✅ Migrated ${roomType.roomTypeName}`);
    }
  }
}

async function migrateRatePlans(propertyMapping) {
  console.log('\n💰 Migrating Rate Plans...');
  const ratePlans = await fetchAllFromAirtable(airtableConfig.tables.ratePlans);

  if (ratePlans.length === 0) {
    console.log('  ⚠️  No rate plans found in Airtable');
    return;
  }

  for (const plan of ratePlans) {
    const supabasePropertyId = propertyMapping.airtableIds[plan.propertyId];
    if (!supabasePropertyId) {
      console.log(`  ⏭️  Skipping rate plan ${plan.planName} (property not migrated)`);
      continue;
    }

    const { error } = await supabase
      .from('rate_plans')
      .insert({
        rate_plan_id: plan.ratePlanId,
        property_id: supabasePropertyId,
        plan_name: plan.planName,
        pricing_type: plan.pricingType || 'multiplier',
        multiplier: plan.multiplier || null,
        cost_per_adult: plan.costPerAdult || null,
        description: plan.description || null,
      });

    if (error) {
      console.error(`  ❌ Failed to migrate rate plan ${plan.planName}:`, error.message);
    } else {
      console.log(`  ✅ Migrated ${plan.planName}`);
    }
  }
}

async function migratePricingFactors(propertyMapping) {
  console.log('\n📊 Migrating Pricing Factors...');
  const factors = await fetchAllFromAirtable(airtableConfig.tables.pricingFactors);

  if (factors.length === 0) {
    console.log('  ⚠️  No pricing factors found in Airtable');
    return;
  }

  for (const factor of factors) {
    const supabasePropertyId = propertyMapping.airtableIds[factor.propertyId];
    if (!supabasePropertyId) {
      console.log(`  ⏭️  Skipping pricing factor (property not migrated)`);
      continue;
    }

    const { error } = await supabase
      .from('pricing_factors')
      .insert({
        factor_id: factor.factorId,
        property_id: supabasePropertyId,
        demand_factor: factor.demandFactor || 1.0,
        seasonal_factor: factor.seasonalFactor || 1.0,
        competitor_factor: factor.competitorFactor || 1.0,
        weekend_multiplier: factor.weekendMultiplier || 1.0,
        weekday_multipliers: factor.weekdayMultipliers || null,
        extra_adult_rate: factor.extraAdultRate || null,
        extra_child_rate: factor.extraChildRate || null,
      });

    if (error) {
      console.error(`  ❌ Failed to migrate pricing factor:`, error.message);
    } else {
      console.log(`  ✅ Migrated pricing factor`);
    }
  }
}

// ============================================
// MAIN MIGRATION
// ============================================

async function main() {
  console.log('🚀 Starting Airtable to Supabase Migration\n');
  console.log('================================================');

  try {
    // Migrate in order (respecting foreign key constraints)
    const userMapping = await migrateUsers();
    const propertyMapping = await migrateProperties();
    await migrateUserProperties(userMapping, propertyMapping);
    await migrateRoomTypes(propertyMapping);
    await migrateRatePlans(propertyMapping);
    await migratePricingFactors(propertyMapping);

    console.log('\n================================================');
    console.log('✅ Migration completed successfully!');
    console.log('\n💡 Next steps:');
    console.log('  1. Verify data in Supabase dashboard');
    console.log('  2. Test your application');
    console.log('  3. Update any remaining code that uses Airtable');

  } catch (err) {
    console.error('\n❌ Migration failed:', err);
    process.exit(1);
  }
}

main();
