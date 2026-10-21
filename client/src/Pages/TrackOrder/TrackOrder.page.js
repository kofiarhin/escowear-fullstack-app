import { useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiRequest } from "../../utils/api";
import { saveOrderAccess } from "../../utils/orderAccess";
import "./trackOrder.styles.css";

const ORDER_NUMBER = /^EW-[0-9A-Z]{5}-[0-9A-Z]{5}$/;

// Two steps: order number + email -> emailed one-time code -> short-lived,
// single-order access. Responses never reveal whether an order exists.
const TrackOrder = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [orderNumber, setOrderNumber] = useState((params.get("order") || "").toUpperCase());
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState("request");
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState({ state: "idle", message: "" });
  const codeInput = useRef(null);
  const busy = status.state === "busy";

  const requestCode = async (event) => {
    event.preventDefault();
    const normalized = orderNumber.trim().toUpperCase();
    const fieldErrors = {};
    if (!ORDER_NUMBER.test(normalized)) fieldErrors.orderNumber = "Enter the order number from your email, e.g. EW-AB12C-34DEF";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) fieldErrors.email = "Enter the email you used for the order";
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) return;
    setStatus({ state: "busy", message: "Sending code…" });
    try {
      const response = await apiRequest("/api/orders/tracking/request", { method: "POST", body: { orderNumber: normalized, email: email.trim() } });
      if (response.status === 202) {
        setOrderNumber(normalized);
        setStep("verify");
        setStatus({ state: "info", message: response.data?.message || "If the details match an order, we have emailed a code." });
        setTimeout(() => codeInput.current?.focus(), 0);
      } else if (response.status === 429) {
        setStatus({ state: "error", message: "Too many requests. Please wait a while and try again." });
      } else {
        setStatus({ state: "error", message: response.data?.error || "We couldn't send a code. Check the details and try again." });
      }
    } catch {
      setStatus({ state: "error", message: "We couldn't reach EscoWear. Please try again." });
    }
  };

  const verifyCode = async (event) => {
    event.preventDefault();
    const cleaned = code.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(cleaned)) {
      setErrors({ code: "Enter the 6-digit code from your email" });
      return;
    }
    setErrors({});
    setStatus({ state: "busy", message: "Checking code…" });
    try {
      const response = await apiRequest("/api/orders/tracking/verify", { method: "POST", body: { orderNumber, email: email.trim(), code: cleaned } });
      if (response.ok && response.data?.orderId) {
        saveOrderAccess(response.data.orderId, response.data.accessToken, response.data.expiresInMinutes);
        navigate(`/orders/${response.data.orderId}`);
        return;
      }
      setStatus({
        state: "error",
        message: response.status === 429 ? "Too many attempts. Please wait and request a new code." : response.data?.error || "That code is not valid or has expired.",
      });
    } catch {
      setStatus({ state: "error", message: "We couldn't reach EscoWear. Please try again." });
    }
  };

  return (
    <main className="track-order container">
      <h1 className="title">Track your order</h1>
      <p className="track-order-lead">Enter your order number and email. We'll email you a one-time code to view your order.</p>

      {step === "request" ? (
        <form className="track-order-form" onSubmit={requestCode} noValidate>
          <div className="track-order-field">
            <label htmlFor="track-order-number">Order number</label>
            <input
              id="track-order-number"
              value={orderNumber}
              onChange={(event) => setOrderNumber(event.target.value)}
              autoCapitalize="characters"
              placeholder="EW-XXXXX-XXXXX"
              aria-invalid={errors.orderNumber ? "true" : undefined}
              aria-describedby={errors.orderNumber ? "track-order-number-error" : undefined}
              disabled={busy}
            />
            {errors.orderNumber && <p className="track-order-error" id="track-order-number-error">{errors.orderNumber}</p>}
          </div>
          <div className="track-order-field">
            <label htmlFor="track-order-email">Email</label>
            <input
              id="track-order-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={errors.email ? "true" : undefined}
              aria-describedby={errors.email ? "track-order-email-error" : undefined}
              disabled={busy}
            />
            {errors.email && <p className="track-order-error" id="track-order-email-error">{errors.email}</p>}
          </div>
          <button type="submit" className="track-order-button" disabled={busy}>
            {busy ? "Sending…" : "Email me a code"}
          </button>
        </form>
      ) : (
        <form className="track-order-form" onSubmit={verifyCode} noValidate>
          <p>
            Order <strong>{orderNumber}</strong>
          </p>
          <div className="track-order-field">
            <label htmlFor="track-order-code">6-digit code</label>
            <input
              id="track-order-code"
              ref={codeInput}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              aria-invalid={errors.code ? "true" : undefined}
              aria-describedby={errors.code ? "track-order-code-error" : undefined}
              disabled={busy}
            />
            {errors.code && <p className="track-order-error" id="track-order-code-error">{errors.code}</p>}
          </div>
          <button type="submit" className="track-order-button" disabled={busy}>
            {busy ? "Checking…" : "View my order"}
          </button>
          <button
            type="button"
            className="track-order-link"
            onClick={() => {
              setStep("request");
              setCode("");
              setStatus({ state: "idle", message: "" });
            }}
          >
            Use different details or get a new code
          </button>
        </form>
      )}

      <div className={`track-order-status is-${status.state}`} role={status.state === "error" ? "alert" : "status"} aria-live="polite">
        {status.message}
      </div>
    </main>
  );
};

export default TrackOrder;
