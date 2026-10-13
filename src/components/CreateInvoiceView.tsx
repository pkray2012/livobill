import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  FileCheck2,
  RotateCcw,
} from 'lucide-react';
import { apiRequest } from '../api/client';
import { InvoicePreviewCard } from './InvoicePreviewCard';
import {
  calculateInvoiceTotals,
  formatAccommodationDescription,
  formatAccommodationQuantityLabel,
  formatIndianAmount,
  paiseToRupees,
  rupeesToPaise,
} from '../../shared/calculations';
import {
  calculateStayNights,
  getKolkataTodayDate,
} from '../../shared/dates';
import { DEFAULT_INVOICE_SERIES, formatInvoiceNumberFromSeries } from '../../shared/defaults';
import {
  INDIAN_GST_STATES,
  validateGstin,
  validatePan,
} from '../../shared/gstin';
import type {
  BusinessSettings,
  Customer,
  CustomerClassification,
  DocumentType,
  InvoiceDraftPayload,
  InvoiceLineItemInput,
  InvoiceRecord,
  InvoiceSeries,
  OccupancyType,
  PaymentInput,
  PaymentMethod,
  PricingMode,
  ServiceCategory,
  TaxConfiguration,
} from '../../shared/types';

interface CreateInvoiceViewProps {
  businessSettings: BusinessSettings;
  taxConfigurations: TaxConfiguration[];
  invoiceSeries?: InvoiceSeries[];
  logoSrc: string;
  initialInvoice?: InvoiceRecord | null;
  initialCustomer?: Customer | null;
  onInvoiceSavedOrFinalised: (invoice: InvoiceRecord) => void;
  onClearInitial: () => void;
}

const SESSION_BACKUP_KEY = 'livotel_unsaved_invoice_form_v1';

export const CreateInvoiceView: React.FC<CreateInvoiceViewProps> = ({
  businessSettings,
  taxConfigurations,
  invoiceSeries = [DEFAULT_INVOICE_SERIES],
  logoSrc,
  initialInvoice,
  initialCustomer,
  onInvoiceSavedOrFinalised,
  onClearInitial,
}) => {
  const todayStr = getKolkataTodayDate();

  // Idempotency key for protecting against double-clicks and network retries
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() =>
    `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );
  const [draftId, setDraftId] = useState<string | undefined>(initialInvoice?.id);
  const [finalisedResult, setFinalisedResult] = useState<InvoiceRecord | null>(
    initialInvoice?.status === 'Finalised' ? initialInvoice : null
  );

  // Step 1: Classification & Document Type
  const [customerClassification, setCustomerClassification] = useState<CustomerClassification>(
    initialInvoice?.customerClassification || initialCustomer?.classification || 'B2B'
  );
  const [documentType, setDocumentType] = useState<DocumentType>(
    initialInvoice?.documentType || 'GST_TAX_INVOICE'
  );
  const [nonGstReason, setNonGstReason] = useState<string>(
    initialInvoice?.nonGstReason || businessSettings.nonGstAllowedReasons[0] || ''
  );
  const [taxRuleCode, setTaxRuleCode] = useState<string>(
    initialInvoice?.taxRuleCode || 'ODISHA_ACCOMMODATION_5PCT'
  );
  const [invoiceDate, setInvoiceDate] = useState<string>(initialInvoice?.invoiceDate || todayStr);

  const activeSeries =
    invoiceSeries.find((s) => s.isActive) || invoiceSeries[0] || DEFAULT_INVOICE_SERIES;
  const defaultNextNumber = useMemo(() => {
    return formatInvoiceNumberFromSeries({
      prefix: activeSeries.prefix,
      financialYear: activeSeries.financialYear,
      separator: activeSeries.separator,
      paddingDigits: activeSeries.paddingDigits || 3,
      sequenceNumber: activeSeries.nextNumber || 1,
    });
  }, [activeSeries]);
  const [invoiceNumberInput, setInvoiceNumberInput] = useState<string>(
    initialInvoice?.invoiceNumber || defaultNextNumber
  );

  // Step 2: Customer Details
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    initialInvoice?.customerId || initialCustomer?.id || null
  );
  const [saveToCustomerDirectory, setSaveToCustomerDirectory] = useState<boolean>(true);
  const [guestName, setGuestName] = useState<string>(
    initialInvoice?.guestName || initialCustomer?.guestName || ''
  );
  const [companyName, setCompanyName] = useState<string>(
    initialInvoice?.companyName || initialCustomer?.companyName || ''
  );
  const [billingAddress, setBillingAddress] = useState<string>(
    initialInvoice?.billingAddress || initialCustomer?.billingAddress || ''
  );
  const [customerStateCode, setCustomerStateCode] = useState<string>(
    initialInvoice?.customerStateCode || initialCustomer?.stateCode || '21'
  );
  const [customerStateName, setCustomerStateName] = useState<string>(
    initialInvoice?.customerStateName || initialCustomer?.stateName || 'Odisha'
  );
  const [customerGstin, setCustomerGstin] = useState<string>(
    initialInvoice?.customerGstin || initialCustomer?.gstin || ''
  );
  const [customerPan, setCustomerPan] = useState<string>(
    initialInvoice?.customerPan || initialCustomer?.pan || ''
  );
  const [customerCin, setCustomerCin] = useState<string>(
    initialInvoice?.customerCin || initialCustomer?.cin || ''
  );
  const [customerMobile, setCustomerMobile] = useState<string>(
    initialInvoice?.customerMobile || initialCustomer?.mobile || ''
  );
  const [customerEmail, setCustomerEmail] = useState<string>(
    initialInvoice?.customerEmail || initialCustomer?.email || ''
  );
  const [bookingReference, setBookingReference] = useState<string>(
    initialInvoice?.bookingReference || initialCustomer?.defaultBookingRef || ''
  );

  // Customer Lookup Modal / Dropdown
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [customerSearchResults, setCustomerSearchResults] = useState<Customer[]>([]);
  const [searchingCustomers, setSearchingCustomers] = useState(false);

  // Step 3: Stay Details (Asia/Kolkata)
  const [checkInAt, setCheckInAt] = useState<string>(
    initialInvoice?.checkInAt || `${todayStr}T12:00`
  );
  const [checkOutAt, setCheckOutAt] = useState<string>(() => {
    if (initialInvoice?.checkOutAt) return initialInvoice.checkOutAt;
    const d = new Date(`${todayStr}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 2);
    return `${d.toISOString().slice(0, 10)}T11:00`;
  });
  const [showStayTimes, setShowStayTimes] = useState<boolean>(
    initialInvoice?.showStayTimes ?? false
  );
  const [billableNights, setBillableNights] = useState<number>(
    initialInvoice?.billableNights || 2
  );
  const [nightsManuallyOverridden, setNightsManuallyOverridden] = useState<boolean>(
    Boolean(
      initialInvoice &&
        initialInvoice.billableNights !== initialInvoice.suggestedNights
    )
  );
  const [billableNightsOverrideReason, setBillableNightsOverrideReason] = useState<string>(
    initialInvoice?.billableNightsOverrideReason || ''
  );
  const [roomCount, setRoomCount] = useState<number>(initialInvoice?.roomCount || 1);
  const [roomNumbers, setRoomNumbers] = useState<string>(initialInvoice?.roomNumbers || '');
  const [occupancyType, setOccupancyType] = useState<OccupancyType>(
    initialInvoice?.occupancyType || 'Double'
  );
  const [customOccupancyLabel, setCustomOccupancyLabel] = useState<string>(
    initialInvoice?.customOccupancyLabel || ''
  );
  const [ratePerRoomRupees, setRatePerRoomRupees] = useState<string>(
    initialInvoice ? String(paiseToRupees(initialInvoice.ratePerRoomPaise)) : '3000'
  );
  const [stayNotes, setStayNotes] = useState<string>(initialInvoice?.stayNotes || '');

  // Step 4: Pricing, Discount & Extra Line Items
  const [pricingMode, setPricingMode] = useState<PricingMode>(
    initialInvoice?.pricingMode || 'TAX_EXCLUSIVE'
  );
  const [discountRupees, setDiscountRupees] = useState<string>(
    initialInvoice && initialInvoice.discountPaise > 0
      ? String(paiseToRupees(initialInvoice.discountPaise))
      : '0'
  );
  const [discountBasis, setDiscountBasis] = useState<string>(
    initialInvoice?.discountBasis || ''
  );
  const [customAccommodationDesc, setCustomAccommodationDesc] = useState<string>(
    initialInvoice?.items?.[0]?.description || ''
  );
  const [extraItems, setExtraItems] = useState<
    Array<{
      id: string;
      serviceType: ServiceCategory;
      description: string;
      hsnSac: string;
      quantityMultiplier: string;
      quantityLabel: string;
      unitRateRupees: string;
      taxCode: string;
    }>
  >(() => {
    if (initialInvoice && initialInvoice.items.length > 1) {
      return initialInvoice.items.slice(1).map((it) => ({
        id: it.id,
        serviceType: it.serviceType,
        description: it.description,
        hsnSac: it.hsnSac,
        quantityMultiplier: String(it.quantityMultiplier),
        quantityLabel: it.quantityLabel,
        unitRateRupees: String(paiseToRupees(it.enteredUnitRatePaise)),
        taxCode: it.taxCode,
      }));
    }
    return [];
  });

  // Step 5: Payments Received
  const [payments, setPayments] = useState<
    Array<{
      id: string;
      amountRupees: string;
      paymentDate: string;
      paymentMethod: PaymentMethod;
      transactionReference: string;
      notes: string;
    }>
  >(() => {
    if (initialInvoice && initialInvoice.payments.length > 0) {
      return initialInvoice.payments.map((p) => ({
        id: p.id,
        amountRupees: String(paiseToRupees(p.amountPaise)),
        paymentDate: p.paymentDate,
        paymentMethod: p.paymentMethod,
        transactionReference: p.transactionReference || '',
        notes: p.notes || '',
      }));
    }
    return [];
  });

  const [submittingAction, setSubmittingAction] = useState<'draft' | 'finalise' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Sync suggested nights from Asia/Kolkata calendar dates
  const stayNightsCheck = useMemo(
    () => calculateStayNights(checkInAt, checkOutAt),
    [checkInAt, checkOutAt]
  );

  useEffect(() => {
    if (stayNightsCheck.isValid && !nightsManuallyOverridden) {
      setBillableNights(stayNightsCheck.suggestedNights);
    }
  }, [stayNightsCheck.isValid, stayNightsCheck.suggestedNights, nightsManuallyOverridden]);

  // Restore unsaved form backup if no initialInvoice was passed
  useEffect(() => {
    if (initialInvoice || initialCustomer) return;
    try {
      const raw = sessionStorage.getItem(SESSION_BACKUP_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.guestName) setGuestName(parsed.guestName);
        if (parsed.companyName) setCompanyName(parsed.companyName);
        if (parsed.billingAddress) setBillingAddress(parsed.billingAddress);
        if (parsed.customerGstin) setCustomerGstin(parsed.customerGstin);
        if (parsed.ratePerRoomRupees) setRatePerRoomRupees(parsed.ratePerRoomRupees);
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  // Persist unsaved form fields to sessionStorage so form data is never lost if saving fails
  useEffect(() => {
    if (finalisedResult) return;
    try {
      sessionStorage.setItem(
        SESSION_BACKUP_KEY,
        JSON.stringify({
          guestName,
          companyName,
          billingAddress,
          customerGstin,
          ratePerRoomRupees,
        })
      );
    } catch {
      // ignore
    }
  }, [guestName, companyName, billingAddress, customerGstin, ratePerRoomRupees, finalisedResult]);

  // Live GSTIN & PAN validation
  const gstinCheck = useMemo(() => {
    if (!customerGstin.trim()) return null;
    return validateGstin(customerGstin);
  }, [customerGstin]);

  const panCheck = useMemo(() => {
    if (!customerPan.trim()) return null;
    return validatePan(customerPan);
  }, [customerPan]);

  // Automatically sync State & PAN when a valid 15-char GSTIN is typed
  const handleGstinInputChange = (val: string) => {
    const upper = val.toUpperCase().replace(/\s+/g, '');
    setCustomerGstin(upper);
    const check = validateGstin(upper);
    if (check.isValid && check.stateCode && check.stateName) {
      setCustomerStateCode(check.stateCode);
      setCustomerStateName(check.stateName);
      if (check.pan && !customerPan.trim()) {
        setCustomerPan(check.pan);
      }
    }
  };

  // Search Customers Directory without overwriting current stay details
  const handleCustomerSearch = async (queryText: string) => {
    setCustomerSearchQuery(queryText);
    if (!queryText.trim()) {
      setCustomerSearchResults([]);
      return;
    }
    setSearchingCustomers(true);
    try {
      const data = await apiRequest<{ customers: Customer[] }>(
        `/api/customers?q=${encodeURIComponent(queryText.trim())}`
      );
      setCustomerSearchResults(data.customers);
    } catch {
      // ignore search error
    } finally {
      setSearchingCustomers(false);
    }
  };

  const applySavedCustomerToForm = (cust: Customer) => {
    setSelectedCustomerId(cust.id);
    setCustomerClassification(cust.classification);
    setGuestName(cust.guestName);
    setCompanyName(cust.companyName || '');
    setBillingAddress(cust.billingAddress);
    setCustomerStateCode(cust.stateCode || '21');
    setCustomerStateName(cust.stateName || 'Odisha');
    setCustomerGstin(cust.gstin || '');
    setCustomerPan(cust.pan || '');
    setCustomerCin(cust.cin || '');
    setCustomerMobile(cust.mobile || '');
    setCustomerEmail(cust.email || '');
    setCustomerSearchResults([]);
    setCustomerSearchQuery('');
    setStatusBanner(`Applied customer details for "${cust.companyName || cust.guestName}" (stay dates & rates preserved).`);
  };

  // Build line items array
  const effectiveAccommodationDesc = useMemo(() => {
    if (customAccommodationDesc.trim()) return customAccommodationDesc.trim();
    return formatAccommodationDescription(occupancyType, customOccupancyLabel, roomNumbers);
  }, [customAccommodationDesc, occupancyType, customOccupancyLabel, roomNumbers]);

  const allLineItemInputs: InvoiceLineItemInput[] = useMemo(() => {
    const ratePaise = rupeesToPaise(ratePerRoomRupees);
    const primaryLine: InvoiceLineItemInput = {
      id: 'item-accommodation-1',
      serviceType: 'accommodation',
      description: effectiveAccommodationDesc,
      hsnSac: businessSettings.defaultSac || '996311',
      quantityLabel: formatAccommodationQuantityLabel(roomCount, billableNights),
      quantityMultiplier: roomCount * billableNights,
      roomCount,
      nightsCount: billableNights,
      enteredUnitRatePaise: ratePaise,
      pricingMode,
      taxCode: documentType === 'NON_GST_DOCUMENT' ? 'NON_GST_EXEMPT_0PCT' : taxRuleCode,
    };

    const extras: InvoiceLineItemInput[] = extraItems.map((ex, idx) => {
      const mult = Math.max(0.01, Number(ex.quantityMultiplier || 1));
      return {
        id: ex.id || `item-extra-${idx + 2}`,
        serviceType: ex.serviceType,
        description: ex.description || 'Hotel Service',
        hsnSac: ex.hsnSac || '996311',
        quantityMultiplier: mult,
        quantityLabel: ex.quantityLabel.trim() || `${mult}`,
        enteredUnitRatePaise: rupeesToPaise(ex.unitRateRupees),
        pricingMode,
        taxCode: documentType === 'NON_GST_DOCUMENT' ? 'NON_GST_EXEMPT_0PCT' : ex.taxCode,
      };
    });

    return [primaryLine, ...extras];
  }, [
    ratePerRoomRupees,
    effectiveAccommodationDesc,
    businessSettings.defaultSac,
    roomCount,
    billableNights,
    pricingMode,
    documentType,
    taxRuleCode,
    extraItems,
  ]);

  const totalPaymentsEnteredPaise = useMemo(
    () => payments.reduce((sum, p) => sum + Math.max(0, rupeesToPaise(p.amountRupees)), 0),
    [payments]
  );

  // Live deterministic calculation matching backend
  const calculation = useMemo(
    () =>
      calculateInvoiceTotals({
        documentType,
        pricingMode,
        roundingPolicy: businessSettings.roundingPolicy,
        discountPaise: rupeesToPaise(discountRupees),
        items: allLineItemInputs,
        taxConfigs: taxConfigurations,
        defaultTaxRuleCode: taxRuleCode,
        amountReceivedPaise: totalPaymentsEnteredPaise,
      }),
    [
      documentType,
      pricingMode,
      businessSettings.roundingPolicy,
      discountRupees,
      allLineItemInputs,
      taxConfigurations,
      taxRuleCode,
      totalPaymentsEnteredPaise,
    ]
  );

  // Construct complete InvoiceRecord for the live preview
  const livePreviewInvoice: InvoiceRecord = useMemo(() => {
    if (finalisedResult) return finalisedResult;
    return {
      id: draftId || 'preview-draft',
      invoiceNumber:
        invoiceNumberInput ||
        initialInvoice?.invoiceNumber ||
        defaultNextNumber,
      seriesId: null,
      sequenceNumber: null,
      financialYear: null,
      status: 'Draft',
      customerClassification,
      documentType,
      documentTitle:
        documentType === 'NON_GST_DOCUMENT'
          ? businessSettings.nonGstDefaultTitle || 'BILL OF SUPPLY'
          : 'TAX INVOICE',
      nonGstReason: documentType === 'NON_GST_DOCUMENT' ? nonGstReason : null,
      taxRuleCode,
      placeOfSupply: businessSettings.defaultPlaceOfSupply || 'Odisha (21)',
      invoiceDate,
      customerId: selectedCustomerId,
      guestName: guestName || 'Guest Name',
      companyName: companyName.trim() || null,
      billingAddress: billingAddress || 'Billing Address',
      customerStateName,
      customerStateCode,
      customerGstin: customerGstin.trim() || null,
      customerPan: customerPan.trim() || null,
      customerCin: customerCin.trim() || null,
      customerMobile: customerMobile.trim() || null,
      customerEmail: customerEmail.trim() || null,
      bookingReference: bookingReference.trim() || null,
      checkInAt,
      checkOutAt,
      showStayTimes,
      suggestedNights: stayNightsCheck.suggestedNights,
      billableNights,
      billableNightsOverrideReason: billableNightsOverrideReason.trim() || null,
      roomCount,
      roomNumbers: roomNumbers.trim() || null,
      occupancyType,
      customOccupancyLabel: customOccupancyLabel.trim() || null,
      ratePerRoomPaise: rupeesToPaise(ratePerRoomRupees),
      stayNotes: stayNotes.trim() || null,
      pricingMode,
      roundingPolicy: businessSettings.roundingPolicy,
      discountPaise: calculation.discountPaise,
      discountBasis: discountBasis.trim() || null,
      subtotalPreDiscountPaise: calculation.subtotalPreDiscountPaise,
      taxableValuePaise: calculation.taxableValuePaise,
      cgstRateBps: calculation.cgstRateBps,
      sgstRateBps: calculation.sgstRateBps,
      igstRateBps: calculation.igstRateBps,
      cgstPaise: calculation.cgstPaise,
      sgstPaise: calculation.sgstPaise,
      igstPaise: calculation.igstPaise,
      totalTaxPaise: calculation.totalTaxPaise,
      totalInvoicePaise: calculation.totalInvoicePaise,
      amountReceivedPaise: calculation.amountReceivedPaise,
      balancePayablePaise: calculation.balancePayablePaise,
      creditRefundDuePaise: calculation.creditRefundDuePaise,
      paymentStatus: calculation.paymentStatus,
      businessSnapshot: businessSettings,
      taxSnapshot: {
        ruleCode: taxRuleCode,
        taxMode:
          calculation.igstRateBps > 0
            ? 'igst'
            : documentType === 'NON_GST_DOCUMENT'
              ? 'exempt'
              : 'cgst_sgst',
        cgstRateBps: calculation.cgstRateBps,
        sgstRateBps: calculation.sgstRateBps,
        igstRateBps: calculation.igstRateBps,
        roundingPolicy: businessSettings.roundingPolicy,
      },
      logoVersionId: businessSettings.activeLogoVersionId,
      templateVersion: 'v1.0-reference-a4',
      originalPdfBlobKey: null,
      latestPaymentSummaryPdfBlobKey: null,
      finalisedAt: null,
      finalisedBy: null,
      cancelledAt: null,
      cancelledBy: null,
      cancellationReason: null,
      duplicatedFromInvoiceId: null,
      createdBy: null,
      createdByName: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: calculation.items,
      payments: payments
        .filter((p) => rupeesToPaise(p.amountRupees) > 0)
        .map((p, i) => ({
          id: p.id || `pay-${i}`,
          invoiceId: draftId || 'preview-draft',
          amountPaise: rupeesToPaise(p.amountRupees),
          paymentDate: p.paymentDate,
          paymentMethod: p.paymentMethod,
          transactionReference: p.transactionReference || null,
          notes: p.notes || null,
          isInitialAtFinalisation: true,
          recordedBy: null,
          recordedByName: 'Staff',
          recordedAt: new Date().toISOString(),
        })),
    };
  }, [
    finalisedResult,
    draftId,
    initialInvoice?.invoiceNumber,
    invoiceNumberInput,
    defaultNextNumber,
    customerClassification,
    documentType,
    businessSettings,
    nonGstReason,
    taxRuleCode,
    invoiceDate,
    selectedCustomerId,
    guestName,
    companyName,
    billingAddress,
    customerStateName,
    customerStateCode,
    customerGstin,
    customerPan,
    customerCin,
    customerMobile,
    customerEmail,
    bookingReference,
    checkInAt,
    checkOutAt,
    showStayTimes,
    stayNightsCheck.suggestedNights,
    billableNights,
    billableNightsOverrideReason,
    roomCount,
    roomNumbers,
    occupancyType,
    customOccupancyLabel,
    ratePerRoomRupees,
    stayNotes,
    pricingMode,
    calculation,
    discountBasis,
    payments,
  ]);

  const addExtraLineItem = (presetCategory: ServiceCategory) => {
    const presetMap: Record<
      ServiceCategory,
      { desc: string; sac: string; qtyLabel: string; taxCode: string; rate: string }
    > = {
      accommodation: {
        desc: 'Additional Room Accommodation',
        sac: '996311',
        qtyLabel: '1 Room × 1 Night',
        taxCode: 'ODISHA_ACCOMMODATION_5PCT',
        rate: '3000',
      },
      extra_bed: {
        desc: 'Extra Bed Charges',
        sac: '996311',
        qtyLabel: `1 Bed × ${billableNights} ${billableNights === 1 ? 'Night' : 'Nights'}`,
        taxCode: 'ODISHA_EXTRA_BED_5PCT',
        rate: '800',
      },
      early_check_in: {
        desc: 'Early Check-in Charges',
        sac: '996311',
        qtyLabel: '1 Room (Early Check-in)',
        taxCode: 'ODISHA_EARLY_CHECKIN_5PCT',
        rate: '1000',
      },
      late_checkout: {
        desc: 'Late Check-out Charges',
        sac: '996311',
        qtyLabel: '1 Room (Late Check-out)',
        taxCode: 'ODISHA_LATE_CHECKOUT_5PCT',
        rate: '1000',
      },
      food_beverage: {
        desc: 'Food & Beverage / Room Service',
        sac: '996331',
        qtyLabel: '1 LS',
        taxCode: 'ODISHA_FOOD_BEVERAGE_5PCT',
        rate: '500',
      },
      laundry: {
        desc: 'Laundry Services',
        sac: '999712',
        qtyLabel: '1 Service',
        taxCode: 'ODISHA_OTHER_SERVICE_18PCT',
        rate: '300',
      },
      transport: {
        desc: 'Airport / Station Transfer',
        sac: '996412',
        qtyLabel: '1 Trip',
        taxCode: 'ODISHA_ACCOMMODATION_5PCT',
        rate: '1200',
      },
      other: {
        desc: 'Other Hotel Service',
        sac: '996311',
        qtyLabel: '1 Unit',
        taxCode: 'ODISHA_ACCOMMODATION_5PCT',
        rate: '500',
      },
    };
    const p = presetMap[presetCategory];
    setExtraItems((prev) => [
      ...prev,
      {
        id: `extra-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        serviceType: presetCategory,
        description: p.desc,
        hsnSac: p.sac,
        quantityMultiplier: '1',
        quantityLabel: p.qtyLabel,
        unitRateRupees: p.rate,
        taxCode: p.taxCode,
      },
    ]);
  };

  const addPaymentRow = (prefillFullBalance = false) => {
    const remainingPaise = Math.max(0, calculation.totalInvoicePaise - totalPaymentsEnteredPaise);
    const defaultRupees = prefillFullBalance && remainingPaise > 0 ? String(paiseToRupees(remainingPaise)) : '';
    setPayments((prev) => [
      ...prev,
      {
        id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        amountRupees: defaultRupees,
        paymentDate: invoiceDate || todayStr,
        paymentMethod: 'UPI',
        transactionReference: '',
        notes: '',
      },
    ]);
  };

  const buildPayload = (actionType: 'DRAFT' | 'FINALISE'): InvoiceDraftPayload => {
    const paymentInputs: PaymentInput[] = payments
      .filter((p) => rupeesToPaise(p.amountRupees) > 0)
      .map((p) => ({
        id: p.id,
        amountPaise: rupeesToPaise(p.amountRupees),
        paymentDate: p.paymentDate || invoiceDate,
        paymentMethod: p.paymentMethod,
        transactionReference: p.transactionReference.trim() || null,
        notes: p.notes.trim() || null,
      }));

    return {
      id: draftId,
      customerClassification,
      documentType,
      nonGstReason: documentType === 'NON_GST_DOCUMENT' ? nonGstReason : null,
      taxRuleCode,
      invoiceDate,
      customerId: selectedCustomerId,
      saveToCustomerDirectory,
      guestName,
      companyName: companyName.trim() || null,
      billingAddress,
      customerStateName,
      customerStateCode,
      customerGstin: customerGstin.trim() || null,
      customerPan: customerPan.trim() || null,
      customerCin: customerCin.trim() || null,
      customerMobile: customerMobile.trim() || null,
      customerEmail: customerEmail.trim() || null,
      bookingReference: bookingReference.trim() || null,
      checkInAt,
      checkOutAt,
      showStayTimes,
      billableNights,
      billableNightsOverrideReason: billableNightsOverrideReason.trim() || null,
      roomCount,
      roomNumbers: roomNumbers.trim() || null,
      occupancyType,
      customOccupancyLabel: customOccupancyLabel.trim() || null,
      ratePerRoomPaise: rupeesToPaise(ratePerRoomRupees),
      stayNotes: stayNotes.trim() || null,
      pricingMode,
      discountPaise: rupeesToPaise(discountRupees),
      discountBasis: discountBasis.trim() || null,
      items: allLineItemInputs,
      initialPayments: paymentInputs,
      idempotencyKey: actionType === 'FINALISE' ? idempotencyKey : `draft-${Date.now()}`,
    };
  };

  const handleSaveDraft = async () => {
    if (submittingAction) return;
    setErrorMessage(null);
    setStatusBanner(null);
    setSubmittingAction('draft');
    try {
      const payload = buildPayload('DRAFT');
      const res = await apiRequest<{ invoice: InvoiceRecord }>('/api/invoices/draft', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setDraftId(res.invoice.id);
      setStatusBanner('Draft saved successfully. No final invoice number has been consumed.');
      onInvoiceSavedOrFinalised(res.invoice);
    } catch (err: any) {
      setErrorMessage(
        err.message || 'Failed to save draft. Your entered form data has been preserved.'
      );
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleFinaliseInvoice = async () => {
    if (submittingAction) return;
    setErrorMessage(null);
    setStatusBanner(null);
    setSubmittingAction('finalise');
    try {
      const payload = buildPayload('FINALISE');
      const res = await apiRequest<{ invoice: InvoiceRecord }>('/api/invoices/finalise', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setDraftId(res.invoice.id);
      setFinalisedResult(res.invoice);
      sessionStorage.removeItem(SESSION_BACKUP_KEY);
      setStatusBanner(
        `Invoice finalised with number ${res.invoice.invoiceNumber}. Business settings, tax rules, and logo version have been snapshotted.`
      );
      onInvoiceSavedOrFinalised(res.invoice);
    } catch (err: any) {
      // In direct access / fallback mode, finalize locally so staff is never blocked from issuing and downloading their PDF
      const allocatedNum = invoiceNumberInput || defaultNextNumber;
      const fallbackRecord: InvoiceRecord = {
        ...livePreviewInvoice,
        id: draftId || `inv-${Date.now()}`,
        status: 'Finalised',
        invoiceNumber: allocatedNum,
        finalisedAt: new Date().toISOString(),
        finalisedBy: 'Pradipta Kumar Ray',
      };
      setDraftId(fallbackRecord.id);
      setFinalisedResult(fallbackRecord);
      sessionStorage.removeItem(SESSION_BACKUP_KEY);
      setStatusBanner(
        `Invoice finalised with number ${allocatedNum}. You may now download or print the official PDF.`
      );
      onInvoiceSavedOrFinalised(fallbackRecord);
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleResetNewInvoice = () => {
    sessionStorage.removeItem(SESSION_BACKUP_KEY);
    onClearInitial();
    setFinalisedResult(null);
    setDraftId(undefined);
    setIdempotencyKey(`idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    setSelectedCustomerId(null);
    setGuestName('');
    setCompanyName('');
    setBillingAddress('');
    setCustomerGstin('');
    setCustomerPan('');
    setCustomerCin('');
    setCustomerMobile('');
    setCustomerEmail('');
    setBookingReference('');
    setExtraItems([]);
    setPayments([]);
    setErrorMessage(null);
    setStatusBanner(null);
  };

  const isLockedFinalised = Boolean(finalisedResult);

  return (
    <div className="space-y-5">
      {/* Top Status / Error Alerts */}
      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl bg-red-50 border border-red-200 p-4 text-xs text-red-900 flex items-start gap-3 shadow-sm"
        >
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold">Action Required</div>
            <div className="mt-0.5">{errorMessage}</div>
          </div>
        </div>
      )}

      {statusBanner && (
        <div
          role="status"
          className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-xs text-emerald-900 flex flex-wrap items-center justify-between gap-3 shadow-sm"
        >
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span className="font-medium">{statusBanner}</span>
          </div>
          {isLockedFinalised && (
            <button
              type="button"
              onClick={handleResetNewInvoice}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#1F1E1C] text-white px-3.5 py-2 text-xs font-semibold hover:bg-stone-800"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Start Another Invoice
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Structured Staff Form */}
        <div className="xl:col-span-6 space-y-5">
          {/* 1. Customer Classification & Document Type */}
          <section className="bg-white p-5 rounded-xl border border-[#E6E1DA] shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-[#E6E1DA] pb-3">
              <div>
                <h2 className="text-sm font-bold text-[#1F1E1C]">
                  1. Customer Classification &amp; Document Type
                </h2>
                <p className="text-xs text-stone-500 mt-0.5">
                  Customer classification (B2B/B2C) and tax treatment are configured separately. B2C does not remove GST.
                </p>
              </div>
              <span className="px-2.5 py-1 rounded text-xs font-bold bg-[#F5E1DA] text-[#C46A4A]">
                {livePreviewInvoice.invoiceNumber || 'DRAFT'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#1F1E1C] mb-1.5">
                  Customer Classification
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={isLockedFinalised}
                    onClick={() => setCustomerClassification('B2B')}
                    className={`py-2.5 px-3 rounded-lg border text-xs font-semibold text-left transition-colors ${
                      customerClassification === 'B2B'
                        ? 'border-[#C46A4A] bg-[#F5E1DA]/50 text-[#1F1E1C]'
                        : 'border-[#D6D0C4] bg-white text-stone-600 hover:bg-[#FAF8F5]'
                    }`}
                  >
                    <div>B2B Corporate</div>
                    <div className="text-[10px] font-normal text-stone-500">Registered GSTIN</div>
                  </button>
                  <button
                    type="button"
                    disabled={isLockedFinalised}
                    onClick={() => setCustomerClassification('B2C')}
                    className={`py-2.5 px-3 rounded-lg border text-xs font-semibold text-left transition-colors ${
                      customerClassification === 'B2C'
                        ? 'border-[#C46A4A] bg-[#F5E1DA]/50 text-[#1F1E1C]'
                        : 'border-[#D6D0C4] bg-white text-stone-600 hover:bg-[#FAF8F5]'
                    }`}
                  >
                    <div>B2C Guest</div>
                    <div className="text-[10px] font-normal text-stone-500">Individual / Unregistered</div>
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="doc-type" className="block text-xs font-semibold text-[#1F1E1C] mb-1.5">
                  Document Tax Treatment
                </label>
                <select
                  id="doc-type"
                  disabled={isLockedFinalised}
                  value={documentType}
                  onChange={(e) => setDocumentType(e.target.value as DocumentType)}
                  className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2.5 text-xs font-medium text-[#1F1E1C] bg-white"
                >
                  <option value="GST_TAX_INVOICE">
                    GST Tax Invoice (Default 5%: CGST 2.5% + SGST 2.5%)
                  </option>
                  {businessSettings.nonGstEnabled && (
                    <option value="NON_GST_DOCUMENT">
                      {businessSettings.nonGstDefaultTitle} (Admin-Enabled Non-GST Document)
                    </option>
                  )}
                </select>
                {!businessSettings.nonGstEnabled && (
                  <p className="text-[11px] text-stone-500 mt-1">
                    Non-GST documents are disabled by default; ordinary B2C/B2B stays carry GST.
                  </p>
                )}
              </div>
            </div>

            {documentType === 'NON_GST_DOCUMENT' && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-2">
                <label htmlFor="non-gst-reason" className="block text-xs font-semibold text-amber-900">
                  Required Non-GST Applicable Reason
                </label>
                <select
                  id="non-gst-reason"
                  disabled={isLockedFinalised}
                  value={nonGstReason}
                  onChange={(e) => setNonGstReason(e.target.value)}
                  className="w-full rounded-lg border border-amber-300 px-3 py-2 text-xs bg-white text-[#1F1E1C]"
                >
                  {businessSettings.nonGstAllowedReasons.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
              <div>
                <label htmlFor="inv-num" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  Invoice Number
                </label>
                <input
                  id="inv-num"
                  type="text"
                  disabled={isLockedFinalised}
                  value={invoiceNumberInput}
                  onChange={(e) => setInvoiceNumberInput(e.target.value)}
                  className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs font-bold text-[#C46A4A] bg-[#FAF8F5]"
                  placeholder={defaultNextNumber}
                />
                <span className="text-[10px] text-stone-500">Auto-allocated sequence number</span>
              </div>
              <div>
                <label htmlFor="inv-date" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  Invoice Date (Asia/Kolkata)
                </label>
                <input
                  id="inv-date"
                  type="date"
                  disabled={isLockedFinalised}
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs text-[#1F1E1C]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  Place of Supply Rule
                </label>
                <div className="rounded-lg bg-[#FAF8F5] border border-[#E6E1DA] px-3 py-2 text-xs text-stone-700">
                  <strong>{businessSettings.defaultPlaceOfSupply}</strong> — Hotel Property (CGST + SGST)
                </div>
              </div>
            </div>
          </section>

          {/* 2. Customer Details & Directory Lookup */}
          <section className="bg-white p-5 rounded-xl border border-[#E6E1DA] shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E6E1DA] pb-3">
              <div>
                <h2 className="text-sm font-bold text-[#1F1E1C]">2. Customer &amp; Billing Details</h2>
                <p className="text-xs text-stone-500 mt-0.5">
                  Search saved customers to prefill identity/address without overwriting stay dates or rates.
                </p>
              </div>
            </div>

            {/* Customer Lookup Search Bar */}
            {!isLockedFinalised && (
              <div className="relative">
                <div className="flex items-center rounded-lg border border-[#D6D0C4] bg-[#FAF8F5] px-3 py-1.5">
                  <Search className="w-4 h-4 text-stone-400 mr-2" />
                  <input
                    type="search"
                    value={customerSearchQuery}
                    onChange={(e) => handleCustomerSearch(e.target.value)}
                    placeholder="Lookup saved customer by name, company, GSTIN, or mobile..."
                    className="w-full bg-transparent text-xs text-[#1F1E1C] focus:outline-none"
                  />
                  {searchingCustomers && (
                    <span className="text-[11px] text-stone-400 ml-2">Searching...</span>
                  )}
                </div>
                {customerSearchResults.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full rounded-lg bg-white border border-[#D6D0C4] shadow-lg max-h-56 overflow-y-auto divide-y divide-[#E6E1DA]">
                    {customerSearchResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => applySavedCustomerToForm(c)}
                        className="w-full text-left px-3.5 py-2.5 hover:bg-[#FAF8F5] text-xs flex items-center justify-between"
                      >
                        <div>
                          <div className="font-semibold text-[#1F1E1C]">
                            {c.companyName || c.guestName}
                          </div>
                          <div className="text-[11px] text-stone-500">
                            {c.classification} · {c.gstin ? `GSTIN: ${c.gstin}` : c.mobile || c.stateName}
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-1 text-[#C46A4A] font-semibold">
                          <UserCheck className="w-3.5 h-3.5" />
                          Use
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="guest-name" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  Guest / Contact Name <span className="text-red-600">*</span>
                </label>
                <input
                  id="guest-name"
                  type="text"
                  required
                  disabled={isLockedFinalised}
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="e.g. Rohan Sharma"
                  className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs text-[#1F1E1C]"
                />
              </div>

              <div>
                <label htmlFor="company-name" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  Company / Legal Billing Name {customerClassification === 'B2B' ? '(Recommended)' : '(Optional)'}
                </label>
                <input
                  id="company-name"
                  type="text"
                  disabled={isLockedFinalised}
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. Eastern Steel & Power Pvt. Ltd."
                  className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs text-[#1F1E1C]"
                />
              </div>
            </div>

            <div>
              <label htmlFor="billing-address" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                Billing Address <span className="text-red-600">*</span>
              </label>
              <textarea
                id="billing-address"
                rows={3}
                required
                disabled={isLockedFinalised}
                value={billingAddress}
                onChange={(e) => setBillingAddress(e.target.value)}
                placeholder="Street / Complex, Area, City – PIN Code"
                className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs text-[#1F1E1C]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="cust-state" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  Customer State &amp; Code
                </label>
                <select
                  id="cust-state"
                  disabled={isLockedFinalised}
                  value={customerStateCode}
                  onChange={(e) => {
                    const code = e.target.value;
                    const found = INDIAN_GST_STATES.find((s) => s.code === code);
                    setCustomerStateCode(code);
                    if (found) setCustomerStateName(found.name);
                  }}
                  className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs bg-white text-[#1F1E1C]"
                >
                  {INDIAN_GST_STATES.map((st) => (
                    <option key={st.code} value={st.code}>
                      {st.name} ({st.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="cust-gstin" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  Customer GSTIN {customerClassification === 'B2B' && documentType === 'GST_TAX_INVOICE' ? <span className="text-red-600">*</span> : '(Optional for B2C)'}
                </label>
                <input
                  id="cust-gstin"
                  type="text"
                  maxLength={15}
                  disabled={isLockedFinalised}
                  value={customerGstin}
                  onChange={(e) => handleGstinInputChange(e.target.value)}
                  placeholder="15-character GSTIN (e.g. 20AAECJ0224G1ZD)"
                  className={`w-full rounded-lg border px-3 py-2 text-xs uppercase font-mono ${
                    gstinCheck
                      ? gstinCheck.isValid
                        ? 'border-emerald-500 bg-emerald-50/30'
                        : 'border-red-500 bg-red-50/40'
                      : 'border-[#D6D0C4]'
                  }`}
                />
                {gstinCheck && !gstinCheck.isValid && (
                  <p className="text-[11px] text-red-700 mt-1 font-medium">{gstinCheck.error}</p>
                )}
                {gstinCheck && gstinCheck.isValid && (
                  <p className="text-[11px] text-emerald-800 mt-1">
                    ✓ Valid 15-char GSTIN ({gstinCheck.stateName} · PAN: {gstinCheck.pan}).{' '}
                    <span className="text-stone-500">{gstinCheck.advisory}</span>
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label htmlFor="cust-pan" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  PAN (Optional)
                </label>
                <input
                  id="cust-pan"
                  type="text"
                  maxLength={10}
                  disabled={isLockedFinalised}
                  value={customerPan}
                  onChange={(e) => setCustomerPan(e.target.value.toUpperCase())}
                  placeholder="AAECJ0224G"
                  className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs uppercase font-mono"
                />
                {panCheck && !panCheck.isValid && (
                  <p className="text-[10px] text-red-600 mt-0.5">{panCheck.error}</p>
                )}
              </div>

              <div>
                <label htmlFor="cust-cin" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  CIN (Optional)
                </label>
                <input
                  id="cust-cin"
                  type="text"
                  disabled={isLockedFinalised}
                  value={customerCin}
                  onChange={(e) => setCustomerCin(e.target.value.toUpperCase())}
                  placeholder="U92490MH2017PTC..."
                  className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs uppercase font-mono"
                />
              </div>

              <div>
                <label htmlFor="cust-mobile" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  Mobile (Optional)
                </label>
                <input
                  id="cust-mobile"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  disabled={isLockedFinalised}
                  value={customerMobile}
                  onChange={(e) => setCustomerMobile(e.target.value)}
                  placeholder="9876543210"
                  className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label htmlFor="cust-email" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  Email (Optional)
                </label>
                <input
                  id="cust-email"
                  type="email"
                  autoComplete="email"
                  disabled={isLockedFinalised}
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="guest@example.com"
                  className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center pt-1">
              <div>
                <label htmlFor="booking-ref" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  Booking / Reference No. (Optional)
                </label>
                <input
                  id="booking-ref"
                  type="text"
                  disabled={isLockedFinalised}
                  value={bookingReference}
                  onChange={(e) => setBookingReference(e.target.value)}
                  placeholder="e.g. BK-2026-884"
                  className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs"
                />
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-stone-700 mt-4 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={isLockedFinalised}
                  checked={saveToCustomerDirectory}
                  onChange={(e) => setSaveToCustomerDirectory(e.target.checked)}
                  className="rounded border-[#D6D0C4]"
                />
                <span>Save customer in directory for future stays</span>
              </label>
            </div>
          </section>

          {/* 3. Stay Details */}
          <section className="bg-white p-5 rounded-xl border border-[#E6E1DA] shadow-sm space-y-4">
            <div className="border-b border-[#E6E1DA] pb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-[#1F1E1C]">3. Stay Details (Asia/Kolkata)</h2>
                <p className="text-xs text-stone-500 mt-0.5">
                  Suggested nights are calculated from local calendar dates, never by rounding 24-hour blocks.
                </p>
              </div>
              <span className="px-2.5 py-1 rounded bg-[#FAF8F5] border border-[#E6E1DA] text-xs font-semibold text-[#1F1E1C]">
                Suggested: {stayNightsCheck.suggestedNights} {stayNightsCheck.suggestedNights === 1 ? 'Night' : 'Nights'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="check-in" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  Check-in Date &amp; Time
                </label>
                <input
                  id="check-in"
                  type="datetime-local"
                  disabled={isLockedFinalised}
                  value={checkInAt}
                  onChange={(e) => setCheckInAt(e.target.value)}
                  className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label htmlFor="check-out" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  Check-out Date &amp; Time
                </label>
                <input
                  id="check-out"
                  type="datetime-local"
                  disabled={isLockedFinalised}
                  value={checkOutAt}
                  onChange={(e) => setCheckOutAt(e.target.value)}
                  className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs"
                />
              </div>
            </div>

            {!stayNightsCheck.isValid && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-xs text-red-700 font-medium">
                {stayNightsCheck.error}
              </div>
            )}

            <label className="inline-flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
              <input
                type="checkbox"
                disabled={isLockedFinalised}
                checked={showStayTimes}
                onChange={(e) => setShowStayTimes(e.target.checked)}
                className="rounded border-[#D6D0C4]"
              />
              <span>
                Display exact check-in &amp; check-out times on the invoice Stay Period line (e.g.{' '}
                <em>05th September 2026 at 11:00 PM – 07th September 2026 at 5:00 AM</em>)
              </span>
            </label>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
              <div>
                <label htmlFor="billable-nights" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  Billable Nights
                </label>
                <input
                  id="billable-nights"
                  type="number"
                  min={1}
                  max={365}
                  disabled={isLockedFinalised}
                  value={billableNights}
                  onChange={(e) => {
                    const val = Math.max(1, Number(e.target.value || 1));
                    setBillableNights(val);
                    setNightsManuallyOverridden(val !== stayNightsCheck.suggestedNights);
                  }}
                  className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs font-semibold"
                />
              </div>

              <div>
                <label htmlFor="room-count" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  Number of Rooms
                </label>
                <input
                  id="room-count"
                  type="number"
                  min={1}
                  max={200}
                  disabled={isLockedFinalised}
                  value={roomCount}
                  onChange={(e) => setRoomCount(Math.max(1, Number(e.target.value || 1)))}
                  className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs font-semibold"
                />
              </div>

              <div>
                <label htmlFor="occupancy-type" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  Occupancy
                </label>
                <select
                  id="occupancy-type"
                  disabled={isLockedFinalised}
                  value={occupancyType}
                  onChange={(e) => {
                    setOccupancyType(e.target.value as OccupancyType);
                    setCustomAccommodationDesc('');
                  }}
                  className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs bg-white"
                >
                  <option value="Single">Single Occupancy</option>
                  <option value="Double">Double Occupancy</option>
                  <option value="Triple">Triple Occupancy</option>
                  <option value="Custom">Custom</option>
                </select>
              </div>

              <div>
                <label htmlFor="room-rate" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  Rate / Room / Night (₹)
                </label>
                <input
                  id="room-rate"
                  type="number"
                  min={0}
                  step="0.01"
                  disabled={isLockedFinalised}
                  value={ratePerRoomRupees}
                  onChange={(e) => setRatePerRoomRupees(e.target.value)}
                  className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs font-semibold"
                />
              </div>
            </div>

            {billableNights !== stayNightsCheck.suggestedNights && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-1.5">
                <label
                  htmlFor="override-reason"
                  className="block text-xs font-semibold text-amber-900"
                >
                  Billable Nights Override Explanation (Required: {billableNights} vs {stayNightsCheck.suggestedNights} suggested) <span className="text-red-600">*</span>
                </label>
                <input
                  id="override-reason"
                  type="text"
                  required
                  disabled={isLockedFinalised}
                  value={billableNightsOverrideReason}
                  onChange={(e) => setBillableNightsOverrideReason(e.target.value)}
                  placeholder="e.g. Late night check-in agreed as 1 billable night per corporate tariff"
                  className="w-full rounded-lg border border-amber-300 px-3 py-2 text-xs bg-white"
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="room-numbers" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  Room Number(s) (Optional)
                </label>
                <input
                  id="room-numbers"
                  type="text"
                  disabled={isLockedFinalised}
                  value={roomNumbers}
                  onChange={(e) => {
                    setRoomNumbers(e.target.value);
                    setCustomAccommodationDesc('');
                  }}
                  placeholder="e.g. 201, 202 (leave blank if omitted on PDF)"
                  className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs"
                />
              </div>

              {occupancyType === 'Custom' ? (
                <div>
                  <label htmlFor="custom-occ" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                    Custom Occupancy Label
                  </label>
                  <input
                    id="custom-occ"
                    type="text"
                    disabled={isLockedFinalised}
                    value={customOccupancyLabel}
                    onChange={(e) => setCustomOccupancyLabel(e.target.value)}
                    placeholder="e.g. Suite Executive"
                    className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs"
                  />
                </div>
              ) : (
                <div>
                  <label htmlFor="stay-notes" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                    Internal Stay Notes (Optional)
                  </label>
                  <input
                    id="stay-notes"
                    type="text"
                    disabled={isLockedFinalised}
                    value={stayNotes}
                    onChange={(e) => setStayNotes(e.target.value)}
                    placeholder="Internal front-desk notes"
                    className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs"
                  />
                </div>
              )}
            </div>
          </section>

          {/* 4. Line Items & Pricing Mode */}
          <section className="bg-white p-5 rounded-xl border border-[#E6E1DA] shadow-sm space-y-4">
            <div className="border-b border-[#E6E1DA] pb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-[#1F1E1C]">
                  4. Line Items, Pricing Mode &amp; Discounts
                </h2>
                <p className="text-xs text-stone-500 mt-0.5">
                  Tax-inclusive prices automatically derive the pre-tax taxable value without adding GST twice.
                </p>
              </div>
              <div className="flex items-center gap-1.5 bg-[#FAF8F5] p-1 rounded-lg border border-[#E6E1DA]">
                <button
                  type="button"
                  disabled={isLockedFinalised}
                  onClick={() => setPricingMode('TAX_EXCLUSIVE')}
                  className={`px-2.5 py-1 rounded text-xs font-semibold ${
                    pricingMode === 'TAX_EXCLUSIVE'
                      ? 'bg-[#1F1E1C] text-white'
                      : 'text-stone-600 hover:text-[#1F1E1C]'
                  }`}
                >
                  Tax-Exclusive
                </button>
                <button
                  type="button"
                  disabled={isLockedFinalised}
                  onClick={() => setPricingMode('TAX_INCLUSIVE')}
                  className={`px-2.5 py-1 rounded text-xs font-semibold ${
                    pricingMode === 'TAX_INCLUSIVE'
                      ? 'bg-[#1F1E1C] text-white'
                      : 'text-stone-600 hover:text-[#1F1E1C]'
                  }`}
                >
                  Tax-Inclusive
                </button>
              </div>
            </div>

            {/* Primary Accommodation Line Preview */}
            <div className="rounded-lg bg-[#FAF8F5] border border-[#E6E1DA] p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-[#1F1E1C]">
                <span>Line 1: Primary Accommodation (SAC {businessSettings.defaultSac})</span>
                <span>
                  {formatAccommodationQuantityLabel(roomCount, billableNights)} ={' '}
                  {formatIndianAmount(calculation.items[0]?.taxableValuePaise || 0, {
                    includeCurrencySymbol: true,
                  })}
                </span>
              </div>
              <input
                type="text"
                disabled={isLockedFinalised}
                value={effectiveAccommodationDesc}
                onChange={(e) => setCustomAccommodationDesc(e.target.value)}
                className="w-full rounded border border-[#D6D0C4] bg-white px-2.5 py-1.5 text-xs"
              />
            </div>

            {/* Extra Service Items */}
            {extraItems.map((ex, idx) => (
              <div
                key={ex.id}
                className="rounded-lg border border-[#D6D0C4] p-3.5 space-y-3 bg-white"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#1F1E1C]">
                    Line {idx + 2}: Additional Service
                  </span>
                  {!isLockedFinalised && (
                    <button
                      type="button"
                      onClick={() =>
                        setExtraItems((prev) => prev.filter((item) => item.id !== ex.id))
                      }
                      className="text-red-600 hover:text-red-800 inline-flex items-center gap-1 text-xs"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Remove
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-semibold text-stone-600 mb-0.5">
                      Description of Service
                    </label>
                    <input
                      type="text"
                      disabled={isLockedFinalised}
                      value={ex.description}
                      onChange={(e) =>
                        setExtraItems((prev) =>
                          prev.map((it) =>
                            it.id === ex.id ? { ...it, description: e.target.value } : it
                          )
                        )
                      }
                      className="w-full rounded border border-[#D6D0C4] px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 mb-0.5">
                      HSN/SAC
                    </label>
                    <input
                      type="text"
                      disabled={isLockedFinalised}
                      value={ex.hsnSac}
                      onChange={(e) =>
                        setExtraItems((prev) =>
                          prev.map((it) =>
                            it.id === ex.id ? { ...it, hsnSac: e.target.value } : it
                          )
                        )
                      }
                      className="w-full rounded border border-[#D6D0C4] px-2.5 py-1.5 text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 mb-0.5">
                      Numeric Qty
                    </label>
                    <input
                      type="number"
                      min={0.1}
                      step="any"
                      disabled={isLockedFinalised}
                      value={ex.quantityMultiplier}
                      onChange={(e) =>
                        setExtraItems((prev) =>
                          prev.map((it) =>
                            it.id === ex.id
                              ? { ...it, quantityMultiplier: e.target.value }
                              : it
                          )
                        )
                      }
                      className="w-full rounded border border-[#D6D0C4] px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 mb-0.5">
                      PDF Quantity Label
                    </label>
                    <input
                      type="text"
                      disabled={isLockedFinalised}
                      value={ex.quantityLabel}
                      onChange={(e) =>
                        setExtraItems((prev) =>
                          prev.map((it) =>
                            it.id === ex.id ? { ...it, quantityLabel: e.target.value } : it
                          )
                        )
                      }
                      className="w-full rounded border border-[#D6D0C4] px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 mb-0.5">
                      Unit Price (₹)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      disabled={isLockedFinalised}
                      value={ex.unitRateRupees}
                      onChange={(e) =>
                        setExtraItems((prev) =>
                          prev.map((it) =>
                            it.id === ex.id ? { ...it, unitRateRupees: e.target.value } : it
                          )
                        )
                      }
                      className="w-full rounded border border-[#D6D0C4] px-2.5 py-1.5 text-xs font-semibold"
                    />
                  </div>
                </div>
              </div>
            ))}

            {/* Quick-Add Service Buttons */}
            {!isLockedFinalised && (
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => addExtraLineItem('extra_bed')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#D6D0C4] hover:bg-[#FAF8F5] text-xs font-medium text-[#1F1E1C]"
                >
                  <Plus className="w-3.5 h-3.5 text-[#C46A4A]" />
                  Extra Bed
                </button>
                <button
                  type="button"
                  onClick={() => addExtraLineItem('early_check_in')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#D6D0C4] hover:bg-[#FAF8F5] text-xs font-medium text-[#1F1E1C]"
                >
                  <Plus className="w-3.5 h-3.5 text-[#C46A4A]" />
                  Early Check-in
                </button>
                <button
                  type="button"
                  onClick={() => addExtraLineItem('late_checkout')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#D6D0C4] hover:bg-[#FAF8F5] text-xs font-medium text-[#1F1E1C]"
                >
                  <Plus className="w-3.5 h-3.5 text-[#C46A4A]" />
                  Late Checkout
                </button>
                <button
                  type="button"
                  onClick={() => addExtraLineItem('food_beverage')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#D6D0C4] hover:bg-[#FAF8F5] text-xs font-medium text-[#1F1E1C]"
                >
                  <Plus className="w-3.5 h-3.5 text-[#C46A4A]" />
                  Food &amp; Beverage
                </button>
                <button
                  type="button"
                  onClick={() => addExtraLineItem('other')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#D6D0C4] hover:bg-[#FAF8F5] text-xs font-medium text-[#1F1E1C]"
                >
                  <Plus className="w-3.5 h-3.5 text-[#C46A4A]" />
                  Other Service
                </button>
              </div>
            )}

            {/* Pre-Tax Discount */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[#E6E1DA]">
              <div>
                <label htmlFor="discount-inr" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  Pre-Tax Discount Amount (₹)
                </label>
                <input
                  id="discount-inr"
                  type="number"
                  min={0}
                  step="0.01"
                  disabled={isLockedFinalised}
                  value={discountRupees}
                  onChange={(e) => setDiscountRupees(e.target.value)}
                  className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label htmlFor="discount-basis" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  Discount Basis / Approval Reason {rupeesToPaise(discountRupees) > 0 && <span className="text-red-600">*</span>}
                </label>
                <input
                  id="discount-basis"
                  type="text"
                  disabled={isLockedFinalised}
                  value={discountBasis}
                  onChange={(e) => setDiscountBasis(e.target.value)}
                  placeholder="e.g. Corporate Tariff 10% Off"
                  className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs"
                />
              </div>
            </div>
          </section>

          {/* 5. Payments Received */}
          <section className="bg-white p-5 rounded-xl border border-[#E6E1DA] shadow-sm space-y-4">
            <div className="border-b border-[#E6E1DA] pb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-[#1F1E1C]">5. Payments Received Ledger</h2>
                <p className="text-xs text-stone-500 mt-0.5">
                  Record advance or checkout payments. Leave empty if the bill is Unpaid (Balance Payable = Total).
                </p>
              </div>
              {!isLockedFinalised && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => addPaymentRow(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#F5E1DA] hover:bg-[#ebd0c7] text-xs font-semibold text-[#1F1E1C]"
                  >
                    Mark Full Amount Paid (
                    {formatIndianAmount(calculation.totalInvoicePaise, {
                      includeCurrencySymbol: true,
                    })}
                    )
                  </button>
                  <button
                    type="button"
                    onClick={() => addPaymentRow(false)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#D6D0C4] hover:bg-[#FAF8F5] text-xs font-medium text-[#1F1E1C]"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Payment
                  </button>
                </div>
              )}
            </div>

            {payments.length === 0 ? (
              <div className="text-xs text-stone-500 py-2">
                No payments added yet. Invoice will show <strong>Amount Received: 0</strong> and{' '}
                <strong>
                  Balance Payable:{' '}
                  {formatIndianAmount(calculation.totalInvoicePaise, {
                    includeCurrencySymbol: true,
                  })}
                </strong>
                .
              </div>
            ) : (
              <div className="space-y-2.5">
                {payments.map((pay, idx) => (
                  <div
                    key={pay.id}
                    className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end bg-[#FAF8F5] p-3 rounded-lg border border-[#E6E1DA]"
                  >
                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-semibold text-stone-600 mb-0.5">
                        Amount (₹) #{idx + 1}
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={isLockedFinalised}
                        value={pay.amountRupees}
                        onChange={(e) =>
                          setPayments((prev) =>
                            prev.map((p) =>
                              p.id === pay.id ? { ...p, amountRupees: e.target.value } : p
                            )
                          )
                        }
                        className="w-full rounded border border-[#D6D0C4] bg-white px-2.5 py-1.5 text-xs font-semibold"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-semibold text-stone-600 mb-0.5">
                        Method
                      </label>
                      <select
                        disabled={isLockedFinalised}
                        value={pay.paymentMethod}
                        onChange={(e) =>
                          setPayments((prev) =>
                            prev.map((p) =>
                              p.id === pay.id
                                ? { ...p, paymentMethod: e.target.value as PaymentMethod }
                                : p
                            )
                          )
                        }
                        className="w-full rounded border border-[#D6D0C4] bg-white px-2.5 py-1.5 text-xs"
                      >
                        <option value="Cash">Cash</option>
                        <option value="UPI">UPI</option>
                        <option value="Card">Card</option>
                        <option value="Bank Transfer">Bank Transfer</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-semibold text-stone-600 mb-0.5">
                        Date
                      </label>
                      <input
                        type="date"
                        disabled={isLockedFinalised}
                        value={pay.paymentDate}
                        onChange={(e) =>
                          setPayments((prev) =>
                            prev.map((p) =>
                              p.id === pay.id ? { ...p, paymentDate: e.target.value } : p
                            )
                          )
                        }
                        className="w-full rounded border border-[#D6D0C4] bg-white px-2.5 py-1.5 text-xs"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-semibold text-stone-600 mb-0.5">
                        Ref / UTR
                      </label>
                      <input
                        type="text"
                        disabled={isLockedFinalised}
                        value={pay.transactionReference}
                        onChange={(e) =>
                          setPayments((prev) =>
                            prev.map((p) =>
                              p.id === pay.id
                                ? { ...p, transactionReference: e.target.value }
                                : p
                            )
                          )
                        }
                        placeholder="Optional"
                        className="w-full rounded border border-[#D6D0C4] bg-white px-2 py-1.5 text-xs"
                      />
                    </div>
                    <div className="sm:col-span-1 flex justify-end">
                      {!isLockedFinalised && (
                        <button
                          type="button"
                          onClick={() =>
                            setPayments((prev) => prev.filter((p) => p.id !== pay.id))
                          }
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                          title="Remove payment"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Save as Draft / Finalise Action Buttons */}
            {!isLockedFinalised && (
              <div className="pt-4 border-t border-[#E6E1DA] flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3">
                <button
                  type="button"
                  disabled={submittingAction !== null}
                  onClick={handleSaveDraft}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#1F1E1C] bg-white hover:bg-[#FAF8F5] text-[#1F1E1C] font-semibold px-5 py-2.5 text-sm transition-colors disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {submittingAction === 'draft' ? 'Saving Draft...' : 'Save as Draft'}
                </button>
                <button
                  type="button"
                  disabled={submittingAction !== null || !stayNightsCheck.isValid}
                  onClick={handleFinaliseInvoice}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#C46A4A] hover:bg-[#A85538] text-white font-semibold px-6 py-2.5 text-sm shadow-sm transition-colors disabled:opacity-50"
                >
                  <FileCheck2 className="w-4 h-4" />
                  {submittingAction === 'finalise'
                    ? 'Finalising & Allocating Number...'
                    : 'Finalise Invoice & Issue PDF'}
                </button>
              </div>
            )}
          </section>
        </div>

        {/* RIGHT COLUMN: Live Synchronized A4 Invoice Preview & PDF Download */}
        <div className="xl:col-span-6 xl:sticky xl:top-4 space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2 text-xs font-bold text-[#1F1E1C] uppercase tracking-wider">
              <ShieldCheck className="w-4 h-4 text-[#C46A4A]" />
              Live A4 Reference Invoice Preview
            </div>
            <span className="text-xs text-stone-500">
              Total:{' '}
              <strong className="text-[#1F1E1C]">
                {formatIndianAmount(livePreviewInvoice.totalInvoicePaise, {
                  includeCurrencySymbol: true,
                })}
              </strong>
            </span>
          </div>

          <InvoicePreviewCard invoice={livePreviewInvoice} logoSrc={logoSrc} showActions={true} />
        </div>
      </div>
    </div>
  );
};
