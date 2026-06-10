const API_BASE = "/api/v1";

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;
let onUpgradeRequired: ((message: string) => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

export function setOnUnauthorized(callback: () => void) {
  onUnauthorized = callback;
}

export function setOnUpgradeRequired(callback: (message: string) => void) {
  onUpgradeRequired = callback;
}

/**
 * Low-level request helper (auth header, 401/402 handling, error shaping).
 * Exported so a downstream overlay can build additional API methods on the
 * same machinery.
 */
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  const ct = res.headers.get("content-type") || "";
  let data: {
    success?: boolean;
    error?: string;
    code?: string;
    errors?: Record<string, string[]>;
    data?: unknown;
    upgrade?: boolean;
  } = {};

  if (ct.includes("application/json")) {
    try {
      data = (await res.json()) as typeof data;
    } catch {
      data = {};
    }
  }

  if (res.status === 401) {
    const msg =
      typeof data.error === "string" && data.error.length > 0 ? data.error : "Unauthorized";
    if (path !== "/auth/login") {
      authToken = null;
      if (onUnauthorized) onUnauthorized();
    }
    throw new ApiError(msg, 401, data.errors, data.code);
  }

  // Intercept 402 plan-limit responses and show upgrade dialog
  if (res.status === 402 && data.upgrade) {
    const msg =
      typeof data.error === "string" && data.error.length > 0 ? data.error : "Plan limit reached";
    if (onUpgradeRequired) onUpgradeRequired(msg);
    throw new ApiError(msg, 402, data.errors, data.code);
  }

  if (!res.ok) {
    const msg =
      typeof data.error === "string" && data.error.length > 0 ? data.error : "Request failed";
    throw new ApiError(msg, res.status, data.errors, data.code);
  }

  return data as T;
}

export type ApiErrorCode =
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "FORBIDDEN"
  | "UNAUTHORIZED"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "PLAN_LIMIT"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  status: number;
  errors?: Record<string, string[]>;
  /** Stable error category from the backend (`NOT_FOUND`, `VALIDATION_FAILED`, …). May be absent on legacy endpoints. */
  code?: string;

  constructor(message: string, status: number, errors?: Record<string, string[]>, code?: string) {
    super(message);
    this.status = status;
    this.errors = errors;
    this.code = code;
  }
}

export const api = {
  // Auth
  login: (username: string, password: string) =>
    request<{
      success: boolean;
      data: {
        token: string;
        user: {
          id: string;
          username: string;
          email: string | null;
          display_name: string | null;
          is_admin: boolean;
        };
      };
    }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  logout: () => request("/auth/logout", { method: "POST" }),

  getMe: () =>
    request<{
      success: boolean;
      data: {
        id: string;
        username: string;
        email: string | null;
        display_name: string | null;
        is_admin: boolean;
        permissions: { resource: string; action: string }[];
      };
    }>("/auth/me"),

  // Dashboard
  getDashboardStats: () => request<{ success: boolean; data: any }>("/dashboard/stats"),
  getRevenueChart: (compareYoy = false) =>
    request<{ success: boolean; data: any }>(
      `/dashboard/revenue-chart${compareYoy ? "?compare=yoy" : ""}`,
    ),
  getRecentInvoices: () => request<{ success: boolean; data: any }>("/dashboard/recent-invoices"),
  getTopCustomers: (limit = 5) =>
    request<{
      success: boolean;
      data: { id: string; name: string; invoice_count: number; total_revenue: number }[];
    }>(`/dashboard/top-customers?limit=${limit}`),

  // Invoices
  listInvoices: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    return request<{ success: boolean; data: any }>(`/invoices${query}`);
  },
  getInvoice: (id: string) => request<{ success: boolean; data: any }>(`/invoices/${id}`),
  createInvoice: (data: any) =>
    request<{ success: boolean; data: any }>("/invoices", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateInvoice: (id: string, data: any) =>
    request<{ success: boolean; data: any }>(`/invoices/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteInvoice: (id: string) => request(`/invoices/${id}`, { method: "DELETE" }),
  publishInvoice: (id: string) =>
    request<{ success: boolean; data: any }>(`/invoices/${id}/publish`, { method: "POST" }),
  unpublishInvoice: (id: string) =>
    request<{ success: boolean; data: any }>(`/invoices/${id}/unpublish`, { method: "POST" }),
  voidInvoice: (id: string) =>
    request<{ success: boolean; data: any }>(`/invoices/${id}/void`, { method: "POST" }),
  markPaid: (id: string) =>
    request<{ success: boolean; data: any }>(`/invoices/${id}/mark-paid`, { method: "POST" }),
  markComplete: (id: string) =>
    request<{ success: boolean; data: any }>(`/invoices/${id}/mark-complete`, { method: "POST" }),
  markSent: (id: string) =>
    request<{ success: boolean; data: any }>(`/invoices/${id}/mark-sent`, { method: "POST" }),
  duplicateInvoice: (id: string) =>
    request<{ success: boolean; data: any }>(`/invoices/${id}/duplicate`, { method: "POST" }),
  duplicateInvoiceAsQuote: (id: string) =>
    request<{ success: boolean; data: any }>(`/invoices/${id}/duplicate-as-quote`, {
      method: "POST",
    }),
  getNextInvoiceNumber: () =>
    request<{ success: boolean; data: { number: string } }>("/invoices/next-number"),
  listXmlProfiles: () =>
    request<{ success: boolean; data: { id: string; name: string }[] }>("/invoices/xml-profiles"),
  downloadXml: (id: string, profileId: string) => `${API_BASE}/invoices/${id}/xml/${profileId}`,
  createCreditNote: (id: string) =>
    request<{ success: boolean; data: any }>(`/invoices/${id}/credit-note`, { method: "POST" }),
  listCreditNotes: (id: string) =>
    request<{ success: boolean; data: any }>(`/invoices/${id}/credit-notes`),
  recordPayment: (id: string, data: any) =>
    request<{ success: boolean; data: any }>(`/invoices/${id}/payments`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  listPayments: (id: string) =>
    request<{ success: boolean; data: any }>(`/invoices/${id}/payments`),
  deletePayment: (invoiceId: string, paymentId: string) =>
    request(`/invoices/${invoiceId}/payments/${paymentId}`, { method: "DELETE" }),
  sendInvoice: (
    id: string,
    data?: {
      to?: string;
      subject?: string;
      message?: string;
      from?: string;
      reply_to?: string;
    },
  ) =>
    request<{ success: boolean; data: any }>(`/invoices/${id}/send`, {
      method: "POST",
      body: JSON.stringify(data || {}),
    }),
  testEmail: (to: string) =>
    request<{ success: boolean; data: any }>("/settings/test-email", {
      method: "POST",
      body: JSON.stringify({ to }),
    }),

  // Customers
  listCustomers: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    return request<{ success: boolean; data: any }>(`/customers${query}`);
  },
  getCustomer: (id: string) => request<{ success: boolean; data: any }>(`/customers/${id}`),
  createCustomer: (data: any) =>
    request<{ success: boolean; data: any }>("/customers", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateCustomer: (id: string, data: any) =>
    request<{ success: boolean; data: any }>(`/customers/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteCustomer: (id: string) => request(`/customers/${id}`, { method: "DELETE" }),
  enableCustomerPortal: (id: string) =>
    request<{
      success: boolean;
      data: { token: string; email_status: "sent" | "skipped" | "failed" };
    }>(`/customers/${id}/portal`, { method: "POST" }),
  disableCustomerPortal: (id: string) =>
    request<{ success: boolean }>(`/customers/${id}/portal`, { method: "DELETE" }),
  getInvoiceComments: (invoiceId: string) =>
    request<{
      success: boolean;
      data: {
        id: string;
        author_type: string;
        author_name: string;
        body: string;
        created_at: string;
      }[];
    }>(`/invoices/${invoiceId}/comments`),
  postInvoiceComment: (invoiceId: string, body: string) =>
    request<{ success: boolean; data: any }>(`/invoices/${invoiceId}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),

  // Products
  listProducts: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    return request<{ success: boolean; data: any }>(`/products${query}`);
  },
  getProduct: (id: string) => request<{ success: boolean; data: any }>(`/products/${id}`),
  createProduct: (data: any) =>
    request<{ success: boolean; data: any }>("/products", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateProduct: (id: string, data: any) =>
    request<{ success: boolean; data: any }>(`/products/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteProduct: (id: string) => request(`/products/${id}`, { method: "DELETE" }),
  reactivateProduct: (id: string) =>
    request<{ success: boolean }>(`/products/${id}/reactivate`, { method: "POST" }),
  getProductUsage: (id: string) =>
    request<{ success: boolean; data: { invoice_count: number; quote_count: number } }>(
      `/products/${id}/usage`,
    ),

  // Expenses
  listExpenses: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    return request<{ success: boolean; data: any }>(`/expenses${query}`);
  },
  getExpense: (id: string) => request<{ success: boolean; data: any }>(`/expenses/${id}`),
  createExpense: (data: any) =>
    request<{ success: boolean; data: any }>("/expenses", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateExpense: (id: string, data: any) =>
    request<{ success: boolean; data: any }>(`/expenses/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteExpense: (id: string) => request(`/expenses/${id}`, { method: "DELETE" }),
  rebillExpense: (id: string) =>
    request<{ success: boolean; data: { invoice_id: string } }>(`/expenses/${id}/rebill`, {
      method: "POST",
    }),
  batchExpenses: (ids: string[], action: string) =>
    request<{
      success: boolean;
      data: { succeeded: number; failed: number; errors: { id: string; reason: string }[] };
    }>("/expenses/batch", { method: "POST", body: JSON.stringify({ ids, action }) }),

  // Product Categories & Units
  listProductCategories: () => request<{ success: boolean; data: any }>("/products/categories"),
  createProductCategory: (data: { name: string }) =>
    request<{ success: boolean; data: any }>("/products/categories", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateProductCategory: (id: string, data: { name: string }) =>
    request<{ success: boolean; data: any }>("/products/categories/" + id, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteProductCategory: (id: string) =>
    request("/products/categories/" + id, { method: "DELETE" }),
  listProductUnits: () => request<{ success: boolean; data: any }>("/products/units"),
  createProductUnit: (data: { name: string; symbol?: string }) =>
    request<{ success: boolean; data: any }>("/products/units", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateProductUnit: (id: string, data: { name: string; symbol?: string }) =>
    request<{ success: boolean; data: any }>("/products/units/" + id, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteProductUnit: (id: string) => request("/products/units/" + id, { method: "DELETE" }),

  // Tax Definitions
  listTaxDefinitions: () => request<{ success: boolean; data: any }>("/tax-definitions"),
  createTaxDefinition: (data: any) =>
    request<{ success: boolean; data: any }>("/tax-definitions", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateTaxDefinition: (id: string, data: any) =>
    request<{ success: boolean; data: any }>(`/tax-definitions/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteTaxDefinition: (id: string) => request(`/tax-definitions/${id}`, { method: "DELETE" }),

  // Settings
  getSettings: () => request<{ success: boolean; data: Record<string, string> }>("/settings"),
  updateSettings: (data: Record<string, string>) =>
    request<{ success: boolean; data: Record<string, string> }>("/settings", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  uploadLogo: (file: File) => {
    const formData = new FormData();
    formData.append("logo", file);
    return request<{ success: boolean; data: { logo: string } }>("/settings/logo", {
      method: "POST",
      body: formData,
    });
  },
  uploadWatermark: (file: File) => {
    const formData = new FormData();
    formData.append("watermark", file);
    return request<{ success: boolean; data: { watermark: string } }>("/settings/watermark", {
      method: "POST",
      body: formData,
    });
  },
  resetDemoData: () =>
    request<{ success: boolean; data: { message: string } }>("/settings/reset-demo", {
      method: "POST",
    }),
  seedSampleData: () =>
    request<{
      success: boolean;
      data: { customers: number; products: number; invoices: number };
    }>("/settings/seed-sample-data", { method: "POST" }),

  // Templates
  listTemplates: () => request<{ success: boolean; data: any }>("/templates"),
  getTemplate: (id: string) => request<{ success: boolean; data: any }>(`/templates/${id}`),
  createTemplate: (data: any) =>
    request<{ success: boolean; data: any }>("/templates", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateTemplate: (id: string, data: any) =>
    request<{ success: boolean; data: any }>(`/templates/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteTemplate: (id: string) => request(`/templates/${id}`, { method: "DELETE" }),
  setDefaultTemplate: (id: string) =>
    request<{ success: boolean; data: any }>(`/templates/${id}/default`, { method: "PUT" }),
  getBundledTemplate: (id: string) =>
    request<{ success: boolean; data: { html_content: string; css_content: string } }>(
      `/templates/${id}/bundled`,
    ),

  // Users
  listUsers: () => request<{ success: boolean; data: any }>("/users"),
  getUser: (id: string) => request<{ success: boolean; data: any }>(`/users/${id}`),
  createUser: (data: any) =>
    request<{ success: boolean; data: any }>("/users", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateUser: (id: string, data: any) =>
    request<{ success: boolean; data: any }>(`/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteUser: (id: string) => request(`/users/${id}`, { method: "DELETE" }),
  updateUserPermissions: (id: string, permissions: { resource: string; action: string }[]) =>
    request(`/users/${id}/permissions`, { method: "PUT", body: JSON.stringify({ permissions }) }),

  // Public
  getPublicInvoice: (shareToken: string) =>
    request<{ success: boolean; data: any }>(`/public/invoices/${shareToken}`),

  // Trash
  listTrashedInvoices: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    return request<{ success: boolean; data: any }>(`/invoices/trash/list${query}`);
  },
  restoreInvoice: (id: string) =>
    request<{ success: boolean }>(`/invoices/${id}/restore`, { method: "POST" }),
  permanentlyDeleteInvoice: (id: string) =>
    request(`/invoices/${id}/permanent`, { method: "DELETE" }),
  batchTrashInvoices: (ids: string[], action: string) =>
    request<{
      success: boolean;
      data: { succeeded: number; failed: number; errors: { id: string; reason: string }[] };
    }>("/invoices/trash/batch", {
      method: "POST",
      body: JSON.stringify({ ids, action }),
    }),

  // Batch operations
  batchInvoices: (ids: string[], action: string) =>
    request<{
      success: boolean;
      data: { succeeded: number; failed: number; errors: { id: string; reason: string }[] };
    }>("/invoices/batch", {
      method: "POST",
      body: JSON.stringify({ ids, action }),
    }),
  batchCustomers: (ids: string[], action: string) =>
    request<{
      success: boolean;
      data: { succeeded: number; failed: number; errors: { id: string; reason: string }[] };
    }>("/customers/batch", {
      method: "POST",
      body: JSON.stringify({ ids, action }),
    }),
  batchProducts: (ids: string[], action: string) =>
    request<{
      success: boolean;
      data: { succeeded: number; failed: number; errors: { id: string; reason: string }[] };
    }>("/products/batch", {
      method: "POST",
      body: JSON.stringify({ ids, action }),
    }),
  batchUsers: (ids: string[], action: string) =>
    request<{
      success: boolean;
      data: { succeeded: number; failed: number; errors: { id: string; reason: string }[] };
    }>("/users/batch", {
      method: "POST",
      body: JSON.stringify({ ids, action }),
    }),

  // Quotes
  listQuotes: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    return request<{ success: boolean; data: any }>(`/quotes${query}`);
  },
  getQuote: (id: string) => request<{ success: boolean; data: any }>(`/quotes/${id}`),
  createQuote: (data: any) =>
    request<{ success: boolean; data: any }>("/quotes", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateQuote: (id: string, data: any) =>
    request<{ success: boolean; data: any }>(`/quotes/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteQuote: (id: string) => request(`/quotes/${id}`, { method: "DELETE" }),
  publishQuote: (id: string) =>
    request<{ success: boolean; data: any }>(`/quotes/${id}/publish`, { method: "POST" }),
  acceptQuote: (id: string) =>
    request<{ success: boolean; data: any }>(`/quotes/${id}/accept`, { method: "POST" }),
  rejectQuote: (id: string) =>
    request<{ success: boolean; data: any }>(`/quotes/${id}/reject`, { method: "POST" }),
  convertQuoteToInvoice: (id: string) =>
    request<{ success: boolean; data: any }>(`/quotes/${id}/convert`, { method: "POST" }),
  duplicateQuote: (id: string) =>
    request<{ success: boolean; data: any }>(`/quotes/${id}/duplicate`, { method: "POST" }),
  getNextQuoteNumber: () =>
    request<{ success: boolean; data: { number: string } }>("/quotes/next-number"),
  sendQuote: (
    id: string,
    data?: {
      to?: string;
      subject?: string;
      message?: string;
      from?: string;
      reply_to?: string;
    },
  ) =>
    request<{ success: boolean; data: any }>(`/quotes/${id}/send`, {
      method: "POST",
      body: JSON.stringify(data || {}),
    }),
  previewQuote: async (id: string): Promise<string> => {
    const headers: Record<string, string> = {};
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`${API_BASE}/quotes/${id}/preview`, {
      headers,
      credentials: "include",
    });
    if (!res.ok) throw new Error("Failed to load preview");
    return res.text();
  },

  // Recurring Invoices
  listRecurring: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    return request<{ success: boolean; data: any }>(`/recurring-invoices${query}`);
  },
  getRecurring: (id: string) =>
    request<{ success: boolean; data: any }>(`/recurring-invoices/${id}`),
  createRecurring: (data: any) =>
    request<{ success: boolean; data: any }>("/recurring-invoices", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateRecurring: (id: string, data: any) =>
    request<{ success: boolean; data: any }>(`/recurring-invoices/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteRecurring: (id: string) => request(`/recurring-invoices/${id}`, { method: "DELETE" }),
  pauseRecurring: (id: string) => request(`/recurring-invoices/${id}/pause`, { method: "POST" }),
  resumeRecurring: (id: string) => request(`/recurring-invoices/${id}/resume`, { method: "POST" }),
  generateRecurringNow: (id: string) =>
    request<{ success: boolean; data: { invoice_id: string } }>(
      `/recurring-invoices/${id}/generate-now`,
      {
        method: "POST",
      },
    ),

  // Activity Log
  listActivity: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    return request<{ success: boolean; data: any }>(`/activity${query}`);
  },
  getResourceActivity: (type: string, id: string) =>
    request<{ success: boolean; data: any }>(`/activity/resource/${type}/${id}`),

  // Reminder Rules
  listReminderRules: () => request<{ success: boolean; data: any }>("/reminder-rules"),
  createReminderRule: (data: any) =>
    request<{ success: boolean; data: any }>("/reminder-rules", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateReminderRule: (id: string, data: any) =>
    request<{ success: boolean; data: any }>(`/reminder-rules/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteReminderRule: (id: string) => request(`/reminder-rules/${id}`, { method: "DELETE" }),
  getInvoiceReminders: (invoiceId: string) =>
    request<{ success: boolean; data: any }>(`/invoices/${invoiceId}/reminders`),

  // Reports
  getTaxSummary: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    return request<{ success: boolean; data: any }>(`/reports/tax-summary${query}`);
  },
  getAgingReport: () => request<{ success: boolean; data: any }>("/reports/aging"),
  getRevenueByCustomer: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    return request<{ success: boolean; data: any }>(`/reports/revenue-by-customer${query}`);
  },
  getRevenueByProduct: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    return request<{ success: boolean; data: any }>(`/reports/revenue-by-product${query}`);
  },
  getCashFlowForecast: (months = 6) =>
    request<{ success: boolean; data: any }>(`/reports/cash-flow-forecast?months=${months}`),
  getExpensesByCategory: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    return request<{ success: boolean; data: any }>(`/reports/expenses-by-category${query}`);
  },
  getProfitLoss: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    return request<{ success: boolean; data: any }>(`/reports/profit-loss${query}`);
  },
  getCurrencyBreakdown: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    return request<{ success: boolean; data: any }>(`/reports/currency-breakdown${query}`);
  },
  getExchangeRate: (from: string, to?: string) => {
    const q = new URLSearchParams({ from, ...(to ? { to } : {}) }).toString();
    return request<{
      success: boolean;
      data: { from: string; to: string; rate: number | null };
    }>(`/exchange-rate?${q}`);
  },
  reportCsvUrl: (report: string, params?: Record<string, string>) => {
    const filtered = params
      ? Object.fromEntries(Object.entries(params).filter(([, v]) => v))
      : undefined;
    const query = filtered ? `?${new URLSearchParams(filtered).toString()}` : "";
    return `${API_BASE}/reports/${report}/csv${query}`;
  },
  accountingExportCsvUrl: (params?: Record<string, string>) => {
    const filtered = params
      ? Object.fromEntries(Object.entries(params).filter(([, v]) => v))
      : undefined;
    const query = filtered ? `?${new URLSearchParams(filtered).toString()}` : "";
    return `${API_BASE}/reports/accounting-export/csv${query}`;
  },

  // Export
  backupUrl: () => `${API_BASE}/export/backup`,
  sqliteBackupUrl: () => `${API_BASE}/export/sqlite`,
  restoreUrl: () => `${API_BASE}/export/restore`,
  wipeUrl: () => `${API_BASE}/export/wipe`,
  /** Re-exposes the in-memory token so admin-only export routes can be hit via fetch directly (FormData uploads). */
  getAuthToken,

  // CSV Export
  exportCsvUrl: (
    resource: "invoices" | "customers" | "products" | "expenses",
    params?: Record<string, string>,
  ) => {
    const filtered = params
      ? Object.fromEntries(Object.entries(params).filter(([, v]) => v))
      : undefined;
    const query = filtered ? `?${new URLSearchParams(filtered).toString()}` : "";
    return `${API_BASE}/${resource}/export/csv${query}`;
  },

  // Full-text search (FTS5 across customers, products, invoices)
  searchAll: (q: string, limit = 15) =>
    request<{
      success: boolean;
      data: {
        hits: {
          kind: "invoice" | "customer" | "product";
          id: string;
          title: string;
          subtitle: string | null;
          snippet: string;
          rank: number;
        }[];
      };
    }>(`/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  // CSV Import
  previewCsvImport: async (
    resource: "customers" | "products" | "expenses",
    file: File,
  ): Promise<{
    success: boolean;
    data: {
      headers: string[];
      sample_rows: string[][];
      total_rows: number;
      suggested_mapping: Record<string, string>;
      available_fields: readonly string[];
    };
    error?: string;
  }> => {
    const formData = new FormData();
    formData.append("csv", file);
    return request(`/${resource}/import/preview`, { method: "POST", body: formData });
  },
  runCsvImport: (
    resource: "customers" | "products" | "expenses",
    payload: { csv: string; mapping: Record<string, string>; dry_run: boolean },
  ) =>
    request<{
      success: boolean;
      data: {
        dry_run?: boolean;
        would_create?: number;
        created?: number;
        failed?: number;
        errors: { row: number; reason: string }[];
        first_preview?: Record<string, unknown>[];
      };
    }>(`/${resource}/import`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // Invoice preview & PDF
  previewInvoice: async (id: string): Promise<string> => {
    const headers: Record<string, string> = {};
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }
    const res = await fetch(`${API_BASE}/invoices/${id}/preview`, {
      headers,
      credentials: "include",
    });
    if (!res.ok) throw new Error("Failed to load preview");
    return res.text();
  },

  // Customer account statement (print-ready HTML + email)
  previewStatement: async (customerId: string, from: string, to: string): Promise<string> => {
    const headers: Record<string, string> = {};
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`${API_BASE}/customers/${customerId}/statement?from=${from}&to=${to}`, {
      headers,
      credentials: "include",
    });
    if (!res.ok) throw new Error("Failed to load statement");
    return res.text();
  },
  sendStatement: (
    customerId: string,
    body: { from: string; to: string; to_email?: string; subject?: string; message?: string },
  ) =>
    request<{ success: boolean; data: { message: string } }>(
      `/customers/${customerId}/statement/send`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  // Client Portal
  getPortalInvoices: (token: string) =>
    request<{
      success: boolean;
      data: {
        customer: { name: string; email: string };
        invoices: Array<{
          id: string;
          invoice_number: string;
          status: string;
          total: number;
          currency: string;
          issue_date: string;
          due_date: string | null;
        }>;
      };
    }>(`/public/portal/${token}`),
  portalYearZipUrl: (token: string, year: number) =>
    `${API_BASE}/public/portal/${token}/invoices.zip?year=${year}`,
  getPortalInvoiceComments: (token: string, invoiceId: string) =>
    request<{
      success: boolean;
      data: {
        id: string;
        author_type: string;
        author_name: string;
        body: string;
        created_at: string;
      }[];
    }>(`/public/portal/${token}/invoices/${invoiceId}/comments`),
  postPortalInvoiceComment: (token: string, invoiceId: string, body: string) =>
    request<{ success: boolean; data: any }>(
      `/public/portal/${token}/invoices/${invoiceId}/comments`,
      {
        method: "POST",
        body: JSON.stringify({ body }),
      },
    ),

  // Outgoing webhooks
  listOutgoingWebhookEvents: () =>
    request<{ success: boolean; data: { events: string[] } }>("/outgoing-webhooks/events"),
  listOutgoingWebhooks: () =>
    request<{
      success: boolean;
      data: Array<{
        id: string;
        name: string;
        url: string;
        events: string;
        preset: string;
        is_active: number;
        created_at: string;
        updated_at: string;
      }>;
    }>("/outgoing-webhooks"),
  createOutgoingWebhook: (data: {
    name: string;
    url: string;
    events: string[];
    preset?: string;
    is_active?: boolean;
  }) =>
    request<{ success: boolean; data: any }>("/outgoing-webhooks", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateOutgoingWebhook: (
    id: string,
    data: Partial<{
      name: string;
      url: string;
      events: string[];
      preset: string;
      is_active: boolean;
    }>,
  ) =>
    request<{ success: boolean; data: any }>(`/outgoing-webhooks/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteOutgoingWebhook: (id: string) => request(`/outgoing-webhooks/${id}`, { method: "DELETE" }),
  listWebhookDeliveries: (id: string, limit = 50) =>
    request<{
      success: boolean;
      data: Array<{
        id: string;
        webhook_id: string;
        event_type: string;
        payload: string | null;
        status_code: number | null;
        response_body: string | null;
        error_message: string | null;
        attempt_count: number;
        created_at: string;
      }>;
    }>(`/outgoing-webhooks/${id}/deliveries?limit=${limit}`),
  retryWebhookDelivery: (id: string) =>
    request<{ success: boolean; data: any }>(`/outgoing-webhooks/deliveries/${id}/retry`, {
      method: "POST",
    }),

  // API tokens (public REST API / integrations)
  listApiTokenScopes: () =>
    request<{ success: boolean; data: { resources: string[]; actions: string[] } }>(
      "/api-tokens/scopes",
    ),
  listApiTokens: () =>
    request<{
      success: boolean;
      data: Array<{
        id: string;
        name: string;
        token_prefix: string;
        scopes: string[];
        last_used_at: string | null;
        created_at: string;
      }>;
    }>("/api-tokens"),
  createApiToken: (data: { name: string; scopes?: string[] }) =>
    request<{ success: boolean; data: { id: string; token: string } }>("/api-tokens", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteApiToken: (id: string) => request(`/api-tokens/${id}`, { method: "DELETE" }),

  // Feedback
  submitFeedback: (data: { message: string; page_url?: string }) =>
    request<{ success: boolean; data: any }>("/feedback", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
