#!/usr/bin/env node

/**
 * Import Properties from Airtable CSV export to Supabase
 *
 * Usage:
 *   1. Export Properties table from Airtable as CSV
 *   2. Run: node scripts/importPropertiesFromCSV.js path/to/properties.csv
 */

require('dotenv').config();
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function parseCSV(content) {
  const lines = content.split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;

    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const record = {};

    headers.forEach((header, index) => {
      record[header] = values[index] || null;
    });

    records.push(record);
  }

  return records;
}

async function importProperties(csvPath) {
  if (!csvPath || !fs.existsSync(csvPath)) {
    console.error('❌ Please provide a valid CSV file path');
    console.log('\nUsage: node scripts/importPropertiesFromCSV.js path/to/properties.csv');
    process.exit(1);
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const records = parseCSV(content);

  console.log(`\n📊 Found ${records.length} properties in CSV\n`);

  for (const record of records) {
    const property = {
      name: record.Name || 'Unnamed Property',
      address: record.Address || null,
      city: record.Location || record.City || null,
      state: record.State || null,
      country: record.Country || null,
      postal_code: record['Postal Code'] || null,
      phone: record.Phone || null,
      email: record.Email || null,
      website: record.Website || null,
      description: record.Description || null,
      star_rating: record['Star Rating'] ? parseInt(record['Star Rating']) : null,
      total_rooms: record['Total Rooms'] ? parseInt(record['Total Rooms']) : null,
    };

    const { data, error } = await supabase
      .from('properties')
      .insert(property)
      .select()
      .single();

    if (error) {
      console.error(`❌ Failed to import ${property.name}:`, error.message);
    } else {
      console.log(`✅ Imported: ${property.name}`);
    }
  }

  console.log('\n✨ Import complete!\n');
}

const csvPath = process.argv[2];
importProperties(csvPath);
