import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { setOnUpgradeRequired } from "@/api/client";
import { MainLayout } from "@/components/layout/MainLayout";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { Toaster } from "@/components/ui/sonner";
import Login from "@/pages/Login";
import { getRoutes } from "@/route-registry";
import { useAuthStore } from "@/stores/auth.store";
import { useSettingsStore } from "@/stores/settings.store";
import { useUpgradeStore } from "@/stores/upgrade.store";

// Additional routes/slots/tabs can be registered by a downstream overlay or
// plugin at bootstrap. OSS ships and imports none.

const ForgotPassword = lazy(() => import("@/pages/ForgotPassword"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));

const ActivityLog = lazy(() => import("@/pages/ActivityLog"));
const Customers = lazy(() => import("@/pages/Customers"));
const CustomerView = lazy(() => import("@/pages/CustomerView"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Expenses = lazy(() => import("@/pages/Expenses"));
const Invoices = lazy(() => import("@/pages/Invoices"));
const Products = lazy(() => import("@/pages/Products"));
const QuoteForm = lazy(() => import("@/pages/QuoteForm"));
const QuoteRoute = lazy(() => import("@/pages/QuoteRoute"));
const PublicInvoice = lazy(() => import("@/pages/PublicInvoice"));
const PublicQuote = lazy(() => import("@/pages/PublicQuote"));
const RecurringInvoiceForm = lazy(() => import("@/pages/RecurringInvoiceForm"));
const RecurringInvoices = lazy(() => import("@/pages/RecurringInvoices"));
const Reports = lazy(() => import("@/pages/Reports"));
const Settings = lazy(() => import("@/pages/Settings"));
const Users = lazy(() => import("@/pages/Users"));
const ClientPortal = lazy(() => import("@/pages/ClientPortal"));
const OnboardingWizard = lazy(() => import("@/pages/OnboardingWizard"));

function ProtectedRoute({
  children,
  skipOnboardingCheck,
}: {
  children: React.ReactNode;
  skipOnboardingCheck?: boolean;
}) {
  const { user, isLoading } = useAuthStore();
  const settings = useSettingsStore((s) => s.settings);
  const settingsLoading = useSettingsStore((s) => s.isLoading);
  const location = useLocation();

  if (isLoading || (user && settingsLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center" role="status">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        <span className="sr-only">Loading...</span>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // First-run wizard for admins on a fresh setup. The onboarding route opts
  // out so it doesn't redirect to itself.
  if (
    !skipOnboardingCheck &&
    user.is_admin &&
    settings.onboarding_completed !== "true" &&
    location.pathname !== "/onboarding"
  ) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();

  if (!user?.is_admin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-muted-foreground">Page not found</p>
      <a href="/" className="text-primary hover:underline">
        Go to Dashboard
      </a>
    </div>
  );
}

// Wire up the 402 upgrade callback once at module level
setOnUpgradeRequired((message) => {
  useUpgradeStore.getState().show(message);
});

function App() {
  const checkAuth = useAuthStore((s) => s.checkAuth);
  const user = useAuthStore((s) => s.user);
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Settings drive the onboarding redirect, so refresh whenever the user changes.
  useEffect(() => {
    if (user) fetchSettings();
  }, [user, fetchSettings]);

  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Suspense
          fallback={
            <div className="min-h-screen flex items-center justify-center" role="status">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
              <span className="sr-only">Loading...</span>
            </div>
          }
        >
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            <Route
              path="/onboarding"
              element={
                <ProtectedRoute skipOnboardingCheck>
                  <OnboardingWizard />
                </ProtectedRoute>
              }
            />

            <Route path="/portal/:token" element={<ClientPortal />} />

            <Route path="/public/quote/:shareToken" element={<PublicLayout />}>
              <Route index element={<PublicQuote />} />
            </Route>

            <Route path="/public/invoice/:shareToken" element={<PublicLayout />}>
              <Route index element={<PublicInvoice />} />
            </Route>

            <Route
              element={
                <ProtectedRoute>
                  <MainLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/invoices" element={<Navigate to="/invoices/all" replace />} />
              <Route path="/invoices/new" element={<Invoices />} />
              <Route path="/invoices/:id/edit" element={<Invoices />} />
              <Route path="/invoices/:id" element={<Invoices />} />
              <Route path="/quotes" element={<Navigate to="/quotes/all" replace />} />
              <Route path="/quotes/new" element={<QuoteForm />} />
              <Route path="/quotes/:id/edit" element={<QuoteForm />} />
              <Route path="/quotes/:id" element={<QuoteRoute />} />
              <Route path="/recurring" element={<Navigate to="/recurring/all" replace />} />
              <Route path="/recurring/new" element={<RecurringInvoiceForm />} />
              <Route path="/recurring/:id/edit" element={<RecurringInvoiceForm />} />
              <Route path="/recurring/:tab" element={<RecurringInvoices />} />
              <Route path="/reports" element={<Navigate to="/reports/tax-summary" replace />} />
              <Route path="/reports/:tab" element={<Reports />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/customers/new" element={<Customers />} />
              <Route path="/customers/:id/edit" element={<Customers />} />
              <Route path="/customers/:id" element={<CustomerView />} />
              <Route path="/products" element={<Navigate to="/products/all" replace />} />
              <Route path="/products/new" element={<Products />} />
              <Route path="/products/:id" element={<Products />} />
              <Route path="/expenses" element={<Expenses />} />
              <Route path="/expenses/new" element={<Expenses />} />
              <Route path="/expenses/:id" element={<Expenses />} />
              {/* Convenience entry point — templates live under Settings. */}
              <Route path="/templates" element={<Navigate to="/settings/templates" replace />} />
              <Route
                path="/settings"
                element={
                  <AdminRoute>
                    <Navigate to="/settings/general" replace />
                  </AdminRoute>
                }
              />
              <Route
                path="/settings/:tab"
                element={
                  <AdminRoute>
                    <Settings />
                  </AdminRoute>
                }
              />
              <Route
                path="/settings/templates/new"
                element={
                  <AdminRoute>
                    <Settings />
                  </AdminRoute>
                }
              />
              <Route
                path="/settings/templates/:id/edit"
                element={
                  <AdminRoute>
                    <Settings />
                  </AdminRoute>
                }
              />
              <Route
                path="/activity"
                element={
                  <AdminRoute>
                    <ActivityLog />
                  </AdminRoute>
                }
              />
              <Route
                path="/users"
                element={
                  <AdminRoute>
                    <Users />
                  </AdminRoute>
                }
              />
              {/* Overlay/plugin protected routes — rendered inside MainLayout
              so they share the authenticated chrome. Admin-scoped ones are
              wrapped in AdminRoute. */}
              {getRoutes("protected").map((r) => (
                <Route key={`prot:${r.path}`} path={r.path} element={r.element} />
              ))}
              {getRoutes("admin").map((r) => (
                <Route
                  key={`adm:${r.path}`}
                  path={r.path}
                  element={<AdminRoute>{r.element}</AdminRoute>}
                />
              ))}
              <Route path="*" element={<NotFound />} />
            </Route>

            {/* Overlay-registered routes. A downstream overlay or plugin
            adds routes here without forking App.tsx. */}
            {getRoutes("public").map((r) => (
              <Route key={`pub:${r.path}`} path={r.path} element={r.element} />
            ))}
            {getRoutes("portal").map((r) => (
              <Route key={`portal:${r.path}`} path={r.path} element={r.element} />
            ))}
          </Routes>
        </Suspense>
        <Toaster />
      </ErrorBoundary>
    </BrowserRouter>
  );
}

export default App;
