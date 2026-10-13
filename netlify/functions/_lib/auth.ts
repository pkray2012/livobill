import crypto from 'node:crypto';
import { query } from './db';
import type { User, UserRole } from '../../../shared/types';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SESSION_COOKIE_NAME = 'livotel_session';

/**
 * Hashes a password using Node's native crypto.scrypt with OWASP parameters.
 * Format: scrypt$N$r$p$saltBase64$derivedKeyBase64
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derivedKey = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(
      password.normalize('NFKC'),
      salt,
      SCRYPT_KEYLEN,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key))
    );
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derivedKey.toString('base64')}`;
}

/**
 * Verifies a password against a stored scrypt hash using constant-time comparison.
 */
export async function verifyPassword(password: string, storedHash: string | null | undefined): Promise<boolean> {
  if (!storedHash) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'base64');
  const expectedKey = Buffer.from(parts[5], 'base64');

  if (!N || !r || !p || salt.length < 8 || expectedKey.length !== SCRYPT_KEYLEN) {
    return false;
  }

  const derivedKey = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(
      password.normalize('NFKC'),
      salt,
      expectedKey.length,
      { N, r, p, maxmem: 64 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key))
    );
  });

  if (derivedKey.length !== expectedKey.length) return false;
  return crypto.timingSafeEqual(derivedKey, expectedKey);
}

/**
 * Generates an opaque 256-bit cryptographically random token and its SHA-256 hash.
 * Only the SHA-256 hash is ever stored in the database.
 */
export function generateOpaqueToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashOpaqueToken(rawToken);
  return { rawToken, tokenHash };
}

export function hashOpaqueToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function validatePasswordStrength(password: string): { isValid: boolean; error: string | null } {
  if (!password || password.length < 10) {
    return { isValid: false, error: 'Password must be at least 10 characters long.' };
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    return {
      isValid: false,
      error: 'Password must include at least one uppercase letter, one lowercase letter, and one digit.',
    };
  }
  return { isValid: true, error: null };
}

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

export function createSessionCookieHeader(rawToken: string, maxAgeSeconds: number, isSecure: boolean): string {
  const flags = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isSecure || process.env.CONTEXT === 'production' || process.env.NODE_ENV === 'production') {
    flags.push('Secure');
  }
  return flags.join('; ');
}

export function clearSessionCookieHeader(isSecure: boolean): string {
  const flags = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (isSecure || process.env.CONTEXT === 'production' || process.env.NODE_ENV === 'production') {
    flags.push('Secure');
  }
  return flags.join('; ');
}

export interface AuthenticatedContext {
  user: User;
  sessionId: string;
  csrfToken: string;
}

/**
 * Resolves and validates the current session from HttpOnly cookie.
 */
export async function getAuthenticatedSession(req: Request): Promise<AuthenticatedContext | null> {
  const cookies = parseCookies(req.headers.get('cookie'));
  const rawToken = cookies[SESSION_COOKIE_NAME];
  if (!rawToken) return null;

  const tokenHash = hashOpaqueToken(rawToken);
  const res = await query<{
    session_id: string;
    csrf_token: string;
    expires_at: string;
    revoked_at: string | null;
    user_id: string;
    email: string;
    full_name: string;
    role: UserRole;
    status: 'pending_setup' | 'active' | 'disabled';
    can_cancel_invoices: boolean;
    created_at: string;
    last_login_at: string | null;
  }>(
    `SELECT
       s.id AS session_id,
       s.csrf_token,
       s.expires_at,
       s.revoked_at,
       u.id AS user_id,
       u.email,
       u.full_name,
       u.role,
       u.status,
       u.can_cancel_invoices,
       u.created_at,
       u.last_login_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1
     LIMIT 1`,
    [tokenHash]
  );

  if (res.rows.length === 0) return null;
  const row = res.rows[0];

  if (row.revoked_at || row.status !== 'active') {
    return null;
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return null;
  }

  return {
    sessionId: row.session_id,
    csrfToken: row.csrf_token,
    user: {
      id: row.user_id,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
      status: row.status,
      canCancelInvoices: row.role === 'admin' ? true : Boolean(row.can_cancel_invoices),
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
    },
  };
}

/**
 * Validates Origin/Referer and CSRF token for state-changing requests (POST, PUT, PATCH, DELETE).
 */
export function verifyCsrfAndOrigin(
  req: Request,
  auth: AuthenticatedContext | null,
  requireCsrfToken = true
): { ok: boolean; error?: string } {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return { ok: true };
  }

  const origin = req.headers.get('origin');
  const reqUrl = new URL(req.url);

  if (origin) {
    try {
      const originUrl = new URL(origin);
      const allowedHosts = new Set<string>([
        reqUrl.host,
        'localhost:5173',
        'localhost:8888',
        '127.0.0.1:5173',
        '127.0.0.1:8888',
      ]);
      if (process.env.URL) allowedHosts.add(new URL(process.env.URL).host);
      if (process.env.DEPLOY_PRIME_URL) allowedHosts.add(new URL(process.env.DEPLOY_PRIME_URL).host);
      if (process.env.APP_ORIGIN) allowedHosts.add(new URL(process.env.APP_ORIGIN).host);

      if (!allowedHosts.has(originUrl.host)) {
        return { ok: false, error: `Cross-origin state-changing request rejected (${originUrl.host}).` };
      }
    } catch {
      return { ok: false, error: 'Malformed Origin header.' };
    }
  }

  if (requireCsrfToken && auth) {
    const headerCsrf = req.headers.get('x-csrf-token') ?? '';
    if (!headerCsrf || headerCsrf !== auth.csrfToken) {
      return { ok: false, error: 'Invalid or missing CSRF token. Please refresh and try again.' };
    }
  }

  return { ok: true };
}

const MAX_LOGIN_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;
const LOCKOUT_MINUTES = 15;

/**
 * Checks persistent PostgreSQL login rate limits before verifying credentials.
 */
export async function checkLoginRateLimit(rateKey: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const res = await query<{
    attempt_count: number;
    first_attempt_at: string;
    locked_until: string | null;
  }>(`SELECT attempt_count, first_attempt_at, locked_until FROM login_rate_limits WHERE rate_key = $1`, [rateKey]);

  if (res.rows.length === 0) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const row = res.rows[0];
  const now = Date.now();
  if (row.locked_until) {
    const lockedUntilMs = new Date(row.locked_until).getTime();
    if (lockedUntilMs > now) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((lockedUntilMs - now) / 1000),
      };
    }
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export async function recordFailedLoginAttempt(rateKey: string): Promise<void> {
  const now = new Date();
  const res = await query<{
    attempt_count: number;
    first_attempt_at: string;
  }>(`SELECT attempt_count, first_attempt_at FROM login_rate_limits WHERE rate_key = $1`, [rateKey]);

  if (res.rows.length === 0) {
    await query(
      `INSERT INTO login_rate_limits (rate_key, attempt_count, first_attempt_at, updated_at)
       VALUES ($1, 1, $2, $2)`,
      [rateKey, now.toISOString()]
    );
    return;
  }

  const firstMs = new Date(res.rows[0].first_attempt_at).getTime();
  const windowExpired = now.getTime() - firstMs > WINDOW_MINUTES * 60 * 1000;
  const newCount = windowExpired ? 1 : res.rows[0].attempt_count + 1;
  const newFirst = windowExpired ? now.toISOString() : res.rows[0].first_attempt_at;
  const lockedUntil =
    newCount >= MAX_LOGIN_ATTEMPTS
      ? new Date(now.getTime() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
      : null;

  await query(
    `UPDATE login_rate_limits
     SET attempt_count = $2, first_attempt_at = $3, locked_until = $4, updated_at = $5
     WHERE rate_key = $1`,
    [rateKey, newCount, newFirst, lockedUntil, now.toISOString()]
  );
}

export async function clearLoginRateLimit(rateKey: string): Promise<void> {
  await query(`DELETE FROM login_rate_limits WHERE rate_key = $1`, [rateKey]);
}

export async function recordAuditEvent(params: {
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  eventType: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, any>;
  ipAddress?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO audit_events (
       id, actor_user_id, actor_email, actor_role, event_type, entity_type, entity_id, summary, metadata_json, ip_address
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
    [
      crypto.randomUUID(),
      params.actorUserId ?? null,
      params.actorEmail ?? null,
      params.actorRole ?? null,
      params.eventType,
      params.entityType,
      params.entityId ?? null,
      params.summary,
      JSON.stringify(params.metadata ?? {}),
      params.ipAddress ?? null,
    ]
  );
}
