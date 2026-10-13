import React, { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  FilePlus2,
  FileStack,
  Users,
  Settings,
  UserCog,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { apiRequest, setApiCsrfToken } from './api/client';
import { LoginScreen } from './components/LoginScreen';
import { DashboardView } from './components/DashboardView';
import { CreateInvoiceView } from './components/CreateInvoiceView';
import { InvoiceHistoryView } from './components/InvoiceHistoryView';
import { CustomersView } from './components/CustomersView';
import { AdminSettingsView } from './components/AdminSettingsView';
import { StaffManagementView } from './components/StaffManagementView';
import {
  DEFAULT_BUSINESS_SETTINGS,
  DEFAULT_INVOICE_SERIES,
  DEFAULT_TAX_CONFIGURATIONS,
} from '../shared/defaults';
import type {
  BusinessSettings,
  Customer,
  InvoiceRecord,
  InvoiceSeries,
  TaxConfiguration,
  User,
} from '../shared/types';

type ScreenId = 'dashboard' | 'create' | 'history' | 'customers' | 'settings' | 'staff';

const DIRECT_ADMIN_USER: User = {
  id: '11111111-1111-4111-8111-111111111101',
  email: 'admin@livotelbhubaneswar.com',
  fullName: 'Pradipta Kumar Ray',
  role: 'admin',
  status: 'active',
  canCancelInvoices: true,
  createdAt: '2026-04-01T00:00:00.000Z',
  lastLoginAt: new Date().toISOString(),
};

export const App: React.FC = () => {
  const [authLoading, setAuthLoading] = useState(false);
  const [bootstrapRequired, setBootstrapRequired] = useState(false);
  const [bootstrapSecretConfigured, setBootstrapSecretConfigured] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(DIRECT_ADMIN_USER);

  // Navigation & cross-screen state
  const [activeScreen, setActiveScreen] = useState<ScreenId>('dashboard');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [editingDraftInvoice, setEditingDraftInvoice] = useState<InvoiceRecord | null>(null);
  const [preselectedCustomer, setPreselectedCustomer] = useState<Customer | null>(null);
  const [historySelectedInvoice, setHistorySelectedInvoice] = useState<InvoiceRecord | null>(null);

  // Shared hotel configuration loaded from server
  const [businessSettings, setBusinessSettings] = useState<BusinessSettings>(
    DEFAULT_BUSINESS_SETTINGS
  );
  const [taxConfigurations, setTaxConfigurations] = useState<TaxConfiguration[]>(
    DEFAULT_TAX_CONFIGURATIONS
  );
  const [invoiceSeries, setInvoiceSeries] = useState<InvoiceSeries[]>([DEFAULT_INVOICE_SERIES]);
  const [staffCreators, setStaffCreators] = useState<
    Array<{ id: string; fullName: string; email: string }>
  >([]);

  const loadBootstrapData = useCallback(async () => {
    try {
      const data = await apiRequest<{
        businessSettings: BusinessSettings;
        taxConfigurations: TaxConfiguration[];
        invoiceSeries: InvoiceSeries[];
        staffCreators: Array<{ id: string; fullName: string; email: string }>;
      }>('/api/bootstrap-data');
      if (data.businessSettings) setBusinessSettings(data.businessSettings);
      if (data.taxConfigurations) setTaxConfigurations(data.taxConfigurations);
      if (data.invoiceSeries) setInvoiceSeries(data.invoiceSeries);
      if (data.staffCreators) setStaffCreators(data.staffCreators);
    } catch {
      // defaults from shared/defaults remain active
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setApiCsrfToken('direct-access-mode');
      setCurrentUser(DIRECT_ADMIN_USER);
      try {
        const status = await apiRequest<{
          bootstrapRequired: boolean;
          bootstrapSecretConfigured: boolean;
          user: User | null;
          csrfToken: string | null;
        }>('/api/auth/status');

        if (!mounted) return;
        if (status.user) setCurrentUser(status.user);
        if (status.csrfToken) setApiCsrfToken(status.csrfToken);
        await loadBootstrapData();
      } catch {
        // Direct access defaults remain active even if server is cold
      }
    })();

    return () => {
      mounted = false;
    };
  }, [loadBootstrapData]);

  const handleAuthenticated = async (user: User, csrfToken: string) => {
    setApiCsrfToken(csrfToken);
    setCurrentUser(user);
    setBootstrapRequired(false);
    await loadBootstrapData();
  };

  const handleLogout = async () => {
    setActiveScreen('dashboard');
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3">
          <img
            src="/livotel-logo.jpg"
            alt="Livotel Premium Hotel"
            className="w-16 h-16 object-contain rounded-lg shadow-sm"
          />
          <p className="text-sm font-medium text-stone-600">
            Loading Livotel Billing Portal...
          </p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <LoginScreen
        bootstrapRequired={bootstrapRequired}
        bootstrapSecretConfigured={bootstrapSecretConfigured}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  const activeLogoSrc = businessSettings.activeLogoDataUrl || '/livotel-logo.jpg';

  const navItems: Array<{
    id: ScreenId;
    label: string;
    icon: React.FC<{ className?: string }>;
    adminOnly?: boolean;
  }> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'create', label: 'Create Invoice', icon: FilePlus2 },
    { id: 'history', label: 'Invoice History', icon: FileStack },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'settings', label: 'Admin Settings', icon: Settings, adminOnly: true },
    { id: 'staff', label: 'Staff Management', icon: UserCog, adminOnly: true },
  ];

  const visibleNavItems = navItems.filter(
    (item) => !item.adminOnly || currentUser.role === 'admin'
  );

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-charcoal flex flex-col">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-30 bg-white border-b border-stone-200 shadow-xs">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(!mobileNavOpen)}
              className="lg:hidden p-2 rounded-lg text-stone-600 hover:bg-stone-100"
              aria-label="Toggle navigation menu"
            >
              {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            <button
              type="button"
              onClick={() => setActiveScreen('dashboard')}
              className="flex items-center gap-3 text-left focus:outline-none"
            >
              <img
                src={activeLogoSrc}
                alt="Livotel Logo"
                className="w-10 h-10 object-contain rounded"
              />
              <div>
                <div className="text-sm font-bold tracking-tight text-livotel-orange leading-tight">
                  {businessSettings.displayName}
                </div>
                <div className="text-[11px] text-stone-500 hidden sm:block leading-tight">
                  {businessSettings.subtitle}
                </div>
              </div>
            </button>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden lg:flex items-center gap-1" aria-label="Primary Navigation">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeScreen === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (item.id === 'create') {
                      setEditingDraftInvoice(null);
                    }
                    setActiveScreen(item.id);
                  }}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition ${
                    isActive
                      ? 'bg-livotel-orange text-white shadow-xs'
                      : 'text-stone-700 hover:bg-stone-100 hover:text-charcoal'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Signed-in User & Logout */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right">
              <div className="text-xs font-bold text-charcoal leading-tight">
                {currentUser.fullName}
              </div>
              <div className="text-[11px] text-stone-500 uppercase tracking-wider">
                {currentUser.role}
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 text-xs font-semibold text-stone-700 hover:bg-stone-100 transition"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5 text-stone-500" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>

        {/* Mobile / Tablet Navigation Drawer */}
        {mobileNavOpen && (
          <div className="lg:hidden border-t border-stone-200 bg-white px-4 py-3 space-y-1">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeScreen === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (item.id === 'create') {
                      setEditingDraftInvoice(null);
                    }
                    setActiveScreen(item.id);
                    setMobileNavOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold ${
                    isActive
                      ? 'bg-livotel-orange text-white'
                      : 'text-stone-700 hover:bg-stone-100'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </button>
              );
            })}
          </div>
        )}
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6">
        {activeScreen === 'dashboard' && (
          <DashboardView
            logoSrc={activeLogoSrc}
            onCreateNewInvoice={() => {
              setEditingDraftInvoice(null);
              setPreselectedCustomer(null);
              setActiveScreen('create');
            }}
            onOpenInvoiceInHistory={(inv) => {
              setHistorySelectedInvoice(inv);
              setActiveScreen('history');
            }}
            onEditDraftInvoice={(inv) => {
              setEditingDraftInvoice(inv);
              setPreselectedCustomer(null);
              setActiveScreen('create');
            }}
          />
        )}

        {activeScreen === 'create' && (
          <CreateInvoiceView
            businessSettings={businessSettings}
            taxConfigurations={taxConfigurations}
            invoiceSeries={invoiceSeries}
            logoSrc={activeLogoSrc}
            initialInvoice={editingDraftInvoice}
            initialCustomer={preselectedCustomer}
            onInvoiceSavedOrFinalised={(inv) => {
              if (inv.status === 'Finalised') {
                setEditingDraftInvoice(inv);
              }
            }}
            onClearInitial={() => {
              setEditingDraftInvoice(null);
              setPreselectedCustomer(null);
            }}
          />
        )}

        {activeScreen === 'history' && (
          <InvoiceHistoryView
            currentUser={currentUser}
            staffCanCancelGlobal={businessSettings.staffCanCancelInvoices}
            staffCreators={staffCreators}
            logoSrc={activeLogoSrc}
            initialSelectedInvoice={historySelectedInvoice}
            onEditDraft={(inv) => {
              setEditingDraftInvoice(inv);
              setPreselectedCustomer(null);
              setActiveScreen('create');
            }}
            onClearInitialSelected={() => setHistorySelectedInvoice(null)}
          />
        )}

        {activeScreen === 'customers' && (
          <CustomersView
            onSelectCustomerForNewInvoice={(customer) => {
              setPreselectedCustomer(customer);
              setEditingDraftInvoice(null);
              setActiveScreen('create');
            }}
          />
        )}

        {activeScreen === 'settings' && currentUser.role === 'admin' && (
          <AdminSettingsView
            settings={businessSettings}
            taxConfigs={taxConfigurations}
            seriesList={invoiceSeries}
            logoSrc={activeLogoSrc}
            onRefreshConfig={loadBootstrapData}
          />
        )}

        {activeScreen === 'staff' && currentUser.role === 'admin' && (
          <StaffManagementView currentUser={currentUser} />
        )}
      </main>
    </div>
  );
};
export default App;
