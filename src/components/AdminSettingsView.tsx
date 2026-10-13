import React, { useEffect, useState } from 'react';
import {
  Building2,
  Percent,
  Hash,
  Upload,
  Download,
  ShieldAlert,
  CheckCircle2,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { apiRequest } from '../api/client';
import type {
  BusinessSettings,
  TaxConfiguration,
  InvoiceSeries,
  RoundingPolicy,
  ServiceCategory,
} from '../../shared/types';
import { INDIAN_GST_STATES, validateGstin } from '../../shared/gstin';

interface AuditEventItem {
  id: string;
  actorEmail: string | null;
  actorRole: string | null;
  eventType: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  createdAt: string;
}

interface AdminSettingsViewProps {
  settings: BusinessSettings;
  taxConfigs: TaxConfiguration[];
  seriesList: InvoiceSeries[];
  logoSrc: string;
  onRefreshConfig: () => Promise<void>;
}

export const AdminSettingsView: React.FC<AdminSettingsViewProps> = ({
  settings: initialSettings,
  taxConfigs,
  seriesList,
  logoSrc,
  onRefreshConfig,
}) => {
  const [activeTab, setActiveTab] = useState<'hotel' | 'tax' | 'series' | 'backup' | 'audit'>('hotel');
  const [form, setForm] = useState<BusinessSettings>(initialSettings);
  const [nonGstReasonsText, setNonGstReasonsText] = useState<string>(
    (initialSettings.nonGstAllowedReasons || []).join('\n')
  );
  const [savingSettings, setSavingSettings] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // New Tax Rule form
  const [showNewTaxModal, setShowNewTaxModal] = useState(false);
  const [taxCode, setTaxCode] = useState('');
  const [taxName, setTaxName] = useState('');
  const [taxServiceCategory, setTaxServiceCategory] = useState<ServiceCategory>('other');
  const [taxDefaultSac, setTaxDefaultSac] = useState('996311');
  const [taxMode, setTaxMode] = useState<'cgst_sgst' | 'igst' | 'exempt'>('cgst_sgst');
  const [taxCgstRateBps, setTaxCgstRateBps] = useState(250);
  const [taxSgstRateBps, setTaxSgstRateBps] = useState(250);
  const [taxIgstRateBps, setTaxIgstRateBps] = useState(0);
  const [taxEffectiveFrom, setTaxEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [taxEffectiveTo, setTaxEffectiveTo] = useState('');
  const [taxNotes, setTaxNotes] = useState('');

  // New Invoice Series form
  const activeSeries = seriesList.find((s) => s.isActive) || seriesList[0];
  const [prefix, setPrefix] = useState(activeSeries?.prefix || 'LPH');
  const [financialYear, setFinancialYear] = useState(activeSeries?.financialYear || '26-27');
  const [separator, setSeparator] = useState(activeSeries?.separator || '/');
  const [paddingDigits, setPaddingDigits] = useState(activeSeries?.paddingDigits || 4);
  const [nextNumber, setNextNumber] = useState(activeSeries?.nextNumber || 1);

  // Audit logs
  const [auditEvents, setAuditEvents] = useState<AuditEventItem[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  useEffect(() => {
    setForm(initialSettings);
    setNonGstReasonsText((initialSettings.nonGstAllowedReasons || []).join('\n'));
  }, [initialSettings]);

  const loadAuditLogs = async () => {
    setLoadingAudit(true);
    try {
      const res = await apiRequest<{ auditEvents: AuditEventItem[] }>('/api/admin/audit-events');
      setAuditEvents(res.auditEvents || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load audit events.');
    } finally {
      setLoadingAudit(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'audit') {
      loadAuditLogs();
    }
  }, [activeTab]);

  const handleSaveBusinessSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFeedback(null);

    const gstCheck = validateGstin(form.supplierGstin);
    if (!gstCheck.isValid) {
      setError(`Supplier GSTIN validation failed: ${gstCheck.error}`);
      return;
    }

    const allowedReasons = nonGstReasonsText
      .split('\n')
      .map((r) => r.trim())
      .filter(Boolean);

    setSavingSettings(true);
    try {
      await apiRequest('/api/admin/business-settings', {
        method: 'PUT',
        body: JSON.stringify({
          ...form,
          nonGstAllowedReasons: allowedReasons,
        }),
      });
      await onRefreshConfig();
      setFeedback(
        'Business settings saved. Newly finalised invoices will snapshot these updated settings; existing finalised invoices remain unchanged.'
      );
    } catch (err: any) {
      setError(err.message || 'Failed to update business settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleLogoFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setFeedback(null);

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Please upload a JPEG or PNG logo image.');
      return;
    }

    setUploadingLogo(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Failed to read image file'));
        reader.readAsDataURL(file);
      });

      const dimensions = await new Promise<{ width: number; height: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth || 1024, height: img.naturalHeight || 1024 });
        img.onerror = () => resolve({ width: 1024, height: 1024 });
        img.src = dataUrl;
      });

      await apiRequest('/api/admin/logo', {
        method: 'POST',
        body: JSON.stringify({
          dataUrl,
          width: dimensions.width,
          height: dimensions.height,
        }),
      });
      await onRefreshConfig();
      setFeedback(
        'New versioned logo uploaded to private storage. Existing finalised invoices keep their original logo snapshot.'
      );
    } catch (err: any) {
      setError(err.message || 'Logo upload failed.');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleToggleTaxRule = async (rule: TaxConfiguration, updates: Partial<TaxConfiguration>) => {
    setError(null);
    setFeedback(null);
    try {
      await apiRequest('/api/admin/tax-configurations', {
        method: 'POST',
        body: JSON.stringify({
          ...rule,
          ...updates,
        }),
      });
      await onRefreshConfig();
      setFeedback(`Updated tax configuration "${rule.name}".`);
    } catch (err: any) {
      setError(err.message || 'Failed to update tax rule.');
    }
  };

  const handleCreateTaxRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    try {
      await apiRequest('/api/admin/tax-configurations', {
        method: 'POST',
        body: JSON.stringify({
          code: taxCode.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
          name: taxName.trim(),
          serviceCategory: taxServiceCategory,
          defaultSac: taxDefaultSac.trim(),
          taxMode,
          cgstRateBps: taxMode === 'cgst_sgst' ? taxCgstRateBps : 0,
          sgstRateBps: taxMode === 'cgst_sgst' ? taxSgstRateBps : 0,
          igstRateBps: taxMode === 'igst' ? taxIgstRateBps : 0,
          isDefault: false,
          isActive: true,
          effectiveFrom: taxEffectiveFrom,
          effectiveTo: taxEffectiveTo || null,
          notes: taxNotes.trim() || null,
        }),
      });
      setShowNewTaxModal(false);
      await onRefreshConfig();
      setFeedback('New tax configuration saved.');
    } catch (err: any) {
      setError(err.message || 'Failed to save tax configuration.');
    }
  };

  const handleSaveSeries = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    try {
      const res = await apiRequest<{ sampleNumber: string }>('/api/admin/invoice-series', {
        method: 'POST',
        body: JSON.stringify({
          prefix: prefix.trim().toUpperCase(),
          financialYear: financialYear.trim(),
          separator: separator.trim() || '/',
          nextNumber,
          paddingDigits,
          isActive: true,
        }),
      });
      await onRefreshConfig();
      setFeedback(`Active invoice series updated. Next invoice number: ${res.sampleNumber}`);
    } catch (err: any) {
      setError(err.message || 'Failed to update invoice series.');
    }
  };

  const handleDownloadBackup = async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/export-backup', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Backup export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `livotel-billing-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setFeedback('Complete database backup JSON downloaded.');
    } catch (err: any) {
      setError(err.message || 'Failed to download backup.');
    }
  };

  const sampleNextNumber = `${prefix.trim().toUpperCase()}${separator}${financialYear.trim()}${separator}${String(
    nextNumber
  ).padStart(paddingDigits, '0')}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-charcoal tracking-tight">Admin Settings</h1>
          <p className="text-sm text-stone-600 mt-0.5">
            Manage hotel supplier details, versioned brand logo, GST/non-GST rules, invoice numbering, and backups.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5 bg-stone-200/70 p-1 rounded-lg">
          {[
            { id: 'hotel', label: 'Hotel & Bank', icon: Building2 },
            { id: 'tax', label: 'Tax & Document Rules', icon: Percent },
            { id: 'series', label: 'Invoice Series', icon: Hash },
            { id: 'backup', label: 'Backups & Recovery', icon: Download },
            { id: 'audit', label: 'Audit Log', icon: ShieldAlert },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id as any);
                  setError(null);
                  setFeedback(null);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                  activeTab === tab.id
                    ? 'bg-white text-charcoal shadow-sm'
                    : 'text-stone-600 hover:text-charcoal'
                }`}
              >
                <Icon className="w-3.5 h-3.5 text-livotel-orange" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div role="alert" className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {feedback && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-900 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {/* TAB 1: HOTEL, SUPPLIER, BANK & LOGO */}
      {activeTab === 'hotel' && (
        <div className="space-y-6">
          <div className="card-surface p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-lg border border-stone-200 bg-white p-1.5 flex items-center justify-center shrink-0">
                <img
                  src={logoSrc || '/livotel-logo.jpg'}
                  alt="Livotel Official Logo"
                  className="max-w-full max-h-full object-contain"
                />
              </div>
              <div>
                <h2 className="text-sm font-bold text-charcoal">Official Hotel Logo Snapshot</h2>
                <p className="text-xs text-stone-600 mt-0.5 max-w-xl">
                  Active Version ID: <span className="font-mono font-medium">{form.activeLogoVersionId || 'default-v1'}</span>. Uploading a new logo creates a new immutable version in Netlify Blobs without altering previously finalised invoices.
                </p>
              </div>
            </div>
            <label className="btn-secondary cursor-pointer text-xs shrink-0">
              <Upload className="w-4 h-4" />
              {uploadingLogo ? 'Uploading...' : 'Upload New Logo Version'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleLogoFileUpload}
                disabled={uploadingLogo}
                className="hidden"
              />
            </label>
          </div>

          <form onSubmit={handleSaveBusinessSettings} className="card-surface p-6 space-y-6">
            <div>
              <h2 className="text-base font-bold text-charcoal border-b border-stone-200 pb-2 mb-4">
                1. Hotel Identity & Supplier GST Registration
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="s-display-name" className="field-label">Display Heading (PDF Title)</label>
                  <input
                    id="s-display-name"
                    type="text"
                    required
                    value={form.displayName}
                    onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                    className="field-input font-semibold"
                  />
                </div>
                <div>
                  <label htmlFor="s-subtitle" className="field-label">Ownership Subtitle</label>
                  <input
                    id="s-subtitle"
                    type="text"
                    required
                    value={form.subtitle}
                    onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
                    className="field-input"
                  />
                </div>
                <div>
                  <label htmlFor="s-legal-name" className="field-label">Supplier Legal Name</label>
                  <input
                    id="s-legal-name"
                    type="text"
                    required
                    value={form.supplierLegalName}
                    onChange={(e) => setForm({ ...form, supplierLegalName: e.target.value })}
                    className="field-input"
                  />
                </div>
                <div>
                  <label htmlFor="s-gstin" className="field-label">Supplier GSTIN (15 chars)</label>
                  <input
                    id="s-gstin"
                    type="text"
                    required
                    maxLength={15}
                    value={form.supplierGstin}
                    onChange={(e) => setForm({ ...form, supplierGstin: e.target.value.toUpperCase() })}
                    className="field-input font-mono uppercase"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="s-address" className="field-label">Supplier Full Address (Multi-line)</label>
                  <textarea
                    id="s-address"
                    rows={3}
                    required
                    value={form.supplierAddress}
                    onChange={(e) => setForm({ ...form, supplierAddress: e.target.value })}
                    className="field-input"
                  />
                </div>
                <div>
                  <label htmlFor="s-pos" className="field-label">Default Place of Supply State</label>
                  <select
                    id="s-pos"
                    value={form.defaultStateCode}
                    onChange={(e) => {
                      const code = e.target.value;
                      const st = INDIAN_GST_STATES.find((s) => s.code === code);
                      setForm({
                        ...form,
                        defaultStateCode: code,
                        defaultPlaceOfSupply: st ? `${st.name} (${st.code})` : form.defaultPlaceOfSupply,
                      });
                    }}
                    className="field-input"
                  >
                    {INDIAN_GST_STATES.map((st) => (
                      <option key={st.code} value={st.code}>
                        {st.name} ({st.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="s-property" className="field-label">Property Name</label>
                  <input
                    id="s-property"
                    type="text"
                    required
                    value={form.propertyName}
                    onChange={(e) => setForm({ ...form, propertyName: e.target.value })}
                    className="field-input"
                  />
                </div>
                <div>
                  <label htmlFor="s-nature" className="field-label">Default Nature of Supply</label>
                  <input
                    id="s-nature"
                    type="text"
                    required
                    value={form.defaultNatureOfSupply}
                    onChange={(e) => setForm({ ...form, defaultNatureOfSupply: e.target.value })}
                    className="field-input"
                  />
                </div>
                <div>
                  <label htmlFor="s-sac" className="field-label">Default SAC</label>
                  <input
                    id="s-sac"
                    type="text"
                    required
                    value={form.defaultSac}
                    onChange={(e) => setForm({ ...form, defaultSac: e.target.value })}
                    className="field-input font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="s-rounding" className="field-label">Default GST Rounding Mode</label>
                  <select
                    id="s-rounding"
                    value={form.roundingPolicy}
                    onChange={(e) => setForm({ ...form, roundingPolicy: e.target.value as RoundingPolicy })}
                    className="field-input"
                  >
                    <option value="per_line">Per Line Item</option>
                    <option value="per_invoice">Per Invoice Summary</option>
                  </select>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-base font-bold text-charcoal border-b border-stone-200 pb-2 mb-4">
                2. Bank Details & Check-in / Signatory Policies
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="b-acc-name" className="field-label">Account Name</label>
                  <input
                    id="b-acc-name"
                    type="text"
                    required
                    value={form.bankAccountName}
                    onChange={(e) => setForm({ ...form, bankAccountName: e.target.value })}
                    className="field-input"
                  />
                </div>
                <div>
                  <label htmlFor="b-name" className="field-label">Bank Name</label>
                  <input
                    id="b-name"
                    type="text"
                    required
                    value={form.bankName}
                    onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                    className="field-input"
                  />
                </div>
                <div>
                  <label htmlFor="b-type" className="field-label">Account Type</label>
                  <input
                    id="b-type"
                    type="text"
                    required
                    value={form.bankAccountType}
                    onChange={(e) => setForm({ ...form, bankAccountType: e.target.value })}
                    className="field-input"
                  />
                </div>
                <div>
                  <label htmlFor="b-num" className="field-label">Account Number</label>
                  <input
                    id="b-num"
                    type="text"
                    required
                    value={form.bankAccountNo}
                    onChange={(e) => setForm({ ...form, bankAccountNo: e.target.value })}
                    className="field-input font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="b-ifsc" className="field-label">IFSC Code</label>
                  <input
                    id="b-ifsc"
                    type="text"
                    required
                    value={form.bankIfsc}
                    onChange={(e) => setForm({ ...form, bankIfsc: e.target.value.toUpperCase() })}
                    className="field-input font-mono uppercase"
                  />
                </div>
                <div>
                  <label htmlFor="b-branch" className="field-label">Branch</label>
                  <input
                    id="b-branch"
                    type="text"
                    required
                    value={form.bankBranch}
                    onChange={(e) => setForm({ ...form, bankBranch: e.target.value })}
                    className="field-input"
                  />
                </div>
                <div>
                  <label htmlFor="b-checkin" className="field-label">Standard Check-in Time</label>
                  <input
                    id="b-checkin"
                    type="text"
                    required
                    value={form.standardCheckIn}
                    onChange={(e) => setForm({ ...form, standardCheckIn: e.target.value })}
                    className="field-input"
                  />
                </div>
                <div>
                  <label htmlFor="b-checkout" className="field-label">Standard Check-out Time</label>
                  <input
                    id="b-checkout"
                    type="text"
                    required
                    value={form.standardCheckOut}
                    onChange={(e) => setForm({ ...form, standardCheckOut: e.target.value })}
                    className="field-input"
                  />
                </div>
                <div>
                  <label htmlFor="b-signatory" className="field-label">Authorised Signatory Name</label>
                  <input
                    id="b-signatory"
                    type="text"
                    required
                    value={form.authorisedSignatory}
                    onChange={(e) => setForm({ ...form, authorisedSignatory: e.target.value })}
                    className="field-input"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label htmlFor="b-decl" className="field-label">Invoice Declaration Text</label>
                  <input
                    id="b-decl"
                    type="text"
                    required
                    value={form.declarationText}
                    onChange={(e) => setForm({ ...form, declarationText: e.target.value })}
                    className="field-input"
                  />
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-base font-bold text-charcoal border-b border-stone-200 pb-2 mb-4">
                3. Non-GST Document & Staff Cancellation Policies
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-charcoal">
                    <input
                      type="checkbox"
                      checked={form.nonGstEnabled}
                      onChange={(e) => setForm({ ...form, nonGstEnabled: e.target.checked })}
                    />
                    Enable Non-GST Document option (e.g., BILL OF SUPPLY) when applicable
                  </label>

                  <div>
                    <label htmlFor="ng-title" className="field-label">Default Non-GST Document Title</label>
                    <select
                      id="ng-title"
                      value={form.nonGstDefaultTitle}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          nonGstDefaultTitle: e.target.value as 'BILL OF SUPPLY' | 'BILL',
                        })
                      }
                      className="field-input"
                    >
                      <option value="BILL OF SUPPLY">BILL OF SUPPLY</option>
                      <option value="BILL">BILL</option>
                    </select>
                  </div>

                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-charcoal">
                    <input
                      type="checkbox"
                      checked={form.showAmountInWords}
                      onChange={(e) => setForm({ ...form, showAmountInWords: e.target.checked })}
                    />
                    Display Amount in Words on invoice PDF
                  </label>
                </div>

                <div>
                  <label htmlFor="ng-reasons" className="field-label">
                    Allowed Non-GST Reasons (one per line; staff must select one)
                  </label>
                  <textarea
                    id="ng-reasons"
                    rows={4}
                    value={nonGstReasonsText}
                    onChange={(e) => setNonGstReasonsText(e.target.value)}
                    className="field-input text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button type="submit" disabled={savingSettings} className="btn-primary">
                {savingSettings ? 'Saving Settings...' : 'Save Hotel & Supplier Settings'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 2: TAX & DOCUMENT RULES */}
      {activeTab === 'tax' && (
        <div className="space-y-4">
          <div className="card-surface p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-charcoal">Configured GST & Service Rules</h2>
              <p className="text-xs text-stone-600 mt-0.5">
                Staff cannot arbitrarily type custom tax percentages. Default accommodation uses Odisha (21) as place of supply (2.5% CGST + 2.5% SGST).
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowNewTaxModal(true)}
              className="btn-primary text-xs shrink-0"
            >
              <Plus className="w-4 h-4" />
              Add Tax Configuration
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {taxConfigs.map((rule) => (
              <div key={rule.id} className="card-surface p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-charcoal text-sm">{rule.name}</span>
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-stone-100 text-stone-700">
                      {rule.code}
                    </span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-orange-50 text-livotel-orange border border-orange-200">
                      {rule.taxMode.toUpperCase()}
                    </span>
                    {rule.isDefault && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-800">
                        Default
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-stone-600 mt-1">
                    SAC: <span className="font-mono">{rule.defaultSac}</span> | Total Tax:{' '}
                    <strong>{(rule.totalRateBps / 100).toFixed(2)}%</strong> (
                    {rule.taxMode === 'igst'
                      ? `IGST ${(rule.igstRateBps / 100).toFixed(2)}%`
                      : rule.taxMode === 'exempt'
                        ? '0% Exempt / Non-GST'
                        : `CGST ${(rule.cgstRateBps / 100).toFixed(2)}% + SGST ${(rule.sgstRateBps / 100).toFixed(2)}%`}
                    ) | Effective from: {rule.effectiveFrom}
                    {rule.effectiveTo ? ` to ${rule.effectiveTo}` : ''}
                  </p>
                  {rule.notes && <p className="text-xs text-stone-500 mt-0.5">{rule.notes}</p>}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleToggleTaxRule(rule, { isActive: !rule.isActive })}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                      rule.isActive
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                        : 'bg-stone-100 text-stone-600 border-stone-300 hover:bg-stone-200'
                    }`}
                  >
                    {rule.isActive ? 'Active for Staff' : 'Disabled'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {showNewTaxModal && (
            <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
                <h3 className="text-lg font-bold text-charcoal">Add Tax Configuration</h3>
                <form onSubmit={handleCreateTaxRule} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="nt-code" className="field-label">Rule Code</label>
                      <input
                        id="nt-code"
                        type="text"
                        required
                        placeholder="e.g. GST_18_FB"
                        value={taxCode}
                        onChange={(e) => setTaxCode(e.target.value)}
                        className="field-input font-mono uppercase"
                      />
                    </div>
                    <div>
                      <label htmlFor="nt-sac" className="field-label">Default SAC</label>
                      <input
                        id="nt-sac"
                        type="text"
                        required
                        value={taxDefaultSac}
                        onChange={(e) => setTaxDefaultSac(e.target.value)}
                        className="field-input font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="nt-name" className="field-label">Display Name</label>
                    <input
                      id="nt-name"
                      type="text"
                      required
                      placeholder="e.g. Catering / Banquet Services (18% GST)"
                      value={taxName}
                      onChange={(e) => setTaxName(e.target.value)}
                      className="field-input"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="nt-cat" className="field-label">Service Category</label>
                      <select
                        id="nt-cat"
                        value={taxServiceCategory}
                        onChange={(e) => setTaxServiceCategory(e.target.value as ServiceCategory)}
                        className="field-input"
                      >
                        <option value="accommodation">Accommodation</option>
                        <option value="extra_bed">Extra Bed</option>
                        <option value="early_check_in">Early Check-in</option>
                        <option value="late_checkout">Late Check-out</option>
                        <option value="food_beverage">Food & Beverage</option>
                        <option value="laundry">Laundry</option>
                        <option value="transport">Transport</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="nt-mode" className="field-label">Tax Mode</label>
                      <select
                        id="nt-mode"
                        value={taxMode}
                        onChange={(e) => setTaxMode(e.target.value as 'cgst_sgst' | 'igst' | 'exempt')}
                        className="field-input"
                      >
                        <option value="cgst_sgst">CGST + SGST (Odisha Place of Supply)</option>
                        <option value="igst">Explicit Inter-State IGST Rule</option>
                        <option value="exempt">0% Exempt / Non-GST</option>
                      </select>
                    </div>
                  </div>

                  {taxMode === 'cgst_sgst' && (
                    <div className="grid grid-cols-2 gap-3 bg-stone-50 p-3 rounded-lg border border-stone-200">
                      <div>
                        <label htmlFor="nt-cgst" className="field-label">CGST (bps, 250 = 2.5%)</label>
                        <input
                          id="nt-cgst"
                          type="number"
                          min={0}
                          max={2500}
                          value={taxCgstRateBps}
                          onChange={(e) => setTaxCgstRateBps(Number(e.target.value))}
                          className="field-input"
                        />
                      </div>
                      <div>
                        <label htmlFor="nt-sgst" className="field-label">SGST (bps, 250 = 2.5%)</label>
                        <input
                          id="nt-sgst"
                          type="number"
                          min={0}
                          max={2500}
                          value={taxSgstRateBps}
                          onChange={(e) => setTaxSgstRateBps(Number(e.target.value))}
                          className="field-input"
                        />
                      </div>
                    </div>
                  )}

                  {taxMode === 'igst' && (
                    <div className="bg-stone-50 p-3 rounded-lg border border-stone-200">
                      <label htmlFor="nt-igst" className="field-label">IGST (bps, 500 = 5%)</label>
                      <input
                        id="nt-igst"
                        type="number"
                        min={0}
                        max={5000}
                        value={taxIgstRateBps}
                        onChange={(e) => setTaxIgstRateBps(Number(e.target.value))}
                        className="field-input"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="nt-from" className="field-label">Effective From</label>
                      <input
                        id="nt-from"
                        type="date"
                        required
                        value={taxEffectiveFrom}
                        onChange={(e) => setTaxEffectiveFrom(e.target.value)}
                        className="field-input"
                      />
                    </div>
                    <div>
                      <label htmlFor="nt-to" className="field-label">Effective To (optional)</label>
                      <input
                        id="nt-to"
                        type="date"
                        value={taxEffectiveTo}
                        onChange={(e) => setTaxEffectiveTo(e.target.value)}
                        className="field-input"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="nt-notes" className="field-label">Notes</label>
                    <input
                      id="nt-notes"
                      type="text"
                      value={taxNotes}
                      onChange={(e) => setTaxNotes(e.target.value)}
                      className="field-input"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-3">
                    <button type="button" onClick={() => setShowNewTaxModal(false)} className="btn-secondary">
                      Cancel
                    </button>
                    <button type="submit" className="btn-primary">
                      Save Configuration
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: INVOICE SERIES */}
      {activeTab === 'series' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card-surface p-5 space-y-4">
            <h2 className="text-base font-bold text-charcoal">Configured Invoice Number Series</h2>
            <p className="text-xs text-stone-600">
              Finalised invoices receive sequential atomic numbers from the active series. Drafts do not consume invoice numbers.
            </p>
            <div className="space-y-2.5">
              {seriesList.map((s) => {
                const sample = `${s.prefix}${s.separator}${s.financialYear}${s.separator}${String(
                  s.nextNumber
                ).padStart(s.paddingDigits, '0')}`;
                return (
                  <div
                    key={s.id}
                    className={`p-3.5 rounded-lg border ${
                      s.isActive ? 'border-livotel-orange bg-orange-50/40' : 'border-stone-200 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-sm text-charcoal">{sample}</span>
                      {s.isActive && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-livotel-orange text-white">
                          Active Series
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-stone-600 mt-1">
                      FY: {s.financialYear} | Next Sequence: {s.nextNumber} | Length: {sample.length}/16 chars
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <form onSubmit={handleSaveSeries} className="card-surface p-5 space-y-4">
            <h2 className="text-base font-bold text-charcoal">Configure / Switch Active Series</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="ser-prefix" className="field-label">Prefix</label>
                <input
                  id="ser-prefix"
                  type="text"
                  required
                  placeholder="LPH"
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                  className="field-input font-mono uppercase"
                />
              </div>
              <div>
                <label htmlFor="ser-fy" className="field-label">Financial Year</label>
                <input
                  id="ser-fy"
                  type="text"
                  required
                  placeholder="26-27"
                  value={financialYear}
                  onChange={(e) => setFinancialYear(e.target.value)}
                  className="field-input font-mono"
                />
              </div>
              <div>
                <label htmlFor="ser-sep" className="field-label">Separator</label>
                <select
                  id="ser-sep"
                  value={separator}
                  onChange={(e) => setSeparator(e.target.value)}
                  className="field-input font-mono"
                >
                  <option value="/">/ (Slash)</option>
                  <option value="-">- (Hyphen)</option>
                </select>
              </div>
              <div>
                <label htmlFor="ser-seq" className="field-label">Next Sequence Number</label>
                <input
                  id="ser-seq"
                  type="number"
                  min={1}
                  required
                  value={nextNumber}
                  onChange={(e) => setNextNumber(Number(e.target.value))}
                  className="field-input font-mono"
                />
              </div>
              <div>
                <label htmlFor="ser-pad" className="field-label">Zero-Padding Digits</label>
                <input
                  id="ser-pad"
                  type="number"
                  min={1}
                  max={8}
                  required
                  value={paddingDigits}
                  onChange={(e) => setPaddingDigits(Number(e.target.value))}
                  className="field-input font-mono"
                />
              </div>
              <div className="flex flex-col justify-end">
                <div className="p-2.5 rounded bg-stone-100 text-xs">
                  Preview: <strong className="font-mono">{sampleNextNumber}</strong> ({sampleNextNumber.length}/16)
                </div>
              </div>
            </div>
            <button type="submit" className="btn-primary text-xs">
              Save & Set as Active Series
            </button>
          </form>
        </div>
      )}

      {/* TAB 4: BACKUPS & RECOVERY */}
      {activeTab === 'backup' && (
        <div className="card-surface p-6 space-y-4">
          <h2 className="text-base font-bold text-charcoal">Database Export & Long-Term GST Retention</h2>
          <p className="text-sm text-stone-700 leading-relaxed">
            Every finalised invoice stores its complete immutable JSON snapshot (customer, stay details, line items, payments, tax configuration, and supplier settings) in PostgreSQL alongside its private PDF in Netlify Blobs. Even if a PDF blob is missing, the server can deterministically regenerate an identical PDF from the stored invoice snapshot.
          </p>
          <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-950 space-y-1.5">
            <p className="font-bold">Important Operational Guidance:</p>
            <p>
              • Under Indian GST rules (CGST Section 36), tax invoices and billing ledgers should be retained for at least 72 months (6 years) from the due date of furnishing the annual return.
            </p>
            <p>
              • Download periodic JSON backups below and store them in your hotel’s secure offline/cloud archive, alongside your PostgreSQL logical backups (`pg_dump`).
            </p>
          </div>
          <div>
            <button type="button" onClick={handleDownloadBackup} className="btn-primary">
              <Download className="w-4 h-4" />
              Export Complete JSON Backup
            </button>
          </div>
        </div>
      )}

      {/* TAB 5: AUDIT LOG */}
      {activeTab === 'audit' && (
        <div className="card-surface overflow-hidden">
          <div className="p-4 border-b border-stone-200 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-charcoal">Security & Financial Audit Trail</h2>
              <p className="text-xs text-stone-500">
                Tracks logins, failed attempts, invoice finalisations, cancellations, payments, and admin changes.
              </p>
            </div>
            <button type="button" onClick={loadAuditLogs} className="btn-secondary text-xs py-1.5">
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
          </div>
          {loadingAudit ? (
            <div className="p-8 text-center text-sm text-stone-500">Loading audit events...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-200 text-stone-500 uppercase">
                    <th className="py-2.5 px-4">Timestamp</th>
                    <th className="py-2.5 px-4">Actor</th>
                    <th className="py-2.5 px-4">Event Type</th>
                    <th className="py-2.5 px-4">Summary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {auditEvents.map((ev) => (
                    <tr key={ev.id} className="hover:bg-stone-50/80">
                      <td className="py-2.5 px-4 font-mono text-stone-600 whitespace-nowrap">
                        {new Date(ev.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                      </td>
                      <td className="py-2.5 px-4 text-stone-700">
                        {ev.actorEmail || 'System'} {ev.actorRole ? `(${ev.actorRole})` : ''}
                      </td>
                      <td className="py-2.5 px-4 font-semibold text-charcoal">{ev.eventType}</td>
                      <td className="py-2.5 px-4 text-stone-600">{ev.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
