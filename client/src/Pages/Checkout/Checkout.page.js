import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { logoutUser } from "../../redux/actions/user.action";
import { readCart, saveCart, cartSubtotal } from "../../utils/cart";
import { getProductImage, useFallbackProductImage } from "../../utils/product";
import { formatGBP } from "../../utils/money";
import { apiRequest, authHeader, NetworkError } from "../../utils/api";
import { saveOrderAccess } from "../../utils/orderAccess";
import {
  GHANA_REGIONS,
  buildOrderPayload,
  emptyCheckoutForm,
  forgetCheckoutAttempt,
  idempotencyKeyFor,
  mapServerErrors,
  validateCheckoutForm,
} from "../../utils/checkout";
import { policiesVisible } from "../../policies/content";
import policyReview from "../../policies/review.json";
import "./checkout.styles.css";

const FIELD_ORDER = ["name", "email", "phone", "recipient", "recipientPhone", "line1", "line2", "landmark", "city", "region", "termsAccepted"];

const Field = ({ id, label, hint, error, children }) => (
  <div className={`checkout-field ${error ? "has-error" : ""}`}>
    <label htmlFor={id}>{label}</label>
    {hint && (
      <p className="checkout-hint" id={`${id}-hint`}>
        {hint}
      </p>
    )}
    {children}
    {error && (
      <p className="checkout-error" id={`${id}-error`}>
        {error}
      </p>
    )}
  </div>
);

const describedBy = (id, hint, error) => [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;

const Checkout = () => {
  const { user } = useSelector((state) => state.userReducer);
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [items] = useState(readCart);
  const [form, setForm] = useState(() => emptyCheckoutForm(user));
  const [errors, setErrors] = useState({});
  const [itemErrors, setItemErrors] = useState({});
  const [status, setStatus] = useState({ state: "idle", message: "" });
  const submitting = useRef(false);
  const formRef = useRef(null);

  if (!items.length) {
    return (
      <main className="checkout container">
        <section className="checkout-empty">
          <h1 className="title">Checkout</h1>
          <p>Your cart is empty, so there is nothing to order yet.</p>
          <Link className="checkout-button checkout-button-dark" to="/store">
            Continue Shopping
          </Link>
        </section>
      </main>
    );
  }

  const update = (field) => (event) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
    if (status.state === "invalid") setStatus({ state: "idle", message: "" });
  };

  const focusFirstError = (fieldErrors) => {
    const first = FIELD_ORDER.find((field) => fieldErrors[field]);
    if (first) formRef.current?.querySelector(`[name="${first}"]`)?.focus();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting.current) return;

    const clientErrors = validateCheckoutForm(form);
    setErrors(clientErrors);
    setItemErrors({});
    if (Object.keys(clientErrors).length) {
      setStatus({ state: "invalid", message: "Please correct the highlighted fields." });
      focusFirstError(clientErrors);
      return;
    }

    const payload = buildOrderPayload(form, items);
    const key = idempotencyKeyFor(payload);
    submitting.current = true;
    setStatus({ state: "submitting", message: "Placing your order…" });

    try {
      const { ok, status: httpStatus, data } = await apiRequest("/api/orders", {
        method: "POST",
        body: payload,
        headers: { "Idempotency-Key": key, ...authHeader(user) },
      });

      if (ok && data?.orderId && data?.orderNumber && (httpStatus === 201 || httpStatus === 200)) {
        saveOrderAccess(data.orderId, data.trackingHandoff?.accessToken, data.trackingHandoff?.expiresInMinutes || 60);
        // Only now, after the server has confirmed the order, is the cart cleared.
        saveCart([]);
        forgetCheckoutAttempt();
        navigate(`/orders/${data.orderId}/confirmation`, { replace: true, state: { order: data.order } });
        return;
      }

      if (httpStatus === 422) {
        const mapped = mapServerErrors(data?.fields);
        setErrors(mapped.formErrors);
        setItemErrors(mapped.itemErrors);
        setStatus({
          state: "invalid",
          message:
            data?.code === "ITEMS_UNAVAILABLE"
              ? "Some items in your cart can no longer be ordered. Update your cart and try again."
              : data?.error || "Please correct the highlighted fields.",
        });
        focusFirstError(mapped.formErrors);
      } else if (httpStatus === 401 && user) {
        // A stored sign-in that has expired must not block checkout.
        dispatch(logoutUser());
        setStatus({
          state: "error",
          message: "Your sign-in has expired, so you have been signed out. Submit again to order as a guest, or sign in again first.",
        });
      } else if (httpStatus === 409) {
        forgetCheckoutAttempt();
        setStatus({ state: "error", message: "Your details changed since the last attempt. Please submit again." });
      } else if (httpStatus === 429) {
        setStatus({ state: "error", message: "Too many attempts. Please wait a few minutes and try again." });
      } else {
        setStatus({ state: "error", message: "We couldn't place your order. Your cart has been kept — please try again." });
      }
    } catch (error) {
      setStatus({
        state: "error",
        message:
          error instanceof NetworkError
            ? "We couldn't reach EscoWear. Your cart has been kept. Trying again is safe — you won't be charged or get a duplicate order."
            : "Something went wrong. Your cart has been kept — please try again.",
      });
    } finally {
      submitting.current = false;
    }
  };

  const isSubmitting = status.state === "submitting";
  const input = (field, props = {}, hasHint = false) => (
    <input
      id={`checkout-${field}`}
      name={field}
      value={form[field]}
      onChange={update(field)}
      aria-invalid={errors[field] ? "true" : undefined}
      aria-describedby={describedBy(`checkout-${field}`, hasHint, errors[field])}
      disabled={isSubmitting}
      {...props}
    />
  );

  return (
    <main className="checkout container">
      <header className="checkout-header">
        <p className="checkout-eyebrow">Secure order request</p>
        <h1 className="title">Checkout</h1>
        {user ? (
          <p className="checkout-account">Signed in as {user.email}. This order will appear in your account.</p>
        ) : (
          <p className="checkout-account">
            Checking out as a guest — no account needed.{" "}
            <Link to="/login" state={{ from: "/checkout" }}>
              Sign in
            </Link>{" "}
            to see this order in your account.
          </p>
        )}
      </header>

      <div className="checkout-notice" role="note">
        <strong>No payment now.</strong> We will email confirmed GHS payment details after checking availability and costs.
      </div>

      <div className="checkout-layout">
        <form ref={formRef} className="checkout-form" onSubmit={handleSubmit} noValidate aria-describedby="checkout-status">
          <fieldset>
            <legend>Your details</legend>
            <Field id="checkout-name" label="Full name" error={errors.name}>
              {input("name", { autoComplete: "name", required: true })}
            </Field>
            <Field id="checkout-email" label="Email" hint="We'll send your order updates and payment details here." error={errors.email}>
              {input("email", { type: "email", autoComplete: "email", required: true }, true)}
            </Field>
            <Field id="checkout-phone" label="Ghana phone number" hint="For example 024 123 4567 or +233 24 123 4567." error={errors.phone}>
              {input("phone", { type: "tel", autoComplete: "tel", inputMode: "tel", required: true }, true)}
            </Field>
          </fieldset>

          <fieldset>
            <legend>Delivery in Ghana</legend>
            <Field id="checkout-recipient" label="Recipient name (optional)" hint="Leave blank if you will receive the order yourself." error={errors.recipient}>
              {input("recipient", { autoComplete: "shipping name" }, true)}
            </Field>
            <Field id="checkout-recipientPhone" label="Recipient phone (optional)" error={errors.recipientPhone}>
              {input("recipientPhone", { type: "tel", inputMode: "tel" })}
            </Field>
            <Field id="checkout-line1" label="Street address or house number" error={errors.line1}>
              {input("line1", { autoComplete: "shipping address-line1", required: true })}
            </Field>
            <Field id="checkout-line2" label="Area or apartment (optional)" error={errors.line2}>
              {input("line2", { autoComplete: "shipping address-line2" })}
            </Field>
            <Field id="checkout-landmark" label="Nearest landmark (optional)" error={errors.landmark}>
              {input("landmark")}
            </Field>
            <div className="checkout-row">
              <Field id="checkout-city" label="Town or city" error={errors.city}>
                {input("city", { autoComplete: "shipping address-level2", required: true })}
              </Field>
              <Field id="checkout-region" label="Region" error={errors.region}>
                <select
                  id="checkout-region"
                  name="region"
                  value={form.region}
                  onChange={update("region")}
                  aria-invalid={errors.region ? "true" : undefined}
                  aria-describedby={describedBy("checkout-region", false, errors.region)}
                  disabled={isSubmitting}
                  required
                >
                  <option value="">Select a region</option>
                  {GHANA_REGIONS.map((region) => (
                    <option key={region} value={region}>
                      {region}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </fieldset>

          <fieldset>
            <legend>Before you order</legend>
            <ul className="checkout-steps">
              <li>Submitting sends us an order request. You are not charged and nothing is confirmed yet.</li>
              <li>We check the exact size is available from the UK retailer and work out the final cost.</li>
              <li>We email you the final amount in Ghana cedis (GHS) with payment instructions.</li>
              <li>Your order is confirmed only after we verify your payment.</li>
              {policiesVisible() && (
                <>
                  <li>Your GHS quote includes shipping, import duties, taxes and delivery, so you pay nothing extra on arrival. Quotes are valid for 48 hours.</li>
                  <li>{policyReview.business.delivery}</li>
                </>
              )}
            </ul>
            <div className={`checkout-consent ${errors.termsAccepted ? "has-error" : ""}`}>
              <input
                type="checkbox"
                id="checkout-termsAccepted"
                name="termsAccepted"
                checked={form.termsAccepted}
                onChange={update("termsAccepted")}
                aria-invalid={errors.termsAccepted ? "true" : undefined}
                aria-describedby={describedBy("checkout-termsAccepted", false, errors.termsAccepted)}
                disabled={isSubmitting}
              />
              <label htmlFor="checkout-termsAccepted">
                I understand this is an order request, not a payment, and agree that EscoWear may use my details to process
                this order and contact me about it.
                {policiesVisible() && (
                  <>
                    {" "}
                    I have read the{" "}
                    <a href="/policies" target="_blank" rel="noopener noreferrer">
                      shop policies (opens in a new tab)
                    </a>
                    .
                  </>
                )}
              </label>
              {errors.termsAccepted && (
                <p className="checkout-error" id="checkout-termsAccepted-error">
                  {errors.termsAccepted}
                </p>
              )}
            </div>
          </fieldset>

          <div id="checkout-status" className={`checkout-status is-${status.state}`} role={status.state === "error" || status.state === "invalid" ? "alert" : "status"} aria-live="polite">
            {status.message}
          </div>

          <button className="checkout-button checkout-button-dark" type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? "Placing order…" : "Place order request"}
          </button>
        </form>

        <aside className="checkout-summary" aria-label="Order summary">
          <h2>Your order</h2>
          <ul>
            {items.map((item, index) => {
              const unit = Math.round(item.price * 100);
              return (
                <li key={`${item.productId}:${item.size}`} className={itemErrors[index] ? "has-error" : ""}>
                  <img src={getProductImage(item)} alt="" onError={useFallbackProductImage} />
                  <div>
                    <p className="checkout-summary-name">{item.name}</p>
                    <p>
                      {item.size} · Qty {item.quantity}
                    </p>
                    {itemErrors[index] && <p className="checkout-error">{itemErrors[index]}</p>}
                  </div>
                  <p className="checkout-summary-price">{formatGBP(unit * item.quantity)}</p>
                </li>
              );
            })}
          </ul>
          <dl>
            <div>
              <dt>Indicative subtotal (GBP)</dt>
              <dd>{formatGBP(cartSubtotal(items))}</dd>
            </div>
          </dl>
          <p className="checkout-summary-note">
            This GBP amount is an estimate based on current UK prices. Your final amount in GHS, including shipping and fees,
            will be in our email.
          </p>
          <Link className="checkout-summary-edit" to="/cart">
            Edit cart
          </Link>
        </aside>
      </div>
    </main>
  );
};

export default Checkout;
