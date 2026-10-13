import React, { useEffect, useMemo, useState } from 'react';
import { FilePlus2, Plus, Search, UserPlus, Edit2, X } from 'lucide-react';
import { apiRequest } from '../api/client';
import { INDIAN_GST_STATES, validateGstin } from '../../shared/gstin';
import type { Customer, CustomerClassification } from '../../shared/types';

interface CustomersViewProps {
  onSelectCustomerForNewInvoice: (customer: Customer) => void;
}

export const CustomersView: React.FC<CustomersViewProps> = ({
  onSelectCustomerForNewInvoice,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [classification, setClassification] = useState<CustomerClassification>('B2B');
  const [guestName, setGuestName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [stateCode, setStateCode] = useState('21');
  const [stateName, setStateName] = useState('Odisha');
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [cin, setCin] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);

  const loadCustomers = async (q = searchQuery) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{ customers: Customer[] }>(
        `/api/customers?q=${encodeURIComponent(q.trim())}`
      );
      setCustomers(data.customers);
    } catch (err: any) {
      setError(err.message || 'Failed to load customers.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers('');
  }, []);

  const gstCheck = useMemo(() => {
    if (!gstin.trim()) return null;
    return validateGstin(gstin);
  }, [gstin]);

  const openModal = (cust?: Customer) => {
    if (cust) {
      setEditingId(cust.id);
      setClassification(cust.classification);
      setGuestName(cust.guestName);
      setCompanyName(cust.companyName || '');
      setBillingAddress(cust.billingAddress);
      setStateCode(cust.stateCode || '21');
      setStateName(cust.stateName || 'Odisha');
      setGstin(cust.gstin || '');
      setPan(cust.pan || '');
      setCin(cust.cin || '');
      setMobile(cust.mobile || '');
      setEmail(cust.email || '');
    } else {
      setEditingId(undefined);
      setClassification('B2B');
      setGuestName('');
      setCompanyName('');
      setBillingAddress('');
      setStateCode('21');
      setStateName('Odisha');
      setGstin('');
      setPan('');
      setCin('');
      setMobile('');
      setEmail('');
    }
    setModalOpen(true);
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiRequest('/api/customers', {
        method: 'POST',
        body: JSON.stringify({
          id: editingId,
          classification,
          guestName,
          companyName,
          billingAddress,
          stateCode,
          stateName,
          gstin,
          pan,
          cin,
          mobile,
          email,
        }),
      });
      setModalOpen(false);
      await loadCustomers();
    } catch (err: any) {
      setError(err.message || 'Could not save customer.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white p-5 rounded-xl border border-[#E6E1DA] shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-[#1F1E1C]">Customers Directory</h1>
          <p className="text-xs text-stone-600 mt-0.5">
            Manage verified B2B corporate billing profiles and B2C guest records. Production database is never pre-populated from sample PDFs.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openModal()}
          className="inline-flex items-center gap-2 rounded-lg bg-[#C46A4A] hover:bg-[#A85538] text-white font-semibold px-4 py-2.5 text-xs shadow-sm"
        >
          <UserPlus className="w-4 h-4" />
          Add Customer Profile
        </button>
      </div>

      {/* Search Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          loadCustomers(searchQuery);
        }}
        className="bg-white p-4 rounded-xl border border-[#E6E1DA] shadow-sm flex gap-3"
      >
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by guest name, company legal name, GSTIN, or mobile..."
            className="w-full rounded-lg border border-[#D6D0C4] pl-9 pr-3 py-2 text-xs"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-[#1F1E1C] text-white px-4 py-2 text-xs font-semibold"
        >
          Search
        </button>
      </form>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-xs text-red-800">
          {error}
        </div>
      )}

      {/* Customers Table */}
      <div className="bg-white rounded-xl border border-[#E6E1DA] shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-xs text-stone-500">Loading customer profiles...</div>
        ) : customers.length === 0 ? (
          <div className="p-10 text-center text-xs text-stone-500">
            No customers saved yet. Click <strong>Add Customer Profile</strong> or save a customer while creating an invoice.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#FAF8F5] border-b border-[#E6E1DA] text-stone-600 font-semibold">
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Company / Guest Name</th>
                  <th className="py-3 px-4">GSTIN / PAN</th>
                  <th className="py-3 px-4">State</th>
                  <th className="py-3 px-4">Contact</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E1DA]">
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-[#FAF8F5]/60">
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded font-semibold text-[11px] ${
                          c.classification === 'B2B'
                            ? 'bg-[#F5E1DA] text-[#C46A4A]'
                            : 'bg-stone-100 text-stone-700'
                        }`}
                      >
                        {c.classification}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-[#1F1E1C]">
                        {c.companyName || c.guestName}
                      </div>
                      {c.companyName && (
                        <div className="text-[11px] text-stone-500">Contact: {c.guestName}</div>
                      )}
                      <div className="text-[11px] text-stone-500 line-clamp-1">
                        {c.billingAddress}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono">
                      <div>{c.gstin || '—'}</div>
                      {c.pan && <div className="text-[10px] text-stone-500">PAN: {c.pan}</div>}
                    </td>
                    <td className="py-3 px-4 text-stone-600">
                      {c.stateName} ({c.stateCode})
                    </td>
                    <td className="py-3 px-4 text-stone-600">
                      <div>{c.mobile || '—'}</div>
                      {c.email && <div className="text-[11px] text-stone-500">{c.email}</div>}
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => openModal(c)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[#D6D0C4] hover:bg-stone-100 text-[#1F1E1C]"
                      >
                        <Edit2 className="w-3 h-3" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onSelectCustomerForNewInvoice(c)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#C46A4A] hover:bg-[#A85538] text-white font-semibold"
                      >
                        <FilePlus2 className="w-3 h-3" />
                        New Invoice
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Customer Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-[#E6E1DA] shadow-2xl max-w-lg w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#E6E1DA] pb-3">
              <h3 className="text-sm font-bold text-[#1F1E1C]">
                {editingId ? 'Edit Customer Profile' : 'New Customer Profile'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 text-stone-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCustomer} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setClassification('B2B')}
                  className={`py-2 px-3 rounded-lg border font-semibold ${
                    classification === 'B2B'
                      ? 'border-[#C46A4A] bg-[#F5E1DA]/50 text-[#1F1E1C]'
                      : 'border-[#D6D0C4]'
                  }`}
                >
                  B2B Registered Business
                </button>
                <button
                  type="button"
                  onClick={() => setClassification('B2C')}
                  className={`py-2 px-3 rounded-lg border font-semibold ${
                    classification === 'B2C'
                      ? 'border-[#C46A4A] bg-[#F5E1DA]/50 text-[#1F1E1C]'
                      : 'border-[#D6D0C4]'
                  }`}
                >
                  B2C Individual Guest
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Guest / Contact Name *</label>
                  <input
                    type="text"
                    required
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Company Legal Name</label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold mb-1">Billing Address *</label>
                <textarea
                  rows={3}
                  required
                  value={billingAddress}
                  onChange={(e) => setBillingAddress(e.target.value)}
                  className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">State</label>
                  <select
                    value={stateCode}
                    onChange={(e) => {
                      const code = e.target.value;
                      const st = INDIAN_GST_STATES.find((s) => s.code === code);
                      setStateCode(code);
                      if (st) setStateName(st.name);
                    }}
                    className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 bg-white"
                  >
                    {INDIAN_GST_STATES.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.name} ({s.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">
                    GSTIN {classification === 'B2B' ? '*' : '(Optional)'}
                  </label>
                  <input
                    type="text"
                    maxLength={15}
                    value={gstin}
                    onChange={(e) => {
                      const val = e.target.value.toUpperCase().replace(/\s+/g, '');
                      setGstin(val);
                      const check = validateGstin(val);
                      if (check.isValid && check.stateCode && check.stateName) {
                        setStateCode(check.stateCode);
                        setStateName(check.stateName);
                        if (check.pan && !pan) setPan(check.pan);
                      }
                    }}
                    className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 font-mono uppercase"
                  />
                </div>
              </div>

              {gstCheck && !gstCheck.isValid && (
                <p className="text-[11px] text-red-700">{gstCheck.error}</p>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">PAN</label>
                  <input
                    type="text"
                    maxLength={10}
                    value={pan}
                    onChange={(e) => setPan(e.target.value.toUpperCase())}
                    className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 font-mono uppercase"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">CIN</label>
                  <input
                    type="text"
                    value={cin}
                    onChange={(e) => setCin(e.target.value.toUpperCase())}
                    className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2 font-mono uppercase"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Mobile</label>
                  <input
                    type="tel"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-[#D6D0C4] px-3 py-2"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#E6E1DA]">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-[#D6D0C4] px-4 py-2 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#C46A4A] hover:bg-[#A85538] text-white font-semibold px-4 py-2"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {saving ? 'Saving...' : 'Save Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
