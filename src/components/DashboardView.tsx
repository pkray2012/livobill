import React, { useEffect, useState } from 'react';
import {
  Calendar,
  Download,
  FilePlus2,
  FileText,
  IndianRupee,
  RefreshCw,
  ArrowUpRight,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import { apiRequest, downloadInvoicePdf } from '../api/client';
import { formatIndianAmount } from '../../shared/calculations';
import { formatInvoiceDateDisplay } from '../../shared/dates';
import type { InvoiceRecord } from '../../shared/types';

interface DashboardViewProps {
  logoSrc: string;
  onCreateNewInvoice: () => void;
  onOpenInvoiceInHistory: (invoice: InvoiceRecord) => void;
  onEditDraftInvoice: (invoice: InvoiceRecord) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  logoSrc,
  onCreateNewInvoice,
  onOpenInvoiceInHistory,
  onEditDraftInvoice,
}) => {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{
    finalisedCount: number;
    draftCount: number;
    cancelledCount: number;
    billedAmountPaise: number;
    receivedAmountPaise: number;
    outstandingAmountPaise: number;
    recentInvoices: InvoiceRecord[];
  }>({
    finalisedCount: 0,
    draftCount: 0,
    cancelledCount: 0,
    billedAmountPaise: 0,
    receivedAmountPaise: 0,
    outstandingAmountPaise: 0,
    recentInvoices: [],
  });

  const loadDashboard = async (from = fromDate, to = toDate) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      const data = await apiRequest(`/api/dashboard?${qs.toString()}`);
      setStats(data);
    } catch (err: any) {
      console.warn('Dashboard stats note:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const applyCurrentFinancialYear = () => {
    const f = '2026-04-01';
    const t = '2027-03-31';
    setFromDate(f);
    setToDate(t);
    loadDashboard(f, t);
  };

  const clearDates = () => {
    setFromDate('');
    setToDate('');
    loadDashboard('', '');
  };

  return (
    <div className="space-y-6">
      {/* Header & Quick Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-xl border border-[#E6E1DA] shadow-sm">
        <div>
          <h1 className="text-lg font-bold text-[#1F1E1C]">Billing Operations Overview</h1>
          <p className="text-xs text-stone-600 mt-0.5">
            Operational billing &amp; collection metrics for finalised invoices (figures reflect billing ledger totals, not recognised accounting revenue).
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateNewInvoice}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#C46A4A] hover:bg-[#A85538] text-white font-semibold px-4 py-2.5 text-sm shadow-sm transition-colors"
        >
          <FilePlus2 className="w-4 h-4" />
          Create New Invoice
        </button>
      </div>

      {/* Date Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-[#E6E1DA] shadow-sm flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="dash-from" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
            Invoice Date From
          </label>
          <input
            id="dash-from"
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded-lg border border-[#D6D0C4] px-3 py-1.5 text-xs text-[#1F1E1C]"
          />
        </div>
        <div>
          <label htmlFor="dash-to" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
            Invoice Date To
          </label>
          <input
            id="dash-to"
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded-lg border border-[#D6D0C4] px-3 py-1.5 text-xs text-[#1F1E1C]"
          />
        </div>
        <button
          type="button"
          onClick={() => loadDashboard(fromDate, toDate)}
          className="rounded-lg bg-[#1F1E1C] text-white px-3.5 py-2 text-xs font-semibold hover:bg-stone-800"
        >
          Apply Date Filter
        </button>
        <button
          type="button"
          onClick={applyCurrentFinancialYear}
          className="rounded-lg border border-[#D6D0C4] bg-[#FAF8F5] hover:bg-stone-100 px-3 py-2 text-xs font-medium text-[#1F1E1C] inline-flex items-center gap-1.5"
        >
          <Calendar className="w-3.5 h-3.5 text-[#C46A4A]" />
          FY 2026–27
        </button>
        {(fromDate || toDate) && (
          <button
            type="button"
            onClick={clearDates}
            className="rounded-lg border border-[#D6D0C4] px-3 py-2 text-xs text-stone-600 hover:text-[#1F1E1C]"
          >
            Clear Filter
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-xs text-red-800">
          {error}
        </div>
      )}

      {/* Four Core Operational Figures */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-[#E6E1DA] shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-stone-500 uppercase tracking-wider">
            <span>Finalised Invoices</span>
            <FileText className="w-4 h-4 text-[#C46A4A]" />
          </div>
          <div className="mt-2 text-2xl font-bold text-[#1F1E1C]">{stats.finalisedCount}</div>
          <div className="mt-1 text-xs text-stone-500">
            {stats.draftCount} Draft(s) · {stats.cancelledCount} Cancelled
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E6E1DA] shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-stone-500 uppercase tracking-wider">
            <span>Total Billed Amount</span>
            <IndianRupee className="w-4 h-4 text-[#C46A4A]" />
          </div>
          <div className="mt-2 text-2xl font-bold text-[#1F1E1C]">
            {formatIndianAmount(stats.billedAmountPaise, { includeCurrencySymbol: true })}
          </div>
          <div className="mt-1 text-xs text-stone-500">
            Gross value of finalised bills (incl. GST)
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E6E1DA] shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-stone-500 uppercase tracking-wider">
            <span>Payments Received</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-800">
            {formatIndianAmount(stats.receivedAmountPaise, { includeCurrencySymbol: true })}
          </div>
          <div className="mt-1 text-xs text-stone-500">
            Recorded in payment ledger on finalised bills
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E6E1DA] shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-stone-500 uppercase tracking-wider">
            <span>Outstanding Balance</span>
            <Clock className="w-4 h-4 text-amber-700" />
          </div>
          <div className="mt-2 text-2xl font-bold text-amber-800">
            {formatIndianAmount(stats.outstandingAmountPaise, { includeCurrencySymbol: true })}
          </div>
          <div className="mt-1 text-xs text-stone-500">
            Balance payable across unpaid/partially paid bills
          </div>
        </div>
      </div>

      {/* Recent Invoices Table */}
      <div className="bg-white rounded-xl border border-[#E6E1DA] shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E6E1DA] flex items-center justify-between">
          <h2 className="text-sm font-bold text-[#1F1E1C]">Recent Billing Activity</h2>
          <button
            type="button"
            onClick={() => loadDashboard()}
            className="inline-flex items-center gap-1 text-xs font-medium text-stone-600 hover:text-[#1F1E1C]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {stats.recentInvoices.length === 0 ? (
          <div className="p-10 text-center text-sm text-stone-500">
            No invoices recorded in this period yet. Click <strong>Create New Invoice</strong> to generate a guest or corporate bill.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#FAF8F5] border-b border-[#E6E1DA] text-stone-600 font-semibold">
                  <th className="py-3 px-4">Invoice No</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Customer / Company</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4 text-right">Total (INR)</th>
                  <th className="py-3 px-4 text-right">Balance (INR)</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E1DA]">
                {stats.recentInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-[#FAF8F5]/60">
                    <td className="py-3 px-4 font-semibold text-[#1F1E1C]">
                      {inv.invoiceNumber || (
                        <span className="text-amber-700 font-medium">DRAFT</span>
                      )}
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
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-stone-100 text-stone-700 font-medium">
                        {inv.customerClassification}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-[#1F1E1C]">
                      {formatIndianAmount(inv.totalInvoicePaise, { includeCurrencySymbol: true })}
                    </td>
                    <td className="py-3 px-4 text-right font-medium">
                      {formatIndianAmount(inv.balancePayablePaise, { includeCurrencySymbol: true })}
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
                        {inv.status === 'Finalised' ? inv.paymentStatus : inv.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      {inv.status === 'Draft' ? (
                        <button
                          type="button"
                          onClick={() => onEditDraftInvoice(inv)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[#D6D0C4] hover:bg-stone-100 font-medium text-[#1F1E1C]"
                        >
                          Edit Draft
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => downloadInvoicePdf(inv, logoSrc, 'ORIGINAL')}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#F5E1DA] hover:bg-[#ebd0c7] font-semibold text-[#1F1E1C]"
                          >
                            <Download className="w-3 h-3" />
                            PDF
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenInvoiceInHistory(inv)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[#D6D0C4] hover:bg-stone-100 font-medium text-[#1F1E1C]"
                          >
                            View
                            <ArrowUpRight className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
