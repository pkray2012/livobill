import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Lock, ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react';
import { apiRequest, setApiCsrfToken } from '../api/client';
import type { User } from '../../shared/types';

interface LoginScreenProps {
  bootstrapRequired: boolean;
  bootstrapSecretConfigured: boolean;
  onAuthenticated: (user: User, csrfToken: string) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  bootstrapRequired,
  bootstrapSecretConfigured,
  onAuthenticated,
}) => {
  const [mode, setMode] = useState<'login' | 'bootstrap' | 'token' | 'recovery'>(
    bootstrapRequired ? 'bootstrap' : 'login'
  );

  // Token mode state (?setup_token=... or ?reset_token=...)
  const [urlToken, setUrlToken] = useState<string>('');
  const [tokenInfo, setTokenInfo] = useState<{
    valid: boolean;
    purpose?: string;
    email?: string;
    fullName?: string;
    error?: string;
  } | null>(null);

  // Form fields
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('Pradipta Kumar Ray');
  const [password, setPassword] = useState('');
  const [bootstrapSecret, setBootstrapSecret] = useState('');
  const [recoverySecret, setRecoverySecret] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tok = params.get('setup_token') || params.get('reset_token');
    if (tok) {
      setUrlToken(tok);
      setMode('token');
      setLoading(true);
      fetch(`/api/auth/verify-token?token=${encodeURIComponent(tok)}`)
        .then((r) => r.json())
        .then((data) => {
          setTokenInfo(data);
        })
        .catch(() => {
          setTokenInfo({ valid: false, error: 'Unable to verify setup/reset token.' });
        })
        .finally(() => setLoading(false));
    } else if (bootstrapRequired) {
      setMode('bootstrap');
    } else {
      setMode('login');
    }
  }, [bootstrapRequired]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await apiRequest<{ user: User; csrfToken: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setApiCsrfToken(data.csrfToken);
      onAuthenticated(data.user, data.csrfToken);
    } catch (err: any) {
      setError(err.message || 'Invalid email or password.');
    } finally {
      setLoading(false);
    }
  };

  const handleBootstrapSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await apiRequest<{ user: User; csrfToken: string }>('/api/auth/bootstrap', {
        method: 'POST',
        body: JSON.stringify({
          email,
          fullName,
          password,
          bootstrapSecret,
        }),
      });
      setApiCsrfToken(data.csrfToken);
      onAuthenticated(data.user, data.csrfToken);
    } catch (err: any) {
      setError(err.message || 'Bootstrap failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteTokenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await apiRequest<{ user: User; csrfToken: string }>('/api/auth/complete-token', {
        method: 'POST',
        body: JSON.stringify({
          token: urlToken,
          password,
        }),
      });
      window.history.replaceState({}, '', window.location.pathname);
      setApiCsrfToken(data.csrfToken);
      onAuthenticated(data.user, data.csrfToken);
    } catch (err: any) {
      setError(err.message || 'Failed to complete account setup.');
    } finally {
      setLoading(false);
    }
  };

  const handleRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setLoading(true);
    try {
      const data = await apiRequest<{ ok: boolean; message: string }>(
        '/api/auth/admin-emergency-recovery',
        {
          method: 'POST',
          body: JSON.stringify({
            email,
            newPassword: password,
            recoverySecret,
          }),
        }
      );
      setSuccessMsg(data.message);
      setPassword('');
      setRecoverySecret('');
      setMode('login');
    } catch (err: any) {
      setError(err.message || 'Emergency recovery failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF8F5] flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <img
          src="/livotel-logo.jpg"
          alt="LIVOTEL PREMIUM HOTEL"
          className="mx-auto w-20 h-20 rounded shadow-sm object-contain"
        />
        <h1 className="mt-4 text-xl font-bold tracking-wide text-[#C46A4A] uppercase">
          LIVOTEL PREMIUM HOTEL
        </h1>
        <p className="text-xs text-stone-600 mt-0.5">
          Owned &amp; Operated by Laughing Buddha Homestay Bhubaneswar
        </p>
        <p className="mt-2 text-sm font-medium text-[#1F1E1C]">
          Private Staff Billing &amp; GST Invoicing Portal
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-7 px-6 shadow-sm rounded-xl border border-[#E6E1DA] sm:px-8">
          {error && (
            <div
              role="alert"
              className="mb-5 rounded-lg bg-red-50 border border-red-200 p-3.5 text-xs text-red-800 flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div
              role="status"
              className="mb-5 rounded-lg bg-emerald-50 border border-emerald-200 p-3.5 text-xs text-emerald-900 flex items-start gap-2.5"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          {mode === 'login' && (
            <form onSubmit={handleLoginSubmit} className="space-y-5">
              <div className="border-b border-[#E6E1DA] pb-3">
                <h2 className="text-base font-semibold text-[#1F1E1C] flex items-center gap-2">
                  <Lock className="w-4 h-4 text-[#C46A4A]" />
                  Staff &amp; Admin Sign In
                </h2>
                <p className="text-xs text-stone-500 mt-0.5">
                  Invitation-only access. Public registration is disabled.
                </p>
              </div>

              <div>
                <label htmlFor="email" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  Email Address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="staff@livotelbhubaneswar.com"
                  className="w-full rounded-lg border border-[#D6D0C4] px-3.5 py-2.5 text-sm text-[#1F1E1C] focus:border-[#C46A4A] focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="current-password"
                  className="block text-xs font-semibold text-[#1F1E1C] mb-1"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="current-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-[#D6D0C4] px-3.5 py-2.5 pr-10 text-sm text-[#1F1E1C] focus:border-[#C46A4A] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-stone-500 hover:text-[#1F1E1C]"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-[#C46A4A] hover:bg-[#A85538] text-white font-semibold py-2.5 px-4 text-sm shadow-sm transition-colors disabled:opacity-50"
              >
                {loading ? 'Signing In...' : 'Sign In'}
              </button>

              <div className="pt-2 border-t border-[#E6E1DA] flex items-center justify-between text-xs text-stone-500">
                <span>Staff: ask Admin for a password reset link.</span>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setMode('recovery');
                  }}
                  className="text-[#C46A4A] hover:underline font-medium"
                >
                  Admin Recovery
                </button>
              </div>
            </form>
          )}

          {mode === 'bootstrap' && (
            <form onSubmit={handleBootstrapSubmit} className="space-y-4">
              <div className="rounded-lg bg-[#FAF8F5] border border-[#E6E1DA] p-3">
                <div className="flex items-center gap-2 text-xs font-bold text-[#C46A4A]">
                  <ShieldCheck className="w-4 h-4" />
                  One-Time Initial Administrator Bootstrap
                </div>
                <p className="text-xs text-stone-600 mt-1">
                  No administrator account exists yet. Create the primary administrator account now.
                  This endpoint is permanently disabled immediately after the first admin is created.
                </p>
              </div>

              <div>
                <label htmlFor="bootstrap-name" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  Administrator Full Name
                </label>
                <input
                  id="bootstrap-name"
                  name="fullName"
                  type="text"
                  autoComplete="name"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-lg border border-[#D6D0C4] px-3.5 py-2.5 text-sm text-[#1F1E1C] focus:border-[#C46A4A] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="bootstrap-email" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  Administrator Email
                </label>
                <input
                  id="bootstrap-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@livotelbhubaneswar.com"
                  className="w-full rounded-lg border border-[#D6D0C4] px-3.5 py-2.5 text-sm text-[#1F1E1C] focus:border-[#C46A4A] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="bootstrap-password" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  Administrator Password
                </label>
                <p id="pw-rules" className="text-[11px] text-stone-500 mb-1.5">
                  Minimum 10 characters with uppercase, lowercase, and a number.
                </p>
                <div className="relative">
                  <input
                    id="bootstrap-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    minLength={10}
                    aria-describedby="pw-rules"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-[#D6D0C4] px-3.5 py-2.5 pr-10 text-sm text-[#1F1E1C] focus:border-[#C46A4A] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-stone-500"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {bootstrapSecretConfigured && (
                <div>
                  <label htmlFor="bootstrap-secret" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                    Server Bootstrap Secret (ADMIN_BOOTSTRAP_SECRET)
                  </label>
                  <input
                    id="bootstrap-secret"
                    name="bootstrapSecret"
                    type="password"
                    required
                    value={bootstrapSecret}
                    onChange={(e) => setBootstrapSecret(e.target.value)}
                    className="w-full rounded-lg border border-[#D6D0C4] px-3.5 py-2.5 text-sm text-[#1F1E1C] focus:border-[#C46A4A] focus:outline-none"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-[#C46A4A] hover:bg-[#A85538] text-white font-semibold py-2.5 px-4 text-sm shadow-sm transition-colors disabled:opacity-50"
              >
                {loading ? 'Creating Administrator...' : 'Complete One-Time Admin Setup'}
              </button>
            </form>
          )}

          {mode === 'token' && (
            <div className="space-y-4">
              <div className="border-b border-[#E6E1DA] pb-3">
                <h2 className="text-base font-semibold text-[#1F1E1C] flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-[#C46A4A]" />
                  {tokenInfo?.purpose === 'password_reset'
                    ? 'Complete Staff Password Reset'
                    : 'Activate Staff Account'}
                </h2>
              </div>

              {!tokenInfo?.valid ? (
                <div className="space-y-3">
                  <p className="text-xs text-red-700">
                    {tokenInfo?.error || 'This single-use setup/reset link is invalid or expired.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      window.history.replaceState({}, '', window.location.pathname);
                      setMode('login');
                    }}
                    className="w-full rounded-lg border border-[#D6D0C4] py-2 text-xs font-semibold text-[#1F1E1C]"
                  >
                    Return to Sign In
                  </button>
                </div>
              ) : (
                <form onSubmit={handleCompleteTokenSubmit} className="space-y-4">
                  <div className="rounded-lg bg-[#FAF8F5] p-3 border border-[#E6E1DA] text-xs space-y-1">
                    <div>
                      <span className="font-semibold">Staff Member: </span>
                      <span>{tokenInfo.fullName}</span>
                    </div>
                    <div>
                      <span className="font-semibold">Email: </span>
                      <span>{tokenInfo.email}</span>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="new-password" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                      Set Your Password
                    </label>
                    <p id="token-pw-rules" className="text-[11px] text-stone-500 mb-1.5">
                      Minimum 10 characters with uppercase, lowercase, and a number.
                    </p>
                    <div className="relative">
                      <input
                        id="new-password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        minLength={10}
                        aria-describedby="token-pw-rules"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full rounded-lg border border-[#D6D0C4] px-3.5 py-2.5 pr-10 text-sm text-[#1F1E1C] focus:border-[#C46A4A] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        type-button="true"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute inset-y-0 right-0 px-3 flex items-center text-stone-500"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-lg bg-[#C46A4A] hover:bg-[#A85538] text-white font-semibold py-2.5 px-4 text-sm shadow-sm transition-colors disabled:opacity-50"
                  >
                    {loading ? 'Saving Password...' : 'Save Password & Sign In'}
                  </button>
                </form>
              )}
            </div>
          )}

          {mode === 'recovery' && (
            <form onSubmit={handleRecoverySubmit} className="space-y-4">
              <div className="border-b border-[#E6E1DA] pb-3">
                <h2 className="text-base font-semibold text-[#1F1E1C]">
                  Primary Admin Emergency Recovery
                </h2>
                <p className="text-xs text-stone-500 mt-0.5">
                  Requires the server-side <code className="bg-stone-100 px-1 rounded">ADMIN_RECOVERY_SECRET</code> configured in Netlify environment variables.
                </p>
              </div>

              <div>
                <label htmlFor="rec-email" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  Administrator Email
                </label>
                <input
                  id="rec-email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-[#D6D0C4] px-3.5 py-2.5 text-sm"
                />
              </div>

              <div>
                <label htmlFor="rec-secret" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  Emergency Recovery Secret (ADMIN_RECOVERY_SECRET)
                </label>
                <input
                  id="rec-secret"
                  type="password"
                  required
                  value={recoverySecret}
                  onChange={(e) => setRecoverySecret(e.target.value)}
                  className="w-full rounded-lg border border-[#D6D0C4] px-3.5 py-2.5 text-sm"
                />
              </div>

              <div>
                <label htmlFor="rec-new-pw" className="block text-xs font-semibold text-[#1F1E1C] mb-1">
                  New Administrator Password
                </label>
                <input
                  id="rec-new-pw"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={10}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-[#D6D0C4] px-3.5 py-2.5 text-sm"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="flex-1 rounded-lg border border-[#D6D0C4] py-2.5 text-xs font-semibold text-[#1F1E1C]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 rounded-lg bg-[#C46A4A] hover:bg-[#A85538] text-white font-semibold py-2.5 px-4 text-xs shadow-sm"
                >
                  {loading ? 'Resetting...' : 'Reset Admin Password'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
