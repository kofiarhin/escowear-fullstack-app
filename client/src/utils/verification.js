import { apiRequest } from "./api";

// Pending email verification (IDE-152). The pending token is a short-lived,
// restricted credential: it can only check status, resend the link or
// correct the email. It is kept for this tab only, never as a sign-in.
const PENDING_KEY = "escowear-pending-verification-v1";

export const savePendingVerification = (pending) => {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ pendingToken: pending.pendingToken, email: pending.email, deadline: pending.deadline }));
  } catch {
    // Without storage the check-email page asks the customer to sign in again.
  }
};

export const readPendingVerification = () => {
  try {
    const stored = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null");
    return stored && typeof stored.pendingToken === "string" ? stored : null;
  } catch {
    return null;
  }
};

export const clearPendingVerification = () => {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing stored.
  }
};

const withPending = (pendingToken) => ({ Authorization: `Bearer ${pendingToken}` });

export const registerAccount = (body) => apiRequest("/api/users/register", { method: "POST", body });
export const verifyEmailToken = (token) => apiRequest("/api/users/verify-email", { method: "POST", body: { token } });
export const fetchVerificationStatus = (pendingToken) => apiRequest("/api/users/verification", { headers: withPending(pendingToken) });
export const resendVerification = (pendingToken) => apiRequest("/api/users/verification/resend", { method: "POST", headers: withPending(pendingToken) });
export const changeVerificationEmail = (pendingToken, email) =>
  apiRequest("/api/users/verification/email", { method: "PATCH", headers: withPending(pendingToken), body: { email } });

export const formatDeadline = (value) =>
  value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "";

// Guest checkout email code (bound to the order email and Idempotency-Key).
export const requestCheckoutCode = (email, checkoutIntent) =>
  apiRequest("/api/orders/checkout-email/request", { method: "POST", body: { email, checkoutIntent } });
export const verifyCheckoutCode = (email, checkoutIntent, code) =>
  apiRequest("/api/orders/checkout-email/verify", { method: "POST", body: { email, checkoutIntent, code } });
