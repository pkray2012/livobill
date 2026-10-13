export type UserRole = 'admin' | 'staff';
export type UserStatus = 'pending_setup' | 'active' | 'disabled';

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  canCancelInvoices: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export type CustomerClassification = 'B2B' | 'B2C';
export type DocumentType = 'GST_TAX_INVOICE' | 'NON_GST_DOCUMENT';
export type PricingMode = 'TAX_EXCLUSIVE' | 'TAX_INCLUSIVE';
export type RoundingPolicy = 'per_line' | 'per_invoice';
export type OccupancyType = 'Single' | 'Double' | 'Triple' | 'Custom';
export type InvoiceStatus = 'Draft' | 'Finalised' | 'Cancelled';
export type PaymentStatus = 'Unpaid' | 'Partially Paid' | 'Paid';
export type PaymentMethod = 'Cash' | 'UPI' | 'Card' | 'Bank Transfer' | 'Other';
export type ServiceCategory =
  | 'accommodation'
  | 'extra_bed'
  | 'early_check_in'
  | 'late_checkout'
  | 'food_beverage'
  | 'laundry'
  | 'transport'
  | 'other';

export interface BusinessSettings {
  id: number;
  displayName: string;
  subtitle: string;
  supplierLegalName: string;
  supplierAddress: string;
  supplierGstin: string;
  defaultPlaceOfSupply: string;
  defaultStateCode: string;
  propertyName: string;
  defaultNatureOfSupply: string;
  defaultSac: string;
  bankAccountName: string;
  bankName: string;
  bankAccountType: string;
  bankAccountNo: string;
  bankIfsc: string;
  bankBranch: string;
  standardCheckIn: string;
  standardCheckOut: string;
  declarationText: string;
  authorisedSignatory: string;
  showAmountInWords: boolean;
  nonGstEnabled: boolean;
  nonGstDefaultTitle: 'BILL OF SUPPLY' | 'BILL';
  nonGstAllowedReasons: string[];
  roundingPolicy: RoundingPolicy;
  staffCanCancelInvoices: boolean;
  activeLogoVersionId: string | null;
  activeLogoDataUrl?: string;
  updatedAt: string;
}

export interface TaxConfiguration {
  id: string;
  code: string;
  name: string;
  serviceCategory: ServiceCategory;
  defaultSac: string;
  placeOfSupplyRule: 'LOC_OF_IMMOVABLE_PROPERTY_ODISHA_21' | 'EXPLICIT_INTERSTATE_IGST_RULE' | 'NON_GST_EXEMPT';
  taxMode: 'cgst_sgst' | 'igst' | 'exempt';
  cgstRateBps: number; // e.g. 250 = 2.5%
  sgstRateBps: number; // e.g. 250 = 2.5%
  igstRateBps: number; // e.g. 0 or 500 = 5%
  totalRateBps: number; // e.g. 500 = 5%
  isDefault: boolean;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
}

export interface InvoiceSeries {
  id: string;
  seriesCode: string;
  prefix: string;
  financialYear: string;
  separator: string;
  nextNumber: number;
  paddingDigits: number;
  isActive: boolean;
  updatedAt: string;
}

export interface Customer {
  id: string;
  classification: CustomerClassification;
  guestName: string;
  companyName: string | null;
  billingAddress: string;
  stateName: string;
  stateCode: string;
  gstin: string | null;
  pan: string | null;
  cin: string | null;
  mobile: string | null;
  email: string | null;
  defaultBookingRef: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceLineItemInput {
  id?: string;
  serviceType: ServiceCategory;
  description: string;
  hsnSac: string;
  quantityLabel?: string;
  quantityMultiplier: number;
  roomCount?: number | null;
  nightsCount?: number | null;
  enteredUnitRatePaise: number;
  pricingMode?: PricingMode;
  taxConfigId?: string | null;
  taxCode?: string;
}

export interface CalculatedLineItem {
  id: string;
  sortOrder: number;
  serviceType: ServiceCategory;
  description: string;
  hsnSac: string;
  quantityLabel: string;
  quantityMultiplier: number;
  roomCount: number | null;
  nightsCount: number | null;
  enteredUnitRatePaise: number;
  pricingMode: PricingMode;
  preTaxUnitRatePaise: number;
  lineSubtotalPaise: number;
  lineDiscountPaise: number;
  taxableValuePaise: number;
  taxConfigId: string | null;
  taxCode: string;
  cgstRateBps: number;
  sgstRateBps: number;
  igstRateBps: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  lineTotalPaise: number;
}

export interface PaymentRecord {
  id: string;
  invoiceId: string;
  amountPaise: number;
  paymentDate: string;
  paymentMethod: PaymentMethod;
  transactionReference: string | null;
  notes: string | null;
  isInitialAtFinalisation: boolean;
  recordedBy: string | null;
  recordedByName: string;
  recordedAt: string;
}

export interface PaymentInput {
  id?: string;
  amountPaise: number;
  paymentDate: string;
  paymentMethod: PaymentMethod;
  transactionReference?: string | null;
  notes?: string | null;
  idempotencyKey?: string;
}

export interface InvoiceDraftPayload {
  id?: string;
  customerClassification: CustomerClassification;
  documentType: DocumentType;
  nonGstReason?: string | null;
  taxRuleCode?: string;
  invoiceDate: string;
  customerId?: string | null;
  saveToCustomerDirectory?: boolean;
  guestName: string;
  companyName?: string | null;
  billingAddress: string;
  customerStateName: string;
  customerStateCode: string;
  customerGstin?: string | null;
  customerPan?: string | null;
  customerCin?: string | null;
  customerMobile?: string | null;
  customerEmail?: string | null;
  bookingReference?: string | null;
  checkInAt: string;
  checkOutAt: string;
  showStayTimes: boolean;
  billableNights: number;
  billableNightsOverrideReason?: string | null;
  roomCount: number;
  roomNumbers?: string | null;
  occupancyType: OccupancyType;
  customOccupancyLabel?: string | null;
  ratePerRoomPaise: number;
  stayNotes?: string | null;
  pricingMode: PricingMode;
  discountPaise: number;
  discountBasis?: string | null;
  items: InvoiceLineItemInput[];
  initialPayments?: PaymentInput[];
  idempotencyKey?: string;
}

export interface InvoiceRecord {
  id: string;
  invoiceNumber: string | null;
  seriesId: string | null;
  sequenceNumber: number | null;
  financialYear: string | null;
  status: InvoiceStatus;
  customerClassification: CustomerClassification;
  documentType: DocumentType;
  documentTitle: string;
  nonGstReason: string | null;
  taxRuleCode: string;
  placeOfSupply: string;
  invoiceDate: string;
  customerId: string | null;
  guestName: string;
  companyName: string | null;
  billingAddress: string;
  customerStateName: string;
  customerStateCode: string;
  customerGstin: string | null;
  customerPan: string | null;
  customerCin: string | null;
  customerMobile: string | null;
  customerEmail: string | null;
  bookingReference: string | null;
  checkInAt: string;
  checkOutAt: string;
  showStayTimes: boolean;
  suggestedNights: number;
  billableNights: number;
  billableNightsOverrideReason: string | null;
  roomCount: number;
  roomNumbers: string | null;
  occupancyType: OccupancyType;
  customOccupancyLabel: string | null;
  ratePerRoomPaise: number;
  stayNotes: string | null;
  pricingMode: PricingMode;
  roundingPolicy: RoundingPolicy;
  discountPaise: number;
  discountBasis: string | null;
  subtotalPreDiscountPaise: number;
  taxableValuePaise: number;
  cgstRateBps: number;
  sgstRateBps: number;
  igstRateBps: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalTaxPaise: number;
  totalInvoicePaise: number;
  amountReceivedPaise: number;
  balancePayablePaise: number;
  creditRefundDuePaise: number;
  paymentStatus: PaymentStatus;
  businessSnapshot: BusinessSettings;
  taxSnapshot: {
    ruleCode: string;
    taxMode: 'cgst_sgst' | 'igst' | 'exempt';
    cgstRateBps: number;
    sgstRateBps: number;
    igstRateBps: number;
    roundingPolicy: RoundingPolicy;
  };
  logoVersionId: string | null;
  templateVersion: string;
  originalPdfBlobKey: string | null;
  latestPaymentSummaryPdfBlobKey: string | null;
  finalisedAt: string | null;
  finalisedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  duplicatedFromInvoiceId: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  items: CalculatedLineItem[];
  payments: PaymentRecord[];
}
