-- ============================================================================
-- LIVOTEL PREMIUM HOTEL - PRIVATE BILLING SYSTEM
-- Migration: 002_seed_defaults.sql
-- Seeds ONLY system configuration defaults (Business Settings, Tax Rules,
-- and Invoice Number Series). NEVER seeds sample customers or sample invoices.
-- ============================================================================

INSERT INTO business_settings (
  id,
  display_name,
  subtitle,
  supplier_legal_name,
  supplier_address,
  supplier_gstin,
  default_place_of_supply,
  default_state_code,
  property_name,
  default_nature_of_supply,
  default_sac,
  bank_account_name,
  bank_name,
  bank_account_type,
  bank_account_no,
  bank_ifsc,
  bank_branch,
  standard_check_in,
  standard_check_out,
  declaration_text,
  authorised_signatory,
  show_amount_in_words,
  non_gst_enabled,
  non_gst_default_title,
  non_gst_allowed_reasons,
  rounding_policy,
  staff_can_cancel_invoices
)
VALUES (
  1,
  'LIVOTEL PREMIUM HOTEL',
  'Owned & Operated by Laughing Buddha Homestay Bhubaneswar',
  'Laughing Buddha Homestay Bhubaneswar',
  E'Plot No. A/13, Trishna Enclave, Phase-1\nKIIT Road, Patia, Bhubaneswar – 751024\nOdisha, India',
  '21BREPR9585B1ZO',
  'Odisha (21)',
  '21',
  'Livotel Premium Hotel, Bhubaneswar',
  'Hotel Accommodation Services',
  '996311',
  'Laughing Buddha Homestay',
  'ICICI Bank',
  'Current Account',
  '242405000457',
  'ICIC0002424',
  'Jayadev Vihar',
  '12:00 PM',
  '11:00 AM',
  'We declare that this invoice shows the actual price of the services described and that all particulars are true and correct.',
  'Pradipta Kumar Ray',
  FALSE,
  FALSE,
  'BILL OF SUPPLY',
  '["Exempt Supply under GST Notification", "Non-GST Reimbursable Disbursement"]'::jsonb,
  'per_line',
  FALSE
)
ON CONFLICT (id) DO NOTHING;

-- Initial Business-Configured GST Rules (Admin-managed, with effective dates)
INSERT INTO tax_configurations (
  id, code, name, service_category, default_sac,
  place_of_supply_rule, tax_mode,
  cgst_rate_bps, sgst_rate_bps, igst_rate_bps, total_rate_bps,
  is_default, is_active, effective_from, notes
)
VALUES
  (
    '11111111-1111-4111-8111-111111111101',
    'ODISHA_ACCOMMODATION_5PCT',
    'Hotel Accommodation Services — 5% GST (CGST 2.5% + SGST 2.5%)',
    'accommodation',
    '996311',
    'LOC_OF_IMMOVABLE_PROPERTY_ODISHA_21',
    'cgst_sgst',
    250, 250, 0, 500,
    TRUE, TRUE, '2025-04-01',
    'Initial business-configured GST rate for hotel accommodation in Odisha (Place of Supply: location of immovable property under Section 12(3) IGST Act).'
  ),
  (
    '11111111-1111-4111-8111-111111111102',
    'ODISHA_EXTRA_BED_5PCT',
    'Extra Bed Charges — 5% GST (CGST 2.5% + SGST 2.5%)',
    'extra_bed',
    '996311',
    'LOC_OF_IMMOVABLE_PROPERTY_ODISHA_21',
    'cgst_sgst',
    250, 250, 0, 500,
    TRUE, TRUE, '2025-04-01',
    'Extra bed ancillary to hotel accommodation (SAC 996311).'
  ),
  (
    '11111111-1111-4111-8111-111111111103',
    'ODISHA_EARLY_CHECKIN_5PCT',
    'Early Check-in Charges — 5% GST (CGST 2.5% + SGST 2.5%)',
    'early_check_in',
    '996311',
    'LOC_OF_IMMOVABLE_PROPERTY_ODISHA_21',
    'cgst_sgst',
    250, 250, 0, 500,
    TRUE, TRUE, '2025-04-01',
    'Early check-in accommodation charge (SAC 996311).'
  ),
  (
    '11111111-1111-4111-8111-111111111104',
    'ODISHA_LATE_CHECKOUT_5PCT',
    'Late Checkout Charges — 5% GST (CGST 2.5% + SGST 2.5%)',
    'late_checkout',
    '996311',
    'LOC_OF_IMMOVABLE_PROPERTY_ODISHA_21',
    'cgst_sgst',
    250, 250, 0, 500,
    TRUE, TRUE, '2025-04-01',
    'Late checkout accommodation charge (SAC 996311).'
  ),
  (
    '11111111-1111-4111-8111-111111111105',
    'ODISHA_FOOD_BEVERAGE_5PCT',
    'Restaurant / Room Service Food & Beverage — 5% GST (CGST 2.5% + SGST 2.5%)',
    'food_beverage',
    '996331',
    'LOC_OF_IMMOVABLE_PROPERTY_ODISHA_21',
    'cgst_sgst',
    250, 250, 0, 500,
    TRUE, TRUE, '2025-04-01',
    'Food and beverage services (SAC 996331).'
  ),
  (
    '11111111-1111-4111-8111-111111111106',
    'ODISHA_OTHER_SERVICE_18PCT',
    'Other Hotel / Ancillary Services — 18% GST (CGST 9% + SGST 9%)',
    'other',
    '996311',
    'LOC_OF_IMMOVABLE_PROPERTY_ODISHA_21',
    'cgst_sgst',
    900, 900, 0, 1800,
    FALSE, TRUE, '2025-04-01',
    'Admin-configured 18% GST option for applicable non-accommodation services.'
  ),
  (
    '11111111-1111-4111-8111-111111111107',
    'ADMIN_INTERSTATE_IGST_5PCT',
    'Explicit Admin-Configured Inter-State IGST 5% Rule',
    'other',
    '996311',
    'EXPLICIT_INTERSTATE_IGST_RULE',
    'igst',
    0, 0, 500, 500,
    FALSE, FALSE, '2025-04-01',
    'Disabled by default. Enable only when an explicit inter-state IGST supply rule is required by Admin.'
  ),
  (
    '11111111-1111-4111-8111-111111111108',
    'NON_GST_EXEMPT_0PCT',
    'Non-GST / Exempt Document Treatment (0%)',
    'other',
    '996311',
    'NON_GST_EXEMPT',
    'exempt',
    0, 0, 0, 0,
    FALSE, TRUE, '2025-04-01',
    'Used only when document type is an admin-enabled Non-GST document with recorded reason.'
  )
ON CONFLICT (code) DO NOTHING;

-- Default GST-compliant Financial-Year Invoice Series: LPH/26-27/0001 (14 chars <= 16 chars GST limit)
INSERT INTO invoice_series (
  id, series_code, prefix, financial_year, separator, next_number, padding_digits, is_active
)
VALUES (
  '22222222-2222-4222-8222-222222222201',
  'FY_26_27_DEFAULT',
  'LPH',
  '26-27',
  '/',
  1,
  4,
  TRUE
)
ON CONFLICT (prefix, financial_year) DO NOTHING;
