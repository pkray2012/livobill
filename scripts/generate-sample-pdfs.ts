import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { renderInvoicePdfBuffer } from '../netlify/functions/_lib/pdf-server';
import { calculateInvoiceTotals, rupeesToPaise } from '../shared/calculations';
import { DEFAULT_BUSINESS_SETTINGS, DEFAULT_TAX_CONFIGURATIONS } from '../shared/defaults';
import type { InvoiceRecord, InvoiceLineItemInput } from '../shared/types';

const ARTIFACT_DIR =
  '/Users/pradiptakumarray/.gemini/antigravity/brain/ad57aecc-09af-4e6c-934d-de3326a12f0d';
const SCRATCH_DIR = path.join(ARTIFACT_DIR, 'scratch/pdf-verification');

function buildSampleInvoiceRecord(params: {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  guestName: string;
  companyName: string | null;
  billingAddress: string;
  customerStateName: string;
  customerStateCode: string;
  customerGstin: string | null;
  customerPan?: string | null;
  customerCin?: string | null;
  checkInAt: string;
  checkOutAt: string;
  showStayTimes: boolean;
  roomCount: number;
  billableNights: number;
  occupancyType: 'Single' | 'Double' | 'Triple' | 'Custom';
  ratePerRoomPaise: number;
  items: InvoiceLineItemInput[];
  amountReceivedPaise: number;
}): InvoiceRecord {
  const calc = calculateInvoiceTotals({
    documentType: 'GST_TAX_INVOICE',
    pricingMode: 'TAX_EXCLUSIVE',
    roundingPolicy: 'per_line',
    discountPaise: 0,
    items: params.items,
    taxConfigs: DEFAULT_TAX_CONFIGURATIONS,
    defaultTaxRuleCode: 'ODISHA_ACCOMMODATION_5PCT',
    amountReceivedPaise: params.amountReceivedPaise,
  });

  return {
    id: params.id,
    invoiceNumber: params.invoiceNumber,
    seriesId: '22222222-2222-4222-8222-222222222201',
    sequenceNumber: 1,
    financialYear: '26-27',
    status: 'Finalised',
    customerClassification: params.customerGstin ? 'B2B' : 'B2C',
    documentType: 'GST_TAX_INVOICE',
    documentTitle: 'TAX INVOICE',
    nonGstReason: null,
    taxRuleCode: 'ODISHA_ACCOMMODATION_5PCT',
    placeOfSupply: 'Odisha (21)',
    invoiceDate: params.invoiceDate,
    customerId: null,
    guestName: params.guestName,
    companyName: params.companyName,
    billingAddress: params.billingAddress,
    customerStateName: params.customerStateName,
    customerStateCode: params.customerStateCode,
    customerGstin: params.customerGstin,
    customerPan: params.customerPan ?? null,
    customerCin: params.customerCin ?? null,
    customerMobile: null,
    customerEmail: null,
    bookingReference: null,
    checkInAt: params.checkInAt,
    checkOutAt: params.checkOutAt,
    showStayTimes: params.showStayTimes,
    suggestedNights: params.billableNights,
    billableNights: params.billableNights,
    billableNightsOverrideReason: null,
    roomCount: params.roomCount,
    roomNumbers: null,
    occupancyType: params.occupancyType,
    customOccupancyLabel: null,
    ratePerRoomPaise: params.ratePerRoomPaise,
    stayNotes: null,
    pricingMode: 'TAX_EXCLUSIVE',
    roundingPolicy: 'per_line',
    discountPaise: 0,
    discountBasis: null,
    subtotalPreDiscountPaise: calc.subtotalPreDiscountPaise,
    taxableValuePaise: calc.taxableValuePaise,
    cgstRateBps: calc.cgstRateBps,
    sgstRateBps: calc.sgstRateBps,
    igstRateBps: calc.igstRateBps,
    cgstPaise: calc.cgstPaise,
    sgstPaise: calc.sgstPaise,
    igstPaise: calc.igstPaise,
    totalTaxPaise: calc.totalTaxPaise,
    totalInvoicePaise: calc.totalInvoicePaise,
    amountReceivedPaise: calc.amountReceivedPaise,
    balancePayablePaise: calc.balancePayablePaise,
    creditRefundDuePaise: calc.creditRefundDuePaise,
    paymentStatus: calc.paymentStatus,
    businessSnapshot: DEFAULT_BUSINESS_SETTINGS,
    taxSnapshot: {
      ruleCode: 'ODISHA_ACCOMMODATION_5PCT',
      taxMode: 'cgst_sgst',
      cgstRateBps: 250,
      sgstRateBps: 250,
      igstRateBps: 0,
      roundingPolicy: 'per_line',
    },
    logoVersionId: '33333333-3333-4333-8333-333333333301',
    templateVersion: 'v1.0-reference-a4',
    originalPdfBlobKey: null,
    latestPaymentSummaryPdfBlobKey: null,
    finalisedAt: new Date().toISOString(),
    finalisedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    duplicatedFromInvoiceId: null,
    createdBy: null,
    createdByName: 'Verification Script',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: calc.items,
    payments: [
      {
        id: 'pay-sample-1',
        invoiceId: params.id,
        amountPaise: params.amountReceivedPaise,
        paymentDate: params.invoiceDate,
        paymentMethod: 'Bank Transfer',
        transactionReference: 'NEFT-SAMPLE-VERIFY',
        notes: null,
        isInitialAtFinalisation: true,
        recordedBy: null,
        recordedByName: 'System',
        recordedAt: new Date().toISOString(),
      },
    ],
  };
}

function renderPdfToPng(pdfPath: string, outPngPath: string) {
  execFileSync('/usr/bin/sips', ['-s', 'format', 'png', pdfPath, '--out', outPngPath], {
    stdio: 'pipe',
  });
}

async function main() {
  fs.mkdirSync(SCRATCH_DIR, { recursive: true });

  // 1. Sample 1: Matches Reference PDF 1 (12 Rooms × 2 Nights @ ₹4,000 = ₹96,000, Total ₹1,00,800)
  // Using clearly labelled fictional test customer data as required
  const sample1 = buildSampleInvoiceRecord({
    id: 'sample-1',
    invoiceNumber: 'LPH/26-27/0020',
    invoiceDate: '2026-04-08',
    guestName: 'Vikramaditya Sen (Fictional Test Guest)',
    companyName: 'APEX INDUSTRIAL INFRASTRUCTURE LTD (FICTIONAL TEST CORP)',
    billingAddress: 'Plot No. 42, Industrial Estate, Sector-A\nRanchi - 834002, Jharkhand',
    customerStateName: 'Jharkhand',
    customerStateCode: '20',
    customerGstin: '20AAECJ0224G1ZD',
    customerPan: 'AAECJ0224G',
    customerCin: 'U27100JH2020PLC014200',
    checkInAt: '2026-04-05T23:00',
    checkOutAt: '2026-04-07T05:00',
    showStayTimes: true,
    roomCount: 12,
    billableNights: 2,
    occupancyType: 'Double',
    ratePerRoomPaise: rupeesToPaise(4000),
    items: [
      {
        serviceType: 'accommodation',
        description: 'Hotel Accommodation – Double Occupancy',
        hsnSac: '996311',
        quantityLabel: '12 Rooms × 2 Nights',
        quantityMultiplier: 24,
        roomCount: 12,
        nightsCount: 2,
        enteredUnitRatePaise: rupeesToPaise(4000),
        pricingMode: 'TAX_EXCLUSIVE',
        taxCode: 'ODISHA_ACCOMMODATION_5PCT',
      },
    ],
    amountReceivedPaise: rupeesToPaise(100800),
  });

  // 2. Sample 2: Matches Reference PDF 2 (1 Room × 2 Nights @ ₹3,000 = ₹6,000, Total ₹6,300)
  // Corrects Reference PDF 2's accidental defects (missing colon, overlapping dash, incomplete 13-char GSTIN, and missing Balance Payable row)
  const sample2 = buildSampleInvoiceRecord({
    id: 'sample-2',
    invoiceNumber: 'LPH/26-27/0011',
    invoiceDate: '2026-04-08',
    guestName: 'Siddharth Mohapatra (Fictional Test Guest)',
    companyName: 'KALINGA STEEL & POWER ENTERPRISES LTD (TEST SAMPLE)',
    billingAddress: 'Janpath Road, Saheed Nagar, Bhubaneswar - 751007',
    customerStateName: 'Odisha',
    customerStateCode: '21',
    customerGstin: '21BREPR9585B1ZO',
    checkInAt: '2026-04-06T12:00',
    checkOutAt: '2026-04-08T11:00',
    showStayTimes: false,
    roomCount: 1,
    billableNights: 2,
    occupancyType: 'Single',
    ratePerRoomPaise: rupeesToPaise(3000),
    items: [
      {
        serviceType: 'accommodation',
        description: 'Hotel Accommodation – Single Occupancy',
        hsnSac: '996311',
        quantityLabel: '1 Room × 2 Nights',
        quantityMultiplier: 2,
        roomCount: 1,
        nightsCount: 2,
        enteredUnitRatePaise: rupeesToPaise(3000),
        pricingMode: 'TAX_EXCLUSIVE',
        taxCode: 'ODISHA_ACCOMMODATION_5PCT',
      },
    ],
    amountReceivedPaise: rupeesToPaise(6300),
  });

  // 3. Sample 3: Multi-page stress test with long customer name, address, and 16 line items
  const manyItems: InvoiceLineItemInput[] = Array.from({ length: 16 }, (_, idx) => ({
    serviceType: idx === 0 ? 'accommodation' : 'food_beverage',
    description:
      idx === 0
        ? 'Hotel Accommodation – Executive Double Occupancy Suite (Rooms 201, 202, 203)'
        : `In-Room Dining & Conference Refreshment Service – Batch #${idx} (Continental & Odia Executive Platter)`,
    hsnSac: idx === 0 ? '996311' : '996331',
    quantityLabel: idx === 0 ? '3 Rooms × 2 Nights' : `${idx + 1} Orders`,
    quantityMultiplier: idx === 0 ? 6 : idx + 1,
    enteredUnitRatePaise: rupeesToPaise(idx === 0 ? 3500 : 450),
    pricingMode: 'TAX_EXCLUSIVE',
    taxCode: idx === 0 ? 'ODISHA_ACCOMMODATION_5PCT' : 'ODISHA_FOOD_BEVERAGE_5PCT',
  }));

  const sample3 = buildSampleInvoiceRecord({
    id: 'sample-3',
    invoiceNumber: 'LPH/26-27/0025',
    invoiceDate: '2026-04-10',
    guestName: 'Dr. Ananya Priyadarshini & Delegation (Fictional Test)',
    companyName:
      'EASTERN INDIA RENEWABLE ENERGY & MARITIME LOGISTICS CORPORATION LIMITED (FICTIONAL TEST ENTITY)',
    billingAddress:
      'Tower-B, 9th Floor, Technology Corridor, Chandaka Industrial Estate, Patia, Bhubaneswar – 751024, Odisha, India',
    customerStateName: 'Odisha',
    customerStateCode: '21',
    customerGstin: '21BREPR9585B1ZO',
    checkInAt: '2026-04-08T12:00',
    checkOutAt: '2026-04-10T11:00',
    showStayTimes: true,
    roomCount: 3,
    billableNights: 2,
    occupancyType: 'Double',
    ratePerRoomPaise: rupeesToPaise(3500),
    items: manyItems,
    amountReceivedPaise: rupeesToPaise(25000),
  });

  const samples = [
    { name: 'sample-1-group-12rooms-100800', record: sample1 },
    { name: 'sample-2-single-room-6300', record: sample2 },
    { name: 'sample-3-multipage-stress-test', record: sample3 },
  ];

  for (const s of samples) {
    const buf = await renderInvoicePdfBuffer(s.record);
    const pdfPath = path.join(SCRATCH_DIR, `${s.name}.pdf`);
    const pngPath = path.join(SCRATCH_DIR, `${s.name}.png`);
    fs.writeFileSync(pdfPath, buf);
    renderPdfToPng(pdfPath, pngPath);
    console.log(`Generated ${pdfPath} (${buf.length} bytes) and ${pngPath}`);
  }

  // Also convert the two uploaded reference PDFs to PNGs for direct side-by-side visual inspection
  const ref1Pdf = path.join(ARTIFACT_DIR, '.user_uploaded/media_1791865398875_cfaef3b5.pdf');
  const ref2Pdf = path.join(ARTIFACT_DIR, '.user_uploaded/media_1791865409841_4e89897f.pdf');
  if (fs.existsSync(ref1Pdf)) {
    renderPdfToPng(ref1Pdf, path.join(SCRATCH_DIR, 'reference-1-uploaded.png'));
  }
  if (fs.existsSync(ref2Pdf)) {
    renderPdfToPng(ref2Pdf, path.join(SCRATCH_DIR, 'reference-2-uploaded.png'));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
