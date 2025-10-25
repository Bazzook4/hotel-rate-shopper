/**
 * Script to create a new user in Airtable
 * Usage: node create-user.js
 */

import { createUser } from './src/lib/airtable.js';
import { hashPassword } from './src/lib/password.js';

async function main() {
  const email = process.argv[2] || 'admin@example.com';
  const password = process.argv[3] || 'admin123';
  const role = process.argv[4] || 'Admin';

  console.log('Creating user...');
  console.log('Email:', email);
  console.log('Role:', role);

  try {
    const passwordHash = await hashPassword(password);

    const user = await createUser({
      email,
      passwordHash,
      role, // Admin or PropertyUser
      status: 'Active',
      propertyIds: [],
    });

    console.log('\n✅ User created successfully!');
    console.log('\nLogin credentials:');
    console.log('Email:', email);
    console.log('Password:', password);
    console.log('Role:', role);
    console.log('\nYou can now login at http://localhost:3000/login');
  } catch (error) {
    console.error('❌ Error creating user:', error.message);
    process.exit(1);
  }
}

main();
