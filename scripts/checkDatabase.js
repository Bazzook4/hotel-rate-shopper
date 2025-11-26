#!/usr/bin/env node

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkDatabase() {
  console.log('\n=== Checking Admin User ===');
  const { data: users, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('email', 'admin@admin.com');

  if (userError) {
    console.error('Error fetching user:', userError);
  } else {
    console.log('Admin user:', JSON.stringify(users, null, 2));
  }

  console.log('\n=== Checking Properties ===');
  const { data: properties, error: propError } = await supabase
    .from('properties')
    .select('*');

  if (propError) {
    console.error('Error fetching properties:', propError);
  } else {
    console.log('Properties:', JSON.stringify(properties, null, 2));
  }

  console.log('\n=== Checking User-Property Links ===');
  const { data: links, error: linkError } = await supabase
    .from('user_properties')
    .select('*');

  if (linkError) {
    console.error('Error fetching links:', linkError);
  } else {
    console.log('User-Property Links:', JSON.stringify(links, null, 2));
  }
}

checkDatabase().catch(console.error);
