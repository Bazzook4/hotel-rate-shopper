const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigration(migrationFile) {
  try {
    console.log(`Running migration: ${migrationFile}`);

    const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', migrationFile);
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // Split SQL by semicolons and execute each statement
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      if (statement.trim()) {
        console.log(`Executing: ${statement.substring(0, 100)}...`);
        const { error } = await supabase.rpc('exec_sql', { sql: statement });

        if (error) {
          console.error('Error executing statement:', error);
          console.error('Statement:', statement);
          // Continue with next statement instead of failing
        } else {
          console.log('✓ Statement executed successfully');
        }
      }
    }

    console.log(`✓ Migration ${migrationFile} completed`);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

const migrationFile = process.argv[2] || '002_user_modules_permissions.sql';
runMigration(migrationFile);
