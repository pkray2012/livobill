import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import type { InvoiceRecord } from '../../shared/types';
import {
  amountInWordsINR,
  formatIndianAmount,
  formatRateBps,
} from '../../shared/calculations';
import {
  formatInvoiceDateDisplay,
  formatStayPeriodDisplay,
} from '../../shared/dates';

export interface InvoicePdfDocumentProps {
  invoice: InvoiceRecord;
  logoSrc: string;
  copyVariant?: 'ORIGINAL' | 'PAYMENT_SUMMARY';
}

const BURNT_ORANGE = '#C46A4A';
const PALE_PEACH = '#F5E1DA';
const BORDER_GREY = '#8C8C8C';
const TEXT_BLACK = '#000000';

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 24,
    paddingLeft: 0,
    paddingRight: 0,
    backgroundColor: '#FFFFFF',
    fontFamily: 'Helvetica',
    fontSize: 9.2,
    color: TEXT_BLACK,
    lineHeight: 1.2,
  },
  headerContainer: {
    alignItems: 'center',
    paddingHorizontal: 42,
  },
  logoImage: {
    width: 78,
    height: 78,
    objectFit: 'contain',
    marginBottom: 6,
  },
  hotelHeading: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 13.8,
    color: BURNT_ORANGE,
    textAlign: 'center',
    letterSpacing: 0.2,
    marginBottom: 2,
  },
  hotelSubtitle: {
    fontFamily: 'Helvetica',
    fontSize: 8.6,
    color: BURNT_ORANGE,
    textAlign: 'center',
    marginBottom: 6,
  },
  documentTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 15,
    color: TEXT_BLACK,
    textAlign: 'center',
    marginBottom: 6,
  },
  contentBlock: {
    paddingHorizontal: 42,
  },
  metadataBlock: {
    marginBottom: 10,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 1,
  },
  metaLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9.2,
  },
  metaValue: {
    fontFamily: 'Helvetica',
    fontSize: 9.2,
  },
  partiesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  leftPartyCol: {
    width: 248,
    paddingRight: 8,
  },
  rightPartyCol: {
    width: 249,
  },
  sectionHeading: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9.5,
    marginBottom: 2,
    color: TEXT_BLACK,
  },
  subSectionHeading: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9.5,
    marginTop: 6,
    marginBottom: 2,
    color: TEXT_BLACK,
  },
  partyText: {
    fontFamily: 'Helvetica',
    fontSize: 9.2,
    marginBottom: 0.8,
  },
  partyTextBold: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9.2,
    marginBottom: 0.8,
  },
  serviceDetailsBlock: {
    marginBottom: 9,
  },
  serviceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 1,
  },
  // Six-column service table (x=8pt to 587pt => width 579pt on 595.28pt A4)
  tableOuter: {
    marginLeft: 8,
    width: 579,
    marginBottom: 12,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: PALE_PEACH,
    borderTopWidth: 0.6,
    borderLeftWidth: 0.6,
    borderRightWidth: 0.6,
    borderBottomWidth: 0.6,
    borderColor: BORDER_GREY,
    minHeight: 19,
    alignItems: 'center',
  },
  tableDataRow: {
    flexDirection: 'row',
    borderLeftWidth: 0.6,
    borderRightWidth: 0.6,
    borderBottomWidth: 0.6,
    borderColor: BORDER_GREY,
    minHeight: 20,
    alignItems: 'stretch',
  },
  colSno: {
    width: 35,
    borderRightWidth: 0.6,
    borderColor: BORDER_GREY,
    paddingVertical: 4,
    paddingHorizontal: 5,
    justifyContent: 'center',
  },
  colDesc: {
    width: 210,
    borderRightWidth: 0.6,
    borderColor: BORDER_GREY,
    paddingVertical: 4,
    paddingHorizontal: 5,
    justifyContent: 'center',
  },
  colSac: {
    width: 72,
    borderRightWidth: 0.6,
    borderColor: BORDER_GREY,
    paddingVertical: 4,
    paddingHorizontal: 5,
    justifyContent: 'center',
  },
  colQty: {
    width: 102,
    borderRightWidth: 0.6,
    borderColor: BORDER_GREY,
    paddingVertical: 4,
    paddingHorizontal: 5,
    justifyContent: 'center',
  },
  colRate: {
    width: 73,
    borderRightWidth: 0.6,
    borderColor: BORDER_GREY,
    paddingVertical: 4,
    paddingHorizontal: 5,
    justifyContent: 'center',
  },
  colTaxable: {
    width: 87,
    paddingVertical: 4,
    paddingHorizontal: 5,
    justifyContent: 'center',
  },
  thText: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8.2,
    color: TEXT_BLACK,
  },
  thTextRight: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8.2,
    color: TEXT_BLACK,
    textAlign: 'right',
  },
  tdText: {
    fontFamily: 'Helvetica',
    fontSize: 8.8,
    color: TEXT_BLACK,
  },
  tdTextRight: {
    fontFamily: 'Helvetica',
    fontSize: 8.8,
    color: TEXT_BLACK,
    textAlign: 'right',
  },
  // Centered Totals Table (x=118pt to 478pt => width 360pt)
  totalsOuterWrapper: {
    marginLeft: 118,
    width: 360,
    borderTopWidth: 0.6,
    borderLeftWidth: 0.6,
    borderRightWidth: 0.6,
    borderColor: BORDER_GREY,
    marginBottom: 11,
  },
  totalsRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.6,
    borderColor: BORDER_GREY,
    minHeight: 17.5,
    alignItems: 'center',
  },
  totalsRowHighlight: {
    flexDirection: 'row',
    backgroundColor: BURNT_ORANGE,
    borderBottomWidth: 0.6,
    borderColor: BORDER_GREY,
    minHeight: 18,
    alignItems: 'center',
  },
  totalsLabelCell: {
    width: 220,
    borderRightWidth: 0.6,
    borderColor: BORDER_GREY,
    paddingVertical: 2.8,
    paddingHorizontal: 6,
    justifyContent: 'center',
  },
  totalsLabelCellHighlight: {
    width: 220,
    borderRightWidth: 0.6,
    borderColor: BURNT_ORANGE,
    paddingVertical: 2.8,
    paddingHorizontal: 6,
    justifyContent: 'center',
  },
  totalsValueCell: {
    width: 140,
    paddingVertical: 2.8,
    paddingHorizontal: 7,
    justifyContent: 'center',
  },
  totalsTextRegular: {
    fontFamily: 'Helvetica',
    fontSize: 9.2,
    color: TEXT_BLACK,
  },
  totalsValueRegular: {
    fontFamily: 'Helvetica',
    fontSize: 9.2,
    color: TEXT_BLACK,
    textAlign: 'right',
  },
  totalsTextBold: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9.2,
    color: TEXT_BLACK,
  },
  totalsValueBold: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9.2,
    color: TEXT_BLACK,
    textAlign: 'right',
  },
  totalsTextWhiteBold: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9.2,
    color: '#FFFFFF',
  },
  totalsValueWhiteBold: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9.2,
    color: '#FFFFFF',
    textAlign: 'right',
  },
  amountWordsLine: {
    paddingHorizontal: 42,
    marginBottom: 8,
    fontSize: 8.8,
    fontFamily: 'Helvetica',
  },
  footerBlock: {
    paddingHorizontal: 42,
  },
  bankDetailsBlock: {
    marginBottom: 6,
  },
  standardCheckInLine: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    marginTop: 2,
    marginBottom: 6,
  },
  declarationBlock: {
    marginBottom: 8,
  },
  signatoryBlock: {
    marginTop: 2,
  },
  paymentLedgerBox: {
    marginTop: 8,
    marginBottom: 8,
    padding: 6,
    borderWidth: 0.5,
    borderColor: BORDER_GREY,
  },
});

export const InvoicePdfDocument: React.FC<InvoicePdfDocumentProps> = ({
  invoice,
  logoSrc,
  copyVariant = 'ORIGINAL',
}) => {
  const biz = invoice.businessSnapshot;
  const isNonGst = invoice.documentType === 'NON_GST_DOCUMENT';
  const documentTitle = isNonGst
    ? invoice.documentTitle || biz.nonGstDefaultTitle || 'BILL OF SUPPLY'
    : 'TAX INVOICE';

  const hasSeparateCorporateBlock = Boolean(
    invoice.companyName?.trim() && (invoice.customerPan?.trim() || invoice.customerCin?.trim())
  );

  const primaryBillToName = invoice.companyName?.trim()
    ? invoice.companyName.trim()
    : invoice.guestName.trim();

  const secondaryGuestName =
    invoice.companyName?.trim() &&
    invoice.guestName?.trim() &&
    invoice.companyName.trim().toLowerCase() !== invoice.guestName.trim().toLowerCase()
      ? invoice.guestName.trim()
      : null;

  const billingAddressLines = (invoice.billingAddress || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const supplierAddressLines = (biz.supplierAddress || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const stayPeriodFormatted = formatStayPeriodDisplay(
    invoice.checkInAt,
    invoice.checkOutAt,
    invoice.billableNights,
    invoice.showStayTimes
  );

  return (
    <Document
      title={`${documentTitle} - ${invoice.invoiceNumber || 'DRAFT'}`}
      author={biz.displayName}
      subject={`${documentTitle} for ${primaryBillToName}`}
    >
      <Page size="A4" style={styles.page} wrap>
        {/* Header with Centred Logo, Burnt-Orange Heading & Subtitle, and Centred Document Title */}
        <View style={styles.headerContainer}>
          {logoSrc ? <Image src={logoSrc} style={styles.logoImage} /> : null}
          <Text style={styles.hotelHeading}>{biz.displayName.toUpperCase()}</Text>
          <Text style={styles.hotelSubtitle}>{biz.subtitle}</Text>
          <Text style={styles.documentTitle}>{documentTitle}</Text>
        </View>

        {/* Upper-left Invoice Metadata */}
        <View style={[styles.contentBlock, styles.metadataBlock]}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Invoice No: </Text>
            <Text style={styles.metaValue}>
              {invoice.invoiceNumber ? invoice.invoiceNumber : 'DRAFT (Unallocated)'}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Invoice Date: </Text>
            <Text style={styles.metaValue}>{formatInvoiceDateDisplay(invoice.invoiceDate)}</Text>
          </View>
          {!isNonGst && (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Place of Supply: </Text>
              <Text style={styles.metaValue}>{invoice.placeOfSupply || biz.defaultPlaceOfSupply}</Text>
            </View>
          )}
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Note: </Text>
            <Text style={styles.metaValue}>All amounts are in INR</Text>
          </View>
          {isNonGst && invoice.nonGstReason ? (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Tax Treatment Basis: </Text>
              <Text style={styles.metaValue}>{invoice.nonGstReason}</Text>
            </View>
          ) : null}
          {invoice.bookingReference?.trim() ? (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Booking Ref: </Text>
              <Text style={styles.metaValue}>{invoice.bookingReference.trim()}</Text>
            </View>
          ) : null}
          {copyVariant === 'PAYMENT_SUMMARY' ? (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Document Copy: </Text>
              <Text style={styles.metaValue}>
                Updated Payment Summary Copy (Original Issued Invoice Preserved)
              </Text>
            </View>
          ) : null}
          {invoice.status === 'Cancelled' ? (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Status: </Text>
              <Text style={styles.metaValue}>
                CANCELLED {invoice.cancellationReason ? `— ${invoice.cancellationReason}` : ''}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Two-Column Party Section: Bill To (Left) & Supplier Details (Right) */}
        <View style={[styles.contentBlock, styles.partiesRow]}>
          <View style={styles.leftPartyCol}>
            <Text style={styles.sectionHeading}>Bill To</Text>
            <Text style={styles.partyText}>{primaryBillToName}</Text>
            {secondaryGuestName ? (
              <Text style={styles.partyText}>Guest: {secondaryGuestName}</Text>
            ) : null}

            {!hasSeparateCorporateBlock &&
              billingAddressLines.map((line, i) => (
                <Text key={`addr-inline-${i}`} style={styles.partyText}>
                  {line}
                </Text>
              ))}

            {!isNonGst && invoice.customerGstin?.trim() ? (
              <Text style={styles.partyText}>GSTIN: {invoice.customerGstin.trim()}</Text>
            ) : null}
            {invoice.customerPan?.trim() ? (
              <Text style={styles.partyText}>PAN: {invoice.customerPan.trim()}</Text>
            ) : null}
            {invoice.customerCin?.trim() ? (
              <Text style={styles.partyText}>CIN: {invoice.customerCin.trim()}</Text>
            ) : null}
            {invoice.customerMobile?.trim() ? (
              <Text style={styles.partyText}>Mobile: {invoice.customerMobile.trim()}</Text>
            ) : null}
            {invoice.customerEmail?.trim() ? (
              <Text style={styles.partyText}>Email: {invoice.customerEmail.trim()}</Text>
            ) : null}

            {hasSeparateCorporateBlock ? (
              <View>
                <Text style={styles.subSectionHeading}>Billing Address</Text>
                {billingAddressLines.map((line, i) => (
                  <Text key={`addr-corp-${i}`} style={styles.partyText}>
                    {line}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>

          <View style={styles.rightPartyCol}>
            <Text style={styles.sectionHeading}>Supplier Details</Text>
            <Text style={styles.partyText}>{biz.supplierLegalName}</Text>
            {supplierAddressLines.map((line, i) => (
              <Text key={`sup-addr-${i}`} style={styles.partyText}>
                {line}
              </Text>
            ))}
            {!isNonGst && biz.supplierGstin?.trim() ? (
              <Text style={styles.partyText}>GSTIN: {biz.supplierGstin.trim()}</Text>
            ) : null}
          </View>
        </View>

        {/* Service Details */}
        <View style={[styles.contentBlock, styles.serviceDetailsBlock]}>
          <Text style={styles.sectionHeading}>Service Details</Text>
          <View style={styles.serviceRow}>
            <Text style={styles.metaLabel}>Property: </Text>
            <Text style={styles.metaValue}>{biz.propertyName}</Text>
          </View>
          <View style={styles.serviceRow}>
            <Text style={styles.metaLabel}>Stay Period: </Text>
            <Text style={styles.metaValue}>{stayPeriodFormatted}</Text>
          </View>
          <View style={styles.serviceRow}>
            <Text style={styles.metaLabel}>Nature of Supply: </Text>
            <Text style={styles.metaValue}>{biz.defaultNatureOfSupply}</Text>
          </View>
        </View>

        {/* Six-Column Service Table */}
        <View style={styles.tableOuter}>
          <View style={styles.tableHeaderRow} fixed>
            <View style={styles.colSno}>
              <Text style={styles.thText}>S.No</Text>
            </View>
            <View style={styles.colDesc}>
              <Text style={styles.thText}>Description of Service</Text>
            </View>
            <View style={styles.colSac}>
              <Text style={styles.thText}>{isNonGst ? 'Service Code' : 'HSN/SAC'}</Text>
            </View>
            <View style={styles.colQty}>
              <Text style={styles.thText}>Quantity</Text>
            </View>
            <View style={styles.colRate}>
              <Text style={styles.thTextRight}>Rate (INR)</Text>
            </View>
            <View style={styles.colTaxable}>
              <Text style={styles.thTextRight}>
                {isNonGst ? 'Amount (INR)' : 'Taxable Value (INR)'}
              </Text>
            </View>
          </View>

          {invoice.items.map((item, idx) => (
            <View key={item.id || `row-${idx}`} style={styles.tableDataRow} wrap={false}>
              <View style={styles.colSno}>
                <Text style={styles.tdText}>{idx + 1}</Text>
              </View>
              <View style={styles.colDesc}>
                <Text style={styles.tdText}>{item.description}</Text>
              </View>
              <View style={styles.colSac}>
                <Text style={styles.tdText}>{item.hsnSac}</Text>
              </View>
              <View style={styles.colQty}>
                <Text style={styles.tdText}>{item.quantityLabel}</Text>
              </View>
              <View style={styles.colRate}>
                <Text style={styles.tdTextRight}>
                  {formatIndianAmount(item.preTaxUnitRatePaise)}
                </Text>
              </View>
              <View style={styles.colTaxable}>
                <Text style={styles.tdTextRight}>
                  {formatIndianAmount(item.taxableValuePaise)}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* Totals Table (kept together on page break via wrap={false}) */}
        <View style={styles.totalsOuterWrapper} wrap={false}>
          {invoice.discountPaise > 0 ? (
            <>
              <View style={styles.totalsRow}>
                <View style={styles.totalsLabelCell}>
                  <Text style={styles.totalsTextRegular}>Subtotal (Before Discount)</Text>
                </View>
                <View style={styles.totalsValueCell}>
                  <Text style={styles.totalsValueRegular}>
                    {formatIndianAmount(invoice.subtotalPreDiscountPaise)}
                  </Text>
                </View>
              </View>
              <View style={styles.totalsRow}>
                <View style={styles.totalsLabelCell}>
                  <Text style={styles.totalsTextRegular}>
                    Discount{invoice.discountBasis ? ` (${invoice.discountBasis})` : ''}
                  </Text>
                </View>
                <View style={styles.totalsValueCell}>
                  <Text style={styles.totalsValueRegular}>
                    - {formatIndianAmount(invoice.discountPaise)}
                  </Text>
                </View>
              </View>
            </>
          ) : null}

          <View style={styles.totalsRow}>
            <View style={styles.totalsLabelCell}>
              <Text style={styles.totalsTextRegular}>
                {isNonGst ? 'Subtotal' : 'Taxable Value'}
              </Text>
            </View>
            <View style={styles.totalsValueCell}>
              <Text style={styles.totalsValueRegular}>
                {formatIndianAmount(invoice.taxableValuePaise)}
              </Text>
            </View>
          </View>

          {!isNonGst && invoice.igstRateBps > 0 ? (
            <View style={styles.totalsRow}>
              <View style={styles.totalsLabelCell}>
                <Text style={styles.totalsTextRegular}>
                  IGST @ {formatRateBps(invoice.igstRateBps)}
                </Text>
              </View>
              <View style={styles.totalsValueCell}>
                <Text style={styles.totalsValueRegular}>
                  {formatIndianAmount(invoice.igstPaise)}
                </Text>
              </View>
            </View>
          ) : null}

          {!isNonGst && invoice.igstRateBps === 0 ? (
            <>
              <View style={styles.totalsRow}>
                <View style={styles.totalsLabelCell}>
                  <Text style={styles.totalsTextRegular}>
                    CGST @ {formatRateBps(invoice.cgstRateBps)}
                  </Text>
                </View>
                <View style={styles.totalsValueCell}>
                  <Text style={styles.totalsValueRegular}>
                    {formatIndianAmount(invoice.cgstPaise)}
                  </Text>
                </View>
              </View>
              <View style={styles.totalsRow}>
                <View style={styles.totalsLabelCell}>
                  <Text style={styles.totalsTextRegular}>
                    SGST @ {formatRateBps(invoice.sgstRateBps)}
                  </Text>
                </View>
                <View style={styles.totalsValueCell}>
                  <Text style={styles.totalsValueRegular}>
                    {formatIndianAmount(invoice.sgstPaise)}
                  </Text>
                </View>
              </View>
            </>
          ) : null}

          {/* Burnt-Orange Total Row with White Bold Text */}
          <View style={styles.totalsRowHighlight}>
            <View style={styles.totalsLabelCellHighlight}>
              <Text style={styles.totalsTextWhiteBold}>
                {isNonGst ? 'TOTAL BILL AMOUNT' : 'TOTAL INVOICE VALUE'}
              </Text>
            </View>
            <View style={styles.totalsValueCell}>
              <Text style={styles.totalsValueWhiteBold}>
                {formatIndianAmount(invoice.totalInvoicePaise)}
              </Text>
            </View>
          </View>

          <View style={styles.totalsRow}>
            <View style={styles.totalsLabelCell}>
              <Text style={styles.totalsTextRegular}>Amount Received</Text>
            </View>
            <View style={styles.totalsValueCell}>
              <Text style={styles.totalsValueRegular}>
                {formatIndianAmount(invoice.amountReceivedPaise)}
              </Text>
            </View>
          </View>

          <View style={styles.totalsRow}>
            <View style={styles.totalsLabelCell}>
              <Text style={styles.totalsTextBold}>Balance Payable</Text>
            </View>
            <View style={styles.totalsValueCell}>
              <Text style={styles.totalsValueBold}>
                {formatIndianAmount(invoice.balancePayablePaise)}
              </Text>
            </View>
          </View>

          {invoice.creditRefundDuePaise > 0 ? (
            <View style={styles.totalsRow}>
              <View style={styles.totalsLabelCell}>
                <Text style={styles.totalsTextBold}>Credit / Refund Due</Text>
              </View>
              <View style={styles.totalsValueCell}>
                <Text style={styles.totalsValueBold}>
                  {formatIndianAmount(invoice.creditRefundDuePaise)}
                </Text>
              </View>
            </View>
          ) : null}
        </View>

        {/* Optional Configurable Amount in Words (disabled by default to match reference PDFs) */}
        {biz.showAmountInWords ? (
          <Text style={styles.amountWordsLine}>
            Amount in Words: {amountInWordsINR(invoice.totalInvoicePaise)}
          </Text>
        ) : null}

        {/* Footer: Bank Details, Standard Check-in/Check-out, Declaration, Authorised Signatory */}
        <View style={styles.footerBlock} wrap={false}>
          {copyVariant === 'PAYMENT_SUMMARY' && invoice.payments.length > 0 ? (
            <View style={styles.paymentLedgerBox}>
              <Text style={styles.sectionHeading}>Payment Ledger Summary</Text>
              {invoice.payments.map((p, idx) => (
                <Text key={p.id || idx} style={styles.partyText}>
                  {idx + 1}. {formatInvoiceDateDisplay(p.paymentDate)} — {p.paymentMethod} — INR{' '}
                  {formatIndianAmount(p.amountPaise)}
                  {p.transactionReference ? ` (Ref: ${p.transactionReference})` : ''}
                </Text>
              ))}
            </View>
          ) : null}

          <View style={styles.bankDetailsBlock}>
            <Text style={styles.sectionHeading}>Bank Details</Text>
            <Text style={styles.partyText}>Account Name: {biz.bankAccountName}</Text>
            <Text style={styles.partyText}>Bank: {biz.bankName}</Text>
            <Text style={styles.partyText}>Account Type: {biz.bankAccountType}</Text>
            <Text style={styles.partyText}>Account No: {biz.bankAccountNo}</Text>
            <Text style={styles.partyText}>IFSC: {biz.bankIfsc}</Text>
            <Text style={styles.partyText}>Branch: {biz.bankBranch}</Text>
          </View>

          <Text style={styles.standardCheckInLine}>
            Standard Check-in: {biz.standardCheckIn} | Standard Check-out: {biz.standardCheckOut}
          </Text>

          <View style={styles.declarationBlock}>
            <Text style={styles.sectionHeading}>Declaration</Text>
            <Text style={styles.partyText}>{biz.declarationText}</Text>
          </View>

          <View style={styles.signatoryBlock}>
            <Text style={styles.sectionHeading}>Authorised Signatory</Text>
            <Text style={styles.partyText}>{biz.authorisedSignatory}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
};
