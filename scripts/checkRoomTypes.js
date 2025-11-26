#!/usr/bin/env node

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkRoomTypes() {
  console.log('\n=== Checking Room Types ===');
  const { data: roomTypes, error } = await supabase
    .from('room_types')
    .select('*')
    .order('rank', { ascending: true });

  if (error) {
    console.error('Error fetching room types:', error);
  } else {
    console.log('Room Types:', JSON.stringify(roomTypes, null, 2));
  }
}

checkRoomTypes().catch(console.error);
