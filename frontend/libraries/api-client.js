import { APP_CONFIG } from "../configs/app-config.js";

const TOKEN_KEY = "milktea-customer-token";
const internalPortal = location.pathname === "/admin" || location.pathname.startsWith("/admin/")
  ? "admin"
  : location.pathname === "/manager" || location.pathname.startsWith("/manager/")
    ? "manager"
    : location.port === "4173" ? "admin" : "manager";
const INTERNAL_TOKEN_KEY = `milktea-${internalPortal}-token`;

async function request(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const response = await fetch(`${APP_CONFIG.apiBaseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || "Không thể kết nối máy chủ");
    error.code = data.code;
    error.status = response.status;
    if (response.status === 401) localStorage.removeItem(TOKEN_KEY);
    throw error;
  }
  return data;
}

export const customerApi = {
  hasToken: () => Boolean(localStorage.getItem(TOKEN_KEY)),
  logout: () => localStorage.removeItem(TOKEN_KEY),
  options: () => request("/catalogs/options"),
  async login(credentials) {
    const data = await request("/auth/login", { method: "POST", body: credentials });
    localStorage.setItem(TOKEN_KEY, data.token);
    return data;
  },
  async register(payload) {
    const data = await request("/auth/register", { method: "POST", body: payload });
    localStorage.setItem(TOKEN_KEY, data.token);
    return data;
  },
  me: () => request("/me"),
  updateMe: profile => request("/me", { method: "PATCH", body: profile }),
  updatePassword: passwords => request("/me/password", { method: "PATCH", body: passwords }),
  feedback: () => request("/me/feedback"),
  sendFeedback: feedback => request("/me/feedback", { method: "POST", body: feedback }),
  surveys: () => request("/me/surveys"),
  survey: id => request(`/me/surveys/${id}`),
  surveyResults: id => request(`/me/surveys/${id}/results`),
  submitSurvey: (id, answers) => request(`/me/surveys/${id}/submit`, { method: "POST", body: { answers } }),
  notifications: () => request("/me/notifications"),
  readNotification: id => request(`/me/notifications/${id}`, { method: "PATCH" }),
  readAllNotifications: () => request("/me/notifications/read-all", { method: "PATCH" })
};

async function internalRequest(path, options = {}) {
  const token = localStorage.getItem(INTERNAL_TOKEN_KEY);
  const response = await fetch(`${APP_CONFIG.apiBaseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || "Không thể kết nối máy chủ");
    error.code = data.code;
    error.status = response.status;
    if (response.status === 401) localStorage.removeItem(INTERNAL_TOKEN_KEY);
    throw error;
  }
  return data;
}

export const internalApi = {
  portal: internalPortal,
  hasToken: () => Boolean(localStorage.getItem(INTERNAL_TOKEN_KEY)),
  logout: () => localStorage.removeItem(INTERNAL_TOKEN_KEY),
  async login(credentials) {
    const data = await internalRequest("/internal/auth/login", { method: "POST", body: credentials });
    localStorage.setItem(INTERNAL_TOKEN_KEY, data.token);
    return data;
  },
  me: () => internalRequest("/internal/me"),
  dashboard: () => internalRequest("/internal/dashboard"),
  customers: () => internalRequest("/internal/customers"),
  createCustomer: customer => internalRequest("/internal/customers", { method: "POST", body: customer }),
  updateCustomer: (id, customer) => internalRequest(`/internal/customers/${id}`, { method: "PATCH", body: customer }),
  updateCustomerStatus: (id, status) => internalRequest(`/internal/customers/${id}/status`, { method: "PATCH", body: { status } }),
  managers: () => internalRequest("/internal/managers"),
  createManager: manager => internalRequest("/internal/managers", { method: "POST", body: manager }),
  updateManager: (id, manager) => internalRequest(`/internal/managers/${id}`, { method: "PATCH", body: manager }),
  customerRequests: () => internalRequest("/internal/customer-requests"),
  createCustomerRequest: request => internalRequest("/internal/customer-requests", { method: "POST", body: request }),
  decideCustomerRequest: (id, status, note = "") => internalRequest(`/internal/customer-requests/${id}`, { method: "PATCH", body: { status, note } }),
  customerReports: () => internalRequest("/internal/reports/customers"),
  feedback: () => internalRequest("/internal/feedback"),
  updateFeedback: (id, status, reply = "") => internalRequest(`/internal/feedback/${id}`, { method: "PATCH", body: { status, reply } }),
  surveys: () => internalRequest("/internal/surveys"),
  survey: id => internalRequest(`/internal/surveys/${id}`),
  surveyResults: id => internalRequest(`/internal/surveys/${id}/results`),
  createSurvey: survey => internalRequest("/internal/surveys", { method: "POST", body: survey }),
  updateSurvey: (id, survey) => internalRequest(`/internal/surveys/${id}`, { method: "PATCH", body: survey }),
  setSurveyVisibility: (id, hidden) => internalRequest(`/internal/surveys/${id}/visibility`, { method: "PATCH", body: { hidden } }),
  accounts: () => internalRequest("/internal/accounts"),
  catalogs: () => internalRequest("/internal/catalogs"),
  createDrink: drink => internalRequest("/internal/drinks", { method: "POST", body: drink }),
  updateDrinkStatus: (id, active) => internalRequest(`/internal/drinks/${id}/status`, { method: "PATCH", body: { active } })
};
