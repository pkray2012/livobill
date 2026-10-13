import React, { useEffect, useState } from 'react';
import {
  UserPlus,
  Copy,
  Check,
  KeyRound,
  ShieldCheck,
  UserX,
  UserCheck,
  AlertTriangle,
} from 'lucide-react';
import { apiRequest } from '../api/client';
import type { User, UserRole, UserStatus } from '../../shared/types';

interface StaffManagementViewProps {
  currentUser: User;
}

export const StaffManagementView: React.FC<StaffManagementViewProps> = ({ currentUser }) => {
  const [staffList, setStaffList] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invite form
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('staff');
  const [canCancelInvoices, setCanCancelInvoices] = useState(false);
  const [inviting, setInviting] = useState(false);

  // Generated single-use link modal/banner
  const [generatedLinkInfo, setGeneratedLinkInfo] = useState<{
    title: string;
    recipientName: string;
    url: string;
    expiresAt: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const loadStaff = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ staff: User[] }>('/api/admin/staff');
      setStaffList(res.staff || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load staff list.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStaff();
  }, []);

  const handleInviteStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInviting(true);
    try {
      const res = await apiRequest<{
        userId: string;
        setupUrl: string;
        expiresAt: string;
      }>('/api/admin/staff/invite', {
        method: 'POST',
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: email.trim().toLowerCase(),
          role,
          canCancelInvoices: role === 'admin' ? true : canCancelInvoices,
        }),
      });
      setGeneratedLinkInfo({
        title: 'Single-Use Account Setup Link Created',
        recipientName: `${fullName.trim()} (${email.trim().toLowerCase()})`,
        url: res.setupUrl,
        expiresAt: res.expiresAt,
      });
      setFullName('');
      setEmail('');
      setRole('staff');
      setCanCancelInvoices(false);
      await loadStaff();
    } catch (err: any) {
      setError(err.message || 'Failed to create staff invitation.');
    } finally {
      setInviting(false);
    }
  };

  const handleGenerateResetLink = async (staff: User) => {
    setError(null);
    try {
      const res = await apiRequest<{
        resetUrl: string;
        expiresAt: string;
      }>(`/api/admin/staff/${staff.id}/reset-link`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setGeneratedLinkInfo({
        title: 'Single-Use Password Reset Link Created',
        recipientName: `${staff.fullName} (${staff.email})`,
        url: res.resetUrl,
        expiresAt: res.expiresAt,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to generate password reset link.');
    }
  };

  const handleToggleStaffProperty = async (
    staff: User,
    updates: { status?: UserStatus; canCancelInvoices?: boolean }
  ) => {
    setError(null);
    try {
      await apiRequest(`/api/admin/staff/${staff.id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      await loadStaff();
    } catch (err: any) {
      setError(err.message || 'Failed to update staff account.');
    }
  };

  const handleCopyLink = async () => {
    if (!generatedLinkInfo) return;
    await navigator.clipboard.writeText(generatedLinkInfo.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal tracking-tight">Staff Management</h1>
        <p className="text-sm text-stone-600 mt-0.5">
          Invitation-only staff and administrator accounts. Share single-use setup and password reset links securely without requiring a paid email service.
        </p>
      </div>

      {error && (
        <div role="alert" className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {generatedLinkInfo && (
        <div className="p-5 rounded-xl bg-amber-50 border-2 border-livotel-orange shadow-sm space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-bold text-charcoal">{generatedLinkInfo.title}</h2>
              <p className="text-xs text-stone-700 mt-0.5">
                Recipient: <strong>{generatedLinkInfo.recipientName}</strong> | Expires:{' '}
                {new Date(generatedLinkInfo.expiresAt).toLocaleString('en-IN', {
                  timeZone: 'Asia/Kolkata',
                })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setGeneratedLinkInfo(null)}
              className="text-xs text-stone-500 hover:text-charcoal font-medium"
            >
              Dismiss
            </button>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              type="text"
              readOnly
              value={generatedLinkInfo.url}
              className="field-input font-mono text-xs bg-white flex-1"
            />
            <button type="button" onClick={handleCopyLink} className="btn-primary text-xs shrink-0">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied to Clipboard' : 'Copy Single-Use Link'}
            </button>
          </div>
          <p className="text-xs text-stone-600">
            Copy this link now and send it directly to the staff member. Only its cryptographic hash is stored in the database, and it expires automatically after a single use.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Invite Staff Form */}
        <form onSubmit={handleInviteStaff} className="card-surface p-5 space-y-4 lg:col-span-1 h-fit">
          <div className="flex items-center gap-2 border-b border-stone-200 pb-3">
            <UserPlus className="w-4 h-4 text-livotel-orange" />
            <h2 className="text-base font-bold text-charcoal">Invite Staff Member</h2>
          </div>

          <div>
            <label htmlFor="invite-name" className="field-label">Full Name</label>
            <input
              id="invite-name"
              type="text"
              required
              placeholder="e.g. Front Desk Executive"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="field-input"
            />
          </div>

          <div>
            <label htmlFor="invite-email" className="field-label">Work Email</label>
            <input
              id="invite-email"
              type="email"
              required
              placeholder="desk@livotelhotel.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field-input"
            />
          </div>

          <div>
            <label htmlFor="invite-role" className="field-label">Account Role</label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="field-input"
            >
              <option value="staff">Staff (Billing & Customer Entry)</option>
              <option value="admin">Administrator (Full Settings & Staff Control)</option>
            </select>
          </div>

          {role === 'staff' && (
            <div className="pt-1">
              <label className="inline-flex items-start gap-2 text-xs text-stone-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={canCancelInvoices}
                  onChange={(e) => setCanCancelInvoices(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Allow this staff member to cancel finalised invoices (with mandatory audit reason)
                </span>
              </label>
            </div>
          )}

          <button type="submit" disabled={inviting} className="btn-primary w-full">
            <UserPlus className="w-4 h-4" />
            {inviting ? 'Generating Link...' : 'Create Single-Use Setup Link'}
          </button>
        </form>

        {/* Staff Directory Table */}
        <div className="card-surface overflow-hidden lg:col-span-2">
          <div className="p-4 border-b border-stone-200">
            <h2 className="text-base font-bold text-charcoal">Authorized Hotel Accounts</h2>
            <p className="text-xs text-stone-500">
              Generating a password reset link or disabling an account immediately revokes all active sessions for that user.
            </p>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-stone-500">Loading staff accounts...</div>
          ) : (
            <div className="divide-y divide-stone-200">
              {staffList.map((member) => {
                const isSelf = member.id === currentUser.id;
                const isActive = member.status !== 'disabled';
                return (
                  <div
                    key={member.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-stone-50/70"
                  >
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-charcoal">{member.fullName}</span>
                        <span
                          className={`text-[11px] font-semibold px-2 py-0.5 rounded uppercase ${
                            member.role === 'admin'
                              ? 'bg-orange-100 text-livotel-orange'
                              : 'bg-stone-100 text-stone-700'
                          }`}
                        >
                          {member.role}
                        </span>
                        <span
                          className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                            member.status === 'active'
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : member.status === 'pending_setup'
                                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                : 'bg-red-50 text-red-700 border border-red-200'
                          }`}
                        >
                          {member.status === 'active'
                            ? 'Active'
                            : member.status === 'pending_setup'
                              ? 'Pending Setup'
                              : 'Disabled'}
                        </span>
                        {isSelf && (
                          <span className="text-[11px] font-medium text-stone-500">(You)</span>
                        )}
                      </div>
                      <p className="text-xs text-stone-600 mt-0.5 font-mono">{member.email}</p>
                      <p className="text-[11px] text-stone-500 mt-1">
                        Cancel Finalised Invoices:{' '}
                        <strong>{member.role === 'admin' || member.canCancelInvoices ? 'Allowed' : 'Restricted'}</strong>
                        {' • '}
                        Last Login:{' '}
                        {member.lastLoginAt
                          ? new Date(member.lastLoginAt).toLocaleString('en-IN', {
                              timeZone: 'Asia/Kolkata',
                            })
                          : 'Pending initial setup / login'}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {member.role === 'staff' && (
                        <button
                          type="button"
                          onClick={() =>
                            handleToggleStaffProperty(member, {
                              canCancelInvoices: !member.canCancelInvoices,
                            })
                          }
                          className="btn-secondary text-xs py-1.5 px-2.5"
                          title="Toggle permission to cancel finalised invoices"
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                          {member.canCancelInvoices ? 'Revoke Cancel Right' : 'Grant Cancel Right'}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleGenerateResetLink(member)}
                        className="btn-secondary text-xs py-1.5 px-2.5"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        Reset Password Link
                      </button>

                      {!isSelf && (
                        <button
                          type="button"
                          onClick={() =>
                            handleToggleStaffProperty(member, {
                              status: isActive ? 'disabled' : 'active',
                            })
                          }
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition ${
                            isActive
                              ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                              : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                          }`}
                        >
                          {isActive ? (
                            <>
                              <UserX className="w-3.5 h-3.5" />
                              Disable
                            </>
                          ) : (
                            <>
                              <UserCheck className="w-3.5 h-3.5" />
                              Enable
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Primary Admin Recovery Info */}
      <div className="card-surface p-5 bg-stone-50/80 border border-stone-200 space-y-2">
        <div className="flex items-center gap-2 text-charcoal font-bold text-sm">
          <AlertTriangle className="w-4 h-4 text-livotel-orange" />
          <span>Primary Administrator Emergency Account Recovery</span>
        </div>
        <p className="text-xs text-stone-600 leading-relaxed">
          For staff members, any administrator can generate a single-use password reset link above. If the primary administrator loses their password and no second administrator account exists, the site owner can set the <code className="font-mono bg-white px-1.5 py-0.5 rounded border">ADMIN_RECOVERY_SECRET</code> environment variable in the Netlify project settings and use the Emergency Recovery tab on the login screen (or invoke <code className="font-mono bg-white px-1.5 py-0.5 rounded border">POST /api/auth/admin-emergency-recovery</code>) to reset the primary administrator password, then remove the environment variable immediately afterwards.
        </p>
      </div>
    </div>
  );
};
