-- ============================================================================
-- LIVOTEL PREMIUM HOTEL - PRIVATE BILLING SYSTEM
-- Migration: 001_initial_schema.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1. Users and Roles
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending_setup' CHECK (status IN ('pending_setup', 'active', 'disabled')),
  can_cancel_invoices BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, status);

-- 2. One-Time Primary Admin Bootstrap Guard
CREATE TABLE IF NOT EXISTS bootstrap_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  bootstrapped_at TIMESTAMPTZ,
  bootstrapped_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO bootstrap_state (id, is_completed)
VALUES (1, FALSE)
ON CONFLICT (id) DO NOTHING;

-- 3. Opaque Sessions (stores SHA-256 token_hash, NEVER raw token)
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- 4. Single-Use Setup & Password Reset Tokens (stores SHA-256 token_hash, NEVER raw token)
CREATE TABLE IF NOT EXISTS auth_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('staff_setup', 'password_reset')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_hash ON auth_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_id ON auth_tokens(user_id);

-- 5. Persistent Login Rate Limiting
CREATE TABLE IF NOT EXISTS login_rate_limits (
  rate_key TEXT PRIMARY KEY,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  first_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Template / Logo Versions
CREATE TABLE IF NOT EXISTS logo_versions (
  id UUID PRIMARY KEY,
  version_number INTEGER NOT NULL UNIQUE,
  blob_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  data_url TEXT NOT NULL,
  sha256_hash TEXT NOT NULL,
  pixel_width INTEGER NOT NULL DEFAULT 1024,
  pixel_height INTEGER NOT NULL DEFAULT 1024,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Business Settings (Singleton id=1, snapshotted onto finalised invoices)
CREATE TABLE IF NOT EXISTS business_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  display_name TEXT NOT NULL DEFAULT 'LIVOTEL PREMIUM HOTEL',
  subtitle TEXT NOT NULL DEFAULT 'Owned & Operated by Laughing Buddha Homestay Bhubaneswar',
  supplier_legal_name TEXT NOT NULL DEFAULT 'Laughing Buddha Homestay Bhubaneswar',
  supplier_address TEXT NOT NULL DEFAULT E'Plot No. A/13, Trishna Enclave, Phase-1\nKIIT Road, Patia, Bhubaneswar – 751024\nOdisha, India',
  supplier_gstin TEXT NOT NULL DEFAULT '21BREPR9585B1ZO',
  default_place_of_supply TEXT NOT NULL DEFAULT 'Odisha (21)',
  default_state_code TEXT NOT NULL DEFAULT '21',
  property_name TEXT NOT NULL DEFAULT 'Livotel Premium Hotel, Bhubaneswar',
  default_nature_of_supply TEXT NOT NULL DEFAULT 'Hotel Accommodation Services',
  default_sac TEXT NOT NULL DEFAULT '996311',
  bank_account_name TEXT NOT NULL DEFAULT 'Laughing Buddha Homestay',
  bank_name TEXT NOT NULL DEFAULT 'ICICI Bank',
  bank_account_type TEXT NOT NULL DEFAULT 'Current Account',
  bank_account_no TEXT NOT NULL DEFAULT '242405000457',
  bank_ifsc TEXT NOT NULL DEFAULT 'ICIC0002424',
  bank_branch TEXT NOT NULL DEFAULT 'Jayadev Vihar',
  standard_check_in TEXT NOT NULL DEFAULT '12:00 PM',
  standard_check_out TEXT NOT NULL DEFAULT '11:00 AM',
  declaration_text TEXT NOT NULL DEFAULT 'We declare that this invoice shows the actual price of the services described and that all particulars are true and correct.',
  authorised_signatory TEXT NOT NULL DEFAULT 'Pradipta Kumar Ray',
  show_amount_in_words BOOLEAN NOT NULL DEFAULT FALSE,
  non_gst_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  non_gst_default_title TEXT NOT NULL DEFAULT 'BILL OF SUPPLY' CHECK (non_gst_default_title IN ('BILL OF SUPPLY', 'BILL')),
  non_gst_allowed_reasons JSONB NOT NULL DEFAULT '["Exempt Supply under GST Notification", "Non-GST Reimbursable Disbursement"]'::jsonb,
  rounding_policy TEXT NOT NULL DEFAULT 'per_line' CHECK (rounding_policy IN ('per_line', 'per_invoice')),
  staff_can_cancel_invoices BOOLEAN NOT NULL DEFAULT FALSE,
  active_logo_version_id UUID REFERENCES logo_versions(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Tax Configurations (Admin-managed with effective dates and basis points)
CREATE TABLE IF NOT EXISTS tax_configurations (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  service_category TEXT NOT NULL CHECK (service_category IN ('accommodation', 'extra_bed', 'early_check_in', 'late_checkout', 'food_beverage', 'laundry', 'transport', 'other')),
  default_sac TEXT NOT NULL DEFAULT '996311',
  place_of_supply_rule TEXT NOT NULL DEFAULT 'LOC_OF_IMMOVABLE_PROPERTY_ODISHA_21' CHECK (place_of_supply_rule IN ('LOC_OF_IMMOVABLE_PROPERTY_ODISHA_21', 'EXPLICIT_INTERSTATE_IGST_RULE', 'NON_GST_EXEMPT')),
  tax_mode TEXT NOT NULL DEFAULT 'cgst_sgst' CHECK (tax_mode IN ('cgst_sgst', 'igst', 'exempt')),
  cgst_rate_bps INTEGER NOT NULL DEFAULT 250 CHECK (cgst_rate_bps >= 0 AND cgst_rate_bps <= 5000),
  sgst_rate_bps INTEGER NOT NULL DEFAULT 250 CHECK (sgst_rate_bps >= 0 AND sgst_rate_bps <= 5000),
  igst_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK (igst_rate_bps >= 0 AND igst_rate_bps <= 5000),
  total_rate_bps INTEGER NOT NULL DEFAULT 500 CHECK (total_rate_bps >= 0 AND total_rate_bps <= 5000),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from TEXT NOT NULL DEFAULT '2025-04-01',
  effective_to TEXT,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tax_configs_category_active ON tax_configurations(service_category, is_active);

-- 9. Invoice Number Series (Financial-year-aware atomic allocation)
CREATE TABLE IF NOT EXISTS invoice_series (
  id UUID PRIMARY KEY,
  series_code TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL DEFAULT 'LPH',
  financial_year TEXT NOT NULL DEFAULT '26-27',
  separator TEXT NOT NULL DEFAULT '/',
  next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  padding_digits INTEGER NOT NULL DEFAULT 4 CHECK (padding_digits BETWEEN 1 AND 8),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (prefix, financial_year)
);

-- 10. Customers Directory (Never pre-populated with sample customers)
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY,
  classification TEXT NOT NULL CHECK (classification IN ('B2B', 'B2C')),
  guest_name TEXT NOT NULL,
  company_name TEXT,
  billing_address TEXT NOT NULL,
  state_name TEXT NOT NULL DEFAULT 'Odisha',
  state_code TEXT NOT NULL DEFAULT '21',
  gstin TEXT,
  pan TEXT,
  cin TEXT,
  mobile TEXT,
  email TEXT,
  default_booking_ref TEXT,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(guest_name);
CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company_name);
CREATE INDEX IF NOT EXISTS idx_customers_gstin ON customers(gstin);
CREATE INDEX IF NOT EXISTS idx_customers_mobile ON customers(mobile);

-- 11. Invoices
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY,
  invoice_number TEXT UNIQUE,
  series_id UUID REFERENCES invoice_series(id) ON DELETE RESTRICT,
  sequence_number INTEGER,
  financial_year TEXT,
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Finalised', 'Cancelled')),
  customer_classification TEXT NOT NULL CHECK (customer_classification IN ('B2B', 'B2C')),
  document_type TEXT NOT NULL DEFAULT 'GST_TAX_INVOICE' CHECK (document_type IN ('GST_TAX_INVOICE', 'NON_GST_DOCUMENT')),
  document_title TEXT NOT NULL DEFAULT 'TAX INVOICE',
  non_gst_reason TEXT,
  tax_rule_code TEXT NOT NULL DEFAULT 'ODISHA_ACCOMMODATION_5PCT',
  place_of_supply TEXT NOT NULL DEFAULT 'Odisha (21)',
  invoice_date TEXT NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  guest_name TEXT NOT NULL,
  company_name TEXT,
  billing_address TEXT NOT NULL,
  customer_state_name TEXT NOT NULL DEFAULT 'Odisha',
  customer_state_code TEXT NOT NULL DEFAULT '21',
  customer_gstin TEXT,
  customer_pan TEXT,
  customer_cin TEXT,
  customer_mobile TEXT,
  customer_email TEXT,
  booking_reference TEXT,
  check_in_at TEXT NOT NULL,
  check_out_at TEXT NOT NULL,
  show_stay_times BOOLEAN NOT NULL DEFAULT FALSE,
  suggested_nights INTEGER NOT NULL CHECK (suggested_nights >= 1),
  billable_nights INTEGER NOT NULL CHECK (billable_nights >= 1),
  billable_nights_override_reason TEXT,
  room_count INTEGER NOT NULL CHECK (room_count >= 1),
  room_numbers TEXT,
  occupancy_type TEXT NOT NULL DEFAULT 'Double' CHECK (occupancy_type IN ('Single', 'Double', 'Triple', 'Custom')),
  custom_occupancy_label TEXT,
  rate_per_room_paise BIGINT NOT NULL CHECK (rate_per_room_paise >= 0),
  stay_notes TEXT,
  pricing_mode TEXT NOT NULL DEFAULT 'TAX_EXCLUSIVE' CHECK (pricing_mode IN ('TAX_EXCLUSIVE', 'TAX_INCLUSIVE')),
  rounding_policy TEXT NOT NULL DEFAULT 'per_line' CHECK (rounding_policy IN ('per_line', 'per_invoice')),
  discount_paise BIGINT NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  discount_basis TEXT,
  subtotal_pre_discount_paise BIGINT NOT NULL DEFAULT 0,
  taxable_value_paise BIGINT NOT NULL DEFAULT 0,
  cgst_rate_bps INTEGER NOT NULL DEFAULT 250,
  sgst_rate_bps INTEGER NOT NULL DEFAULT 250,
  igst_rate_bps INTEGER NOT NULL DEFAULT 0,
  cgst_paise BIGINT NOT NULL DEFAULT 0,
  sgst_paise BIGINT NOT NULL DEFAULT 0,
  igst_paise BIGINT NOT NULL DEFAULT 0,
  total_tax_paise BIGINT NOT NULL DEFAULT 0,
  total_invoice_paise BIGINT NOT NULL DEFAULT 0,
  amount_received_paise BIGINT NOT NULL DEFAULT 0,
  balance_payable_paise BIGINT NOT NULL DEFAULT 0,
  credit_refund_due_paise BIGINT NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'Unpaid' CHECK (payment_status IN ('Unpaid', 'Partially Paid', 'Paid')),
  business_snapshot_json JSONB,
  tax_snapshot_json JSONB,
  logo_version_id UUID REFERENCES logo_versions(id) ON DELETE SET NULL,
  template_version TEXT NOT NULL DEFAULT 'v1.0-reference-a4',
  original_pdf_blob_key TEXT,
  latest_payment_summary_pdf_blob_key TEXT,
  finalised_at TIMESTAMPTZ,
  finalised_by UUID REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  cancellation_reason TEXT,
  replacement_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  duplicated_from_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_payment_status ON invoices(payment_status);
CREATE INDEX IF NOT EXISTS idx_invoices_doc_type ON invoices(document_type);
CREATE INDEX IF NOT EXISTS idx_invoices_created_by ON invoices(created_by);
CREATE INDEX IF NOT EXISTS idx_invoices_guest_company ON invoices(guest_name, company_name);
CREATE INDEX IF NOT EXISTS idx_invoices_mobile ON invoices(customer_mobile);

-- 12. Invoice Line Items
CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 1,
  service_type TEXT NOT NULL CHECK (service_type IN ('accommodation', 'extra_bed', 'early_check_in', 'late_checkout', 'food_beverage', 'laundry', 'transport', 'other')),
  description TEXT NOT NULL,
  hsn_sac TEXT NOT NULL DEFAULT '996311',
  quantity_label TEXT NOT NULL,
  quantity_multiplier NUMERIC(12, 4) NOT NULL DEFAULT 1,
  room_count INTEGER,
  nights_count INTEGER,
  entered_unit_rate_paise BIGINT NOT NULL CHECK (entered_unit_rate_paise >= 0),
  pricing_mode TEXT NOT NULL DEFAULT 'TAX_EXCLUSIVE' CHECK (pricing_mode IN ('TAX_EXCLUSIVE', 'TAX_INCLUSIVE')),
  pre_tax_unit_rate_paise BIGINT NOT NULL DEFAULT 0,
  line_subtotal_paise BIGINT NOT NULL DEFAULT 0,
  line_discount_paise BIGINT NOT NULL DEFAULT 0,
  taxable_value_paise BIGINT NOT NULL DEFAULT 0,
  tax_config_id UUID REFERENCES tax_configurations(id) ON DELETE SET NULL,
  tax_code TEXT NOT NULL DEFAULT 'ODISHA_ACCOMMODATION_5PCT',
  cgst_rate_bps INTEGER NOT NULL DEFAULT 250,
  sgst_rate_bps INTEGER NOT NULL DEFAULT 250,
  igst_rate_bps INTEGER NOT NULL DEFAULT 0,
  cgst_paise BIGINT NOT NULL DEFAULT 0,
  sgst_paise BIGINT NOT NULL DEFAULT 0,
  igst_paise BIGINT NOT NULL DEFAULT 0,
  line_total_paise BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id, sort_order);

-- 13. Payments Ledger
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  payment_date TEXT NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('Cash', 'UPI', 'Card', 'Bank Transfer', 'Other')),
  transaction_reference TEXT,
  notes TEXT,
  is_initial_at_finalisation BOOLEAN NOT NULL DEFAULT FALSE,
  idempotency_key TEXT UNIQUE,
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  recorded_by_name TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id, recorded_at ASC);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date DESC);

-- 14. Idempotency Records (prevents duplicate invoice creation, finalisation, and payments)
CREATE TABLE IF NOT EXISTS idempotency_records (
  idempotency_key TEXT PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  resource_id TEXT,
  response_status INTEGER NOT NULL,
  response_body_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_idempotency_created_at ON idempotency_records(created_at);

-- 15. Immutable Audit Events
CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT,
  actor_role TEXT,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT NOT NULL,
  metadata_json JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events(entity_type, entity_id);
