#!/usr/bin/env node

/**
 * User Creation Script
 *
 * Creates a new user in Airtable with hashed password
 *
 * Usage:
 *   node scripts/createUser.js
 *
 * The script will prompt you for:
 *   - Email
 *   - Password
 *   - Role (Admin or PropertyUser)
 *   - Property ID (optional - can link later in Airtable)
 */

const crypto = require('crypto');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

async function createUser() {
  console.log('\n🔧 User Creation Wizard\n');
  console.log('This will create a new user in your Airtable Users table.\n');

  // Get user details
  const email = await question('📧 Email: ');
  const password = await question('🔒 Password: ');
  const role = await question('👤 Role (Admin/PropertyUser) [default: Admin]: ');
  const propertyId = await question('🏨 Property ID (Airtable Record ID, optional): ');

  const passwordHash = hashPassword(password);
  const finalRole = role || 'Admin';

  console.log('\n✅ User Details:\n');
  console.log(`Email:         ${email}`);
  console.log(`Password Hash: ${passwordHash}`);
  console.log(`Role:          ${finalRole}`);
  console.log(`Status:        Active`);
  if (propertyId) {
    console.log(`Property ID:   ${propertyId}`);
  }

  console.log('\n📋 Manual Steps (go to Airtable):\n');
  console.log('1. Open your Airtable Users table');
  console.log('2. Click "+ Add Record"');
  console.log('3. Fill in the following fields:');
  console.log(`   - Email: ${email}`);
  console.log(`   - Password Hash: ${passwordHash}`);
  console.log(`   - Role: ${finalRole}`);
  console.log('   - Status: Active');
  if (propertyId) {
    console.log(`   - Properties: Link to record ${propertyId}`);
  } else {
    console.log('   - Properties: (Link to a property record after creating it)');
  }
  console.log('\n4. Save the record');
  console.log('\n✨ Done! You can now login with these credentials.\n');

  rl.close();
}

createUser().catch(err => {
  console.error('❌ Error:', err.message);
  rl.close();
  process.exit(1);
});
