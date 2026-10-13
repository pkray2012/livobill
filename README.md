# LIVOTEL PREMIUM HOTEL — Private Billing & GST Invoicing Web Application

Private internal web application for **LIVOTEL PREMIUM HOTEL** (*Owned & Operated by Laughing Buddha Homestay Bhubaneswar*) to create, preview, finalise, manage, and export selectable-text A4 GST Tax Invoices and configured Non-GST documents.

---

## 1. Technical Architecture

- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS (`src/`).
- **Backend API**: Netlify Functions v2 (`netlify/functions/api.mts`) routed under `/api/*`.
- **Database**: **Netlify Database** (built-in PostgreSQL powered by Neon via `@netlify/neon` and `@neondatabase/serverless` `Pool`). For isolated local development and automated tests without a remote database URL, the server automatically uses an embedded PostgreSQL 16 engine (`@electric-sql/pglite`) stored in `.local-data/pgdata`.
- **Private Binary Storage**: **Netlify Blobs** (`@netlify/blobs`) for private finalised invoice PDFs (`livotel-private-invoices`) and versioned brand logos (`livotel-brand-assets`). PDFs are never served from public static URLs; every PDF download is gated by authenticated session verification in `/api/invoices/:id/pdf`.
- **PDF Generation**: `@react-pdf/renderer` (`src/pdf/InvoicePdfDocument.tsx` & `netlify/functions/_lib/pdf-server.tsx`) generating selectable-text A4 portrait PDFs with sharp vector borders and the exact official Livotel logo.

---

## 2. Netlify Setup, Provisioning & Deployment

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Provision Netlify Database (PostgreSQL)
Link your Netlify site and initialize Netlify DB (built-in Neon PostgreSQL):
```bash
npx netlify link
npx netlify db init
```
When provisioned, Netlify automatically injects `NETLIFY_DATABASE_URL` into your Netlify Functions environment.

> **Important Note on Netlify Database Plans & Claiming**:
> - Newly initialized Netlify DB instances that are unclaimed have a 7-day claiming window in the Netlify dashboard. Claim and connect the database in your Netlify project dashboard before putting the billing system into production.
> - Production and Deploy Preview environments should use separate database branches/URLs so preview deployments never write to production billing records.
> - Build commands (`npm run build`) **never** seed sample customers, sample invoices, or reset production data.

### Step 3: Configure Environment Variables
Copy `.env.example` to `.env` for local configuration, or set the following in **Netlify Site Configuration → Environment variables**:

| Variable | Required | Description |
| :--- | :--- | :--- |
| `NETLIFY_DATABASE_URL` | Auto-set by Netlify DB | PostgreSQL connection string (server-only; never exposed to browser). |
| `ADMIN_BOOTSTRAP_SECRET` | Recommended | One-time secret required on the initial `/login` bootstrap screen to create the first administrator account. |
| `ADMIN_RECOVERY_SECRET` | Emergency only | Optional secret used only when recovering a locked-out primary administrator account via `POST /api/auth/admin-emergency-recovery`. |
| `SESSION_TTL_HOURS` | Optional (default `12`) | Session expiration window in hours. |

### Step 4: Database Migrations
Migrations in `migrations/001_initial_schema.sql` and `migrations/002_seed_defaults.sql` run idempotently (`CREATE TABLE IF NOT EXISTS` / `ON CONFLICT DO NOTHING`) on server startup or can be executed explicitly via CLI:
```bash
npm run db:migrate
```
`002_seed_defaults.sql` seeds **only** the default Livotel business settings, initial 5% GST tax rules (`2.5% CGST + 2.5% SGST`), and the default `LPH/26-27/0001` invoice series. It never seeds sample customers or sample invoices.

### Step 5: Local Development, Testing & Production Build
```bash
# Run local development server (Vite + mounted /api/* Netlify Functions middleware)
npm run dev

# Run automated test suite (Vitest)
npm test

# Generate and render verification sample PDFs
npm run verify:pdfs

# Build for production (outputs to dist/)
npm run build
```

---

## 3. Authentication, Staff Onboarding & Admin Recovery

1. **One-Time Primary Admin Bootstrap**:
   - On a fresh database with zero administrators, visiting `/login` displays the **Initial Admin Bootstrap** screen.
   - Once the first administrator account is created, `bootstrap_state.is_completed` is permanently locked to `TRUE` in PostgreSQL, disabling public bootstrap forever.
2. **Invitation-Only Staff Accounts (No Paid Email Service Required)**:
   - Administrators open **Staff Management** and create an account for a staff member.
   - The server generates a cryptographically random 256-bit single-use token (`?setup_token=...`), stores **only** its SHA-256 hash in `auth_tokens` with a 48-hour expiry, and displays the link for the administrator to copy and share manually.
3. **Admin-Driven Staff Password Reset**:
   - In **Staff Management**, an administrator can click **Reset Password Link** for any staff member.
   - This immediately revokes all active sessions for that user and provides a single-use 24-hour password reset link (`?reset_token=...`) to copy and share.
4. **Primary Administrator Emergency Recovery**:
   - Best practice: Create a second trusted administrator account for redundancy.
   - If the primary administrator loses their password and no second administrator exists:
     1. Set `ADMIN_RECOVERY_SECRET` to a strong random string in the Netlify dashboard and redeploy/restart functions.
     2. On the `/login` screen, click **Emergency Admin Recovery**, enter the primary admin email, the `ADMIN_RECOVERY_SECRET`, and a new password.
     3. Remove `ADMIN_RECOVERY_SECRET` from the Netlify environment variables immediately after recovery.

---

## 4. Backup, Restore & 72-Month GST Retention Guidance

- Under Indian GST rules (**CGST Section 36**), tax invoices and billing ledgers should be retained for at least **72 months (6 years)** from the due date of furnishing the annual return for the relevant financial year.
- **Built-in Redundancy**:
  - Every finalised invoice stores its complete immutable snapshot (`business_snapshot_json`, `tax_snapshot_json`, `logo_version_id`, line items, and payments) in PostgreSQL in addition to its private PDF in Netlify Blobs.
  - If a PDF blob is ever missing from object storage, requesting `/api/invoices/:id/pdf` deterministically regenerates an identical PDF from the immutable database snapshot and re-caches it in Netlify Blobs.
- **Routine Backup Procedure**:
  1. **Application JSON Export**: Administrators can go to **Admin Settings → Backups & Recovery → Export Complete JSON Backup** (`GET /api/admin/export-backup`) to download all business settings, tax rules, invoice series, customers, invoices, line items, payments, and audit logs.
  2. **PostgreSQL Logical Backup (`pg_dump`)**: Periodically run `pg_dump "$NETLIFY_DATABASE_URL" --format=custom --file=livotel_$(date +%F).dump` and archive the dump in encrypted off-site storage.
