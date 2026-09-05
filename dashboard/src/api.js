/*
 * Two origins, on purpose.
 *
 * The buyer agent (:8003) is the buyer's gateway. The passport service
 * (:8001) is the MERCHANT's, and it hosts the merchant control plane — so the
 * merchant console in this dashboard talks to it directly rather than being
 * proxied through the buyer agent. Routing a merchant's catalog edits through
 * the buyer's agent would quietly contradict the architecture the whole
 * project is arguing for.
 */

/* 127.0.0.1 rather than localhost for the same reason the Python services use
   it: on Windows, "localhost" tries ::1 first and stalls ~2s per connection
   before falling back to IPv4. */
const BUYER_AGENT_URL = "http://127.0.0.1:8003";
const PASSPORT_URL = "http://127.0.0.1:8001";

async function request(path, options = {}, base = BUYER_AGENT_URL) {
  const resp = await fetch(`${base}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const detail = data?.detail || resp.statusText;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return data;
}

export const STREAM_URLS = {
  query: `${BUYER_AGENT_URL}/api/agent/stream`,
  compare: `${BUYER_AGENT_URL}/api/agent/compare/stream`,
  confirm: `${BUYER_AGENT_URL}/api/agent/confirm/stream`,
  redteam: `${BUYER_AGENT_URL}/api/redteam/stream`,
};

export const api = {
  health: () => request("/health"),

  startSession: () => request("/api/session/start", { method: "POST" }),

  passportSummary: (merchantId) =>
    request(`/api/passport/summary${merchantId ? `?merchant_id=${encodeURIComponent(merchantId)}` : ""}`),

  registry: () => request("/api/registry"),

  agentQuery: (correlationId, message, merchantId) =>
    request("/api/agent/query", {
      method: "POST",
      body: JSON.stringify({ correlation_id: correlationId, message, merchant_id: merchantId }),
    }),

  agentConfirm: (correlationId, basketId, merchantId) =>
    request("/api/agent/confirm", {
      method: "POST",
      body: JSON.stringify({ correlation_id: correlationId, basket_id: basketId, merchant_id: merchantId }),
    }),

  paymentsVerify: (payload) =>
    request("/api/payments/verify", { method: "POST", body: JSON.stringify(payload) }),

  paymentsSimulate: (orderId) =>
    request("/api/payments/simulate", {
      method: "POST",
      body: JSON.stringify({ order_id: orderId }),
    }),

  demoOverlimit: (correlationId) =>
    request("/api/demo/overlimit", {
      method: "POST",
      body: JSON.stringify({ correlation_id: correlationId }),
    }),

  audit: (correlationId, limit = 100) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (correlationId) params.set("correlation_id", correlationId);
    return request(`/api/audit?${params.toString()}`);
  },

  auditRuns: () => request("/api/audit/correlations"),

  // -- buyer risk policy --
  getPolicy: () => request("/api/policy"),
  putPolicy: (patch) => request("/api/policy", { method: "PUT", body: JSON.stringify({ patch }) }),
  resetPolicy: () => request("/api/policy/reset", { method: "POST" }),
  evaluatePolicy: (merchantId) =>
    request(`/api/policy/evaluate${merchantId ? `?merchant_id=${encodeURIComponent(merchantId)}` : ""}`),

  // -- red team --
  redteamAttacks: () => request("/api/redteam/attacks"),
  redteamRun: (attackId, correlationId) =>
    request("/api/redteam/run", {
      method: "POST",
      body: JSON.stringify({ attack_id: attackId, correlation_id: correlationId }),
    }),

  // -- merchant control plane (the MERCHANT's service, not the buyer's) --
  merchants: () => request("/admin/merchants", {}, PASSPORT_URL),
  merchant: (id) => request(`/admin/merchant/${id}`, {}, PASSPORT_URL),
  patchMerchant: (id, patch) =>
    request(`/admin/merchant/${id}`, { method: "PATCH", body: JSON.stringify(patch) }, PASSPORT_URL),
  regenerateMerchant: (id) =>
    request(`/admin/merchant/${id}/regenerate`, { method: "POST" }, PASSPORT_URL),
  previewPassport: (id) => request(`/admin/preview/${id}`, {}, PASSPORT_URL),
};
