import { getSupabaseAdmin } from '@/lib/database';
import { getSessionFromRequest } from '@/lib/session';
import { isSuperAdmin } from '@/lib/permissions';
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Migration filenames are fixed-format: 001_initial_schema.sql, 003_v2_modules.sql, ...
const MIGRATION_NAME = /^\d{3}_[a-z0-9_]+\.sql$/;
const MIGRATIONS_DIR = ['supabase', 'migrations'];

export async function POST(req) {
  // This endpoint executes arbitrary SQL with the service role key, which
  // bypasses RLS. It must never be reachable without an Admin session.
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isSuperAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { migrationFile } = await req.json();

    if (!migrationFile || typeof migrationFile !== 'string') {
      return NextResponse.json({ error: 'Migration file name required' }, { status: 400 });
    }

    // Reject path traversal: the name must be a bare filename in the expected
    // format, never a path. `../../../etc/passwd` fails both checks below.
    if (migrationFile !== path.basename(migrationFile) || !MIGRATION_NAME.test(migrationFile)) {
      return NextResponse.json({ error: 'Invalid migration file name' }, { status: 400 });
    }

    const migrationsDir = path.join(process.cwd(), ...MIGRATIONS_DIR);
    const migrationPath = path.join(migrationsDir, migrationFile);

    // Belt and braces: confirm the resolved path really is inside the
    // migrations directory before reading it.
    if (path.dirname(path.resolve(migrationPath)) !== path.resolve(migrationsDir)) {
      return NextResponse.json({ error: 'Invalid migration file name' }, { status: 400 });
    }

    if (!fs.existsSync(migrationPath)) {
      return NextResponse.json({ error: `Migration ${migrationFile} not found` }, { status: 404 });
    }

    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.rpc('exec_sql', { sql: migrationSQL });

    if (error) {
      console.error('Migration error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Migration ${migrationFile} executed successfully`,
    });
  } catch (err) {
    console.error('Migration failed:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
