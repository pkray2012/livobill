import React, { useEffect, useState } from 'react';
import {
  Ban,
  Copy,
  CreditCard,
  Download,
  Eye,
  FileSpreadsheet,
  Plus,
  Search,
  X,
  Edit3,
} from 'lucide-react';
import { apiRequest, downloadInvoicePdf } from '../api/client';
import { InvoicePreviewCard } from './InvoicePreviewCard';
import { formatIndianAmount, rupeesToPaise } from '../../shared/calculations';
import { formatInvoiceDateDisplay, getKolkataTodayDate } from '../../shared/dates';
import type { InvoiceRecord, PaymentMethod, User } from '../../shared/types';

interface InvoiceHistoryViewProps {
  currentUser: User;
  staffCanCancelGlobal: boolean;
  staffCreators: Array<{ id: string; fullName: string; email: string }>;
  logoSrc: string;
  initialSelectedInvoice?: InvoiceRecord | null;
  onEditDraft: (invoice: InvoiceRecord) => void;
  onClearInitialSelected: () => void;
}

export const InvoiceHistoryView: React.FC<InvoiceHistoryViewProps> = ({
  currentUser,
  staffCanCancelGlobal,
  staffCreators,
  logoSrc,
  initialSelectedInvoice,
  onEditDraft,
  onClearInitialSelected,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [documentType, setDocumentType] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [invoiceStatus, setInvoiceStatus] = useState('');
  const [createdBy, setCreatedBy] = useState('');
  const [page, setPage] = useState(1);

  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modals
  const [inspectInvoice, setInspectInvoice] = useState<InvoiceRecord | null>(
    initialSelectedInvoice || null
  );
  const [paymentModalInvoice, setPaymentModalInvoice] = useState<InvoiceRecord | null>(null);
  const [cancelModalInvoice, setCancelModalInvoice] = useState<InvoiceRecord | null>(null);

  // Payment Form State
  const [payAmountRupees, setPayAmountRupees] = useState('');
  const [payDate, setPayDate] = useState(getKolkataTodayDate());
  const [payMethod, setPayMethod] = useState<PaymentMethod>('UPI');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payIdemKey, setPayIdemKey] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);

  // Cancel Form State
  const [cancelReason, setCancelReason] = useState('');
  const [savingCancel, setSavingCancel] = useState(false);

  const canCancel =
    currentUser.role === 'admin' || currentUser.canCancelInvoices || staffCanCancelGlobal;

  const buildFilterParams = (targetPage = page) => {
    const qs = new URLSearchParams();
    if (searchQuery.trim()) qs.set('q', searchQuery.trim());
    if (fromDate) qs.set('from', fromDate);
    if (toDate) qs.set('to', toDate);
    if (documentType) qs.set('documentType', documentType);
    if (paymentStatus) qs.set('paymentStatus', paymentStatus);
    if (invoiceStatus) qs.set('status', invoiceStatus);
    if (createdBy) qs.set('createdBy', createdBy);
    qs.set('page', String(targetPage));
    qs.set('pageSize', '20');
    return qs;
  };

  const loadHistory = async (targetPage = page) => {
    setLoading(true);
    setError(null);
    try {
      const qs = buildFilterParams(targetPage);
      const data = await apiRequest(`/api/invoices?${qs.toString()}`);
      setInvoices(data.invoices);
      setTotalCount(data.totalCount);
      setTotalPages(data.totalPages);
      setPage(data.page);
    } catch (err: any) {
      setError(err.message || 'Failed to load invoice history.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory(1);
  }, []);

  useEffect(() => {
    if (initialSelectedInvoice) {
      setInspectInvoice(initialSelectedInvoice);
    }
  }, [initialSelectedInvoice]);

  const handleDuplicate = async (inv: InvoiceRecord) => {
    try {
      setError(null);
      const data = await apiRequest<{ invoice: InvoiceRecord }>(
        `/api/invoices/${inv.id}/duplicate`,
        { method: 'POST', body: JSON.stringify({}) }
      );
      onEditDraft(data.invoice);
    } catch (err: any) {
      setError(err.message || 'Failed to duplicate invoice.');
    }
  };

  const openPaymentModal = (inv: InvoiceRecord) => {
    setPaymentModalInvoice(inv);
    setPayAmountRupees(
      inv.balancePayablePaise > 0 ? String(inv.balancePayablePaise / 100) : ''
    );
    setPayDate(getKolkataTodayDate());
    setPayMethod('UPI');
    setPayRef('');
    setPayNotes('');
    setPayIdemKey(`pay-${inv.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentModalInvoice || savingPayment) return;
    setSavingPayment(true);
    setError(null);
    try {
      const data = await apiRequest<{ invoice: InvoiceRecord }>(
        `/api/invoices/${paymentModalInvoice.id}/payments`,
        {
          method: 'POST',
          body: JSON.stringify({
            amountPaise: rupeesToPaise(payAmountRupees),
            paymentDate: payDate,
            paymentMethod: payMethod,
            transactionReference: payRef,
            notes: payNotes,
            idempotencyKey: payIdemKey,
          }),
        }
      );
      setPaymentModalInvoice(data.invoice);
      setPayAmountRupees(
        data.invoice.balancePayablePaise > 0
          ? String(data.invoice.balancePayablePaise / 100)
          : ''
      );
      setPayRef('');
      setPayNotes('');
      setPayIdemKey(`pay-${data.invoice.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      await loadHistory(page);
    } catch (err: any) {
      setError(err.message || 'Failed to record payment.');
    } finally {
      setSavingPayment(false);
    }
  };

  const handleCancelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelModalInvoice || savingCancel) return;
    setSavingCancel(true);
    setError(null);
    try {
      await apiRequest(`/api/invoices/${cancelModalInvoice.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: cancelReason }),
      });
      setCancelModalInvoice(null);
      setCancelReason('');
      await loadHistory(page);
    } catch (err: any) {
      setError(err.message || 'Failed to cancel invoice.');
    } finally {
      setSavingCancel(false);
    }
  };

  const handleExportCsv = () => {
    const qs = buildFilterParams(1);
    window.open(`/api/invoices/export.csv?${qs.toString()}`, '_blank');
  };

  return (
    <div className="space-y-5">
      {/* Header & CSV Export */}
      <div className="bg-white p-5 rounded-xl border border-[#E6E1DA] shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-[#1F1E1C]">
            Invoice History &amp; Payment Ledger
          </h1>
          <p className="text-xs text-stone-600 mt-0.5">
            Search, filter, download original issued PDFs, record payments, duplicate as draft, or export CSV.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportCsv}
          className="inline-flex items-center gap-2 rounded-lg border border-[#1F1E1C] bg-white hover:bg-[#FAF8F5] text-xs font-semibold text-[#1F1E1C] px-4 py-2.5"
        >
          <FileSpreadsheet className="w-4 h-4 text-[#C46A4A]" />
          Export Filtered CSV
        </button>
      </div>

      {/* Search & Filters */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          loadHistory(1);
        }}
        className="bg-white p-4 rounded-xl border border-[#E6E1DA] shadow-sm space-y-3"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="sm:col-span-2">
            <label htmlFor="hist-search" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
              Search Invoice No., Customer, Company, or Mobile
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
              <input
                id="hist-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="e.g. LPH/26-27/0001, company name, or mobile..."
                className="w-full rounded-lg border border-[#D6D0C4] pl-9 pr-3 py-2 text-xs"
              />
            </div>
          </div>

          <div>
            <label htmlFor="hist-from" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
              From Date
            </label>
            <input
              id="hist-from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs"
            />
          </div>

          <div>
            <label htmlFor="hist-to" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
              To Date
            </label>
            <input
              id="hist-to"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-[#1F1E1C] mb-1">
              Invoice Status
            </label>
            <select
              value={invoiceStatus}
              onChange={(e) => setInvoiceStatus(e.target.value)}
              className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs bg-white"
            >
              <option value="">All Statuses</option>
              <option value="Finalised">Finalised</option>
              <option value="Draft">Draft</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1F1E1C] mb-1">
              Payment Status
            </label>
            <select
              value={paymentStatus}
              onChange={(e) => setPaymentStatus(e.target.value)}
              className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs bg-white"
            >
              <option value="">All Payment States</option>
              <option value="Paid">Paid</option>
              <option value="Partially Paid">Partially Paid</option>
              <option value="Unpaid">Unpaid</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1F1E1C] mb-1">
              Document Type
            </label>
            <select
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
              className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs bg-white"
            >
              <option value="">All Document Types</option>
              <option value="GST_TAX_INVOICE">GST Tax Invoice</option>
              <option value="NON_GST_DOCUMENT">Non-GST Document</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1F1E1C] mb-1">
              Created By
            </label>
            <select
              value={createdBy}
              onChange={(e) => setCreatedBy(e.target.value)}
              className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs bg-white"
            >
              <option value="">All Staff / Admins</option>
              {staffCreators.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 rounded-lg bg-[#C46A4A] hover:bg-[#A85538] text-white font-semibold py-2 px-3 text-xs"
            >
              Apply Filters
            </button>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setFromDate('');
                setToDate('');
                setDocumentType('');
                setPaymentStatus('');
                setInvoiceStatus('');
                setCreatedBy('');
                setTimeout(() => loadHistory(1), 0);
              }}
              className="rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs text-stone-600 hover:text-[#1F1E1C]"
            >
              Reset
            </button>
          </div>
        </div>
      </form>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-xs text-red-800">
          {error}
        </div>
      )}

      {/* Results Table */}
      <div className="bg-white rounded-xl border border-[#E6E1DA] shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E6E1DA] flex items-center justify-between text-xs text-stone-600">
          <span>
            Showing <strong>{invoices.length}</strong> of <strong>{totalCount}</strong> record(s)
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => loadHistory(page - 1)}
                className="px-2.5 py-1 rounded border border-[#D6D0C4] disabled:opacity-40"
              >
                Previous
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => loadHistory(page + 1)}
                className="px-2.5 py-1 rounded border border-[#D6D0C4] disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="p-10 text-center text-xs text-stone-500">Loading invoices...</div>
        ) : invoices.length === 0 ? (
          <div className="p-10 text-center text-xs text-stone-500">
            No matching invoices found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#FAF8F5] border-b border-[#E6E1DA] text-stone-600 font-semibold">
                  <th className="py-3 px-4">Invoice No</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Customer / Company</th>
                  <th className="py-3 px-4">Stay</th>
                  <th className="py-3 px-4 text-right">Total (INR)</th>
                  <th className="py-3 px-4 text-right">Received</th>
                  <th className="py-3 px-4 text-right">Balance</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E1DA]">
                {invoices.map((inv) => {
                  const hasSubsequentPayments = inv.payments.some(
                    (p) => !p.isInitialAtFinalisation
                  );
                  return (
                    <tr key={inv.id} className="hover:bg-[#FAF8F5]/60">
                      <td className="py-3 px-4 font-semibold text-[#1F1E1C]">
                        <div>{inv.invoiceNumber || 'DRAFT'}</div>
                        <div className="text-[10px] text-stone-500 font-normal">
                          {inv.customerClassification} ·{' '}
                          {inv.documentType === 'NON_GST_DOCUMENT' ? 'Non-GST' : 'GST Tax Invoice'}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-stone-600">
                        {formatInvoiceDateDisplay(inv.invoiceDate)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-[#1F1E1C]">
                          {inv.companyName || inv.guestName}
                        </div>
                        {inv.companyName && (
                          <div className="text-[11px] text-stone-500">Guest: {inv.guestName}</div>
                        )}
                        {inv.customerGstin && (
                          <div className="text-[10px] font-mono text-stone-500">
                            GSTIN: {inv.customerGstin}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-stone-600">
                        {inv.roomCount} {inv.roomCount === 1 ? 'Rm' : 'Rms'} × {inv.billableNights}{' '}
                        {inv.billableNights === 1 ? 'Nt' : 'Nts'}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-[#1F1E1C]">
                        {formatIndianAmount(inv.totalInvoicePaise, {
                          includeCurrencySymbol: true,
                        })}
                      </td>
                      <td className="py-3 px-4 text-right text-emerald-800 font-medium">
                        {formatIndianAmount(inv.amountReceivedPaise, {
                          includeCurrencySymbol: true,
                        })}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold">
                        {formatIndianAmount(inv.balancePayablePaise, {
                          includeCurrencySymbol: true,
                        })}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${
                            inv.status === 'Cancelled'
                              ? 'bg-red-100 text-red-800'
                              : inv.status === 'Draft'
                                ? 'bg-amber-100 text-amber-800'
                                : inv.paymentStatus === 'Paid'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : inv.paymentStatus === 'Partially Paid'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-stone-200 text-stone-800'
                          }`}
                        >
                          {inv.status === 'Finalised'
                            ? `${inv.status} · ${inv.paymentStatus}`
                            : inv.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setInspectInvoice(inv)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#D6D0C4] hover:bg-stone-100 text-[#1F1E1C]"
                            title="View Invoice"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            View
                          </button>

                          {inv.status === 'Draft' ? (
                            <button
                              type="button"
                              onClick={() => onEditDraft(inv)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#C46A4A] text-white font-semibold"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              Edit
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => downloadInvoicePdf(inv, logoSrc, 'ORIGINAL')}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#F5E1DA] hover:bg-[#ebd0c7] font-semibold text-[#1F1E1C]"
                                title="Download Original Issued PDF"
                              >
                                <Download className="w-3.5 h-3.5" />
                                Original PDF
                              </button>
                              {hasSubsequentPayments && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    downloadInvoicePdf(inv, logoSrc, 'PAYMENT_SUMMARY')
                                  }
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#C46A4A] text-[#C46A4A] hover:bg-[#F5E1DA]/40 font-semibold"
                                  title="Download Updated Payment-Summary Copy"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  Payment Copy
                                </button>
                              )}
                            </>
                          )}

                          {inv.status !== 'Cancelled' && (
                            <button
                              type="button"
                              onClick={() => openPaymentModal(inv)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#D6D0C4] hover:bg-stone-100 text-[#1F1E1C]"
                              title="View / Record Payments"
                            >
                              <CreditCard className="w-3.5 h-3.5 text-emerald-700" />
                              Payments ({inv.payments.length})
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleDuplicate(inv)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#D6D0C4] hover:bg-stone-100 text-[#1F1E1C]"
                            title="Duplicate as new Draft without invoice number or payments"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            Duplicate
                          </button>

                          {inv.status === 'Finalised' && canCancel && (
                            <button
                              type="button"
                              onClick={() => {
                                setCancelModalInvoice(inv);
                                setCancelReason('');
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50"
                              title="Cancel Invoice"
                            >
                              <Ban className="w-3.5 h-3.5" />
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal 1: View / Inspect Invoice A4 Preview */}
      {inspectInvoice && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[#FAF8F5] rounded-2xl border border-[#E6E1DA] shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 bg-white border-b border-[#E6E1DA] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[#1F1E1C]">
                  Invoice Preview — {inspectInvoice.invoiceNumber || 'DRAFT'}
                </h3>
                <p className="text-xs text-stone-500">
                  {inspectInvoice.companyName || inspectInvoice.guestName} · Status:{' '}
                  {inspectInvoice.status}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setInspectInvoice(null);
                  onClearInitialSelected();
                }}
                className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              <InvoicePreviewCard invoice={inspectInvoice} logoSrc={logoSrc} showActions={true} />
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Payment Ledger & Record New Payment */}
      {paymentModalInvoice && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-[#E6E1DA] shadow-2xl max-w-2xl w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E6E1DA] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[#1F1E1C]">
                  Payment Ledger — {paymentModalInvoice.invoiceNumber || 'DRAFT'}
                </h3>
                <p className="text-xs text-stone-500">
                  Original issued PDF is preserved untouched when subsequent payments are recorded.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPaymentModalInvoice(null)}
                className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Summary Bar */}
              <div className="grid grid-cols-3 gap-3 bg-[#FAF8F5] p-3.5 rounded-xl border border-[#E6E1DA] text-xs">
                <div>
                  <div className="text-stone-500">Total Invoice Value</div>
                  <div className="font-bold text-sm text-[#1F1E1C]">
                    {formatIndianAmount(paymentModalInvoice.totalInvoicePaise, {
                      includeCurrencySymbol: true,
                    })}
                  </div>
                </div>
                <div>
                  <div className="text-stone-500">Amount Received</div>
                  <div className="font-bold text-sm text-emerald-800">
                    {formatIndianAmount(paymentModalInvoice.amountReceivedPaise, {
                      includeCurrencySymbol: true,
                    })}
                  </div>
                </div>
                <div>
                  <div className="text-stone-500">
                    {paymentModalInvoice.creditRefundDuePaise > 0
                      ? 'Credit / Refund Due'
                      : 'Balance Payable'}
                  </div>
                  <div className="font-bold text-sm text-[#C46A4A]">
                    {formatIndianAmount(
                      paymentModalInvoice.creditRefundDuePaise > 0
                        ? paymentModalInvoice.creditRefundDuePaise
                        : paymentModalInvoice.balancePayablePaise,
                      { includeCurrencySymbol: true }
                    )}
                  </div>
                </div>
              </div>

              {/* Existing Payments Table */}
              <div>
                <h4 className="text-xs font-bold text-[#1F1E1C] mb-2">Recorded Payments</h4>
                {paymentModalInvoice.payments.length === 0 ? (
                  <p className="text-xs text-stone-500">No payments recorded yet.</p>
                ) : (
                  <div className="border border-[#E6E1DA] rounded-lg overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#FAF8F5] border-b border-[#E6E1DA] text-stone-600">
                        <tr>
                          <th className="py-2 px-3">Date</th>
                          <th className="py-2 px-3">Method</th>
                          <th className="py-2 px-3">Reference</th>
                          <th className="py-2 px-3">Recorded By</th>
                          <th className="py-2 px-3 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E6E1DA]">
                        {paymentModalInvoice.payments.map((p) => (
                          <tr key={p.id}>
                            <td className="py-2 px-3">{formatInvoiceDateDisplay(p.paymentDate)}</td>
                            <td className="py-2 px-3 font-medium">{p.paymentMethod}</td>
                            <td className="py-2 px-3 text-stone-500">
                              {p.transactionReference || '—'}
                            </td>
                            <td className="py-2 px-3 text-stone-500">
                              <div>{p.recordedByName}</div>
                              <div className="text-[10px]">
                                {new Date(p.recordedAt).toLocaleString('en-IN', {
                                  timeZone: 'Asia/Kolkata',
                                })}
                              </div>
                            </td>
                            <td className="py-2 px-3 text-right font-semibold">
                              {formatIndianAmount(p.amountPaise, {
                                includeCurrencySymbol: true,
                              })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Add Payment Form */}
              <form
                onSubmit={handleRecordPayment}
                className="border-t border-[#E6E1DA] pt-4 space-y-3"
              >
                <h4 className="text-xs font-bold text-[#1F1E1C]">Record New Payment</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                      Amount (₹) <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="number"
                      min={0.01}
                      step="0.01"
                      required
                      value={payAmountRupees}
                      onChange={(e) => setPayAmountRupees(e.target.value)}
                      className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                      Payment Method
                    </label>
                    <select
                      value={payMethod}
                      onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                      className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs bg-white"
                    >
                      <option value="UPI">UPI</option>
                      <option value="Cash">Cash</option>
                      <option value="Card">Card</option>
                      <option value="Bank Transfer">Bank Transfer</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                      Payment Date
                    </label>
                    <input
                      type="date"
                      required
                      value={payDate}
                      onChange={(e) => setPayDate(e.target.value)}
                      className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                      Transaction Reference / UTR (Optional)
                    </label>
                    <input
                      type="text"
                      value={payRef}
                      onChange={(e) => setPayRef(e.target.value)}
                      placeholder="e.g. UPI-62918374"
                      className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                      Notes (Optional)
                    </label>
                    <input
                      type="text"
                      value={payNotes}
                      onChange={(e) => setPayNotes(e.target.value)}
                      placeholder="Settlement remarks"
                      className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setPaymentModalInvoice(null)}
                    className="rounded-lg border border-[#D6D0C4] px-4 py-2 text-xs font-semibold"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={savingPayment}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#C46A4A] hover:bg-[#A85538] text-white font-semibold px-4 py-2 text-xs disabled:opacity-50"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {savingPayment ? 'Recording...' : 'Record Payment'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: Controlled Invoice Cancellation */}
      {cancelModalInvoice && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#E6E1DA] shadow-2xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#E6E1DA] pb-3">
              <h3 className="text-sm font-bold text-red-800">
                Cancel Invoice {cancelModalInvoice.invoiceNumber}
              </h3>
              <button
                type="button"
                onClick={() => setCancelModalInvoice(null)}
                className="p-1 text-stone-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-stone-600">
              Cancelling an issued invoice preserves the original document and marks the invoice as{' '}
              <strong>Cancelled</strong> in the audit ledger. Cancelled invoice numbers are never reused.
            </p>
            <form onSubmit={handleCancelSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  Mandatory Cancellation Reason <span className="text-red-600">*</span>
                </label>
                <textarea
                  rows={3}
                  required
                  minLength={5}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="State the reason for cancelling this invoice (minimum 5 characters)..."
                  className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCancelModalInvoice(null)}
                  className="rounded-lg border border-[#D6D0C4] px-4 py-2 text-xs font-semibold"
                >
                  Keep Active
                </button>
                <button
                  type="submit"
                  disabled={savingCancel}
                  className="rounded-lg bg-red-700 hover:bg-red-800 text-white font-semibold px-4 py-2 text-xs disabled:opacity-50"
                >
                  {savingCancel ? 'Cancelling...' : 'Confirm Cancellation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
