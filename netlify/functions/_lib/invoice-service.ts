import crypto from 'node:crypto';
import { query, withTransaction, type DbClient, loadDefaultLogoDataUrl } from './db';
import { generatePrivateInvoiceBlobKey, getPrivateBlob, putPrivateBlob } from './blobs';
// pdf-server is dynamically imported inside getPdfRenderer to prevent top-level module load failures in serverless Lambda
async function getPdfRenderer() {
  const mod = await import('./pdf-server');
  return mod.renderInvoicePdfBuffer;
}
import {
  calculateInvoiceTotals,
  formatAccommodationDescription,
  formatAccommodationQuantityLabel,
} from '../../../shared/calculations';
import { calculateStayNights, getIndianFinancialYear, getKolkataTodayDate } from '../../../shared/dates';
import { validateGstin, validateGstInvoiceNumber, validatePan } from '../../../shared/gstin';
import type {
  BusinessSettings,
  CalculatedLineItem,
  Customer,
  DocumentType,
  InvoiceDraftPayload,
  InvoiceRecord,
  InvoiceSeries,
  PaymentInput,
  PaymentRecord,
  TaxConfiguration,
  User,
} from '../../../shared/types';

export class ValidationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ValidationError';
    this.status = status;
  }
}

export async function getBusinessSettings(db: DbClient = { query }): Promise<BusinessSettings> {
  const res = await db.query(
    `SELECT b.*, l.data_url AS logo_data_url
     FROM business_settings b
     LEFT JOIN logo_versions l ON l.id = b.active_logo_version_id
     WHERE b.id = 1
     LIMIT 1`
  );
  if (res.rows.length === 0) {
    throw new Error('Business settings row missing.');
  }
  const r = res.rows[0];
  const fallbackLogo = r.logo_data_url || loadDefaultLogoDataUrl().dataUrl;

  return {
    id: r.id,
    displayName: r.display_name,
    subtitle: r.subtitle,
    supplierLegalName: r.supplier_legal_name,
    supplierAddress: r.supplier_address,
    supplierGstin: r.supplier_gstin,
    defaultPlaceOfSupply: r.default_place_of_supply,
    defaultStateCode: r.default_state_code,
    propertyName: r.property_name,
    defaultNatureOfSupply: r.default_nature_of_supply,
    defaultSac: r.default_sac,
    bankAccountName: r.bank_account_name,
    bankName: r.bank_name,
    bankAccountType: r.bank_account_type,
    bankAccountNo: r.bank_account_no,
    bankIfsc: r.bank_ifsc,
    bankBranch: r.bank_branch,
    standardCheckIn: r.standard_check_in,
    standardCheckOut: r.standard_check_out,
    declarationText: r.declaration_text,
    authorisedSignatory: r.authorised_signatory,
    showAmountInWords: Boolean(r.show_amount_in_words),
    nonGstEnabled: Boolean(r.non_gst_enabled),
    nonGstDefaultTitle: r.non_gst_default_title,
    nonGstAllowedReasons: Array.isArray(r.non_gst_allowed_reasons)
      ? r.non_gst_allowed_reasons
      : JSON.parse(r.non_gst_allowed_reasons || '[]'),
    roundingPolicy: r.rounding_policy,
    staffCanCancelInvoices: Boolean(r.staff_can_cancel_invoices),
    activeLogoVersionId: r.active_logo_version_id,
    activeLogoDataUrl: fallbackLogo,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
  };
}

export async function getTaxConfigurations(db: DbClient = { query }): Promise<TaxConfiguration[]> {
  const res = await db.query(`SELECT * FROM tax_configurations ORDER BY is_default DESC, code ASC`);
  return res.rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    serviceCategory: r.service_category,
    defaultSac: r.default_sac,
    placeOfSupplyRule: r.place_of_supply_rule,
    taxMode: r.tax_mode,
    cgstRateBps: Number(r.cgst_rate_bps),
    sgstRateBps: Number(r.sgst_rate_bps),
    igstRateBps: Number(r.igst_rate_bps),
    totalRateBps: Number(r.total_rate_bps),
    isDefault: Boolean(r.is_default),
    isActive: Boolean(r.is_active),
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    notes: r.notes,
  }));
}

export async function getInvoiceSeriesList(db: DbClient = { query }): Promise<InvoiceSeries[]> {
  const res = await db.query(`SELECT * FROM invoice_series ORDER BY is_active DESC, financial_year DESC`);
  return res.rows.map((r) => ({
    id: r.id,
    seriesCode: r.series_code,
    prefix: r.prefix,
    financialYear: r.financial_year,
    separator: r.separator,
    nextNumber: Number(r.next_number),
    paddingDigits: Number(r.padding_digits),
    isActive: Boolean(r.is_active),
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
  }));
}

export function formatInvoiceNumberFromSeries(series: {
  prefix: string;
  financialYear: string;
  separator: string;
  paddingDigits: number;
  sequenceNumber: number;
}): string {
  const seqStr = String(series.sequenceNumber).padStart(series.paddingDigits, '0');
  const sep = series.separator || '/';
  const prefix = series.prefix.trim().toUpperCase();
  const fy = series.financialYear.trim();
  return fy ? `${prefix}${sep}${fy}${sep}${seqStr}` : `${prefix}${sep}${seqStr}`;
}

export async function mapInvoiceRowToRecord(row: any, db: DbClient = { query }): Promise<InvoiceRecord> {
  const itemsRes = await db.query(
    `SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order ASC`,
    [row.id]
  );
  const paymentsRes = await db.query(
    `SELECT * FROM payments WHERE invoice_id = $1 ORDER BY recorded_at ASC`,
    [row.id]
  );

  const items: CalculatedLineItem[] = itemsRes.rows.map((it) => ({
    id: it.id,
    sortOrder: Number(it.sort_order),
    serviceType: it.service_type,
    description: it.description,
    hsnSac: it.hsn_sac,
    quantityLabel: it.quantity_label,
    quantityMultiplier: Number(it.quantity_multiplier),
    roomCount: it.room_count !== null ? Number(it.room_count) : null,
    nightsCount: it.nights_count !== null ? Number(it.nights_count) : null,
    enteredUnitRatePaise: Number(it.entered_unit_rate_paise),
    pricingMode: it.pricing_mode,
    preTaxUnitRatePaise: Number(it.pre_tax_unit_rate_paise),
    lineSubtotalPaise: Number(it.line_subtotal_paise),
    lineDiscountPaise: Number(it.line_discount_paise),
    taxableValuePaise: Number(it.taxable_value_paise),
    taxConfigId: it.tax_config_id,
    taxCode: it.tax_code,
    cgstRateBps: Number(it.cgst_rate_bps),
    sgstRateBps: Number(it.sgst_rate_bps),
    igstRateBps: Number(it.igst_rate_bps),
    cgstPaise: Number(it.cgst_paise),
    sgstPaise: Number(it.sgst_paise),
    igstPaise: Number(it.igst_paise),
    lineTotalPaise: Number(it.line_total_paise),
  }));

  const payments: PaymentRecord[] = paymentsRes.rows.map((p) => ({
    id: p.id,
    invoiceId: p.invoice_id,
    amountPaise: Number(p.amount_paise),
    paymentDate: p.payment_date,
    paymentMethod: p.payment_method,
    transactionReference: p.transaction_reference,
    notes: p.notes,
    isInitialAtFinalisation: Boolean(p.is_initial_at_finalisation),
    recordedBy: p.recorded_by,
    recordedByName: p.recorded_by_name,
    recordedAt: new Date(p.recorded_at).toISOString(),
  }));

  let businessSnapshot: BusinessSettings;
  if (row.business_snapshot_json) {
    businessSnapshot =
      typeof row.business_snapshot_json === 'string'
        ? JSON.parse(row.business_snapshot_json)
        : row.business_snapshot_json;
  } else {
    businessSnapshot = await getBusinessSettings(db);
  }

  // Strip heavy base64 dataUrl from JSON API responses if needed, or keep a clean URL reference
  const taxSnapshot = row.tax_snapshot_json
    ? typeof row.tax_snapshot_json === 'string'
      ? JSON.parse(row.tax_snapshot_json)
      : row.tax_snapshot_json
    : {
        ruleCode: row.tax_rule_code,
        taxMode: row.igst_rate_bps > 0 ? 'igst' : row.document_type === 'NON_GST_DOCUMENT' ? 'exempt' : 'cgst_sgst',
        cgstRateBps: Number(row.cgst_rate_bps),
        sgstRateBps: Number(row.sgst_rate_bps),
        igstRateBps: Number(row.igst_rate_bps),
        roundingPolicy: row.rounding_policy,
      };

  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    seriesId: row.series_id,
    sequenceNumber: row.sequence_number !== null ? Number(row.sequence_number) : null,
    financialYear: row.financial_year,
    status: row.status,
    customerClassification: row.customer_classification,
    documentType: row.document_type,
    documentTitle: row.document_title,
    nonGstReason: row.non_gst_reason,
    taxRuleCode: row.tax_rule_code,
    placeOfSupply: row.place_of_supply,
    invoiceDate: row.invoice_date,
    customerId: row.customer_id,
    guestName: row.guest_name,
    companyName: row.company_name,
    billingAddress: row.billing_address,
    customerStateName: row.customer_state_name,
    customerStateCode: row.customer_state_code,
    customerGstin: row.customer_gstin,
    customerPan: row.customer_pan,
    customerCin: row.customer_cin,
    customerMobile: row.customer_mobile,
    customerEmail: row.customer_email,
    bookingReference: row.booking_reference,
    checkInAt: row.check_in_at,
    checkOutAt: row.check_out_at,
    showStayTimes: Boolean(row.show_stay_times),
    suggestedNights: Number(row.suggested_nights),
    billableNights: Number(row.billable_nights),
    billableNightsOverrideReason: row.billable_nights_override_reason,
    roomCount: Number(row.room_count),
    roomNumbers: row.room_numbers,
    occupancyType: row.occupancy_type,
    customOccupancyLabel: row.custom_occupancy_label,
    ratePerRoomPaise: Number(row.rate_per_room_paise),
    stayNotes: row.stay_notes,
    pricingMode: row.pricing_mode,
    roundingPolicy: row.rounding_policy,
    discountPaise: Number(row.discount_paise),
    discountBasis: row.discount_basis,
    subtotalPreDiscountPaise: Number(row.subtotal_pre_discount_paise),
    taxableValuePaise: Number(row.taxable_value_paise),
    cgstRateBps: Number(row.cgst_rate_bps),
    sgstRateBps: Number(row.sgst_rate_bps),
    igstRateBps: Number(row.igst_rate_bps),
    cgstPaise: Number(row.cgst_paise),
    sgstPaise: Number(row.sgst_paise),
    igstPaise: Number(row.igst_paise),
    totalTaxPaise: Number(row.total_tax_paise),
    totalInvoicePaise: Number(row.total_invoice_paise),
    amountReceivedPaise: Number(row.amount_received_paise),
    balancePayablePaise: Number(row.balance_payable_paise),
    creditRefundDuePaise: Number(row.credit_refund_due_paise),
    paymentStatus: row.payment_status,
    businessSnapshot,
    taxSnapshot,
    logoVersionId: row.logo_version_id,
    templateVersion: row.template_version,
    originalPdfBlobKey: row.original_pdf_blob_key,
    latestPaymentSummaryPdfBlobKey: row.latest_payment_summary_pdf_blob_key,
    finalisedAt: row.finalised_at ? new Date(row.finalised_at).toISOString() : null,
    finalisedBy: row.finalised_by,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
    cancelledBy: row.cancelled_by,
    cancellationReason: row.cancellation_reason,
    duplicatedFromInvoiceId: row.duplicated_from_invoice_id,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    items,
    payments,
  };
}

/**
 * Validates and normalizes an invoice payload on the server.
 * When `mode === 'FINALISE'`, enforces all strict GSTIN, night-override, and non-GST rules.
 */
export function validateAndPrepareInvoicePayload(
  payload: InvoiceDraftPayload,
  businessSettings: BusinessSettings,
  taxConfigs: TaxConfiguration[],
  mode: 'DRAFT' | 'FINALISE'
) {
  const guestName = (payload.guestName ?? '').trim();
  const companyName = (payload.companyName ?? '').trim() || null;
  const billingAddress = (payload.billingAddress ?? '').trim();

  if (!guestName && !companyName) {
    throw new ValidationError('Guest or company billing name is required.');
  }
  if (mode === 'FINALISE' && !guestName) {
    throw new ValidationError('Guest / Contact Name is required to finalise an invoice.');
  }
  if (mode === 'FINALISE' && !billingAddress) {
    throw new ValidationError('Billing Address is required to finalise an invoice.');
  }

  const classification = payload.customerClassification === 'B2B' ? 'B2B' : 'B2C';
  const documentType = payload.documentType === 'NON_GST_DOCUMENT' ? 'NON_GST_DOCUMENT' : 'GST_TAX_INVOICE';

  if (documentType === 'NON_GST_DOCUMENT') {
    if (!businessSettings.nonGstEnabled) {
      throw new ValidationError(
        'Non-GST documents are currently disabled by the Administrator. Ordinary B2C or B2B accommodation must use a GST Tax Invoice.'
      );
    }
    const reason = (payload.nonGstReason ?? '').trim();
    if (!reason) {
      throw new ValidationError('A valid configured reason is required when issuing a Non-GST document.');
    }
  }

  // Validate GSTIN
  const rawGstin = (payload.customerGstin ?? '').trim().toUpperCase().replace(/\s+/g, '');
  let normalizedGstin: string | null = null;
  if (classification === 'B2B' && documentType === 'GST_TAX_INVOICE') {
    if (mode === 'FINALISE' && !rawGstin) {
      throw new ValidationError('A valid 15-character Customer GSTIN is required when finalising a B2B GST Tax Invoice.');
    }
    if (rawGstin) {
      const gstCheck = validateGstin(rawGstin);
      if (!gstCheck.isValid) {
        throw new ValidationError(gstCheck.error || 'Invalid Customer GSTIN.');
      }
      normalizedGstin = gstCheck.normalized;
    }
  } else if (rawGstin) {
    const gstCheck = validateGstin(rawGstin);
    if (!gstCheck.isValid && mode === 'FINALISE') {
      throw new ValidationError(gstCheck.error || 'Invalid Customer GSTIN.');
    }
    normalizedGstin = gstCheck.normalized;
  }

  // Validate optional PAN
  const panCheck = validatePan(payload.customerPan);
  if (!panCheck.isValid && mode === 'FINALISE') {
    throw new ValidationError(panCheck.error || 'Invalid PAN format.');
  }

  // Validate Stay Dates & Suggested vs Billable Nights
  const stayCheck = calculateStayNights(payload.checkInAt, payload.checkOutAt);
  if (!stayCheck.isValid) {
    throw new ValidationError(stayCheck.error || 'Invalid check-in or check-out dates.');
  }

  const suggestedNights = stayCheck.suggestedNights;
  const billableNights = Math.max(1, Math.round(Number(payload.billableNights || suggestedNights)));
  const overrideReason = (payload.billableNightsOverrideReason ?? '').trim() || null;

  if (billableNights !== suggestedNights && !overrideReason) {
    throw new ValidationError(
      `Billable nights (${billableNights}) differ from calendar-date suggested nights (${suggestedNights}). Please provide an explanation for overriding billable nights.`
    );
  }

  const roomCount = Math.max(1, Math.round(Number(payload.roomCount || 1)));
  const ratePerRoomPaise = Math.max(0, Math.round(Number(payload.ratePerRoomPaise || 0)));

  // Discount validation
  const discountPaise = Math.max(0, Math.round(Number(payload.discountPaise || 0)));
  const discountBasis = (payload.discountBasis ?? '').trim() || null;
  if (discountPaise > 0 && !discountBasis) {
    throw new ValidationError('A clear discount basis/reason must be recorded when applying a pre-tax discount.');
  }

  // Verify tax rule selection:
  // By default, Odisha accommodation uses LOC_OF_IMMOVABLE_PROPERTY_ODISHA_21 (CGST + SGST).
  // Switching to IGST is only permitted if an explicit admin-enabled rule is selected.
  let requestedRuleCode = payload.taxRuleCode || 'ODISHA_ACCOMMODATION_5PCT';
  if (documentType === 'NON_GST_DOCUMENT') {
    requestedRuleCode = 'NON_GST_EXEMPT_0PCT';
  } else if (requestedRuleCode === 'ADMIN_INTERSTATE_IGST_5PCT') {
    const igstRule = taxConfigs.find((t) => t.code === 'ADMIN_INTERSTATE_IGST_5PCT');
    if (!igstRule || !igstRule.isActive) {
      throw new ValidationError(
        'Inter-state IGST tax rule is not enabled by the Administrator. Hotel accommodation services in Odisha default to Odisha (21) Place of Supply with CGST + SGST.'
      );
    }
  } else {
    requestedRuleCode = 'ODISHA_ACCOMMODATION_5PCT';
  }

  // Ensure line items exist
  const rawItems =
    Array.isArray(payload.items) && payload.items.length > 0
      ? payload.items
      : [
          {
            serviceType: 'accommodation' as const,
            description: formatAccommodationDescription(
              payload.occupancyType || 'Double',
              payload.customOccupancyLabel,
              payload.roomNumbers
            ),
            hsnSac: businessSettings.defaultSac || '996311',
            quantityLabel: formatAccommodationQuantityLabel(roomCount, billableNights),
            quantityMultiplier: roomCount * billableNights,
            roomCount,
            nightsCount: billableNights,
            enteredUnitRatePaise: ratePerRoomPaise,
            pricingMode: payload.pricingMode || 'TAX_EXCLUSIVE',
            taxCode: requestedRuleCode,
          },
        ];

  const normalizedItems = rawItems.map((it) => {
    if (it.serviceType === 'accommodation') {
      const rCount = it.roomCount ? Math.max(1, Math.round(Number(it.roomCount))) : roomCount;
      const nCount = it.nightsCount ? Math.max(1, Math.round(Number(it.nightsCount))) : billableNights;
      return {
        ...it,
        description:
          it.description?.trim() ||
          formatAccommodationDescription(
            payload.occupancyType || 'Double',
            payload.customOccupancyLabel,
            payload.roomNumbers
          ),
        hsnSac: it.hsnSac?.trim() || businessSettings.defaultSac || '996311',
        roomCount: rCount,
        nightsCount: nCount,
        quantityMultiplier: rCount * nCount,
        quantityLabel: formatAccommodationQuantityLabel(rCount, nCount),
        enteredUnitRatePaise: Math.max(0, Math.round(Number(it.enteredUnitRatePaise ?? ratePerRoomPaise))),
        pricingMode: it.pricingMode || payload.pricingMode || 'TAX_EXCLUSIVE',
      };
    }
    const mult = Math.max(0.01, Number(it.quantityMultiplier || 1));
    return {
      ...it,
      description: it.description?.trim() || 'Additional Hotel Service',
      hsnSac: it.hsnSac?.trim() || businessSettings.defaultSac || '996311',
      roomCount: null,
      nightsCount: null,
      quantityMultiplier: mult,
      quantityLabel: it.quantityLabel?.trim() || `${mult}`,
      enteredUnitRatePaise: Math.max(0, Math.round(Number(it.enteredUnitRatePaise || 0))),
      pricingMode: it.pricingMode || payload.pricingMode || 'TAX_EXCLUSIVE',
    };
  });

  if (mode === 'FINALISE') {
    const hasZeroAll = normalizedItems.every((i) => i.enteredUnitRatePaise <= 0);
    if (hasZeroAll) {
      throw new ValidationError('At least one line item must have a positive rate before finalising the invoice.');
    }
  }

  return {
    classification,
    documentType,
    documentTitle:
      documentType === 'NON_GST_DOCUMENT'
        ? businessSettings.nonGstDefaultTitle || 'BILL OF SUPPLY'
        : 'TAX INVOICE',
    nonGstReason: documentType === 'NON_GST_DOCUMENT' ? (payload.nonGstReason ?? '').trim() : null,
    taxRuleCode: requestedRuleCode,
    placeOfSupply: businessSettings.defaultPlaceOfSupply || 'Odisha (21)',
    invoiceDate: payload.invoiceDate?.trim() || getKolkataTodayDate(),
    guestName: guestName || companyName || 'Guest',
    companyName,
    billingAddress,
    customerStateName: (payload.customerStateName ?? 'Odisha').trim() || 'Odisha',
    customerStateCode: (payload.customerStateCode ?? '21').trim() || '21',
    customerGstin: normalizedGstin,
    customerPan: panCheck.normalized || null,
    customerCin: (payload.customerCin ?? '').trim().toUpperCase() || null,
    customerMobile: (payload.customerMobile ?? '').trim() || null,
    customerEmail: (payload.customerEmail ?? '').trim() || null,
    bookingReference: (payload.bookingReference ?? '').trim() || null,
    checkInAt: payload.checkInAt,
    checkOutAt: payload.checkOutAt,
    showStayTimes: Boolean(payload.showStayTimes),
    suggestedNights,
    billableNights,
    billableNightsOverrideReason: overrideReason,
    roomCount,
    roomNumbers: (payload.roomNumbers ?? '').trim() || null,
    occupancyType: payload.occupancyType || 'Double',
    customOccupancyLabel: (payload.customOccupancyLabel ?? '').trim() || null,
    ratePerRoomPaise,
    stayNotes: (payload.stayNotes ?? '').trim() || null,
    pricingMode: payload.pricingMode || 'TAX_EXCLUSIVE',
    discountPaise,
    discountBasis,
    normalizedItems,
  };
}

/**
 * Saves or updates a Draft invoice without allocating an invoice number.
 */
export async function saveInvoiceDraft(
  payload: InvoiceDraftPayload,
  actor: User
): Promise<InvoiceRecord> {
  return withTransaction(async (tx) => {
    if (payload.idempotencyKey) {
      const idem = await tx.query<{ resource_id: string }>(
        `SELECT resource_id FROM idempotency_records WHERE idempotency_key = $1 LIMIT 1`,
        [payload.idempotencyKey]
      );
      if (idem.rows[0]?.resource_id) {
        const existingRow = await tx.query(`SELECT * FROM invoices WHERE id = $1 LIMIT 1`, [
          idem.rows[0].resource_id,
        ]);
        if (existingRow.rows[0]) {
          return mapInvoiceRowToRecord(existingRow.rows[0], tx);
        }
      }
    }

    const businessSettings = await getBusinessSettings(tx);
    const taxConfigs = await getTaxConfigurations(tx);
    const prepared = validateAndPrepareInvoicePayload(payload, businessSettings, taxConfigs, 'DRAFT');

    let invoiceId = payload.id || crypto.randomUUID();
    let existingPaymentsPaise = 0;

    if (payload.id) {
      const existing = await tx.query(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [payload.id]);
      if (existing.rows.length > 0) {
        if (existing.rows[0].status !== 'Draft') {
          throw new ValidationError(
            `Invoice ${existing.rows[0].invoice_number || payload.id} is already ${existing.rows[0].status} and cannot be edited as a draft.`
          );
        }
        const payRes = await tx.query<{ total: string }>(
          `SELECT COALESCE(SUM(amount_paise), 0) AS total FROM payments WHERE invoice_id = $1`,
          [payload.id]
        );
        existingPaymentsPaise = Number(payRes.rows[0]?.total || 0);
      }
    }

    const initialPayments = Array.isArray(payload.initialPayments)
      ? payload.initialPayments.filter((p) => Number(p.amountPaise) > 0)
      : [];
    const initialPaymentsSum = initialPayments.reduce((s, p) => s + Math.round(Number(p.amountPaise)), 0);
    const totalReceivedPaise = payload.id && initialPayments.length === 0 ? existingPaymentsPaise : initialPaymentsSum;

    const calc = calculateInvoiceTotals({
      documentType: prepared.documentType as DocumentType,
      pricingMode: prepared.pricingMode,
      roundingPolicy: businessSettings.roundingPolicy,
      discountPaise: prepared.discountPaise,
      items: prepared.normalizedItems,
      taxConfigs,
      defaultTaxRuleCode: prepared.taxRuleCode,
      amountReceivedPaise: totalReceivedPaise,
    });

    const taxSnapshot = {
      ruleCode: prepared.taxRuleCode,
      taxMode: calc.igstRateBps > 0 ? 'igst' : prepared.documentType === 'NON_GST_DOCUMENT' ? 'exempt' : 'cgst_sgst',
      cgstRateBps: calc.cgstRateBps,
      sgstRateBps: calc.sgstRateBps,
      igstRateBps: calc.igstRateBps,
      roundingPolicy: businessSettings.roundingPolicy,
    };

    const existingCheck = await tx.query(`SELECT id FROM invoices WHERE id = $1`, [invoiceId]);
    if (existingCheck.rows.length === 0) {
      await tx.query(
        `INSERT INTO invoices (
          id, status, customer_classification, document_type, document_title, non_gst_reason,
          tax_rule_code, place_of_supply, invoice_date, customer_id,
          guest_name, company_name, billing_address, customer_state_name, customer_state_code,
          customer_gstin, customer_pan, customer_cin, customer_mobile, customer_email, booking_reference,
          check_in_at, check_out_at, show_stay_times, suggested_nights, billable_nights, billable_nights_override_reason,
          room_count, room_numbers, occupancy_type, custom_occupancy_label, rate_per_room_paise, stay_notes,
          pricing_mode, rounding_policy, discount_paise, discount_basis, subtotal_pre_discount_paise,
          taxable_value_paise, cgst_rate_bps, sgst_rate_bps, igst_rate_bps,
          cgst_paise, sgst_paise, igst_paise, total_tax_paise, total_invoice_paise,
          amount_received_paise, balance_payable_paise, credit_refund_due_paise, payment_status,
          business_snapshot_json, tax_snapshot_json, logo_version_id, created_by, created_by_name
        ) VALUES (
          $1, 'Draft', $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25, $26,
          $27, $28, $29, $30, $31, $32,
          $33, $34, $35, $36, $37,
          $38, $39, $40, $41,
          $42, $43, $44, $45, $46,
          $47, $48, $49, $50,
          $51::jsonb, $52::jsonb, $53, $54, $55
        )`,
        [
          invoiceId,
          prepared.classification,
          prepared.documentType,
          prepared.documentTitle,
          prepared.nonGstReason,
          prepared.taxRuleCode,
          prepared.placeOfSupply,
          prepared.invoiceDate,
          payload.customerId || null,
          prepared.guestName,
          prepared.companyName,
          prepared.billingAddress,
          prepared.customerStateName,
          prepared.customerStateCode,
          prepared.customerGstin,
          prepared.customerPan,
          prepared.customerCin,
          prepared.customerMobile,
          prepared.customerEmail,
          prepared.bookingReference,
          prepared.checkInAt,
          prepared.checkOutAt,
          prepared.showStayTimes,
          prepared.suggestedNights,
          prepared.billableNights,
          prepared.billableNightsOverrideReason,
          prepared.roomCount,
          prepared.roomNumbers,
          prepared.occupancyType,
          prepared.customOccupancyLabel,
          prepared.ratePerRoomPaise,
          prepared.stayNotes,
          prepared.pricingMode,
          businessSettings.roundingPolicy,
          calc.discountPaise,
          prepared.discountBasis,
          calc.subtotalPreDiscountPaise,
          calc.taxableValuePaise,
          calc.cgstRateBps,
          calc.sgstRateBps,
          calc.igstRateBps,
          calc.cgstPaise,
          calc.sgstPaise,
          calc.igstPaise,
          calc.totalTaxPaise,
          calc.totalInvoicePaise,
          calc.amountReceivedPaise,
          calc.balancePayablePaise,
          calc.creditRefundDuePaise,
          calc.paymentStatus,
          JSON.stringify({ ...businessSettings, activeLogoDataUrl: undefined }),
          JSON.stringify(taxSnapshot),
          businessSettings.activeLogoVersionId,
          actor.id,
          actor.fullName,
        ]
      );
    } else {
      await tx.query(
        `UPDATE invoices SET
          customer_classification = $2, document_type = $3, document_title = $4, non_gst_reason = $5,
          tax_rule_code = $6, place_of_supply = $7, invoice_date = $8, customer_id = $9,
          guest_name = $10, company_name = $11, billing_address = $12, customer_state_name = $13, customer_state_code = $14,
          customer_gstin = $15, customer_pan = $16, customer_cin = $17, customer_mobile = $18, customer_email = $19, booking_reference = $20,
          check_in_at = $21, check_out_at = $22, show_stay_times = $23, suggested_nights = $24, billable_nights = $25, billable_nights_override_reason = $26,
          room_count = $27, room_numbers = $28, occupancy_type = $29, custom_occupancy_label = $30, rate_per_room_paise = $31, stay_notes = $32,
          pricing_mode = $33, rounding_policy = $34, discount_paise = $35, discount_basis = $36, subtotal_pre_discount_paise = $37,
          taxable_value_paise = $38, cgst_rate_bps = $39, sgst_rate_bps = $40, igst_rate_bps = $41,
          cgst_paise = $42, sgst_paise = $43, igst_paise = $44, total_tax_paise = $45, total_invoice_paise = $46,
          amount_received_paise = $47, balance_payable_paise = $48, credit_refund_due_paise = $49, payment_status = $50,
          business_snapshot_json = $51::jsonb, tax_snapshot_json = $52::jsonb, logo_version_id = $53, updated_at = NOW()
        WHERE id = $1`,
        [
          invoiceId,
          prepared.classification,
          prepared.documentType,
          prepared.documentTitle,
          prepared.nonGstReason,
          prepared.taxRuleCode,
          prepared.placeOfSupply,
          prepared.invoiceDate,
          payload.customerId || null,
          prepared.guestName,
          prepared.companyName,
          prepared.billingAddress,
          prepared.customerStateName,
          prepared.customerStateCode,
          prepared.customerGstin,
          prepared.customerPan,
          prepared.customerCin,
          prepared.customerMobile,
          prepared.customerEmail,
          prepared.bookingReference,
          prepared.checkInAt,
          prepared.checkOutAt,
          prepared.showStayTimes,
          prepared.suggestedNights,
          prepared.billableNights,
          prepared.billableNightsOverrideReason,
          prepared.roomCount,
          prepared.roomNumbers,
          prepared.occupancyType,
          prepared.customOccupancyLabel,
          prepared.ratePerRoomPaise,
          prepared.stayNotes,
          prepared.pricingMode,
          businessSettings.roundingPolicy,
          calc.discountPaise,
          prepared.discountBasis,
          calc.subtotalPreDiscountPaise,
          calc.taxableValuePaise,
          calc.cgstRateBps,
          calc.sgstRateBps,
          calc.igstRateBps,
          calc.cgstPaise,
          calc.sgstPaise,
          calc.igstPaise,
          calc.totalTaxPaise,
          calc.totalInvoicePaise,
          calc.amountReceivedPaise,
          calc.balancePayablePaise,
          calc.creditRefundDuePaise,
          calc.paymentStatus,
          JSON.stringify({ ...businessSettings, activeLogoDataUrl: undefined }),
          JSON.stringify(taxSnapshot),
          businessSettings.activeLogoVersionId,
        ]
      );
      await tx.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [invoiceId]);
    }

    for (const item of calc.items) {
      await tx.query(
        `INSERT INTO invoice_items (
          id, invoice_id, sort_order, service_type, description, hsn_sac,
          quantity_label, quantity_multiplier, room_count, nights_count,
          entered_unit_rate_paise, pricing_mode, pre_tax_unit_rate_paise,
          line_subtotal_paise, line_discount_paise, taxable_value_paise,
          tax_config_id, tax_code, cgst_rate_bps, sgst_rate_bps, igst_rate_bps,
          cgst_paise, sgst_paise, igst_paise, line_total_paise
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10,
          $11, $12, $13,
          $14, $15, $16,
          $17, $18, $19, $20, $21,
          $22, $23, $24, $25
        )`,
        [
          crypto.randomUUID(),
          invoiceId,
          item.sortOrder,
          item.serviceType,
          item.description,
          item.hsnSac,
          item.quantityLabel,
          item.quantityMultiplier,
          item.roomCount,
          item.nightsCount,
          item.enteredUnitRatePaise,
          item.pricingMode,
          item.preTaxUnitRatePaise,
          item.lineSubtotalPaise,
          item.lineDiscountPaise,
          item.taxableValuePaise,
          item.taxConfigId,
          item.taxCode,
          item.cgstRateBps,
          item.sgstRateBps,
          item.igstRateBps,
          item.cgstPaise,
          item.sgstPaise,
          item.igstPaise,
          item.lineTotalPaise,
        ]
      );
    }

    if (Array.isArray(payload.initialPayments)) {
      await tx.query(`DELETE FROM payments WHERE invoice_id = $1`, [invoiceId]);
      for (const pay of initialPayments) {
        await tx.query(
          `INSERT INTO payments (
            id, invoice_id, amount_paise, payment_date, payment_method, transaction_reference,
            notes, is_initial_at_finalisation, recorded_by, recorded_by_name
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8, $9)`,
          [
            crypto.randomUUID(),
            invoiceId,
            Math.round(Number(pay.amountPaise)),
            pay.paymentDate || prepared.invoiceDate,
            pay.paymentMethod || 'Cash',
            pay.transactionReference?.trim() || null,
            pay.notes?.trim() || null,
            actor.id,
            actor.fullName,
          ]
        );
      }
    }

    if (payload.idempotencyKey) {
      await tx.query(
        `INSERT INTO idempotency_records (idempotency_key, user_id, operation, resource_id, response_status, response_body_json)
         VALUES ($1, $2, 'SAVE_DRAFT', $3, 200, '{}'::jsonb)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [payload.idempotencyKey, actor.id, invoiceId]
      );
    }

    const saved = await tx.query(`SELECT * FROM invoices WHERE id = $1 LIMIT 1`, [invoiceId]);
    return mapInvoiceRowToRecord(saved.rows[0], tx);
  });
}

/**
 * Atomically finalises an invoice in PostgreSQL:
 * 1. Checks idempotency / existing Finalised status (never double-allocates numbers on retry).
 * 2. Validates customer, GSTIN, stay dates, and override explanations.
 * 3. Loads approved business settings & tax configurations.
 * 4. Recalculates all line items and totals in integer paise.
 * 5. Locks the active invoice_series row (`FOR UPDATE`), allocates the next number, and validates GST compliance.
 * 6. Saves immutable business, tax, and logo version snapshots.
 * 7. Records an audit event.
 * 8. Generates and privately stores the original A4 PDF in Netlify Blobs.
 */
export async function finaliseInvoiceAtomically(
  payload: InvoiceDraftPayload,
  actor: User,
  ipAddress?: string | null
): Promise<InvoiceRecord> {
  const finalisedRecord = await withTransaction(async (tx) => {
    // 1. Check idempotency key first
    if (payload.idempotencyKey) {
      const idem = await tx.query<{ resource_id: string }>(
        `SELECT resource_id FROM idempotency_records WHERE idempotency_key = $1 LIMIT 1`,
        [payload.idempotencyKey]
      );
      if (idem.rows[0]?.resource_id) {
        const existingRow = await tx.query(`SELECT * FROM invoices WHERE id = $1 LIMIT 1`, [
          idem.rows[0].resource_id,
        ]);
        if (existingRow.rows[0] && existingRow.rows[0].status === 'Finalised') {
          return mapInvoiceRowToRecord(existingRow.rows[0], tx);
        }
      }
    }

    // Check if an existing invoice ID is already finalised (idempotent retry protection)
    if (payload.id) {
      const existing = await tx.query(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [payload.id]);
      if (existing.rows.length > 0) {
        if (existing.rows[0].status === 'Finalised') {
          return mapInvoiceRowToRecord(existing.rows[0], tx);
        }
        if (existing.rows[0].status === 'Cancelled') {
          throw new ValidationError('Cancelled invoices cannot be finalised.');
        }
      }
    }

    // 2. Load approved business and tax settings
    const businessSettings = await getBusinessSettings(tx);
    const taxConfigs = await getTaxConfigurations(tx);

    // 3. Validate customer & stay fields strictly
    const prepared = validateAndPrepareInvoicePayload(payload, businessSettings, taxConfigs, 'FINALISE');

    const invoiceId = payload.id || crypto.randomUUID();

    // Optionally save/update customer in directory if requested
    let customerId = payload.customerId || null;
    if (payload.saveToCustomerDirectory && !customerId) {
      customerId = crypto.randomUUID();
      await tx.query(
        `INSERT INTO customers (
          id, classification, guest_name, company_name, billing_address,
          state_name, state_code, gstin, pan, cin, mobile, email, default_booking_ref, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          customerId,
          prepared.classification,
          prepared.guestName,
          prepared.companyName,
          prepared.billingAddress,
          prepared.customerStateName,
          prepared.customerStateCode,
          prepared.customerGstin,
          prepared.customerPan,
          prepared.customerCin,
          prepared.customerMobile,
          prepared.customerEmail,
          prepared.bookingReference,
          actor.id,
        ]
      );
    }

    // Resolve payments
    let existingPayments: PaymentInput[] = [];
    if (payload.initialPayments && Array.isArray(payload.initialPayments)) {
      existingPayments = payload.initialPayments.filter((p) => Number(p.amountPaise) > 0);
    } else if (payload.id) {
      const dbPays = await tx.query(`SELECT * FROM payments WHERE invoice_id = $1`, [payload.id]);
      existingPayments = dbPays.rows.map((p) => ({
        amountPaise: Number(p.amount_paise),
        paymentDate: p.payment_date,
        paymentMethod: p.payment_method,
        transactionReference: p.transaction_reference,
        notes: p.notes,
      }));
    }

    const amountReceivedPaise = existingPayments.reduce(
      (sum, p) => sum + Math.max(0, Math.round(Number(p.amountPaise))),
      0
    );

    // 4. Recalculate totals on server
    const calc = calculateInvoiceTotals({
      documentType: prepared.documentType as DocumentType,
      pricingMode: prepared.pricingMode,
      roundingPolicy: businessSettings.roundingPolicy,
      discountPaise: prepared.discountPaise,
      items: prepared.normalizedItems,
      taxConfigs,
      defaultTaxRuleCode: prepared.taxRuleCode,
      amountReceivedPaise,
    });

    // 5. Allocate unique invoice number atomically in PostgreSQL (`FOR UPDATE`)
    const seriesRes = await tx.query(
      `SELECT * FROM invoice_series WHERE is_active = TRUE ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`
    );

    let seriesRow = seriesRes.rows[0];
    if (!seriesRow) {
      const fy = getIndianFinancialYear(prepared.invoiceDate);
      const newSeriesId = crypto.randomUUID();
      await tx.query(
        `INSERT INTO invoice_series (id, series_code, prefix, financial_year, separator, next_number, padding_digits, is_active)
         VALUES ($1, $2, 'LPH', $3, '/', 1, 4, TRUE)`,
        [newSeriesId, `FY_${fy}`, fy]
      );
      const refetch = await tx.query(`SELECT * FROM invoice_series WHERE id = $1 FOR UPDATE`, [newSeriesId]);
      seriesRow = refetch.rows[0];
    }

    const allocatedSeq = Number(seriesRow.next_number);
    const allocatedInvoiceNumber = formatInvoiceNumberFromSeries({
      prefix: seriesRow.prefix,
      financialYear: seriesRow.financial_year,
      separator: seriesRow.separator,
      paddingDigits: Number(seriesRow.padding_digits),
      sequenceNumber: allocatedSeq,
    });

    const numValidation = validateGstInvoiceNumber(allocatedInvoiceNumber);
    if (!numValidation.isValid) {
      throw new ValidationError(numValidation.error || 'Configured invoice number format is invalid.');
    }

    await tx.query(
      `UPDATE invoice_series SET next_number = next_number + 1, updated_at = NOW() WHERE id = $1`,
      [seriesRow.id]
    );

    // 6. Save immutable business, tax, and logo version snapshots
    const businessSnapshotForDb: BusinessSettings = {
      ...businessSettings,
      activeLogoDataUrl: undefined,
    };

    const taxSnapshot = {
      ruleCode: prepared.taxRuleCode,
      taxMode: calc.igstRateBps > 0 ? 'igst' : prepared.documentType === 'NON_GST_DOCUMENT' ? 'exempt' : 'cgst_sgst',
      cgstRateBps: calc.cgstRateBps,
      sgstRateBps: calc.sgstRateBps,
      igstRateBps: calc.igstRateBps,
      roundingPolicy: businessSettings.roundingPolicy,
    };

    const existingInv = await tx.query(`SELECT id FROM invoices WHERE id = $1`, [invoiceId]);
    if (existingInv.rows.length === 0) {
      await tx.query(
        `INSERT INTO invoices (
          id, invoice_number, series_id, sequence_number, financial_year, status,
          customer_classification, document_type, document_title, non_gst_reason,
          tax_rule_code, place_of_supply, invoice_date, customer_id,
          guest_name, company_name, billing_address, customer_state_name, customer_state_code,
          customer_gstin, customer_pan, customer_cin, customer_mobile, customer_email, booking_reference,
          check_in_at, check_out_at, show_stay_times, suggested_nights, billable_nights, billable_nights_override_reason,
          room_count, room_numbers, occupancy_type, custom_occupancy_label, rate_per_room_paise, stay_notes,
          pricing_mode, rounding_policy, discount_paise, discount_basis, subtotal_pre_discount_paise,
          taxable_value_paise, cgst_rate_bps, sgst_rate_bps, igst_rate_bps,
          cgst_paise, sgst_paise, igst_paise, total_tax_paise, total_invoice_paise,
          amount_received_paise, balance_payable_paise, credit_refund_due_paise, payment_status,
          business_snapshot_json, tax_snapshot_json, logo_version_id,
          finalised_at, finalised_by, created_by, created_by_name
        ) VALUES (
          $1, $2, $3, $4, $5, 'Finalised',
          $6, $7, $8, $9,
          $10, $11, $12, $13,
          $14, $15, $16, $17, $18,
          $19, $20, $21, $22, $23, $24,
          $25, $26, $27, $28, $29, $30,
          $31, $32, $33, $34, $35, $36,
          $37, $38, $39, $40, $41,
          $42, $43, $44, $45,
          $46, $47, $48, $49, $50,
          $51, $52, $53, $54,
          $55::jsonb, $56::jsonb, $57,
          NOW(), $58, $58, $59
        )`,
        [
          invoiceId,
          allocatedInvoiceNumber,
          seriesRow.id,
          allocatedSeq,
          seriesRow.financial_year,
          prepared.classification,
          prepared.documentType,
          prepared.documentTitle,
          prepared.nonGstReason,
          prepared.taxRuleCode,
          prepared.placeOfSupply,
          prepared.invoiceDate,
          customerId,
          prepared.guestName,
          prepared.companyName,
          prepared.billingAddress,
          prepared.customerStateName,
          prepared.customerStateCode,
          prepared.customerGstin,
          prepared.customerPan,
          prepared.customerCin,
          prepared.customerMobile,
          prepared.customerEmail,
          prepared.bookingReference,
          prepared.checkInAt,
          prepared.checkOutAt,
          prepared.showStayTimes,
          prepared.suggestedNights,
          prepared.billableNights,
          prepared.billableNightsOverrideReason,
          prepared.roomCount,
          prepared.roomNumbers,
          prepared.occupancyType,
          prepared.customOccupancyLabel,
          prepared.ratePerRoomPaise,
          prepared.stayNotes,
          prepared.pricingMode,
          businessSettings.roundingPolicy,
          calc.discountPaise,
          prepared.discountBasis,
          calc.subtotalPreDiscountPaise,
          calc.taxableValuePaise,
          calc.cgstRateBps,
          calc.sgstRateBps,
          calc.igstRateBps,
          calc.cgstPaise,
          calc.sgstPaise,
          calc.igstPaise,
          calc.totalTaxPaise,
          calc.totalInvoicePaise,
          calc.amountReceivedPaise,
          calc.balancePayablePaise,
          calc.creditRefundDuePaise,
          calc.paymentStatus,
          JSON.stringify(businessSnapshotForDb),
          JSON.stringify(taxSnapshot),
          businessSettings.activeLogoVersionId,
          actor.id,
          actor.fullName,
        ]
      );
    } else {
      await tx.query(
        `UPDATE invoices SET
          invoice_number = $2, series_id = $3, sequence_number = $4, financial_year = $5, status = 'Finalised',
          customer_classification = $6, document_type = $7, document_title = $8, non_gst_reason = $9,
          tax_rule_code = $10, place_of_supply = $11, invoice_date = $12, customer_id = $13,
          guest_name = $14, company_name = $15, billing_address = $16, customer_state_name = $17, customer_state_code = $18,
          customer_gstin = $19, customer_pan = $20, customer_cin = $21, customer_mobile = $22, customer_email = $23, booking_reference = $24,
          check_in_at = $25, check_out_at = $26, show_stay_times = $27, suggested_nights = $28, billable_nights = $29, billable_nights_override_reason = $30,
          room_count = $31, room_numbers = $32, occupancy_type = $33, custom_occupancy_label = $34, rate_per_room_paise = $35, stay_notes = $36,
          pricing_mode = $37, rounding_policy = $38, discount_paise = $39, discount_basis = $40, subtotal_pre_discount_paise = $41,
          taxable_value_paise = $42, cgst_rate_bps = $43, sgst_rate_bps = $44, igst_rate_bps = $45,
          cgst_paise = $46, sgst_paise = $47, igst_paise = $48, total_tax_paise = $49, total_invoice_paise = $50,
          amount_received_paise = $51, balance_payable_paise = $52, credit_refund_due_paise = $53, payment_status = $54,
          business_snapshot_json = $55::jsonb, tax_snapshot_json = $56::jsonb, logo_version_id = $57,
          finalised_at = NOW(), finalised_by = $58, updated_at = NOW()
        WHERE id = $1`,
        [
          invoiceId,
          allocatedInvoiceNumber,
          seriesRow.id,
          allocatedSeq,
          seriesRow.financial_year,
          prepared.classification,
          prepared.documentType,
          prepared.documentTitle,
          prepared.nonGstReason,
          prepared.taxRuleCode,
          prepared.placeOfSupply,
          prepared.invoiceDate,
          customerId,
          prepared.guestName,
          prepared.companyName,
          prepared.billingAddress,
          prepared.customerStateName,
          prepared.customerStateCode,
          prepared.customerGstin,
          prepared.customerPan,
          prepared.customerCin,
          prepared.customerMobile,
          prepared.customerEmail,
          prepared.bookingReference,
          prepared.checkInAt,
          prepared.checkOutAt,
          prepared.showStayTimes,
          prepared.suggestedNights,
          prepared.billableNights,
          prepared.billableNightsOverrideReason,
          prepared.roomCount,
          prepared.roomNumbers,
          prepared.occupancyType,
          prepared.customOccupancyLabel,
          prepared.ratePerRoomPaise,
          prepared.stayNotes,
          prepared.pricingMode,
          businessSettings.roundingPolicy,
          calc.discountPaise,
          prepared.discountBasis,
          calc.subtotalPreDiscountPaise,
          calc.taxableValuePaise,
          calc.cgstRateBps,
          calc.sgstRateBps,
          calc.igstRateBps,
          calc.cgstPaise,
          calc.sgstPaise,
          calc.igstPaise,
          calc.totalTaxPaise,
          calc.totalInvoicePaise,
          calc.amountReceivedPaise,
          calc.balancePayablePaise,
          calc.creditRefundDuePaise,
          calc.paymentStatus,
          JSON.stringify(businessSnapshotForDb),
          JSON.stringify(taxSnapshot),
          businessSettings.activeLogoVersionId,
          actor.id,
        ]
      );
      await tx.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [invoiceId]);
    }

    for (const item of calc.items) {
      await tx.query(
        `INSERT INTO invoice_items (
          id, invoice_id, sort_order, service_type, description, hsn_sac,
          quantity_label, quantity_multiplier, room_count, nights_count,
          entered_unit_rate_paise, pricing_mode, pre_tax_unit_rate_paise,
          line_subtotal_paise, line_discount_paise, taxable_value_paise,
          tax_config_id, tax_code, cgst_rate_bps, sgst_rate_bps, igst_rate_bps,
          cgst_paise, sgst_paise, igst_paise, line_total_paise
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10,
          $11, $12, $13,
          $14, $15, $16,
          $17, $18, $19, $20, $21,
          $22, $23, $24, $25
        )`,
        [
          crypto.randomUUID(),
          invoiceId,
          item.sortOrder,
          item.serviceType,
          item.description,
          item.hsnSac,
          item.quantityLabel,
          item.quantityMultiplier,
          item.roomCount,
          item.nightsCount,
          item.enteredUnitRatePaise,
          item.pricingMode,
          item.preTaxUnitRatePaise,
          item.lineSubtotalPaise,
          item.lineDiscountPaise,
          item.taxableValuePaise,
          item.taxConfigId,
          item.taxCode,
          item.cgstRateBps,
          item.sgstRateBps,
          item.igstRateBps,
          item.cgstPaise,
          item.sgstPaise,
          item.igstPaise,
          item.lineTotalPaise,
        ]
      );
    }

    if (payload.initialPayments && Array.isArray(payload.initialPayments)) {
      await tx.query(`DELETE FROM payments WHERE invoice_id = $1`, [invoiceId]);
      for (const pay of existingPayments) {
        await tx.query(
          `INSERT INTO payments (
            id, invoice_id, amount_paise, payment_date, payment_method, transaction_reference,
            notes, is_initial_at_finalisation, recorded_by, recorded_by_name
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8, $9)`,
          [
            crypto.randomUUID(),
            invoiceId,
            Math.round(Number(pay.amountPaise)),
            pay.paymentDate || prepared.invoiceDate,
            pay.paymentMethod || 'Cash',
            pay.transactionReference?.trim() || null,
            pay.notes?.trim() || null,
            actor.id,
            actor.fullName,
          ]
        );
      }
    } else {
      await tx.query(`UPDATE payments SET is_initial_at_finalisation = TRUE WHERE invoice_id = $1`, [
        invoiceId,
      ]);
    }

    // 7. Record immutable audit event
    await tx.query(
      `INSERT INTO audit_events (
        id, actor_user_id, actor_email, actor_role, event_type, entity_type, entity_id, summary, metadata_json, ip_address
      ) VALUES ($1, $2, $3, $4, 'INVOICE_FINALISED', 'invoice', $5, $6, $7::jsonb, $8)`,
      [
        crypto.randomUUID(),
        actor.id,
        actor.email,
        actor.role,
        invoiceId,
        `Finalised ${prepared.documentTitle} ${allocatedInvoiceNumber} for ${prepared.companyName || prepared.guestName}`,
        JSON.stringify({
          invoiceNumber: allocatedInvoiceNumber,
          totalInvoicePaise: calc.totalInvoicePaise,
          amountReceivedPaise: calc.amountReceivedPaise,
          paymentStatus: calc.paymentStatus,
        }),
        ipAddress ?? null,
      ]
    );

    // 8. Save idempotency record inside the same transaction
    if (payload.idempotencyKey) {
      await tx.query(
        `INSERT INTO idempotency_records (idempotency_key, user_id, operation, resource_id, response_status, response_body_json)
         VALUES ($1, $2, 'FINALISE_INVOICE', $3, 200, $4::jsonb)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          payload.idempotencyKey,
          actor.id,
          invoiceId,
          JSON.stringify({ invoiceId, invoiceNumber: allocatedInvoiceNumber }),
        ]
      );
    }

    const rowRes = await tx.query(`SELECT * FROM invoices WHERE id = $1 LIMIT 1`, [invoiceId]);
    return mapInvoiceRowToRecord(rowRes.rows[0], tx);
  });

  // 9. Generate and privately store original PDF in Netlify Blobs if not already stored.
  // If PDF storage fails transiently, the finalised invoice and its allocated number remain safe,
  // and the PDF can be regenerated on demand without allocating a new invoice number.
  if (!finalisedRecord.originalPdfBlobKey) {
    try {
      const renderInvoicePdfBuffer = await getPdfRenderer();
      const pdfBuffer = await renderInvoicePdfBuffer(finalisedRecord, 'ORIGINAL');
      const blobKey = generatePrivateInvoiceBlobKey(
        finalisedRecord.financialYear || 'fy',
        finalisedRecord.id,
        'original'
      );
      await putPrivateBlob('invoices', blobKey, pdfBuffer, {
        invoiceId: finalisedRecord.id,
        invoiceNumber: finalisedRecord.invoiceNumber || '',
        variant: 'ORIGINAL',
        createdAt: new Date().toISOString(),
      });
      await query(`UPDATE invoices SET original_pdf_blob_key = $2 WHERE id = $1`, [
        finalisedRecord.id,
        blobKey,
      ]);
      finalisedRecord.originalPdfBlobKey = blobKey;
    } catch {
      // Non-fatal: PDF will be regenerated on next download request without re-allocating invoice number
    }
  }

  return finalisedRecord;
}

/**
 * Adds a payment to an invoice with idempotency protection.
 * Preserves the originally issued PDF (`original_pdf_blob_key`) untouched, and generates a separate
 * `latest_payment_summary_pdf_blob_key` when a payment is recorded after finalisation.
 */
export async function recordInvoicePayment(
  invoiceId: string,
  payment: PaymentInput,
  actor: User,
  ipAddress?: string | null
): Promise<InvoiceRecord> {
  const amountPaise = Math.round(Number(payment.amountPaise || 0));
  if (amountPaise <= 0) {
    throw new ValidationError('Payment amount must be greater than zero.');
  }

  const updatedInvoice = await withTransaction(async (tx) => {
    if (payment.idempotencyKey) {
      const existingPay = await tx.query(
        `SELECT id FROM payments WHERE idempotency_key = $1 LIMIT 1`,
        [payment.idempotencyKey]
      );
      if (existingPay.rows.length > 0) {
        const inv = await tx.query(`SELECT * FROM invoices WHERE id = $1 LIMIT 1`, [invoiceId]);
        return mapInvoiceRowToRecord(inv.rows[0], tx);
      }
    }

    const invRes = await tx.query(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [invoiceId]);
    if (invRes.rows.length === 0) {
      throw new ValidationError('Invoice not found.', 404);
    }
    const inv = invRes.rows[0];
    if (inv.status === 'Cancelled') {
      throw new ValidationError('Cannot record payment against a cancelled invoice.');
    }

    const isInitial = inv.status === 'Draft';
    await tx.query(
      `INSERT INTO payments (
        id, invoice_id, amount_paise, payment_date, payment_method, transaction_reference,
        notes, is_initial_at_finalisation, idempotency_key, recorded_by, recorded_by_name
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        crypto.randomUUID(),
        invoiceId,
        amountPaise,
        payment.paymentDate || getKolkataTodayDate(),
        payment.paymentMethod || 'Cash',
        payment.transactionReference?.trim() || null,
        payment.notes?.trim() || null,
        isInitial,
        payment.idempotencyKey || null,
        actor.id,
        actor.fullName,
      ]
    );

    const sumRes = await tx.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount_paise), 0) AS total FROM payments WHERE invoice_id = $1`,
      [invoiceId]
    );
    const totalReceivedPaise = Number(sumRes.rows[0]?.total || 0);
    const totalInvoicePaise = Number(inv.total_invoice_paise);
    const balancePayablePaise = Math.max(0, totalInvoicePaise - totalReceivedPaise);
    const creditRefundDuePaise = Math.max(0, totalReceivedPaise - totalInvoicePaise);

    let paymentStatus: 'Unpaid' | 'Partially Paid' | 'Paid' = 'Unpaid';
    if (totalInvoicePaise === 0 || totalReceivedPaise >= totalInvoicePaise) {
      paymentStatus = 'Paid';
    } else if (totalReceivedPaise > 0) {
      paymentStatus = 'Partially Paid';
    }

    await tx.query(
      `UPDATE invoices
       SET amount_received_paise = $2,
           balance_payable_paise = $3,
           credit_refund_due_paise = $4,
           payment_status = $5,
           updated_at = NOW()
       WHERE id = $1`,
      [invoiceId, totalReceivedPaise, balancePayablePaise, creditRefundDuePaise, paymentStatus]
    );

    await tx.query(
      `INSERT INTO audit_events (
        id, actor_user_id, actor_email, actor_role, event_type, entity_type, entity_id, summary, metadata_json, ip_address
      ) VALUES ($1, $2, $3, $4, 'PAYMENT_RECORDED', 'invoice', $5, $6, $7::jsonb, $8)`,
      [
        crypto.randomUUID(),
        actor.id,
        actor.email,
        actor.role,
        invoiceId,
        `Recorded payment of paise=${amountPaise} (${payment.paymentMethod}) on invoice ${inv.invoice_number || invoiceId}`,
        JSON.stringify({
          amountPaise,
          paymentMethod: payment.paymentMethod,
          totalReceivedPaise,
          balancePayablePaise,
          paymentStatus,
        }),
        ipAddress ?? null,
      ]
    );

    const updatedRow = await tx.query(`SELECT * FROM invoices WHERE id = $1 LIMIT 1`, [invoiceId]);
    return mapInvoiceRowToRecord(updatedRow.rows[0], tx);
  });

  // If invoice was already finalised, generate a separate Payment Summary PDF blob while preserving originalPdfBlobKey
  if (updatedInvoice.status === 'Finalised') {
    try {
      const renderInvoicePdfBuffer = await getPdfRenderer();
      const summaryBuffer = await renderInvoicePdfBuffer(updatedInvoice, 'PAYMENT_SUMMARY');
      const summaryKey = generatePrivateInvoiceBlobKey(
        updatedInvoice.financialYear || 'fy',
        updatedInvoice.id,
        'payment-summary'
      );
      await putPrivateBlob('invoices', summaryKey, summaryBuffer, {
        invoiceId: updatedInvoice.id,
        invoiceNumber: updatedInvoice.invoiceNumber || '',
        variant: 'PAYMENT_SUMMARY',
        createdAt: new Date().toISOString(),
      });
      await query(`UPDATE invoices SET latest_payment_summary_pdf_blob_key = $2 WHERE id = $1`, [
        updatedInvoice.id,
        summaryKey,
      ]);
      updatedInvoice.latestPaymentSummaryPdfBlobKey = summaryKey;
    } catch {
      // Non-fatal: can be rendered on demand
    }
  }

  return updatedInvoice;
}

/**
 * Controlled cancellation of a finalised invoice with mandatory reason and server-side permission checks.
 * Cancelled invoice numbers are never reused.
 */
export async function cancelFinalisedInvoice(
  invoiceId: string,
  reason: string,
  actor: User,
  ipAddress?: string | null
): Promise<InvoiceRecord> {
  const cleanReason = (reason ?? '').trim();
  if (!cleanReason || cleanReason.length < 5) {
    throw new ValidationError('A clear cancellation reason (at least 5 characters) is required.');
  }

  return withTransaction(async (tx) => {
    const businessSettings = await getBusinessSettings(tx);
    const allowed =
      actor.role === 'admin' || actor.canCancelInvoices || businessSettings.staffCanCancelInvoices;
    if (!allowed) {
      throw new ValidationError(
        'Only Administrators or explicitly authorised staff members can cancel finalised invoices.',
        403
      );
    }

    const invRes = await tx.query(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [invoiceId]);
    if (invRes.rows.length === 0) {
      throw new ValidationError('Invoice not found.', 404);
    }
    const inv = invRes.rows[0];
    if (inv.status === 'Cancelled') {
      return mapInvoiceRowToRecord(inv, tx);
    }

    await tx.query(
      `UPDATE invoices
       SET status = 'Cancelled',
           cancelled_at = NOW(),
           cancelled_by = $2,
           cancellation_reason = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [invoiceId, actor.id, cleanReason]
    );

    await tx.query(
      `INSERT INTO audit_events (
        id, actor_user_id, actor_email, actor_role, event_type, entity_type, entity_id, summary, metadata_json, ip_address
      ) VALUES ($1, $2, $3, $4, 'INVOICE_CANCELLED', 'invoice', $5, $6, $7::jsonb, $8)`,
      [
        crypto.randomUUID(),
        actor.id,
        actor.email,
        actor.role,
        invoiceId,
        `Cancelled invoice ${inv.invoice_number || invoiceId}: ${cleanReason}`,
        JSON.stringify({ invoiceNumber: inv.invoice_number, reason: cleanReason }),
        ipAddress ?? null,
      ]
    );

    const updated = await tx.query(`SELECT * FROM invoices WHERE id = $1 LIMIT 1`, [invoiceId]);
    return mapInvoiceRowToRecord(updated.rows[0], tx);
  });
}

/**
 * Duplicates an existing invoice into a new Draft WITHOUT retaining its invoice number or payment records.
 */
export async function duplicateInvoiceAsDraft(
  sourceInvoiceId: string,
  actor: User
): Promise<InvoiceRecord> {
  const sourceRes = await query(`SELECT * FROM invoices WHERE id = $1 LIMIT 1`, [sourceInvoiceId]);
  if (sourceRes.rows.length === 0) {
    throw new ValidationError('Source invoice not found.', 404);
  }
  const source = await mapInvoiceRowToRecord(sourceRes.rows[0]);

  const draftPayload: InvoiceDraftPayload = {
    customerClassification: source.customerClassification,
    documentType: source.documentType,
    nonGstReason: source.nonGstReason,
    taxRuleCode: source.taxRuleCode,
    invoiceDate: getKolkataTodayDate(),
    customerId: source.customerId,
    guestName: source.guestName,
    companyName: source.companyName,
    billingAddress: source.billingAddress,
    customerStateName: source.customerStateName,
    customerStateCode: source.customerStateCode,
    customerGstin: source.customerGstin,
    customerPan: source.customerPan,
    customerCin: source.customerCin,
    customerMobile: source.customerMobile,
    customerEmail: source.customerEmail,
    bookingReference: source.bookingReference,
    checkInAt: source.checkInAt,
    checkOutAt: source.checkOutAt,
    showStayTimes: source.showStayTimes,
    billableNights: source.billableNights,
    billableNightsOverrideReason: source.billableNightsOverrideReason,
    roomCount: source.roomCount,
    roomNumbers: source.roomNumbers,
    occupancyType: source.occupancyType,
    customOccupancyLabel: source.customOccupancyLabel,
    ratePerRoomPaise: source.ratePerRoomPaise,
    stayNotes: source.stayNotes,
    pricingMode: source.pricingMode,
    discountPaise: source.discountPaise,
    discountBasis: source.discountBasis,
    items: source.items.map((it) => ({
      serviceType: it.serviceType,
      description: it.description,
      hsnSac: it.hsnSac,
      quantityLabel: it.quantityLabel,
      quantityMultiplier: it.quantityMultiplier,
      roomCount: it.roomCount,
      nightsCount: it.nightsCount,
      enteredUnitRatePaise: it.enteredUnitRatePaise,
      pricingMode: it.pricingMode,
      taxConfigId: it.taxConfigId,
      taxCode: it.taxCode,
    })),
    initialPayments: [], // Never retain payment records when duplicating
  };

  const createdDraft = await saveInvoiceDraft(draftPayload, actor);
  await query(`UPDATE invoices SET duplicated_from_invoice_id = $2 WHERE id = $1`, [
    createdDraft.id,
    source.id,
  ]);
  createdDraft.duplicatedFromInvoiceId = source.id;
  return createdDraft;
}

/**
 * Retrieves the private PDF bytes for an invoice.
 * - For `variant === 'ORIGINAL'`, returns the stored original PDF from Netlify Blobs, or regenerates and stores it
 *   using the immutable initial payment state at finalisation without allocating a new invoice number.
 * - For `variant === 'PAYMENT_SUMMARY'`, returns or generates the updated payment-summary PDF.
 */
export async function getOrGenerateInvoicePdfBytes(
  invoiceId: string,
  variant: 'ORIGINAL' | 'PAYMENT_SUMMARY' = 'ORIGINAL'
): Promise<{ pdfBytes: Uint8Array; filename: string; invoice: InvoiceRecord }> {
  const res = await query(`SELECT * FROM invoices WHERE id = $1 LIMIT 1`, [invoiceId]);
  if (res.rows.length === 0) {
    throw new ValidationError('Invoice not found.', 404);
  }
  const invoice = await mapInvoiceRowToRecord(res.rows[0]);
  const safeNum = (invoice.invoiceNumber || `DRAFT-${invoice.id.slice(0, 8)}`).replace(/[^a-zA-Z0-9_-]/g, '_');

  if (variant === 'ORIGINAL' && invoice.originalPdfBlobKey && invoice.status === 'Finalised') {
    const existingBlob = await getPrivateBlob('invoices', invoice.originalPdfBlobKey);
    if (existingBlob) {
      return {
        pdfBytes: existingBlob,
        filename: `${safeNum}.pdf`,
        invoice,
      };
    }
  }

  if (variant === 'PAYMENT_SUMMARY' && invoice.latestPaymentSummaryPdfBlobKey) {
    const existingBlob = await getPrivateBlob('invoices', invoice.latestPaymentSummaryPdfBlobKey);
    if (existingBlob) {
      return {
        pdfBytes: existingBlob,
        filename: `${safeNum}_Payment_Summary.pdf`,
        invoice,
      };
    }
  }

  // If regenerating the ORIGINAL PDF after subsequent payments were added, reconstruct the initial payment state
  let invoiceToRender = invoice;
  if (variant === 'ORIGINAL' && invoice.status === 'Finalised') {
    const initialPayments = invoice.payments.filter((p) => p.isInitialAtFinalisation);
    const initialReceived = initialPayments.reduce((s, p) => s + p.amountPaise, 0);
    const initialBalance = Math.max(0, invoice.totalInvoicePaise - initialReceived);
    const initialCredit = Math.max(0, initialReceived - invoice.totalInvoicePaise);
    invoiceToRender = {
      ...invoice,
      payments: initialPayments,
      amountReceivedPaise: initialReceived,
      balancePayablePaise: initialBalance,
      creditRefundDuePaise: initialCredit,
    };
  }

  const renderInvoicePdfBuffer = await getPdfRenderer();
  const buffer = await renderInvoicePdfBuffer(invoiceToRender, variant);
  const uint8 = new Uint8Array(buffer);

  if (invoice.status === 'Finalised') {
    const key = generatePrivateInvoiceBlobKey(
      invoice.financialYear || 'fy',
      invoice.id,
      variant === 'ORIGINAL' ? 'original' : 'payment-summary'
    );
    try {
      await putPrivateBlob('invoices', key, uint8, {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber || '',
        variant,
        createdAt: new Date().toISOString(),
      });
      if (variant === 'ORIGINAL') {
        await query(`UPDATE invoices SET original_pdf_blob_key = $2 WHERE id = $1`, [invoice.id, key]);
      } else {
        await query(`UPDATE invoices SET latest_payment_summary_pdf_blob_key = $2 WHERE id = $1`, [
          invoice.id,
          key,
        ]);
      }
    } catch {
      // Serve generated bytes even if blob persistence had a transient failure
    }
  }

  return {
    pdfBytes: uint8,
    filename: variant === 'PAYMENT_SUMMARY' ? `${safeNum}_Payment_Summary.pdf` : `${safeNum}.pdf`,
    invoice,
  };
}
