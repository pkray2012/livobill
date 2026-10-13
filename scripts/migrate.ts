import { ensureMigrations, isUsingNetlifyNeon, query } from '../netlify/functions/_lib/db';

async function main() {
  console.log('Running LIVOTEL PREMIUM HOTEL PostgreSQL database migrations...');
  console.log(
    `Target Database Mode: ${isUsingNetlifyNeon() ? 'Netlify Database (Neon PostgreSQL)' : 'Local Embedded PostgreSQL (.local-data/pgdata)'}`
  );
  await ensureMigrations();
  const applied = await query<{ version: string; applied_at: string }>(
    `SELECT version, applied_at FROM schema_migrations ORDER BY version ASC`
  );
  console.log('Applied migrations:');
  for (const row of applied.rows) {
    console.log(`  - ${row.version} (${new Date(row.applied_at).toISOString()})`);
  }
  console.log('Database migrations completed successfully.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
