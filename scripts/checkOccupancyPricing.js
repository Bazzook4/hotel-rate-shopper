#!/usr/bin/env node

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkOccupancyPricing() {
  console.log('\n=== Checking Room Types with Occupancy Pricing ===');
  const { data: roomTypes, error } = await supabase
    .from('room_types')
    .select('room_type_name, occupancy_pricing')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching room types:', error);
  } else {
    roomTypes.forEach(room => {
      console.log(`\n${room.room_type_name}:`);
      console.log('Occupancy Pricing:', JSON.stringify(room.occupancy_pricing, null, 2));
    });
  }
}

checkOccupancyPricing().catch(console.error);
