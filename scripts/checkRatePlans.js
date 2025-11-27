#!/usr/bin/env node

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkRatePlans() {
  console.log('\n=== Checking Rate Plans ===');
  const { data: ratePlans, error } = await supabase
    .from('rate_plans')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching rate plans:', error);
  } else {
    console.log('Rate Plans:', JSON.stringify(ratePlans, null, 2));
  }
}

checkRatePlans().catch(console.error);
