import crypto from 'node:crypto';
import type { Config, Context } from '@netlify/functions';
import { query, withTransaction } from './_lib/db';
import { putPrivateBlob } from './_lib/blobs';
import {
  checkLoginRateLimit,
  clearLoginRateLimit,
  clearSessionCookieHeader,
  createSessionCookieHeader,
  generateOpaqueToken,
  getAuthenticatedSession,
  hashOpaqueToken,
  hashPassword,
  recordAuditEvent,
  recordFailedLoginAttempt,
   validatePasswordStrength,
  verifyCsrfAndOrigin,
  verifyPassword,
} from './_lib/auth';
import {
  cancelFinalisedInvoice,
  duplicateInvoiceAsDraft,
  finaliseInvoiceAtomically,
  formatInvoiceNumberFromSeries,
  getBusinessSettings,
  getInvoiceSeriesList,
  getOrGenerateInvoicePdfBytes,
  getTaxConfigurations,
  mapInvoiceRowToRecord,
  recordInvoicePayment,
  saveInvoiceDraft,
  ValidationError,
} from './_lib/invoice-service';
import { validateGstin, validateGstInvoiceNumber, validatePan } from '../../shared/gstin';
import { paiseToRupees } from '../../shared/calculations';
import type { Customer } from '../../shared/types';

async function readBody(req: Request): Promise<any> {
  try {
    return (await req.json()) || {};
  } catch {
    return {};
  }
}

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      ...extraHeaders,
    },
  });
}

function getClientIp(req: Request, context?: Context): string {
  return (
    context?.ip ||
    req.headers.get('x-nf-client-connection-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    '127.0.0.1'
  );
}

function normalizeApiPath(urlStr: string): string {
  const url = new URL(urlStr);
  let pathname = url.pathname;
  if (pathname.startsWith('/.netlify/functions/api')) {
    pathname = '/api' + pathname.slice('/.netlify/functions/api'.length);
  }
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }
  return pathname;
}

async function isBootstrapRequired(): Promise<boolean> {
  const stateRes = await query<{ is_completed: boolean }>(
    `SELECT is_completed FROM bootstrap_state WHERE id = 1 LIMIT 1`
  );
  if (stateRes.rows[0]?.is_completed) return false;

  const adminCountRes = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM users WHERE role = 'admin'`
  );
  return Number(adminCountRes.rows[0]?.count || 0) === 0;
}

export default async function handler(req: Request, context?: Context): Promise<Response> {
  try {
    const url = new URL(req.url);
    const path = normalizeApiPath(req.url);
    const method = req.method.toUpperCase();
    const ip = getClientIp(req, context);
    const isSecure = url.protocol === 'https:';

    // ========================================================================
    // 1. PUBLIC / AUTHENTICATION ENDPOINTS
    // ========================================================================

    if (path === '/api/auth/status' && method === 'GET') {
      const bootstrapRequired = await isBootstrapRequired();
      const auth = await getAuthenticatedSession(req);
      const configuredSecret =
        Boolean(process.env.ADMIN_BOOTSTRAP_SECRET) &&
        process.env.ADMIN_BOOTSTRAP_SECRET !== 'replace-with-32-byte-random-hex-secret';

      return jsonResponse({
        bootstrapRequired,
        bootstrapSecretConfigured: configuredSecret,
        user: auth?.user ?? null,
        csrfToken: auth?.csrfToken ?? null,
      });
    }

    // One-time Primary Administrator Bootstrap
    if (path === '/api/auth/bootstrap' && method === 'POST') {
      const originCheck = verifyCsrfAndOrigin(req, null, false);
      if (!originCheck.ok) {
        return jsonResponse({ error: originCheck.error }, 403);
      }

      const body = await readBody(req);
      const email = String(body.email ?? '').trim().toLowerCase();
      const fullName = String(body.fullName ?? '').trim();
      const password = String(body.password ?? '');
      const suppliedSecret = String(body.bootstrapSecret ?? '').trim();

      const envSecret = (process.env.ADMIN_BOOTSTRAP_SECRET ?? '').trim();
      if (envSecret && envSecret !== 'replace-with-32-byte-random-hex-secret') {
        const a = Buffer.from(suppliedSecret);
        const b = Buffer.from(envSecret);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
          return jsonResponse({ error: 'Invalid ADMIN_BOOTSTRAP_SECRET.' }, 403);
        }
      }

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return jsonResponse({ error: 'Please enter a valid administrator email address.' }, 400);
      }
      if (!fullName) {
        return jsonResponse({ error: 'Please enter the administrator full name.' }, 400);
      }
      const pwValid = validatePasswordStrength(password);
      if (!pwValid.isValid) {
        return jsonResponse({ error: pwValid.error }, 400);
      }

      const passwordHash = await hashPassword(password);
      const userId = crypto.randomUUID();
      const { rawToken, tokenHash } = generateOpaqueToken();
      const csrfToken = crypto.randomBytes(24).toString('hex');
      const ttlHours = Math.max(1, Number(process.env.SESSION_TTL_HOURS || 12));
      const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();

      try {
        await withTransaction(async (tx) => {
          const bState = await tx.query<{ is_completed: boolean }>(
            `SELECT is_completed FROM bootstrap_state WHERE id = 1 FOR UPDATE`
          );
          const existingAdmins = await tx.query<{ count: string }>(
            `SELECT COUNT(*) AS count FROM users WHERE role = 'admin'`
          );

          if (bState.rows[0]?.is_completed || Number(existingAdmins.rows[0]?.count || 0) > 0) {
            throw new ValidationError(
              'Initial administrator bootstrap has already been completed and is permanently disabled.',
              403
            );
          }

          await tx.query(
            `INSERT INTO users (id, email, full_name, role, password_hash, status, can_cancel_invoices, last_login_at)
             VALUES ($1, $2, $3, 'admin', $4, 'active', TRUE, NOW())`,
            [userId, email, fullName, passwordHash]
          );

          await tx.query(
            `UPDATE bootstrap_state
             SET is_completed = TRUE, bootstrapped_at = NOW(), bootstrapped_by_user_id = $1
             WHERE id = 1`,
            [userId]
          );

          await tx.query(
            `INSERT INTO sessions (id, user_id, token_hash, csrf_token, ip_address, user_agent, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              crypto.randomUUID(),
              userId,
              tokenHash,
              csrfToken,
              ip,
              req.headers.get('user-agent') || '',
              expiresAt,
            ]
          );

          await tx.query(
            `INSERT INTO audit_events (id, actor_user_id, actor_email, actor_role, event_type, entity_type, entity_id, summary, ip_address)
             VALUES ($1, $2, $3, 'admin', 'ADMIN_BOOTSTRAPPED', 'user', $4, 'One-time primary administrator account bootstrapped', $5)`,
            [crypto.randomUUID(), userId, email, userId, ip]
          );
        });
      } catch (err: any) {
        if (err instanceof ValidationError) {
          return jsonResponse({ error: err.message }, err.status);
        }
        throw err;
      }

      return jsonResponse(
        {
          user: {
            id: userId,
            email,
            fullName,
            role: 'admin',
            status: 'active',
            canCancelInvoices: true,
            createdAt: new Date().toISOString(),
            lastLoginAt: new Date().toISOString(),
          },
          csrfToken,
        },
        201,
        {
          'Set-Cookie': createSessionCookieHeader(rawToken, ttlHours * 3600, isSecure),
        }
      );
    }

    // Staff / Admin Login
    if (path === '/api/auth/login' && method === 'POST') {
      const originCheck = verifyCsrfAndOrigin(req, null, false);
      if (!originCheck.ok) {
        return jsonResponse({ error: originCheck.error }, 403);
      }

      const body = await readBody(req);
      const email = String(body.email ?? '').trim().toLowerCase();
      const password = String(body.password ?? '');

      if (!email || !password) {
        return jsonResponse({ error: 'Invalid email or password.' }, 401);
      }

      const emailKeyHash = crypto.createHash('sha256').update(`${ip}:${email}`).digest('hex');
      const ipRateKey = `ip:${ip}`;
      const acctRateKey = `acct:${emailKeyHash}`;

      const [ipLimit, acctLimit] = await Promise.all([
        checkLoginRateLimit(ipRateKey),
        checkLoginRateLimit(acctRateKey),
      ]);

      if (!ipLimit.allowed || !acctLimit.allowed) {
        const retryAfter = Math.max(ipLimit.retryAfterSeconds, acctLimit.retryAfterSeconds);
        return jsonResponse(
          {
            error: `Too many failed login attempts. Please wait ${Math.ceil(retryAfter / 60)} minute(s) before trying again.`,
          },
          429,
          { 'Retry-After': String(retryAfter) }
        );
      }

      const userRes = await query<{
        id: string;
        email: string;
        full_name: string;
        role: 'admin' | 'staff';
        password_hash: string | null;
        status: 'pending_setup' | 'active' | 'disabled';
        can_cancel_invoices: boolean;
        created_at: string;
      }>(`SELECT * FROM users WHERE email = $1 LIMIT 1`, [email]);

      const userRow = userRes.rows[0];

      // Always run password verification (against a dummy hash if user missing) to prevent timing enumeration
      const dummyHash =
        'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
      const passwordOk = await verifyPassword(password, userRow?.password_hash || dummyHash);

      if (!userRow || !passwordOk || userRow.status !== 'active') {
        await Promise.all([
          recordFailedLoginAttempt(ipRateKey),
          recordFailedLoginAttempt(acctRateKey),
        ]);
        await recordAuditEvent({
          actorEmail: email,
          eventType: 'LOGIN_FAILED',
          entityType: 'auth',
          summary: 'Failed login attempt',
          ipAddress: ip,
        });
        return jsonResponse({ error: 'Invalid email or password.' }, 401);
      }

      await Promise.all([clearLoginRateLimit(ipRateKey), clearLoginRateLimit(acctRateKey)]);

      const { rawToken, tokenHash } = generateOpaqueToken();
      const csrfToken = crypto.randomBytes(24).toString('hex');
      const ttlHours = Math.max(1, Number(process.env.SESSION_TTL_HOURS || 12));
      const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();

      await query(
        `INSERT INTO sessions (id, user_id, token_hash, csrf_token, ip_address, user_agent, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          crypto.randomUUID(),
          userRow.id,
          tokenHash,
          csrfToken,
          ip,
          req.headers.get('user-agent') || '',
          expiresAt,
        ]
      );

      await query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [userRow.id]);

      await recordAuditEvent({
        actorUserId: userRow.id,
        actorEmail: userRow.email,
        actorRole: userRow.role,
        eventType: 'LOGIN_SUCCESS',
        entityType: 'auth',
        entityId: userRow.id,
        summary: `User ${userRow.email} signed in`,
        ipAddress: ip,
      });

      return jsonResponse(
        {
          user: {
            id: userRow.id,
            email: userRow.email,
            fullName: userRow.full_name,
            role: userRow.role,
            status: userRow.status,
            canCancelInvoices: userRow.role === 'admin' ? true : Boolean(userRow.can_cancel_invoices),
            createdAt: userRow.created_at,
            lastLoginAt: new Date().toISOString(),
          },
          csrfToken,
        },
        200,
        {
          'Set-Cookie': createSessionCookieHeader(rawToken, ttlHours * 3600, isSecure),
        }
      );
    }

    // Verify single-use Setup / Password Reset Token
    if (path === '/api/auth/verify-token' && method === 'GET') {
      const rawToken = (url.searchParams.get('token') ?? '').trim();
      if (!rawToken) {
        return jsonResponse({ valid: false, error: 'Missing setup/reset token.' }, 400);
      }
      const tokenHash = hashOpaqueToken(rawToken);
      const res = await query<{
        purpose: 'staff_setup' | 'password_reset';
        expires_at: string;
        used_at: string | null;
        email: string;
        full_name: string;
        status: string;
      }>(
        `SELECT t.purpose, t.expires_at, t.used_at, u.email, u.full_name, u.status
         FROM auth_tokens t
         JOIN users u ON u.id = t.user_id
         WHERE t.token_hash = $1
         LIMIT 1`,
        [tokenHash]
      );

      if (res.rows.length === 0) {
        return jsonResponse({ valid: false, error: 'Invalid or expired link.' }, 404);
      }
      const row = res.rows[0];
      if (row.used_at || new Date(row.expires_at).getTime() <= Date.now() || row.status === 'disabled') {
        return jsonResponse({ valid: false, error: 'This single-use link has expired or has already been used.' }, 410);
      }

      return jsonResponse({
        valid: true,
        purpose: row.purpose,
        email: row.email,
        fullName: row.full_name,
      });
    }

    // Complete single-use Setup / Password Reset Token
    if (path === '/api/auth/complete-token' && method === 'POST') {
      const originCheck = verifyCsrfAndOrigin(req, null, false);
      if (!originCheck.ok) {
        return jsonResponse({ error: originCheck.error }, 403);
      }

      const body = await readBody(req);
      const rawToken = String(body.token ?? '').trim();
      const newPassword = String(body.password ?? '');

      if (!rawToken) {
        return jsonResponse({ error: 'Missing setup/reset token.' }, 400);
      }
      const pwValid = validatePasswordStrength(newPassword);
      if (!pwValid.isValid) {
        return jsonResponse({ error: pwValid.error }, 400);
      }

      const tokenHash = hashOpaqueToken(rawToken);
      const passwordHash = await hashPassword(newPassword);
      const { rawToken: sessionRaw, tokenHash: sessionHash } = generateOpaqueToken();
      const csrfToken = crypto.randomBytes(24).toString('hex');
      const ttlHours = Math.max(1, Number(process.env.SESSION_TTL_HOURS || 12));
      const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();

      const completedUser = await withTransaction(async (tx) => {
        const tokRes = await tx.query<{
          id: string;
          user_id: string;
          purpose: string;
          expires_at: string;
          used_at: string | null;
        }>(`SELECT * FROM auth_tokens WHERE token_hash = $1 FOR UPDATE`, [tokenHash]);

        if (tokRes.rows.length === 0) {
          throw new ValidationError('Invalid setup or reset link.', 404);
        }
        const tok = tokRes.rows[0];
        if (tok.used_at || new Date(tok.expires_at).getTime() <= Date.now()) {
          throw new ValidationError('This single-use link has expired or has already been used.', 410);
        }

        const userRes = await tx.query<{
          id: string;
          email: string;
          full_name: string;
          role: 'admin' | 'staff';
          status: string;
          can_cancel_invoices: boolean;
          created_at: string;
        }>(`SELECT * FROM users WHERE id = $1 FOR UPDATE`, [tok.user_id]);

        const u = userRes.rows[0];
        if (!u || u.status === 'disabled') {
          throw new ValidationError('Account is disabled.', 403);
        }

        await tx.query(`UPDATE auth_tokens SET used_at = NOW() WHERE id = $1`, [tok.id]);
        await tx.query(
          `UPDATE users SET password_hash = $2, status = 'active', last_login_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [u.id, passwordHash]
        );
        // Revoke any prior sessions on password reset
        await tx.query(`UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, [u.id]);

        await tx.query(
          `INSERT INTO sessions (id, user_id, token_hash, csrf_token, ip_address, user_agent, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            crypto.randomUUID(),
            u.id,
            sessionHash,
            csrfToken,
            ip,
            req.headers.get('user-agent') || '',
            expiresAt,
          ]
        );

        await tx.query(
          `INSERT INTO audit_events (id, actor_user_id, actor_email, actor_role, event_type, entity_type, entity_id, summary, ip_address)
           VALUES ($1, $2, $3, $4, $5, 'user', $6, $7, $8)`,
          [
            crypto.randomUUID(),
            u.id,
            u.email,
            u.role,
            tok.purpose === 'staff_setup' ? 'STAFF_ACCOUNT_ACTIVATED' : 'PASSWORD_RESET_COMPLETED',
            u.id,
            `Completed ${tok.purpose} for ${u.email}`,
            ip,
          ]
        );

        return u;
      });

      return jsonResponse(
        {
          user: {
            id: completedUser.id,
            email: completedUser.email,
            fullName: completedUser.full_name,
            role: completedUser.role,
            status: 'active',
            canCancelInvoices:
              completedUser.role === 'admin' ? true : Boolean(completedUser.can_cancel_invoices),
            createdAt: completedUser.created_at,
            lastLoginAt: new Date().toISOString(),
          },
          csrfToken,
        },
        200,
        {
          'Set-Cookie': createSessionCookieHeader(sessionRaw, ttlHours * 3600, isSecure),
        }
      );
    }

    // Primary Admin Emergency Recovery (requires ADMIN_RECOVERY_SECRET env var)
    if (path === '/api/auth/admin-emergency-recovery' && method === 'POST') {
      const originCheck = verifyCsrfAndOrigin(req, null, false);
      if (!originCheck.ok) {
        return jsonResponse({ error: originCheck.error }, 403);
      }

      const envRecoverySecret = (process.env.ADMIN_RECOVERY_SECRET ?? '').trim();
      if (!envRecoverySecret || envRecoverySecret === 'replace-with-separate-32-byte-random-hex-secret') {
        return jsonResponse(
          {
            error:
              'ADMIN_RECOVERY_SECRET is not configured on the server. Set ADMIN_RECOVERY_SECRET in Netlify environment variables to enable emergency primary admin recovery.',
          },
          403
        );
      }

      const body = await readBody(req);
      const suppliedSecret = String(body.recoverySecret ?? '').trim();
      const email = String(body.email ?? '').trim().toLowerCase();
      const newPassword = String(body.newPassword ?? '');

      const a = Buffer.from(suppliedSecret);
      const b = Buffer.from(envRecoverySecret);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return jsonResponse({ error: 'Invalid emergency recovery secret.' }, 403);
      }

      const pwValid = validatePasswordStrength(newPassword);
      if (!pwValid.isValid) {
        return jsonResponse({ error: pwValid.error }, 400);
      }

      const adminRes = await query<{ id: string; email: string }>(
        `SELECT id, email FROM users WHERE role = 'admin' AND email = $1 LIMIT 1`,
        [email]
      );
      if (adminRes.rows.length === 0) {
        return jsonResponse({ error: 'Matching administrator account not found.' }, 404);
      }

      const admin = adminRes.rows[0];
      const passwordHash = await hashPassword(newPassword);
      await query(
        `UPDATE users SET password_hash = $2, status = 'active', updated_at = NOW() WHERE id = $1`,
        [admin.id, passwordHash]
      );
      await query(`UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, [
        admin.id,
      ]);

      await recordAuditEvent({
        actorUserId: admin.id,
        actorEmail: admin.email,
        actorRole: 'admin',
        eventType: 'PRIMARY_ADMIN_EMERGENCY_RECOVERY',
        entityType: 'user',
        entityId: admin.id,
        summary: `Emergency password recovery completed for primary admin ${admin.email}`,
        ipAddress: ip,
      });

      return jsonResponse({ ok: true, message: 'Administrator password reset successfully. You may now sign in.' });
    }

    // ========================================================================
    // 2. PROTECTED ENDPOINTS (AUTHENTICATION + CSRF REQUIRED)
    // ========================================================================

    const auth = await getAuthenticatedSession(req);
    if (!auth) {
      return jsonResponse({ error: 'Authentication required. Please sign in.' }, 401);
    }

    const csrfCheck = verifyCsrfAndOrigin(req, auth, true);
    if (!csrfCheck.ok) {
      return jsonResponse({ error: csrfCheck.error }, 403);
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      await query(`UPDATE sessions SET revoked_at = NOW() WHERE id = $1`, [auth.sessionId]);
      await recordAuditEvent({
        actorUserId: auth.user.id,
        actorEmail: auth.user.email,
        actorRole: auth.user.role,
        eventType: 'LOGOUT',
        entityType: 'auth',
        entityId: auth.user.id,
        summary: `User ${auth.user.email} signed out`,
        ipAddress: ip,
      });
      return jsonResponse(
        { ok: true },
        200,
        { 'Set-Cookie': clearSessionCookieHeader(isSecure) }
      );
    }

    // Bootstrap configuration for authenticated staff/admin
    if (path === '/api/bootstrap-data' && method === 'GET') {
      const [businessSettings, taxConfigurations, invoiceSeries, creatorsRes] = await Promise.all([
        getBusinessSettings(),
        getTaxConfigurations(),
        getInvoiceSeriesList(),
        query<{ id: string; full_name: string; email: string }>(
          `SELECT id, full_name, email FROM users ORDER BY full_name ASC`
        ),
      ]);

      return jsonResponse({
        businessSettings,
        taxConfigurations,
        invoiceSeries,
        staffCreators: creatorsRes.rows.map((u) => ({
          id: u.id,
          fullName: u.full_name,
          email: u.email,
        })),
      });
    }

    // Dashboard metrics (operational billing figures, date-filtered)
    if (path === '/api/dashboard' && method === 'GET') {
      const from = (url.searchParams.get('from') ?? '').trim();
      const to = (url.searchParams.get('to') ?? '').trim();

      const params: any[] = [];
      const dateConds: string[] = [];
      if (from) {
        params.push(from);
        dateConds.push(`invoice_date >= $${params.length}`);
      }
      if (to) {
        params.push(to);
        dateConds.push(`invoice_date <= $${params.length}`);
      }
      const whereDate = dateConds.length > 0 ? `AND ${dateConds.join(' AND ')}` : '';

      const statsRes = await query<{
        finalised_count: string;
        draft_count: string;
        cancelled_count: string;
        billed_paise: string;
        received_paise: string;
        outstanding_paise: string;
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'Finalised') AS finalised_count,
           COUNT(*) FILTER (WHERE status = 'Draft') AS draft_count,
           COUNT(*) FILTER (WHERE status = 'Cancelled') AS cancelled_count,
           COALESCE(SUM(total_invoice_paise) FILTER (WHERE status = 'Finalised'), 0) AS billed_paise,
           COALESCE(SUM(amount_received_paise) FILTER (WHERE status = 'Finalised'), 0) AS received_paise,
           COALESCE(SUM(balance_payable_paise) FILTER (WHERE status = 'Finalised'), 0) AS outstanding_paise
         FROM invoices
         WHERE 1=1 ${whereDate}`,
        params
      );

      const recentRes = await query(
        `SELECT * FROM invoices WHERE 1=1 ${whereDate} ORDER BY created_at DESC LIMIT 8`,
        params
      );

      const recentInvoices = await Promise.all(recentRes.rows.map((r) => mapInvoiceRowToRecord(r)));
      const s = statsRes.rows[0];

      return jsonResponse({
        finalisedCount: Number(s?.finalised_count || 0),
        draftCount: Number(s?.draft_count || 0),
        cancelledCount: Number(s?.cancelled_count || 0),
        billedAmountPaise: Number(s?.billed_paise || 0),
        receivedAmountPaise: Number(s?.received_paise || 0),
        outstandingAmountPaise: Number(s?.outstanding_paise || 0),
        recentInvoices,
      });
    }

    // Customers Directory
    if (path === '/api/customers' && method === 'GET') {
      const q = (url.searchParams.get('q') ?? '').trim();
      const params: any[] = [];
      let whereSql = '';
      if (q) {
        params.push(`%${q}%`);
        whereSql = `WHERE guest_name ILIKE $1 OR COALESCE(company_name, '') ILIKE $1 OR COALESCE(gstin, '') ILIKE $1 OR COALESCE(mobile, '') ILIKE $1`;
      }
      const res = await query(
        `SELECT * FROM customers ${whereSql} ORDER BY updated_at DESC LIMIT 100`,
        params
      );
      const customers: Customer[] = res.rows.map((r) => ({
        id: r.id,
        classification: r.classification,
        guestName: r.guest_name,
        companyName: r.company_name,
        billingAddress: r.billing_address,
        stateName: r.state_name,
        stateCode: r.state_code,
        gstin: r.gstin,
        pan: r.pan,
        cin: r.cin,
        mobile: r.mobile,
        email: r.email,
        defaultBookingRef: r.default_booking_ref,
        notes: r.notes,
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString(),
      }));
      return jsonResponse({ customers });
    }

    if (path === '/api/customers' && method === 'POST') {
      const body = await readBody(req);
      const classification = body.classification === 'B2B' ? 'B2B' : 'B2C';
      const guestName = String(body.guestName ?? '').trim();
      const companyName = String(body.companyName ?? '').trim() || null;
      const billingAddress = String(body.billingAddress ?? '').trim();
      const stateName = String(body.stateName ?? 'Odisha').trim() || 'Odisha';
      const stateCode = String(body.stateCode ?? '21').trim() || '21';
      const rawGstin = String(body.gstin ?? '').trim().toUpperCase().replace(/\s+/g, '');

      if (!guestName) {
        return jsonResponse({ error: 'Guest / Contact Name is required.' }, 400);
      }
      if (!billingAddress) {
        return jsonResponse({ error: 'Billing Address is required.' }, 400);
      }

      let normalizedGstin: string | null = null;
      if (classification === 'B2B' || rawGstin) {
        if (!rawGstin && classification === 'B2B') {
          return jsonResponse({ error: 'A valid 15-character GSTIN is required for B2B customers.' }, 400);
        }
        const gstCheck = validateGstin(rawGstin);
        if (!gstCheck.isValid) {
          return jsonResponse({ error: gstCheck.error }, 400);
        }
        normalizedGstin = gstCheck.normalized;
      }

      const panCheck = validatePan(body.pan);
      if (!panCheck.isValid) {
        return jsonResponse({ error: panCheck.error }, 400);
      }

      const customerId = body.id || crypto.randomUUID();
      const existing = await query(`SELECT id FROM customers WHERE id = $1`, [customerId]);

      if (existing.rows.length === 0) {
        await query(
          `INSERT INTO customers (
            id, classification, guest_name, company_name, billing_address,
            state_name, state_code, gstin, pan, cin, mobile, email, default_booking_ref, notes, created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            customerId,
            classification,
            guestName,
            companyName,
            billingAddress,
            stateName,
            stateCode,
            normalizedGstin,
            panCheck.normalized || null,
            String(body.cin ?? '').trim().toUpperCase() || null,
            String(body.mobile ?? '').trim() || null,
            String(body.email ?? '').trim() || null,
            String(body.defaultBookingRef ?? '').trim() || null,
            String(body.notes ?? '').trim() || null,
            auth.user.id,
          ]
        );
      } else {
        await query(
          `UPDATE customers SET
            classification = $2, guest_name = $3, company_name = $4, billing_address = $5,
            state_name = $6, state_code = $7, gstin = $8, pan = $9, cin = $10,
            mobile = $11, email = $12, default_booking_ref = $13, notes = $14, updated_at = NOW()
           WHERE id = $1`,
          [
            customerId,
            classification,
            guestName,
            companyName,
            billingAddress,
            stateName,
            stateCode,
            normalizedGstin,
            panCheck.normalized || null,
            String(body.cin ?? '').trim().toUpperCase() || null,
            String(body.mobile ?? '').trim() || null,
            String(body.email ?? '').trim() || null,
            String(body.defaultBookingRef ?? '').trim() || null,
            String(body.notes ?? '').trim() || null,
          ]
        );
      }

      const saved = await query(`SELECT * FROM customers WHERE id = $1 LIMIT 1`, [customerId]);
      const r = saved.rows[0];
      return jsonResponse({
        customer: {
          id: r.id,
          classification: r.classification,
          guestName: r.guest_name,
          companyName: r.company_name,
          billingAddress: r.billing_address,
          stateName: r.state_name,
          stateCode: r.state_code,
          gstin: r.gstin,
          pan: r.pan,
          cin: r.cin,
          mobile: r.mobile,
          email: r.email,
          defaultBookingRef: r.default_booking_ref,
          notes: r.notes,
          createdAt: new Date(r.created_at).toISOString(),
          updatedAt: new Date(r.updated_at).toISOString(),
        },
      });
    }

    // Invoices List & CSV Export
    if ((path === '/api/invoices' || path === '/api/invoices/export.csv') && method === 'GET') {
      const q = (url.searchParams.get('q') ?? '').trim();
      const from = (url.searchParams.get('from') ?? '').trim();
      const to = (url.searchParams.get('to') ?? '').trim();
      const documentType = (url.searchParams.get('documentType') ?? '').trim();
      const paymentStatus = (url.searchParams.get('paymentStatus') ?? '').trim();
      const status = (url.searchParams.get('status') ?? '').trim();
      const createdBy = (url.searchParams.get('createdBy') ?? '').trim();
      const page = Math.max(1, Number(url.searchParams.get('page') || 1));
      const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') || 20)));

      const params: any[] = [];
      const conds: string[] = [];

      if (q) {
        params.push(`%${q}%`);
        conds.push(
          `(COALESCE(invoice_number, '') ILIKE $${params.length} OR guest_name ILIKE $${params.length} OR COALESCE(company_name, '') ILIKE $${params.length} OR COALESCE(customer_mobile, '') ILIKE $${params.length})`
        );
      }
      if (from) {
        params.push(from);
        conds.push(`invoice_date >= $${params.length}`);
      }
      if (to) {
        params.push(to);
        conds.push(`invoice_date <= $${params.length}`);
      }
      if (documentType) {
        params.push(documentType);
        conds.push(`document_type = $${params.length}`);
      }
      if (paymentStatus) {
        params.push(paymentStatus);
        conds.push(`payment_status = $${params.length}`);
      }
      if (status) {
        params.push(status);
        conds.push(`status = $${params.length}`);
      }
      if (createdBy) {
        params.push(createdBy);
        conds.push(`created_by = $${params.length}`);
      }

      const whereSql = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';

      if (path === '/api/invoices/export.csv') {
        const allRes = await query(
          `SELECT * FROM invoices ${whereSql} ORDER BY invoice_date DESC, created_at DESC LIMIT 2000`,
          params
        );
        const csvHeaders = [
          'Invoice Number',
          'Status',
          'Invoice Date',
          'Classification',
          'Document Type',
          'Company Name',
          'Guest Name',
          'Customer GSTIN',
          'Mobile',
          'Check-In',
          'Check-Out',
          'Rooms',
          'Billable Nights',
          'Taxable Value (INR)',
          'CGST (INR)',
          'SGST (INR)',
          'IGST (INR)',
          'Total Invoice Value (INR)',
          'Amount Received (INR)',
          'Balance Payable (INR)',
          'Payment Status',
          'Created By',
        ];
        const escapeCsv = (val: unknown) => {
          const s = String(val ?? '');
          if (s.includes(',') || s.includes('"') || s.includes('\n')) {
            return `"${s.replace(/"/g, '""')}"`;
          }
          return s;
        };
        const rows = allRes.rows.map((r) =>
          [
            r.invoice_number || 'DRAFT',
            r.status,
            r.invoice_date,
            r.customer_classification,
            r.document_type,
            r.company_name || '',
            r.guest_name,
            r.customer_gstin || '',
            r.customer_mobile || '',
            r.check_in_at,
            r.check_out_at,
            r.room_count,
            r.billable_nights,
            paiseToRupees(Number(r.taxable_value_paise)).toFixed(2),
            paiseToRupees(Number(r.cgst_paise)).toFixed(2),
            paiseToRupees(Number(r.sgst_paise)).toFixed(2),
            paiseToRupees(Number(r.igst_paise)).toFixed(2),
            paiseToRupees(Number(r.total_invoice_paise)).toFixed(2),
            paiseToRupees(Number(r.amount_received_paise)).toFixed(2),
            paiseToRupees(Number(r.balance_payable_paise)).toFixed(2),
            r.payment_status,
            r.created_by_name || '',
          ]
            .map(escapeCsv)
            .join(',')
        );
        const csvContent = [csvHeaders.map(escapeCsv).join(','), ...rows].join('\r\n');
        return new Response(csvContent, {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="livotel-invoices-export.csv"`,
            'Cache-Control': 'no-store, private',
          },
        });
      }

      const countRes = await query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM invoices ${whereSql}`,
        params
      );
      const totalCount = Number(countRes.rows[0]?.count || 0);
      const offset = (page - 1) * pageSize;

      const listRes = await query(
        `SELECT * FROM invoices ${whereSql} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, pageSize, offset]
      );

      const invoices = await Promise.all(listRes.rows.map((r) => mapInvoiceRowToRecord(r)));
      return jsonResponse({
        invoices,
        totalCount,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      });
    }

    // Save Draft Invoice
    if (path === '/api/invoices/draft' && method === 'POST') {
      const payload = await readBody(req);
      const saved = await saveInvoiceDraft(payload, auth.user);
      return jsonResponse({ invoice: saved });
    }

    // Finalise Invoice Atomically
    if (path === '/api/invoices/finalise' && method === 'POST') {
      const payload = await readBody(req);
      const finalised = await finaliseInvoiceAtomically(payload, auth.user, ip);
      return jsonResponse({ invoice: finalised });
    }

    // Dynamic /api/invoices/:id routes
    const invMatch = /^\/api\/invoices\/([0-9a-fA-F-]{10,64})(?:\/(payments|duplicate|cancel|pdf))?$/.exec(path);
    if (invMatch) {
      const invoiceId = invMatch[1];
      const subAction = invMatch[2];

      if (!subAction && method === 'GET') {
        const res = await query(`SELECT * FROM invoices WHERE id = $1 LIMIT 1`, [invoiceId]);
        if (res.rows.length === 0) {
          return jsonResponse({ error: 'Invoice not found.' }, 404);
        }
        const invoice = await mapInvoiceRowToRecord(res.rows[0]);
        return jsonResponse({ invoice });
      }

      if (subAction === 'payments' && method === 'POST') {
        const body = await readBody(req);
        const invoice = await recordInvoicePayment(invoiceId, body, auth.user, ip);
        return jsonResponse({ invoice });
      }

      if (subAction === 'duplicate' && method === 'POST') {
        const draft = await duplicateInvoiceAsDraft(invoiceId, auth.user);
        return jsonResponse({ invoice: draft });
      }

      if (subAction === 'cancel' && method === 'POST') {
        const body = await readBody(req);
        const invoice = await cancelFinalisedInvoice(invoiceId, String(body.reason ?? ''), auth.user, ip);
        return jsonResponse({ invoice });
      }

      if (subAction === 'pdf' && method === 'GET') {
        const variantParam = (url.searchParams.get('variant') ?? 'original').toLowerCase();
        const variant = variantParam === 'payment_summary' ? 'PAYMENT_SUMMARY' : 'ORIGINAL';
        const { pdfBytes, filename } = await getOrGenerateInvoicePdfBytes(invoiceId, variant);
        return new Response(pdfBytes as any, {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'private, no-store, max-age=0',
            'X-Robots-Tag': 'noindex, nofollow, noarchive',
          },
        });
      }
    }

    // ========================================================================
    // 3. ADMIN-ONLY ENDPOINTS (Strict Server-Side Role Enforcement)
    // ========================================================================

    if (path.startsWith('/api/admin/')) {
      if (auth.user.role !== 'admin') {
        return jsonResponse(
          { error: 'Forbidden: Administrator privileges are required for this action.' },
          403
        );
      }

      // Update Business Settings
      if (path === '/api/admin/business-settings' && method === 'PUT') {
        const body = await readBody(req);
        const gstCheck = validateGstin(body.supplierGstin);
        if (!gstCheck.isValid) {
          return jsonResponse({ error: `Supplier GSTIN invalid: ${gstCheck.error}` }, 400);
        }

        const reasons = Array.isArray(body.nonGstAllowedReasons)
          ? body.nonGstAllowedReasons.map((r: any) => String(r).trim()).filter(Boolean)
          : ['Exempt Supply under GST Notification'];

        await query(
          `UPDATE business_settings SET
            display_name = $1,
            subtitle = $2,
            supplier_legal_name = $3,
            supplier_address = $4,
            supplier_gstin = $5,
            default_place_of_supply = $6,
            default_state_code = $7,
            property_name = $8,
            default_nature_of_supply = $9,
            default_sac = $10,
            bank_account_name = $11,
            bank_name = $12,
            bank_account_type = $13,
            bank_account_no = $14,
            bank_ifsc = $15,
            bank_branch = $16,
            standard_check_in = $17,
            standard_check_out = $18,
            declaration_text = $19,
            authorised_signatory = $20,
            show_amount_in_words = $21,
            non_gst_enabled = $22,
            non_gst_default_title = $23,
            non_gst_allowed_reasons = $24::jsonb,
            rounding_policy = $25,
            staff_can_cancel_invoices = $26,
            updated_by = $27,
            updated_at = NOW()
           WHERE id = 1`,
          [
            String(body.displayName ?? 'LIVOTEL PREMIUM HOTEL').trim(),
            String(body.subtitle ?? '').trim(),
            String(body.supplierLegalName ?? '').trim(),
            String(body.supplierAddress ?? '').trim(),
            gstCheck.normalized,
            String(body.defaultPlaceOfSupply ?? 'Odisha (21)').trim(),
            String(body.defaultStateCode ?? '21').trim(),
            String(body.propertyName ?? '').trim(),
            String(body.defaultNatureOfSupply ?? '').trim(),
            String(body.defaultSac ?? '996311').trim(),
            String(body.bankAccountName ?? '').trim(),
            String(body.bankName ?? '').trim(),
            String(body.bankAccountType ?? '').trim(),
            String(body.bankAccountNo ?? '').trim(),
            String(body.bankIfsc ?? '').trim(),
            String(body.bankBranch ?? '').trim(),
            String(body.standardCheckIn ?? '12:00 PM').trim(),
            String(body.standardCheckOut ?? '11:00 AM').trim(),
            String(body.declarationText ?? '').trim(),
            String(body.authorisedSignatory ?? '').trim(),
            Boolean(body.showAmountInWords),
            Boolean(body.nonGstEnabled),
            body.nonGstDefaultTitle === 'BILL' ? 'BILL' : 'BILL OF SUPPLY',
            JSON.stringify(reasons),
            body.roundingPolicy === 'per_invoice' ? 'per_invoice' : 'per_line',
            Boolean(body.staffCanCancelInvoices),
            auth.user.id,
          ]
        );

        await recordAuditEvent({
          actorUserId: auth.user.id,
          actorEmail: auth.user.email,
          actorRole: auth.user.role,
          eventType: 'BUSINESS_SETTINGS_UPDATED',
          entityType: 'business_settings',
          entityId: '1',
          summary: 'Updated hotel business settings (applies to future invoices only)',
          ipAddress: ip,
        });

        const updated = await getBusinessSettings();
        return jsonResponse({ businessSettings: updated });
      }

      // Upload Versioned Hotel Logo
      if (path === '/api/admin/logo' && method === 'POST') {
        const body = await readBody(req);
        const dataUrl = String(body.dataUrl ?? '').trim();
        if (!dataUrl.startsWith('data:image/')) {
          return jsonResponse({ error: 'Please provide a valid image data URL (JPEG or PNG).' }, 400);
        }

        const commaIdx = dataUrl.indexOf(',');
        const metaPart = dataUrl.slice(5, commaIdx);
        const mimeType = metaPart.split(';')[0] || 'image/jpeg';
        const base64Data = dataUrl.slice(commaIdx + 1);
        const binaryBuf = Buffer.from(base64Data, 'base64');
        if (binaryBuf.length > 5 * 1024 * 1024) {
          return jsonResponse({ error: 'Logo file must be under 5 MB.' }, 400);
        }

        const sha256 = crypto.createHash('sha256').update(binaryBuf).digest('hex');
        const maxVerRes = await query<{ max_ver: number }>(
          `SELECT COALESCE(MAX(version_number), 0) AS max_ver FROM logo_versions`
        );
        const nextVersion = Number(maxVerRes.rows[0]?.max_ver || 0) + 1;
        const logoId = crypto.randomUUID();
        const ext = mimeType.includes('png') ? 'png' : 'jpg';
        const blobKey = `logos/v${nextVersion}-${crypto.randomBytes(8).toString('hex')}.${ext}`;

        await putPrivateBlob('logos', blobKey, binaryBuf, {
          versionNumber: String(nextVersion),
          mimeType,
          uploadedBy: auth.user.id,
        });

        await query(
          `INSERT INTO logo_versions (id, version_number, blob_key, mime_type, data_url, sha256_hash, pixel_width, pixel_height, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            logoId,
            nextVersion,
            blobKey,
            mimeType,
            dataUrl,
            sha256,
            Number(body.width || 1024),
            Number(body.height || 1024),
            auth.user.id,
          ]
        );

        await query(
          `UPDATE business_settings SET active_logo_version_id = $1, updated_by = $2, updated_at = NOW() WHERE id = 1`,
          [logoId, auth.user.id]
        );

        await recordAuditEvent({
          actorUserId: auth.user.id,
          actorEmail: auth.user.email,
          actorRole: auth.user.role,
          eventType: 'LOGO_VERSION_UPLOADED',
          entityType: 'logo_version',
          entityId: logoId,
          summary: `Uploaded hotel logo version v${nextVersion} (existing finalised invoices retain prior snapshot)`,
          ipAddress: ip,
        });

        const updated = await getBusinessSettings();
        return jsonResponse({ businessSettings: updated, versionNumber: nextVersion });
      }

      // Update or Create Tax Configuration
      if (path === '/api/admin/tax-configurations' && method === 'POST') {
        const body = await readBody(req);
        const id = body.id || crypto.randomUUID();
        const code = String(body.code ?? '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        const name = String(body.name ?? '').trim();
        const serviceCategory = body.serviceCategory || 'other';
        const defaultSac = String(body.defaultSac ?? '996311').trim();
        const taxMode = body.taxMode === 'igst' ? 'igst' : body.taxMode === 'exempt' ? 'exempt' : 'cgst_sgst';
        const cgstRateBps = taxMode === 'cgst_sgst' ? Math.max(0, Math.round(Number(body.cgstRateBps || 0))) : 0;
        const sgstRateBps = taxMode === 'cgst_sgst' ? Math.max(0, Math.round(Number(body.sgstRateBps || 0))) : 0;
        const igstRateBps = taxMode === 'igst' ? Math.max(0, Math.round(Number(body.igstRateBps || 0))) : 0;
        const totalRateBps = cgstRateBps + sgstRateBps + igstRateBps;

        if (!code || !name) {
          return jsonResponse({ error: 'Tax rule code and name are required.' }, 400);
        }

        await query(
          `INSERT INTO tax_configurations (
            id, code, name, service_category, default_sac, place_of_supply_rule, tax_mode,
            cgst_rate_bps, sgst_rate_bps, igst_rate_bps, total_rate_bps,
            is_default, is_active, effective_from, effective_to, notes, created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          ON CONFLICT (code) DO UPDATE SET
            name = EXCLUDED.name,
            service_category = EXCLUDED.service_category,
            default_sac = EXCLUDED.default_sac,
            tax_mode = EXCLUDED.tax_mode,
            cgst_rate_bps = EXCLUDED.cgst_rate_bps,
            sgst_rate_bps = EXCLUDED.sgst_rate_bps,
            igst_rate_bps = EXCLUDED.igst_rate_bps,
            total_rate_bps = EXCLUDED.total_rate_bps,
            is_default = EXCLUDED.is_default,
            is_active = EXCLUDED.is_active,
            effective_from = EXCLUDED.effective_from,
            effective_to = EXCLUDED.effective_to,
            notes = EXCLUDED.notes,
            updated_at = NOW()`,
          [
            id,
            code,
            name,
            serviceCategory,
            defaultSac,
            taxMode === 'igst'
              ? 'EXPLICIT_INTERSTATE_IGST_RULE'
              : taxMode === 'exempt'
                ? 'NON_GST_EXEMPT'
                : 'LOC_OF_IMMOVABLE_PROPERTY_ODISHA_21',
            taxMode,
            cgstRateBps,
            sgstRateBps,
            igstRateBps,
            totalRateBps,
            Boolean(body.isDefault),
            body.isActive !== undefined ? Boolean(body.isActive) : true,
            String(body.effectiveFrom || '2025-04-01'),
            body.effectiveTo || null,
            body.notes || null,
            auth.user.id,
          ]
        );

        const taxConfigurations = await getTaxConfigurations();
        return jsonResponse({ taxConfigurations });
      }

      // Configure Invoice Number Series
      if (path === '/api/admin/invoice-series' && method === 'POST') {
        const body = await readBody(req);
        const prefix = String(body.prefix ?? 'LPH').trim().toUpperCase();
        const financialYear = String(body.financialYear ?? '26-27').trim();
        const separator = String(body.separator ?? '/').trim() || '/';
        const nextNumber = Math.max(1, Math.round(Number(body.nextNumber || 1)));
        const paddingDigits = Math.min(8, Math.max(1, Math.round(Number(body.paddingDigits || 4))));

        const sampleNum = formatInvoiceNumberFromSeries({
          prefix,
          financialYear,
          separator,
          paddingDigits,
          sequenceNumber: nextNumber,
        });

        const gstNumCheck = validateGstInvoiceNumber(sampleNum);
        if (!gstNumCheck.isValid) {
          return jsonResponse({ error: gstNumCheck.error }, 400);
        }

        // Verify nextNumber does not collide with already issued invoices in this series
        const maxIssued = await query<{ max_seq: number }>(
          `SELECT COALESCE(MAX(sequence_number), 0) AS max_seq
           FROM invoices i
           JOIN invoice_series s ON s.id = i.series_id
           WHERE s.prefix = $1 AND s.financial_year = $2`,
          [prefix, financialYear]
        );
        const highestIssued = Number(maxIssued.rows[0]?.max_seq || 0);
        if (nextNumber <= highestIssued) {
          return jsonResponse(
            {
              error: `Cannot set starting sequence to ${nextNumber}; sequence #${highestIssued} has already been allocated in ${prefix}${separator}${financialYear}. Set Next Number to at least ${highestIssued + 1}.`,
            },
            400
          );
        }

        await withTransaction(async (tx) => {
          if (body.isActive !== false) {
            await tx.query(`UPDATE invoice_series SET is_active = FALSE`);
          }
          await tx.query(
            `INSERT INTO invoice_series (id, series_code, prefix, financial_year, separator, next_number, padding_digits, is_active, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (prefix, financial_year) DO UPDATE SET
               separator = EXCLUDED.separator,
               next_number = EXCLUDED.next_number,
               padding_digits = EXCLUDED.padding_digits,
               is_active = EXCLUDED.is_active,
               updated_by = EXCLUDED.updated_by,
               updated_at = NOW()`,
            [
              crypto.randomUUID(),
              `${prefix}_${financialYear}`.replace(/[^A-Z0-9_]/g, '_'),
              prefix,
              financialYear,
              separator,
              nextNumber,
              paddingDigits,
              body.isActive !== false,
              auth.user.id,
            ]
          );
        });

        const invoiceSeries = await getInvoiceSeriesList();
        return jsonResponse({ invoiceSeries, sampleNumber: sampleNum });
      }

      // Staff Management: List Staff & Admin accounts
      if (path === '/api/admin/staff' && method === 'GET') {
        const res = await query(
          `SELECT u.*,
             (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > NOW()) AS active_sessions
           FROM users u
           ORDER BY u.created_at ASC`
        );
        return jsonResponse({
          staff: res.rows.map((u) => ({
            id: u.id,
            email: u.email,
            fullName: u.full_name,
            role: u.role,
            status: u.status,
            canCancelInvoices: u.role === 'admin' ? true : Boolean(u.can_cancel_invoices),
            activeSessions: Number(u.active_sessions || 0),
            createdAt: new Date(u.created_at).toISOString(),
            lastLoginAt: u.last_login_at ? new Date(u.last_login_at).toISOString() : null,
          })),
        });
      }

      // Create Staff Account & Single-Use Expiring Setup Link
      if (path === '/api/admin/staff/invite' && method === 'POST') {
        const body = await readBody(req);
        const email = String(body.email ?? '').trim().toLowerCase();
        const fullName = String(body.fullName ?? '').trim();
        const role = body.role === 'admin' ? 'admin' : 'staff';
        const canCancelInvoices = role === 'admin' ? true : Boolean(body.canCancelInvoices);

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return jsonResponse({ error: 'Please enter a valid email address.' }, 400);
        }
        if (!fullName) {
          return jsonResponse({ error: 'Please enter the staff member full name.' }, 400);
        }

        const existing = await query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [email]);
        if (existing.rows.length > 0) {
          return jsonResponse({ error: 'An account with this email already exists.' }, 409);
        }

        const userId = crypto.randomUUID();
        const { rawToken, tokenHash } = generateOpaqueToken();
        const expiresAt = new Date(Date.now() + 48 * 3600 * 1000).toISOString();

        await withTransaction(async (tx) => {
          await tx.query(
            `INSERT INTO users (id, email, full_name, role, status, can_cancel_invoices, created_by)
             VALUES ($1, $2, $3, $4, 'pending_setup', $5, $6)`,
            [userId, email, fullName, role, canCancelInvoices, auth.user.id]
          );
          await tx.query(
            `INSERT INTO auth_tokens (id, user_id, token_hash, purpose, created_by, expires_at)
             VALUES ($1, $2, $3, 'staff_setup', $4, $5)`,
            [crypto.randomUUID(), userId, tokenHash, auth.user.id, expiresAt]
          );
        });

        await recordAuditEvent({
          actorUserId: auth.user.id,
          actorEmail: auth.user.email,
          actorRole: auth.user.role,
          eventType: 'STAFF_INVITED',
          entityType: 'user',
          entityId: userId,
          summary: `Created invitation setup link for ${email} (${role})`,
          ipAddress: ip,
        });

        const baseOrigin = process.env.URL || `${url.protocol}//${url.host}`;
        const setupUrl = `${baseOrigin}/login?setup_token=${encodeURIComponent(rawToken)}`;

        return jsonResponse({
          userId,
          email,
          fullName,
          role,
          setupUrl,
          expiresAt,
        });
      }

      // Admin-Driven Staff Password Reset Link or Account Update
      const staffMatch = /^\/api\/admin\/staff\/([0-9a-fA-F-]{10,64})(?:\/(reset-link))?$/.exec(path);
      if (staffMatch) {
        const targetUserId = staffMatch[1];
        const sub = staffMatch[2];

        if (sub === 'reset-link' && method === 'POST') {
          const userRes = await query<{ id: string; email: string; full_name: string }>(
            `SELECT id, email, full_name FROM users WHERE id = $1 LIMIT 1`,
            [targetUserId]
          );
          if (userRes.rows.length === 0) {
            return jsonResponse({ error: 'Staff account not found.' }, 404);
          }
          const u = userRes.rows[0];
          const { rawToken, tokenHash } = generateOpaqueToken();
          const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

          await withTransaction(async (tx) => {
            await tx.query(
              `UPDATE auth_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`,
              [u.id]
            );
            await tx.query(
              `INSERT INTO auth_tokens (id, user_id, token_hash, purpose, created_by, expires_at)
               VALUES ($1, $2, $3, 'password_reset', $4, $5)`,
              [crypto.randomUUID(), u.id, tokenHash, auth.user.id, expiresAt]
            );
            await tx.query(
              `UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
              [u.id]
            );
          });

          await recordAuditEvent({
            actorUserId: auth.user.id,
            actorEmail: auth.user.email,
            actorRole: auth.user.role,
            eventType: 'STAFF_PASSWORD_RESET_ISSUED',
            entityType: 'user',
            entityId: u.id,
            summary: `Generated single-use password reset link for ${u.email}`,
            ipAddress: ip,
          });

          const baseOrigin = process.env.URL || `${url.protocol}//${url.host}`;
          const resetUrl = `${baseOrigin}/login?reset_token=${encodeURIComponent(rawToken)}`;

          return jsonResponse({
            resetUrl,
            email: u.email,
            fullName: u.full_name,
            expiresAt,
          });
        }

        if (!sub && method === 'PATCH') {
          const body = await readBody(req);
          if (targetUserId === auth.user.id && body.status === 'disabled') {
            return jsonResponse({ error: 'You cannot disable your own active administrator account.' }, 400);
          }

          const currentRes = await query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [targetUserId]);
          if (currentRes.rows.length === 0) {
            return jsonResponse({ error: 'User not found.' }, 404);
          }
          const curr = currentRes.rows[0];
          const nextStatus = body.status || curr.status;
          const nextRole = body.role || curr.role;
          const nextCancel =
            body.canCancelInvoices !== undefined
              ? Boolean(body.canCancelInvoices)
              : Boolean(curr.can_cancel_invoices);

          await query(
            `UPDATE users SET status = $2, role = $3, can_cancel_invoices = $4, updated_at = NOW() WHERE id = $1`,
            [targetUserId, nextStatus, nextRole, nextCancel]
          );

          if (nextStatus === 'disabled') {
            await query(
              `UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
              [targetUserId]
            );
          }

          await recordAuditEvent({
            actorUserId: auth.user.id,
            actorEmail: auth.user.email,
            actorRole: auth.user.role,
            eventType: 'STAFF_UPDATED',
            entityType: 'user',
            entityId: targetUserId,
            summary: `Updated staff account ${curr.email} (status=${nextStatus}, role=${nextRole}, canCancel=${nextCancel})`,
            ipAddress: ip,
          });

          return jsonResponse({ ok: true });
        }
      }

      // Admin Full Backup Export (JSON)
      if (path === '/api/admin/export-backup' && method === 'GET') {
        const [
          businessSettings,
          taxConfigurations,
          invoiceSeries,
          customersRes,
          invoicesRes,
          itemsRes,
          paymentsRes,
          auditRes,
        ] = await Promise.all([
          getBusinessSettings(),
          getTaxConfigurations(),
          getInvoiceSeriesList(),
          query(`SELECT * FROM customers ORDER BY created_at ASC`),
          query(`SELECT * FROM invoices ORDER BY created_at ASC`),
          query(`SELECT * FROM invoice_items ORDER BY invoice_id, sort_order ASC`),
          query(`SELECT * FROM payments ORDER BY recorded_at ASC`),
          query(`SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 500`),
        ]);

        const backupPayload = {
          exportedAt: new Date().toISOString(),
          exportedBy: auth.user.email,
          application: 'LIVOTEL PREMIUM HOTEL Billing System',
          businessSettings: { ...businessSettings, activeLogoDataUrl: undefined },
          taxConfigurations,
          invoiceSeries,
          customers: customersRes.rows,
          invoices: invoicesRes.rows,
          invoiceItems: itemsRes.rows,
          payments: paymentsRes.rows,
          auditEvents: auditRes.rows,
        };

        return new Response(JSON.stringify(backupPayload, null, 2), {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="livotel-billing-backup-${new Date().toISOString().slice(0, 10)}.json"`,
            'Cache-Control': 'no-store, private',
          },
        });
      }

      // Admin Audit Events
      if (path === '/api/admin/audit-events' && method === 'GET') {
        const res = await query(`SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 100`);
        return jsonResponse({
          auditEvents: res.rows.map((a) => ({
            id: a.id,
            actorEmail: a.actor_email,
            actorRole: a.actor_role,
            eventType: a.event_type,
            entityType: a.entity_type,
            entityId: a.entity_id,
            summary: a.summary,
            createdAt: new Date(a.created_at).toISOString(),
          })),
        });
      }
    }

    return jsonResponse({ error: `API route not found: ${method} ${path}` }, 404);
  } catch (err: any) {
    if (err instanceof ValidationError) {
      return jsonResponse({ error: err.message }, err.status);
    }
    return jsonResponse(
      { error: err?.message || 'An unexpected server error occurred.' },
      500
    );
  }
}

export const config: Config = {
  path: ['/api/*'],
};
