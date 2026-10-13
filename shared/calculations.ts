import type {
  CalculatedLineItem,
  DocumentType,
  InvoiceLineItemInput,
  OccupancyType,
  PaymentStatus,
  PricingMode,
  RoundingPolicy,
  TaxConfiguration,
} from './types';

/**
 * Converts rupees (number or string) to integer paise safely.
 */
export function rupeesToPaise(rupees: number | string): number {
  const cleaned = typeof rupees === 'string' ? rupees.replace(/,/g, '').trim() : String(rupees);
  if (!cleaned || Number.isNaN(Number(cleaned))) return 0;
  return Math.round(Number(cleaned) * 100);
}

/**
 * Converts integer paise to decimal rupees.
 */
export function paiseToRupees(paise: number): number {
  return Math.round(paise) / 100;
}

/**
 * Formats integer paise using Indian number grouping (e.g. 6,300 or 1,00,800).
 * Whole-rupee amounts omit .00 by default to match the reference invoice PDFs,
 * while non-whole paise amounts always show 2 decimal places.
 */
export function formatIndianAmount(
  paise: number,
  options?: { alwaysShowDecimals?: boolean; includeCurrencySymbol?: boolean }
): string {
  const roundedPaise = Math.round(paise);
  const isNegative = roundedPaise < 0;
  const absPaise = Math.abs(roundedPaise);
  const wholeRupees = Math.floor(absPaise / 100);
  const remainderPaise = absPaise % 100;

  const numStr = String(wholeRupees);
  let grouped = '';
  if (numStr.length <= 3) {
    grouped = numStr;
  } else {
    const lastThree = numStr.slice(-3);
    const otherNumbers = numStr.slice(0, -3);
    grouped = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + lastThree;
  }

  const showDecimals = options?.alwaysShowDecimals || remainderPaise !== 0;
  const decimalPart = showDecimals ? `.${String(remainderPaise).padStart(2, '0')}` : '';
  const prefix = options?.includeCurrencySymbol ? '₹' : '';
  return `${isNegative ? '-' : ''}${prefix}${grouped}${decimalPart}`;
}

/**
 * Formats basis points (e.g. 250 -> "2.5%", 900 -> "9%", 500 -> "5%").
 */
export function formatRateBps(bps: number): string {
  const pct = bps / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

/**
 * Formats quantity label for accommodation matching Reference PDFs:
 * "1 Room × 2 Nights" or "12 Rooms × 2 Nights"
 */
export function formatAccommodationQuantityLabel(roomCount: number, billableNights: number): string {
  const rLabel = roomCount === 1 ? '1 Room' : `${roomCount} Rooms`;
  const nLabel = billableNights === 1 ? '1 Night' : `${billableNights} Nights`;
  return `${rLabel} × ${nLabel}`;
}

/**
 * Formats default accommodation description matching Reference PDFs:
 * "Hotel Accommodation – Single Occupancy" / "Hotel Accommodation – Double Occupancy"
 */
export function formatAccommodationDescription(
  occupancyType: OccupancyType,
  customOccupancyLabel?: string | null,
  roomNumbers?: string | null
): string {
  const occ =
    occupancyType === 'Custom' && customOccupancyLabel?.trim()
      ? customOccupancyLabel.trim()
      : `${occupancyType} Occupancy`;
  const base = `Hotel Accommodation – ${occ}`;
  if (roomNumbers && roomNumbers.trim()) {
    return `${base} (Room: ${roomNumbers.trim()})`;
  }
  return base;
}

export interface InvoiceCalculationInput {
  documentType: DocumentType;
  pricingMode: PricingMode;
  roundingPolicy: RoundingPolicy;
  discountPaise: number;
  items: InvoiceLineItemInput[];
  taxConfigs: TaxConfiguration[];
  defaultTaxRuleCode: string;
  amountReceivedPaise: number;
}

export interface InvoiceCalculationResult {
  items: CalculatedLineItem[];
  subtotalPreDiscountPaise: number;
  discountPaise: number;
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
}

/**
 * Authoritative deterministic money & GST calculator (runs identically on server and client).
 *
 * Rounding & Tax Policy:
 * - All monetary values are integer paise (1 INR = 100 paise).
 * - For TAX_INCLUSIVE items, pre-tax value is derived via `Math.round((gross * 10000) / (10000 + totalRateBps))`.
 *   GST is never added twice.
 * - Pre-tax discounts (`discountPaise`) are subtracted before tax and distributed proportionally across line items.
 * - Under `per_line` rounding policy (default), CGST/SGST/IGST are rounded to integer paise per line and summed.
 *   When a tax-inclusive line has zero discount and equal CGST/SGST rates, `cgstPaise + sgstPaise` is constrained
 *   to equal `grossLinePaise - taxableValuePaise` so the total never drifts from the tax-inclusive price.
 * - Under `per_invoice` rounding policy, line taxable values are summed first and CGST/SGST/IGST are rounded once
 *   at the invoice summary level.
 */
export function calculateInvoiceTotals(input: InvoiceCalculationInput): InvoiceCalculationResult {
  const isNonGst = input.documentType === 'NON_GST_DOCUMENT';
  const configByCode = new Map(input.taxConfigs.map((c) => [c.code, c]));
  const configById = new Map(input.taxConfigs.map((c) => [c.id, c]));
  const configByCategory = new Map(
    input.taxConfigs.filter((c) => c.isActive && c.isDefault).map((c) => [c.serviceCategory, c])
  );

  // Step 1: Resolve pre-discount pre-tax subtotal for each line item
  const resolvedLines = input.items.map((item, idx) => {
    const linePricingMode = item.pricingMode ?? input.pricingMode;
    let taxConfig: TaxConfiguration | undefined;

    if (isNonGst) {
      taxConfig = configByCode.get('NON_GST_EXEMPT_0PCT');
    } else if (item.taxConfigId && configById.has(item.taxConfigId)) {
      taxConfig = configById.get(item.taxConfigId);
    } else if (item.taxCode && configByCode.has(item.taxCode)) {
      taxConfig = configByCode.get(item.taxCode);
    } else if (input.defaultTaxRuleCode === 'ADMIN_INTERSTATE_IGST_5PCT' && configByCode.has('ADMIN_INTERSTATE_IGST_5PCT')) {
      taxConfig = configByCode.get('ADMIN_INTERSTATE_IGST_5PCT');
    } else {
      taxConfig =
        configByCategory.get(item.serviceType) ??
        configByCode.get(input.defaultTaxRuleCode) ??
        configByCode.get('ODISHA_ACCOMMODATION_5PCT');
    }

    const cgstRateBps = isNonGst ? 0 : (taxConfig?.cgstRateBps ?? 250);
    const sgstRateBps = isNonGst ? 0 : (taxConfig?.sgstRateBps ?? 250);
    const igstRateBps = isNonGst ? 0 : (taxConfig?.igstRateBps ?? 0);
    const totalRateBps = cgstRateBps + sgstRateBps + igstRateBps;

    const isAccommodation = item.serviceType === 'accommodation' && item.roomCount && item.nightsCount;
    const multiplier = isAccommodation
      ? Number(item.roomCount) * Number(item.nightsCount)
      : Number(item.quantityMultiplier || 1);

    const quantityLabel =
      item.quantityLabel?.trim() ||
      (isAccommodation
        ? formatAccommodationQuantityLabel(Number(item.roomCount), Number(item.nightsCount))
        : `${multiplier}`);

    const enteredUnitRatePaise = Math.max(0, Math.round(item.enteredUnitRatePaise || 0));
    const grossEnteredLinePaise = Math.round(multiplier * enteredUnitRatePaise);

    let preTaxUnitRatePaise = enteredUnitRatePaise;
    let lineSubtotalPaise = grossEnteredLinePaise;

    if (linePricingMode === 'TAX_INCLUSIVE' && totalRateBps > 0) {
      lineSubtotalPaise = Math.round((grossEnteredLinePaise * 10000) / (10000 + totalRateBps));
      preTaxUnitRatePaise = multiplier > 0 ? Math.round(lineSubtotalPaise / multiplier) : 0;
    }

    return {
      raw: item,
      sortOrder: idx + 1,
      quantityLabel,
      multiplier,
      enteredUnitRatePaise,
      linePricingMode,
      preTaxUnitRatePaise,
      grossEnteredLinePaise,
      lineSubtotalPaise,
      taxConfigId: taxConfig?.id ?? null,
      taxCode: taxConfig?.code ?? (isNonGst ? 'NON_GST_EXEMPT_0PCT' : 'ODISHA_ACCOMMODATION_5PCT'),
      cgstRateBps,
      sgstRateBps,
      igstRateBps,
      totalRateBps,
    };
  });

  const subtotalPreDiscountPaise = resolvedLines.reduce((sum, l) => sum + l.lineSubtotalPaise, 0);
  const boundedDiscountPaise = Math.max(0, Math.min(Math.round(input.discountPaise || 0), subtotalPreDiscountPaise));

  // Step 2: Allocate pre-tax discount proportionally across lines
  let remainingDiscount = boundedDiscountPaise;
  const calculatedItems: CalculatedLineItem[] = resolvedLines.map((line, index) => {
    let lineDiscountPaise = 0;
    if (boundedDiscountPaise > 0 && subtotalPreDiscountPaise > 0) {
      if (index === resolvedLines.length - 1) {
        lineDiscountPaise = remainingDiscount;
      } else {
        lineDiscountPaise = Math.round((boundedDiscountPaise * line.lineSubtotalPaise) / subtotalPreDiscountPaise);
        remainingDiscount -= lineDiscountPaise;
      }
    }

    const taxableValuePaise = Math.max(0, line.lineSubtotalPaise - lineDiscountPaise);

    let cgstPaise = 0;
    let sgstPaise = 0;
    let igstPaise = 0;

    if (!isNonGst && line.totalRateBps > 0) {
      if (line.linePricingMode === 'TAX_INCLUSIVE' && lineDiscountPaise === 0) {
        // Exact reconciliation so taxable + tax === grossEnteredLinePaise
        const exactTaxTotal = line.grossEnteredLinePaise - taxableValuePaise;
        if (line.igstRateBps > 0) {
          igstPaise = exactTaxTotal;
        } else {
          cgstPaise = Math.floor(exactTaxTotal / 2);
          sgstPaise = exactTaxTotal - cgstPaise;
        }
      } else {
        cgstPaise = Math.round((taxableValuePaise * line.cgstRateBps) / 10000);
        sgstPaise = Math.round((taxableValuePaise * line.sgstRateBps) / 10000);
        igstPaise = Math.round((taxableValuePaise * line.igstRateBps) / 10000);
      }
    }

    const lineTotalPaise = taxableValuePaise + cgstPaise + sgstPaise + igstPaise;

    return {
      id: line.raw.id || `item-${index + 1}`,
      sortOrder: line.sortOrder,
      serviceType: line.raw.serviceType,
      description: line.raw.description,
      hsnSac: line.raw.hsnSac || '996311',
      quantityLabel: line.quantityLabel,
      quantityMultiplier: line.multiplier,
      roomCount: line.raw.roomCount ?? null,
      nightsCount: line.raw.nightsCount ?? null,
      enteredUnitRatePaise: line.enteredUnitRatePaise,
      pricingMode: line.linePricingMode,
      preTaxUnitRatePaise: line.preTaxUnitRatePaise,
      lineSubtotalPaise: line.lineSubtotalPaise,
      lineDiscountPaise,
      taxableValuePaise,
      taxConfigId: line.taxConfigId,
      taxCode: line.taxCode,
      cgstRateBps: line.cgstRateBps,
      sgstRateBps: line.sgstRateBps,
      igstRateBps: line.igstRateBps,
      cgstPaise,
      sgstPaise,
      igstPaise,
      lineTotalPaise,
    };
  });

  const taxableValuePaise = calculatedItems.reduce((acc, item) => acc + item.taxableValuePaise, 0);

  // Determine primary tax rates for invoice summary display
  const primaryItem = calculatedItems[0];
  const cgstRateBps = isNonGst ? 0 : (primaryItem?.cgstRateBps ?? 250);
  const sgstRateBps = isNonGst ? 0 : (primaryItem?.sgstRateBps ?? 250);
  const igstRateBps = isNonGst ? 0 : (primaryItem?.igstRateBps ?? 0);

  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;

  if (!isNonGst) {
    if (input.roundingPolicy === 'per_invoice') {
      // Group taxable amounts by rate and round once per invoice
      cgstPaise = Math.round(
        calculatedItems.reduce((acc, item) => acc + (item.taxableValuePaise * item.cgstRateBps) / 10000, 0)
      );
      sgstPaise = Math.round(
        calculatedItems.reduce((acc, item) => acc + (item.taxableValuePaise * item.sgstRateBps) / 10000, 0)
      );
      igstPaise = Math.round(
        calculatedItems.reduce((acc, item) => acc + (item.taxableValuePaise * item.igstRateBps) / 10000, 0)
      );
    } else {
      cgstPaise = calculatedItems.reduce((acc, item) => acc + item.cgstPaise, 0);
      sgstPaise = calculatedItems.reduce((acc, item) => acc + item.sgstPaise, 0);
      igstPaise = calculatedItems.reduce((acc, item) => acc + item.igstPaise, 0);
    }
  }

  const totalTaxPaise = cgstPaise + sgstPaise + igstPaise;
  const totalInvoicePaise = taxableValuePaise + totalTaxPaise;
  const amountReceivedPaise = Math.max(0, Math.round(input.amountReceivedPaise || 0));

  const balancePayablePaise = Math.max(0, totalInvoicePaise - amountReceivedPaise);
  const creditRefundDuePaise = Math.max(0, amountReceivedPaise - totalInvoicePaise);

  let paymentStatus: PaymentStatus = 'Unpaid';
  if (totalInvoicePaise === 0 || amountReceivedPaise >= totalInvoicePaise) {
    paymentStatus = 'Paid';
  } else if (amountReceivedPaise > 0) {
    paymentStatus = 'Partially Paid';
  }

  return {
    items: calculatedItems,
    subtotalPreDiscountPaise,
    discountPaise: boundedDiscountPaise,
    taxableValuePaise,
    cgstRateBps,
    sgstRateBps,
    igstRateBps,
    cgstPaise,
    sgstPaise,
    igstPaise,
    totalTaxPaise,
    totalInvoicePaise,
    amountReceivedPaise,
    balancePayablePaise,
    creditRefundDuePaise,
    paymentStatus,
  };
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigitsToWords(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return `${TENS[t]}${o ? ' ' + ONES[o] : ''}`;
}

function threeDigitsToWords(n: number): string {
  const h = Math.floor(n / 100);
  const rem = n % 100;
  const hPart = h > 0 ? `${ONES[h]} Hundred` : '';
  const rPart = rem > 0 ? twoDigitsToWords(rem) : '';
  return [hPart, rPart].filter(Boolean).join(' ');
}

/**
 * Converts integer paise into Indian Rupee words (e.g. "INR One Lakh Eight Hundred Only").
 */
export function amountInWordsINR(paise: number): string {
  const rounded = Math.max(0, Math.round(paise));
  const rupees = Math.floor(rounded / 100);
  const paisePart = rounded % 100;

  if (rupees === 0 && paisePart === 0) return 'INR Zero Only';

  const parts: string[] = [];
  let rem = rupees;

  const crore = Math.floor(rem / 10000000);
  rem %= 10000000;
  const lakh = Math.floor(rem / 100000);
  rem %= 100000;
  const thousand = Math.floor(rem / 1000);
  rem %= 1000;
  const hundredBelow = rem;

  if (crore > 0) parts.push(`${threeDigitsToWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${twoDigitsToWords(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${twoDigitsToWords(thousand)} Thousand`);
  if (hundredBelow > 0) parts.push(threeDigitsToWords(hundredBelow));

  const rupeeWords = parts.join(' ');
  const paiseWords = paisePart > 0 ? ` and ${twoDigitsToWords(paisePart)} Paise` : '';
  return `INR ${rupeeWords || 'Zero'}${paiseWords} Only`;
}
