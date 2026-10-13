import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Pool } from '@neondatabase/serverless';
import { neon } from '@netlify/neon';
import { PGlite } from '@electric-sql/pglite';

export interface DbQueryResult<T = Record<string, any>> {
  rows: T[];
  rowCount: number;
}

export interface DbClient {
  query<T = Record<string, any>>(text: string, params?: any[]): Promise<DbQueryResult<T>>;
}

let pgPool: Pool | null = null;
let localPglite: PGlite | null = null;
let localTxMutex: Promise<void> = Promise.resolve();
let migrationsApplied = false;

function isValidPostgresUrl(url: string | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith('postgres://') && !trimmed.startsWith('postgresql://')) return false;
  if (trimmed.includes('ep-example.region.aws.neon.tech')) return false;
  return true;
}

export function isUsingNetlifyNeon(): boolean {
  return isValidPostgresUrl(process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL);
}

/**
 * Returns the active PostgreSQL connection (Netlify Database powered by Neon in production/preview,
 * or isolated local PGlite PostgreSQL 16 in local dev / tests).
 */
async function getRawAdapter(): Promise<{
  mode: 'neon' | 'pglite';
  pool?: Pool;
  pglite?: PGlite;
}> {
  const dbUrl = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;

  if (isValidPostgresUrl(dbUrl)) {
    // Also initialize @netlify/neon client to verify environment compatibility
    try {
      neon(dbUrl!);
    } catch {
      // Pool handles full transactional queries
    }
    if (!pgPool) {
      pgPool = new Pool({ connectionString: dbUrl });
    }
    return { mode: 'neon', pool: pgPool };
  }

  if (process.env.CONTEXT === 'production') {
    throw new Error(
      'NETLIFY_DATABASE_URL is not configured in production. Provision Netlify Database with `npx netlify db init`.'
    );
  }

  if (!localPglite) {
    const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
    if (isTest && process.env.TEST_DB_DIR) {
      localPglite = new PGlite(process.env.TEST_DB_DIR);
    } else if (isTest) {
      localPglite = new PGlite();
    } else {
      const dataDir = path.resolve(process.cwd(), '.local-data/pgdata');
      fs.mkdirSync(dataDir, { recursive: true });
      localPglite = new PGlite(dataDir);
    }
  }

  return { mode: 'pglite', pglite: localPglite };
}

export async function query<T = Record<string, any>>(
  text: string,
  params: any[] = []
): Promise<DbQueryResult<T>> {
  await ensureMigrations();
  const adapter = await getRawAdapter();
  if (adapter.mode === 'neon' && adapter.pool) {
    const res = await adapter.pool.query(text, params);
    return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
  }
  const res = await adapter.pglite!.query<T>(text, params);
  return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
}

/**
 * Runs an atomic PostgreSQL transaction (`BEGIN` ... `COMMIT` / `ROLLBACK`).
 * Serializes transactions on single-connection PGlite in local dev/tests, and uses a dedicated
 * pooled client connection on Netlify Database (Neon Postgres).
 */
export async function withTransaction<R>(fn: (tx: DbClient) => Promise<R>): Promise<R> {
  await ensureMigrations();
  const adapter = await getRawAdapter();

  if (adapter.mode === 'neon' && adapter.pool) {
    const client = await adapter.pool.connect();
    try {
      await client.query('BEGIN');
      const txClient: DbClient = {
        async query<T = Record<string, any>>(text: string, params: any[] = []) {
          const res = await client.query(text, params);
          return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
        },
      };
      const result = await fn(txClient);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // PGlite single-connection mutex for strict serializable atomic transactions in local dev & tests
  let releaseLock!: () => void;
  const prevMutex = localTxMutex;
  localTxMutex = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  await prevMutex;
  try {
    await adapter.pglite!.query('BEGIN');
    const txClient: DbClient = {
      async query<T = Record<string, any>>(text: string, params: any[] = []) {
        const res = await adapter.pglite!.query<T>(text, params);
        return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
      },
    };
    const result = await fn(txClient);
    await adapter.pglite!.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await adapter.pglite!.query('ROLLBACK');
    } catch {
      // ignore rollback error
    }
    throw err;
  } finally {
    releaseLock();
  }
}

function findProjectFile(relPath: string): string | null {
  const candidates = [
    path.resolve(process.cwd(), relPath),
    path.resolve(process.cwd(), '..', relPath),
    path.resolve(process.cwd(), '../..', relPath),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function loadDefaultLogoDataUrl(): { dataUrl: string; sha256: string } {
  const logoPath = findProjectFile('public/livotel-logo.jpg') || findProjectFile('src/assets/livotel-logo.jpg');
  if (logoPath && fs.existsSync(logoPath)) {
    const buf = fs.readFileSync(logoPath);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
    return { dataUrl, sha256 };
  }
  return { dataUrl: '', sha256: 'missing' };
}

/**
 * Idempotently applies SQL migrations from `migrations/*.sql` and seeds the initial official logo version.
 * Never seeds sample customers or sample invoices.
 */
export async function ensureMigrations(): Promise<void> {
  if (migrationsApplied) return;
  migrationsApplied = true;

  try {
    const adapter = await getRawAdapter();
    const execSql = async (sqlText: string) => {
      if (adapter.mode === 'neon' && adapter.pool) {
        await adapter.pool.query(sqlText);
      } else if (adapter.pglite) {
        await adapter.pglite.exec(sqlText);
      }
    };

    const runQuery = async (sqlText: string, params: any[] = []) => {
      if (adapter.mode === 'neon' && adapter.pool) {
        return adapter.pool.query(sqlText, params);
      }
      return adapter.pglite!.query(sqlText, params);
    };

    const migrationFiles = ['migrations/001_initial_schema.sql', 'migrations/002_seed_defaults.sql'];
    for (const rel of migrationFiles) {
      const fullPath = findProjectFile(rel);
      if (!fullPath) continue;
      const sqlContent = fs.readFileSync(fullPath, 'utf8');
      await execSql(sqlContent);
      await runQuery(
        `INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING`,
        [path.basename(rel)]
      );
    }

    // Ensure the uploaded official logo is registered in logo_versions v1
    const existingLogo = await runQuery(`SELECT id FROM logo_versions WHERE version_number = 1 LIMIT 1`);
    if (existingLogo.rows.length === 0) {
      const { dataUrl, sha256 } = loadDefaultLogoDataUrl();
      if (dataUrl) {
        const logoId = '33333333-3333-4333-8333-333333333301';
        await runQuery(
          `INSERT INTO logo_versions (id, version_number, blob_key, mime_type, data_url, sha256_hash, pixel_width, pixel_height)
           VALUES ($1, 1, 'logos/v1-official-livotel-logo.jpg', 'image/jpeg', $2, $3, 1024, 1024)
           ON CONFLICT (version_number) DO NOTHING`,
          [logoId, dataUrl, sha256]
        );
        await runQuery(
          `UPDATE business_settings SET active_logo_version_id = $1 WHERE id = 1 AND active_logo_version_id IS NULL`,
          [logoId]
        );
      }
    }
  } catch (err) {
    migrationsApplied = false;
    throw err;
  }
}

/**
 * Helper for tests to reset only the test database instance.
 */
export async function resetTestDatabase(): Promise<void> {
  if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
    throw new Error('resetTestDatabase may only be called in test environment.');
  }
  localPglite = new PGlite();
  migrationsApplied = false;
  await ensureMigrations();
}
