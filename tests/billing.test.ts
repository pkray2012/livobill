import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateInvoiceTotals,
  formatIndianAmount,
  amountInWordsINR,
  rupeesToPaise,
} from '../shared/calculations';
import { calculateStayNights } from '../shared/dates';
import { validateGstin, validateGstInvoiceNumber } from '../shared/gstin';
import { DEFAULT_TAX_CONFIGURATIONS } from '../shared/defaults';
import { resetTestDatabase } from '../netlify/functions/_lib/db';
import apiHandler from '../netlify/functions/api.mts';

describe('1. Financial & GST Calculations (Integer Paise)', () => {
  it('calculates Reference 2 math: 1 room × 2 nights × ₹3,000 = ₹6,000, CGST ₹150, SGST ₹150, Total ₹6,300, Balance ₹0', () => {
    const result = calculateInvoiceTotals({
      documentType: 'GST_TAX_INVOICE',
      pricingMode: 'TAX_EXCLUSIVE',
      roundingPolicy: 'per_line',
      discountPaise: 0,
      items: [
        {
          serviceType: 'accommodation',
          description: 'Hotel Accommodation Charges (Double Occupancy – 1 Room for 2 Nights)',
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
      taxConfigs: DEFAULT_TAX_CONFIGURATIONS,
      defaultTaxRuleCode: 'ODISHA_ACCOMMODATION_5PCT',
      amountReceivedPaise: rupeesToPaise(6300),
    });

    expect(result.taxableValuePaise).toBe(600000); // ₹6,000
    expect(result.cgstPaise).toBe(15000); // ₹150
    expect(result.sgstPaise).toBe(15000); // ₹150
    expect(result.igstPaise).toBe(0);
    expect(result.totalTaxPaise).toBe(30000); // ₹300
    expect(result.totalInvoicePaise).toBe(630000); // ₹6,300
    expect(result.amountReceivedPaise).toBe(630000); // ₹6,300
    expect(result.balancePayablePaise).toBe(0); // ₹0
    expect(result.paymentStatus).toBe('Paid');
    expect(formatIndianAmount(result.totalInvoicePaise)).toBe('6,300');
  });

  it('calculates Reference 1 math: 12 rooms × 2 nights × ₹4,000 = ₹96,000, CGST ₹2,400, SGST ₹2,400, Total ₹1,00,800', () => {
    const result = calculateInvoiceTotals({
      documentType: 'GST_TAX_INVOICE',
      pricingMode: 'TAX_EXCLUSIVE',
      roundingPolicy: 'per_line',
      discountPaise: 0,
      items: [
        {
          serviceType: 'accommodation',
          description: 'Hotel Accommodation Charges (Double Occupancy – 12 Rooms for 2 Nights)',
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
      taxConfigs: DEFAULT_TAX_CONFIGURATIONS,
      defaultTaxRuleCode: 'ODISHA_ACCOMMODATION_5PCT',
      amountReceivedPaise: rupeesToPaise(100800),
    });

    expect(result.taxableValuePaise).toBe(9600000); // ₹96,000
    expect(result.cgstPaise).toBe(240000); // ₹2,400
    expect(result.sgstPaise).toBe(240000); // ₹2,400
    expect(result.totalInvoicePaise).toBe(10080000); // ₹1,00,800
    expect(result.balancePayablePaise).toBe(0);
    expect(formatIndianAmount(result.totalInvoicePaise)).toBe('1,00,800');
    expect(amountInWordsINR(result.totalInvoicePaise)).toContain('One Lakh Eight Hundred');
  });

  it('correctly derives pre-tax taxable amount in TAX_INCLUSIVE mode without double-charging GST', () => {
    // ₹6,300 inclusive of 5% GST (1 room × 2 nights @ ₹3,150 inclusive/night)
    const result = calculateInvoiceTotals({
      documentType: 'GST_TAX_INVOICE',
      pricingMode: 'TAX_INCLUSIVE',
      roundingPolicy: 'per_line',
      discountPaise: 0,
      items: [
        {
          serviceType: 'accommodation',
          description: 'Inclusive Stay',
          hsnSac: '996311',
          quantityMultiplier: 2,
          enteredUnitRatePaise: rupeesToPaise(3150),
          pricingMode: 'TAX_INCLUSIVE',
          taxCode: 'ODISHA_ACCOMMODATION_5PCT',
        },
      ],
      taxConfigs: DEFAULT_TAX_CONFIGURATIONS,
      defaultTaxRuleCode: 'ODISHA_ACCOMMODATION_5PCT',
      amountReceivedPaise: 0,
    });

    expect(result.taxableValuePaise).toBe(600000); // ₹6,000
    expect(result.cgstPaise).toBe(15000); // ₹150
    expect(result.sgstPaise).toBe(15000); // ₹150
    expect(result.totalInvoicePaise).toBe(630000); // ₹6,300 (matches gross inclusive input)
  });

  it('handles pre-tax discounts, partial payments, and overpayments (credit/refund due)', () => {
    const partialResult = calculateInvoiceTotals({
      documentType: 'GST_TAX_INVOICE',
      pricingMode: 'TAX_EXCLUSIVE',
      roundingPolicy: 'per_invoice',
      discountPaise: rupeesToPaise(1000),
      items: [
        {
          serviceType: 'accommodation',
          description: 'Stay with ₹1,000 pre-tax discount',
          hsnSac: '996311',
          quantityMultiplier: 2,
          enteredUnitRatePaise: rupeesToPaise(3500), // ₹7,000 pre-discount
          pricingMode: 'TAX_EXCLUSIVE',
        },
      ],
      taxConfigs: DEFAULT_TAX_CONFIGURATIONS,
      defaultTaxRuleCode: 'ODISHA_ACCOMMODATION_5PCT',
      amountReceivedPaise: rupeesToPaise(2000),
    });

    expect(partialResult.subtotalPreDiscountPaise).toBe(700000); // ₹7,000
    expect(partialResult.taxableValuePaise).toBe(600000); // ₹6,000 after ₹1,000 pre-tax discount
    expect(partialResult.totalInvoicePaise).toBe(630000); // ₹6,300
    expect(partialResult.balancePayablePaise).toBe(430000); // ₹4,300 remaining
    expect(partialResult.paymentStatus).toBe('Partially Paid');

    // Overpayment test
    const overpaidResult = calculateInvoiceTotals({
      documentType: 'GST_TAX_INVOICE',
      pricingMode: 'TAX_EXCLUSIVE',
      roundingPolicy: 'per_line',
      discountPaise: 0,
      items: [
        {
          serviceType: 'accommodation',
          description: 'Stay',
          hsnSac: '996311',
          quantityMultiplier: 2,
          enteredUnitRatePaise: rupeesToPaise(3000),
          pricingMode: 'TAX_EXCLUSIVE',
        },
      ],
      taxConfigs: DEFAULT_TAX_CONFIGURATIONS,
      defaultTaxRuleCode: 'ODISHA_ACCOMMODATION_5PCT',
      amountReceivedPaise: rupeesToPaise(7000), // ₹700 excess
    });

    expect(overpaidResult.balancePayablePaise).toBe(0);
    expect(overpaidResult.creditRefundDuePaise).toBe(70000); // ₹700 credit/refund due
    expect(overpaidResult.paymentStatus).toBe('Paid');
  });
});

describe('2. GSTIN Structural & Checksum Validation & Invoice Numbering', () => {
  it('validates official 15-character GSTINs and rejects incomplete 13-character GSTINs from Reference 2', () => {
    const supplierGstin = validateGstin(' 21brepr9585b1zo ');
    expect(supplierGstin.isValid).toBe(true);
    expect(supplierGstin.normalized).toBe('21BREPR9585B1ZO');
    expect(supplierGstin.stateCode).toBe('21');

    const jspGstin = validateGstin('20AAECJ0224G1ZD');
    expect(jspGstin.isValid).toBe(true);

    // Incomplete 13-character GSTIN visible in Reference PDF 2 must be rejected
    const incompleteRef2 = validateGstin('21AAACS8577K1');
    expect(incompleteRef2.isValid).toBe(false);
    expect(incompleteRef2.error).toContain('15 characters');

    // Invalid checksum character
    const badChecksum = validateGstin('20AAECJ0224G1ZZ');
    expect(badChecksum.isValid).toBe(false);
    expect(badChecksum.error).toContain('checksum');
  });

  it('enforces CGST Rule 46(b) 16-character limit on invoice numbers', () => {
    expect(validateGstInvoiceNumber('LPH/26-27/0001').isValid).toBe(true);
    expect(validateGstInvoiceNumber('LPH/2026-2027/000001').isValid).toBe(false);
  });
});

describe('3. Asia/Kolkata Local Calendar-Date Stay Night Calculation', () => {
  it('computes calendar-date nights accurately instead of rounding 24-hour blocks', () => {
    // 05 Apr 2026 11:00 PM to 07 Apr 2026 05:00 AM is only 30 elapsed hours,
    // but spans 2 local calendar nights (05->06 and 06->07).
    const calc = calculateStayNights('2026-04-05T23:00', '2026-04-07T05:00');
    expect(calc.isValid).toBe(true);
    expect(calc.suggestedNights).toBe(2);

    // Same-day check-in / check-out suggests 1 night minimum
    const sameDay = calculateStayNights('2026-04-10T09:00', '2026-04-10T18:00');
    expect(sameDay.isValid).toBe(true);
    expect(sameDay.suggestedNights).toBe(1);

    // Check-out before check-in is invalid
    const invalidRange = calculateStayNights('2026-04-10T12:00', '2026-04-09T11:00');
    expect(invalidRange.isValid).toBe(false);
  });
});

describe('4. Full Backend API: Bootstrap, RBAC, Night Override, Atomic Numbering & Payment Preservation', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  async function callApi(
    path: string,
    options: {
      method?: string;
      body?: any;
      cookie?: string;
      csrfToken?: string;
    } = {}
  ) {
    const headers: Record<string, string> = {
      Origin: 'http://localhost:8888',
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.cookie) {
      headers['Cookie'] = options.cookie;
    }
    if (options.csrfToken) {
      headers['X-CSRF-Token'] = options.csrfToken;
    }
    const req = new Request(`http://localhost:8888${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const res = await apiHandler(req);
    const setCookie = res.headers.get('Set-Cookie') || '';
    const cookiePair = setCookie.split(';')[0] || options.cookie || '';
    const contentType = res.headers.get('Content-Type') || '';
    const data: any = contentType.includes('application/json') ? await res.json() : await res.arrayBuffer();
    return { status: res.status, data, cookie: cookiePair, headers: res.headers };
  }

  it('enforces one-time admin bootstrap, blocks unauthenticated requests, and restricts staff from admin endpoints', async () => {
    // 1. Unauthenticated access to protected route is blocked
    const unauth = await callApi('/api/invoices');
    expect(unauth.status).toBe(401);

    // 2. First admin bootstrap succeeds
    const boot1 = await callApi('/api/auth/bootstrap', {
      method: 'POST',
      body: {
        email: 'admin@livotel.test',
        fullName: 'Pradipta Kumar Ray',
        password: 'StrongAdminPassword!2026',
      },
    });
    expect({ status: boot1.status, error: boot1.data?.error }).toEqual({ status: 201, error: undefined });
    expect(boot1.data.user.role).toBe('admin');
    const adminCookie = boot1.cookie;
    const adminCsrf = boot1.data.csrfToken;

    // 3. Second bootstrap attempt is permanently rejected
    const boot2 = await callApi('/api/auth/bootstrap', {
      method: 'POST',
      body: {
        email: 'attacker@livotel.test',
        fullName: 'Attacker',
        password: 'StrongAdminPassword!2026',
      },
    });
    expect(boot2.status).toBe(403);

    // 4. Admin invites a staff member via single-use setup link
    const inviteRes = await callApi('/api/admin/staff/invite', {
      method: 'POST',
      cookie: adminCookie,
      csrfToken: adminCsrf,
      body: {
        email: 'frontdesk@livotel.test',
        fullName: 'Front Desk Staff',
        role: 'staff',
        canCancelInvoices: false,
      },
    });
    expect(inviteRes.status).toBe(200);
    const setupUrl = new URL(inviteRes.data.setupUrl);
    const setupToken = setupUrl.searchParams.get('setup_token');
    expect(setupToken).toBeTruthy();

    // 5. Staff completes account setup with single-use token
    const completeRes = await callApi('/api/auth/complete-token', {
      method: 'POST',
      body: {
        token: setupToken,
        password: 'StaffSecurePassword!2026',
      },
    });
    expect(completeRes.status).toBe(200);
    const staffCookie = completeRes.cookie;
    const staffCsrf = completeRes.data.csrfToken;

    // Reusing the same setup token is rejected
    const reuseRes = await callApi('/api/auth/complete-token', {
      method: 'POST',
      body: {
        token: setupToken,
        password: 'StaffSecurePassword!2026',
      },
    });
    expect(reuseRes.status).toBe(410);

    // 6. Staff cannot access /api/admin/* endpoints
    const staffAdminAttempt = await callApi('/api/admin/business-settings', {
      method: 'PUT',
      cookie: staffCookie,
      csrfToken: staffCsrf,
      body: { displayName: 'HACKED' },
    });
    expect(staffAdminAttempt.status).toBe(403);
  });

  it('allocates sequential invoice numbers without collision, enforces idempotency, requires night override reason, and preserves original PDF on subsequent payment', async () => {
    const boot = await callApi('/api/auth/bootstrap', {
      method: 'POST',
      body: {
        email: 'admin@livotel.test',
        fullName: 'Pradipta Kumar Ray',
        password: 'StrongAdminPassword!2026',
      },
    });
    const cookie = boot.cookie;
    const csrfToken = boot.data.csrfToken;

    const basePayload = {
      customerClassification: 'B2B',
      documentType: 'GST_TAX_INVOICE',
      taxRuleCode: 'ODISHA_ACCOMMODATION_5PCT',
      invoiceDate: '2026-04-10',
      guestName: 'Aarav Mohanty (Test Sample)',
      companyName: 'Kalinga Tech Solutions Pvt Ltd (Test Only)',
      billingAddress: ' Infocity Avenue, Patia, Bhubaneswar - 751024 ',
      customerStateName: 'Odisha',
      customerStateCode: '21',
      customerGstin: '20AAECJ0224G1ZD',
      checkInAt: '2026-04-08T12:00',
      checkOutAt: '2026-04-10T11:00',
      showStayTimes: true,
      billableNights: 2,
      roomCount: 1,
      occupancyType: 'Double',
      ratePerRoomPaise: rupeesToPaise(3000),
      pricingMode: 'TAX_EXCLUSIVE',
      discountPaise: 0,
      items: [
        {
          serviceType: 'accommodation',
          description: 'Hotel Accommodation Charges (Double Occupancy – 1 Room for 2 Nights)',
          hsnSac: '996311',
          quantityLabel: '1 Room × 2 Nights',
          quantityMultiplier: 2,
          roomCount: 1,
          nightsCount: 2,
          enteredUnitRatePaise: rupeesToPaise(3000),
          pricingMode: 'TAX_EXCLUSIVE',
        },
      ],
      initialPayments: [
        {
          amountPaise: rupeesToPaise(3000),
          paymentDate: '2026-04-08',
          paymentMethod: 'UPI',
          transactionReference: 'UTR-TEST-001',
        },
      ],
    };

    // 1. Rejects when billableNights != suggestedNights (2) without override reason
    const missingOverrideReason = await callApi('/api/invoices/finalise', {
      method: 'POST',
      cookie,
      csrfToken,
      body: {
        ...basePayload,
        billableNights: 3,
        billableNightsOverrideReason: '',
      },
    });
    expect(missingOverrideReason.status).toBe(400);
    expect(missingOverrideReason.data.error).toContain('explanation');

    // 2. Rejects incomplete 13-character GSTIN on B2B finalisation
    const badGstinRes = await callApi('/api/invoices/finalise', {
      method: 'POST',
      cookie,
      csrfToken,
      body: {
        ...basePayload,
        customerGstin: '21AAACS8577K1',
      },
    });
    expect(badGstinRes.status).toBe(400);

    // 3. Finalise with idempotencyKey: duplicate submission returns exact same invoice & number
    const idemKey = 'idem-test-001';
    const fin1 = await callApi('/api/invoices/finalise', {
      method: 'POST',
      cookie,
      csrfToken,
      body: { ...basePayload, idempotencyKey: idemKey },
    });
    expect(fin1.status).toBe(200);
    expect(fin1.data.invoice.invoiceNumber).toBe('LPH/26-27/0001');
    expect(fin1.data.invoice.paymentStatus).toBe('Partially Paid');
    expect(fin1.data.invoice.balancePayablePaise).toBe(330000); // ₹3,300 remaining

    const finRetry = await callApi('/api/invoices/finalise', {
      method: 'POST',
      cookie,
      csrfToken,
      body: { ...basePayload, idempotencyKey: idemKey },
    });
    expect(finRetry.status).toBe(200);
    expect(finRetry.data.invoice.id).toBe(fin1.data.invoice.id);
    expect(finRetry.data.invoice.invoiceNumber).toBe('LPH/26-27/0001');

    // 4. Concurrent finalisations allocate sequential numbers LPH/26-27/0002 and LPH/26-27/0003 without collision
    const [concA, concB] = await Promise.all([
      callApi('/api/invoices/finalise', {
        method: 'POST',
        cookie,
        csrfToken,
        body: { ...basePayload, idempotencyKey: 'idem-conc-a' },
      }),
      callApi('/api/invoices/finalise', {
        method: 'POST',
        cookie,
        csrfToken,
        body: { ...basePayload, idempotencyKey: 'idem-conc-b' },
      }),
    ]);
    const allocatedNumbers = [
      concA.data.invoice.invoiceNumber,
      concB.data.invoice.invoiceNumber,
    ].sort();
    expect(allocatedNumbers).toEqual(['LPH/26-27/0002', 'LPH/26-27/0003']);

    // 5. Record subsequent payment on invoice #1 and verify original PDF is preserved while payment summary PDF is available
    const invId = fin1.data.invoice.id;
    const origPdfBefore = await callApi(`/api/invoices/${invId}/pdf?variant=original`, {
      cookie,
    });
    expect(origPdfBefore.status).toBe(200);
    const bytesBefore = Buffer.from(origPdfBefore.data as ArrayBuffer);

    const payRes = await callApi(`/api/invoices/${invId}/payments`, {
      method: 'POST',
      cookie,
      csrfToken,
      body: {
        amountPaise: rupeesToPaise(3300),
        paymentDate: '2026-04-10',
        paymentMethod: 'Bank Transfer',
        transactionReference: 'NEFT-TEST-002',
      },
    });
    expect(payRes.status).toBe(200);
    expect(payRes.data.invoice.paymentStatus).toBe('Paid');
    expect(payRes.data.invoice.balancePayablePaise).toBe(0);

    const origPdfAfter = await callApi(`/api/invoices/${invId}/pdf?variant=original`, {
      cookie,
    });
    const bytesAfter = Buffer.from(origPdfAfter.data as ArrayBuffer);
    // Original issued PDF binary must remain byte-for-byte identical
    expect(bytesAfter.equals(bytesBefore)).toBe(true);

    // Updated Payment Summary PDF is also generated and downloadable
    const summaryPdf = await callApi(`/api/invoices/${invId}/pdf?variant=payment_summary`, {
      cookie,
    });
    expect(summaryPdf.status).toBe(200);
    expect((summaryPdf.data as ArrayBuffer).byteLength).toBeGreaterThan(1000);
  });
});
