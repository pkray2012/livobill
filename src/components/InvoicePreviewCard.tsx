import React, { useEffect, useState } from 'react';
import { pdf } from '@react-pdf/renderer';
import { Download, Eye, FileText, Printer, RefreshCw } from 'lucide-react';
import { InvoicePdfDocument } from '../pdf/InvoicePdfDocument';
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
import { downloadInvoicePdf, printInvoicePdf } from '../api/client';

interface InvoicePreviewCardProps {
  invoice: InvoiceRecord;
  logoSrc: string;
  copyVariant?: 'ORIGINAL' | 'PAYMENT_SUMMARY';
  showActions?: boolean;
}

export const InvoicePreviewCard: React.FC<InvoicePreviewCardProps> = ({
  invoice,
  logoSrc,
  copyVariant = 'ORIGINAL',
  showActions = true,
}) => {
  const [viewMode, setViewMode] = useState<'sheet' | 'pdf'>('sheet');
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [renderingPdf, setRenderingPdf] = useState(false);
  const [busyAction, setBusyAction] = useState(false);

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
    : invoice.guestName.trim() || '—';

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

  useEffect(() => {
    if (viewMode !== 'pdf') return;
    let active = true;
    let generatedUrl: string | null = null;
    setRenderingPdf(true);

    const element = React.createElement(InvoicePdfDocument, {
      invoice,
      logoSrc: logoSrc || '/livotel-logo.jpg',
      copyVariant,
    });

    pdf(element as any)
      .toBlob()
      .then((blob) => {
        if (!active) return;
        generatedUrl = URL.createObjectURL(blob);
        setPdfBlobUrl(generatedUrl);
      })
      .finally(() => {
        if (active) setRenderingPdf(false);
      });

    return () => {
      active = false;
      if (generatedUrl) URL.revokeObjectURL(generatedUrl);
    };
  }, [viewMode, invoice, logoSrc, copyVariant]);

  const handleDownload = async () => {
    try {
      setBusyAction(true);
      await downloadInvoicePdf(invoice, logoSrc || '/livotel-logo.jpg', copyVariant);
    } finally {
      setBusyAction(false);
    }
  };

  const handlePrint = async () => {
    try {
      setBusyAction(true);
      await printInvoicePdf(invoice, logoSrc || '/livotel-logo.jpg', copyVariant);
    } finally {
      setBusyAction(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {showActions && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-white px-4 py-2.5 rounded-lg border border-[#E6E1DA] shadow-sm">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setViewMode('sheet')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                viewMode === 'sheet'
                  ? 'bg-[#1F1E1C] text-white'
                  : 'text-[#1F1E1C] hover:bg-[#FAF8F5]'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              A4 Layout Preview
            </button>
            <button
              type="button"
              onClick={() => setViewMode('pdf')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                viewMode === 'pdf'
                  ? 'bg-[#1F1E1C] text-white'
                  : 'text-[#1F1E1C] hover:bg-[#FAF8F5]'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Rendered PDF Stream
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busyAction}
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#D6D0C4] bg-white hover:bg-[#FAF8F5] text-xs font-medium text-[#1F1E1C] disabled:opacity-50"
            >
              <Printer className="w-3.5 h-3.5" />
              Print A4
            </button>
            <button
              type="button"
              disabled={busyAction}
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-[#C46A4A] hover:bg-[#A85538] text-xs font-semibold text-white shadow-sm disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              Download PDF
            </button>
          </div>
        </div>
      )}

      {viewMode === 'pdf' ? (
        <div className="bg-white rounded-lg border border-[#E6E1DA] overflow-hidden min-h-[780px] flex flex-col">
          {renderingPdf ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-sm text-stone-600 gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-[#C46A4A]" />
              <span>Rendering selectable-text A4 PDF with @react-pdf/renderer...</span>
            </div>
          ) : pdfBlobUrl ? (
            <iframe
              src={pdfBlobUrl}
              title="A4 Invoice PDF Preview"
              className="w-full h-[820px] border-0"
            />
          ) : null}
        </div>
      ) : (
        /* Synchronized A4 Portrait Paper Sheet matching the Reference PDFs */
        <div className="w-full overflow-x-auto bg-stone-200/70 p-3 sm:p-6 rounded-lg border border-[#E6E1DA] flex justify-center">
          <div
            className="bg-white text-black shadow-md border border-stone-300 w-full max-w-[595px] min-h-[842px] py-[34px] text-[12px] leading-[1.32] select-text"
            style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}
          >
            {/* Centred Logo & Headings */}
            <div className="flex flex-col items-center px-[42px]">
              <img
                src={logoSrc || '/livotel-logo.jpg'}
                alt="LIVOTEL PREMIUM HOTEL Logo"
                className="w-[78px] h-[78px] object-contain mb-2"
              />
              <h2
                className="font-bold text-[18px] tracking-[0.01em] text-center uppercase"
                style={{ color: '#C46A4A' }}
              >
                {biz.displayName}
              </h2>
              <p
                className="text-[11.2px] text-center mt-0.5 mb-2"
                style={{ color: '#C46A4A' }}
              >
                {biz.subtitle}
              </p>
              <h1 className="font-bold text-[19.5px] text-black text-center mb-2.5">
                {documentTitle}
              </h1>
            </div>

            {/* Upper-Left Invoice Metadata */}
            <div className="px-[42px] mb-3.5 space-y-0.5 text-[12px]">
              <div>
                <span className="font-bold">Invoice No: </span>
                <span>{invoice.invoiceNumber || 'LPH/26-27/001'}</span>
              </div>
              <div>
                <span className="font-bold">Invoice Date: </span>
                <span>{formatInvoiceDateDisplay(invoice.invoiceDate)}</span>
              </div>
              {!isNonGst && (
                <div>
                  <span className="font-bold">Place of Supply: </span>
                  <span>{invoice.placeOfSupply || biz.defaultPlaceOfSupply}</span>
                </div>
              )}
              <div>
                <span className="font-bold">Note: </span>
                <span>All amounts are in INR</span>
              </div>
              {isNonGst && invoice.nonGstReason && (
                <div>
                  <span className="font-bold">Tax Treatment Basis: </span>
                  <span>{invoice.nonGstReason}</span>
                </div>
              )}
              {invoice.bookingReference?.trim() && (
                <div>
                  <span className="font-bold">Booking Ref: </span>
                  <span>{invoice.bookingReference.trim()}</span>
                </div>
              )}
              {copyVariant === 'PAYMENT_SUMMARY' && (
                <div>
                  <span className="font-bold">Document Copy: </span>
                  <span>Updated Payment Summary Copy (Original Issued Invoice Preserved)</span>
                </div>
              )}
              {invoice.status === 'Cancelled' && (
                <div className="text-red-700 font-bold">
                  STATUS: CANCELLED {invoice.cancellationReason ? `— ${invoice.cancellationReason}` : ''}
                </div>
              )}
            </div>

            {/* Two-Column Party Details */}
            <div className="px-[42px] grid grid-cols-2 gap-4 mb-3.5 text-[12px]">
              <div className="break-words pr-2">
                <div className="font-bold mb-0.5">Bill To</div>
                <div>{primaryBillToName}</div>
                {secondaryGuestName && <div>Guest: {secondaryGuestName}</div>}

                {!hasSeparateCorporateBlock &&
                  billingAddressLines.map((line, i) => <div key={i}>{line}</div>)}

                {!isNonGst && invoice.customerGstin?.trim() && (
                  <div>GSTIN: {invoice.customerGstin.trim()}</div>
                )}
                {invoice.customerPan?.trim() && <div>PAN: {invoice.customerPan.trim()}</div>}
                {invoice.customerCin?.trim() && <div>CIN: {invoice.customerCin.trim()}</div>}
                {invoice.customerMobile?.trim() && <div>Mobile: {invoice.customerMobile.trim()}</div>}
                {invoice.customerEmail?.trim() && <div>Email: {invoice.customerEmail.trim()}</div>}

                {hasSeparateCorporateBlock && (
                  <div className="mt-2.5">
                    <div className="font-bold mb-0.5">Billing Address</div>
                    {billingAddressLines.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                )}
              </div>

              <div className="break-words">
                <div className="font-bold mb-0.5">Supplier Details</div>
                <div>{biz.supplierLegalName}</div>
                {supplierAddressLines.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
                {!isNonGst && biz.supplierGstin?.trim() && (
                  <div>GSTIN: {biz.supplierGstin.trim()}</div>
                )}
              </div>
            </div>

            {/* Service Details */}
            <div className="px-[42px] mb-3 text-[12px] space-y-0.5">
              <div className="font-bold mb-0.5">Service Details</div>
              <div>
                <span className="font-bold">Property: </span>
                <span>{biz.propertyName}</span>
              </div>
              <div>
                <span className="font-bold">Stay Period: </span>
                <span>{stayPeriodFormatted}</span>
              </div>
              <div>
                <span className="font-bold">Nature of Supply: </span>
                <span>{biz.defaultNatureOfSupply}</span>
              </div>
            </div>

            {/* Six-Column Service Table */}
            <div className="px-[8px] mb-4">
              <table className="w-full border-collapse border border-[#8C8C8C] text-[11.2px]">
                <thead>
                  <tr style={{ backgroundColor: '#F5E1DA' }}>
                    <th className="border border-[#8C8C8C] px-1.5 py-1 text-left font-bold w-[6%]">
                      S.No
                    </th>
                    <th className="border border-[#8C8C8C] px-1.5 py-1 text-left font-bold w-[36%]">
                      Description of Service
                    </th>
                    <th className="border border-[#8C8C8C] px-1.5 py-1 text-left font-bold w-[12.5%]">
                      {isNonGst ? 'Service Code' : 'HSN/SAC'}
                    </th>
                    <th className="border border-[#8C8C8C] px-1.5 py-1 text-left font-bold w-[17.5%]">
                      Quantity
                    </th>
                    <th className="border border-[#8C8C8C] px-1.5 py-1 text-right font-bold w-[12.5%]">
                      Rate (INR)
                    </th>
                    <th className="border border-[#8C8C8C] px-1.5 py-1 text-right font-bold w-[15.5%]">
                      {isNonGst ? 'Amount (INR)' : 'Taxable Value (INR)'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.items.map((item, idx) => (
                    <tr key={item.id || idx}>
                      <td className="border border-[#8C8C8C] px-1.5 py-1 align-top">{idx + 1}</td>
                      <td className="border border-[#8C8C8C] px-1.5 py-1 align-top break-words">
                        {item.description}
                      </td>
                      <td className="border border-[#8C8C8C] px-1.5 py-1 align-top">
                        {item.hsnSac}
                      </td>
                      <td className="border border-[#8C8C8C] px-1.5 py-1 align-top">
                        {item.quantityLabel}
                      </td>
                      <td className="border border-[#8C8C8C] px-1.5 py-1 align-top text-right">
                        {formatIndianAmount(item.preTaxUnitRatePaise)}
                      </td>
                      <td className="border border-[#8C8C8C] px-1.5 py-1 align-top text-right">
                        {formatIndianAmount(item.taxableValuePaise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Centred Totals Table */}
            <div className="flex justify-center mb-4 px-[42px]">
              <table className="w-[360px] border-collapse border border-[#8C8C8C] text-[12px]">
                <tbody>
                  {invoice.discountPaise > 0 && (
                    <>
                      <tr>
                        <td className="border border-[#8C8C8C] px-2 py-1 w-[220px]">
                          Subtotal (Before Discount)
                        </td>
                        <td className="border border-[#8C8C8C] px-2 py-1 text-right w-[140px]">
                          {formatIndianAmount(invoice.subtotalPreDiscountPaise)}
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-[#8C8C8C] px-2 py-1">
                          Discount{invoice.discountBasis ? ` (${invoice.discountBasis})` : ''}
                        </td>
                        <td className="border border-[#8C8C8C] px-2 py-1 text-right">
                          - {formatIndianAmount(invoice.discountPaise)}
                        </td>
                      </tr>
                    </>
                  )}

                  <tr>
                    <td className="border border-[#8C8C8C] px-2 py-1 w-[220px]">
                      {isNonGst ? 'Subtotal' : 'Taxable Value'}
                    </td>
                    <td className="border border-[#8C8C8C] px-2 py-1 text-right w-[140px]">
                      {formatIndianAmount(invoice.taxableValuePaise)}
                    </td>
                  </tr>

                  {!isNonGst && invoice.igstRateBps > 0 && (
                    <tr>
                      <td className="border border-[#8C8C8C] px-2 py-1">
                        IGST @ {formatRateBps(invoice.igstRateBps)}
                      </td>
                      <td className="border border-[#8C8C8C] px-2 py-1 text-right">
                        {formatIndianAmount(invoice.igstPaise)}
                      </td>
                    </tr>
                  )}

                  {!isNonGst && invoice.igstRateBps === 0 && (
                    <>
                      <tr>
                        <td className="border border-[#8C8C8C] px-2 py-1">
                          CGST @ {formatRateBps(invoice.cgstRateBps)}
                        </td>
                        <td className="border border-[#8C8C8C] px-2 py-1 text-right">
                          {formatIndianAmount(invoice.cgstPaise)}
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-[#8C8C8C] px-2 py-1">
                          SGST @ {formatRateBps(invoice.sgstRateBps)}
                        </td>
                        <td className="border border-[#8C8C8C] px-2 py-1 text-right">
                          {formatIndianAmount(invoice.sgstPaise)}
                        </td>
                      </tr>
                    </>
                  )}

                  <tr style={{ backgroundColor: '#C46A4A' }} className="text-white font-bold">
                    <td className="border border-[#8C8C8C] px-2 py-1">
                      {isNonGst ? 'TOTAL BILL AMOUNT' : 'TOTAL INVOICE VALUE'}
                    </td>
                    <td className="border border-[#8C8C8C] px-2 py-1 text-right">
                      {formatIndianAmount(invoice.totalInvoicePaise)}
                    </td>
                  </tr>

                  <tr>
                    <td className="border border-[#8C8C8C] px-2 py-1">Amount Received</td>
                    <td className="border border-[#8C8C8C] px-2 py-1 text-right">
                      {formatIndianAmount(invoice.amountReceivedPaise)}
                    </td>
                  </tr>

                  <tr className="font-bold">
                    <td className="border border-[#8C8C8C] px-2 py-1">Balance Payable</td>
                    <td className="border border-[#8C8C8C] px-2 py-1 text-right">
                      {formatIndianAmount(invoice.balancePayablePaise)}
                    </td>
                  </tr>

                  {invoice.creditRefundDuePaise > 0 && (
                    <tr className="font-bold text-emerald-800">
                      <td className="border border-[#8C8C8C] px-2 py-1">Credit / Refund Due</td>
                      <td className="border border-[#8C8C8C] px-2 py-1 text-right">
                        {formatIndianAmount(invoice.creditRefundDuePaise)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {biz.showAmountInWords && (
              <div className="px-[42px] mb-3 text-[11.5px]">
                <span className="font-bold">Amount in Words: </span>
                <span>{amountInWordsINR(invoice.totalInvoicePaise)}</span>
              </div>
            )}

            {/* Footer: Bank Details, Check-in/Check-out, Declaration, Authorised Signatory */}
            <div className="px-[42px] text-[12px] space-y-3">
              <div>
                <div className="font-bold mb-0.5">Bank Details</div>
                <div>Account Name: {biz.bankAccountName}</div>
                <div>Bank: {biz.bankName}</div>
                <div>Account Type: {biz.bankAccountType}</div>
                <div>Account No: {biz.bankAccountNo}</div>
                <div>IFSC: {biz.bankIfsc}</div>
                <div>Branch: {biz.bankBranch}</div>
              </div>

              <div>
                Standard Check-in: {biz.standardCheckIn} | Standard Check-out: {biz.standardCheckOut}
              </div>

              <div>
                <div className="font-bold mb-0.5">Declaration</div>
                <div>{biz.declarationText}</div>
              </div>

              <div className="pt-2">
                <div className="font-bold mb-0.5">Authorised Signatory</div>
                <div>{biz.authorisedSignatory}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
