import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest, authHeader } from "../../utils/api";
import { clearProofAccess, proofAccessHeader } from "../../utils/orderAccess";
import { formatGHS } from "../../utils/money";
import {
  ACCEPTED_TYPES,
  DEFAULT_MAX_BYTES,
  newUploadKey,
  prepareProofImage,
  uploadErrorMessage,
  uploadPaymentProof,
  validateProofFile,
  validateReference,
} from "../../utils/paymentProof";
import "./paymentPanel.styles.css";

const formatDate = (value) => (value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "");
const PAID = ["confirmed", "processing", "dispatched", "delivered", "delivery_issue", "completed", "sourcing_failed"];

const Breakdown = ({ quote }) => (
  <dl className="payment-panel-breakdown">
    <dt>Items</dt>
    <dd>{formatGHS(quote.subtotalMinor)}</dd>
    <dt>Fees</dt>
    <dd>{formatGHS(quote.feesMinor)}</dd>
    <dt>Shipping to Ghana</dt>
    <dd>{formatGHS(quote.shippingMinor)}</dd>
    <dt>Duties</dt>
    <dd>{formatGHS(quote.dutiesMinor)}</dd>
    <dt className="is-total">Total to pay</dt>
    <dd className="is-total">{formatGHS(quote.totalMinor)}</dd>
  </dl>
);

const UploadForm = ({ order, instructions, headers, onSubmitted, onSessionExpired }) => {
  const [file, setFile] = useState(null);
  const [reference, setReference] = useState("");
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState({ state: "idle", message: "" });
  const [progress, setProgress] = useState(0);
  // One key per distinct (file, reference): a retry after a network error
  // reuses it, so the server returns the same proof instead of a duplicate.
  const attempt = useRef({ key: newUploadKey(), file: null, reference: "" });
  const maxBytes = instructions.maxUploadBytes || DEFAULT_MAX_BYTES;
  const busy = status.state === "busy";

  const submit = async (event) => {
    event.preventDefault();
    const fieldErrors = {};
    const fileError = validateProofFile(file, maxBytes);
    const referenceError = validateReference(reference);
    if (fileError) fieldErrors.file = fileError;
    if (referenceError) fieldErrors.reference = referenceError;
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) {
      document.getElementById(fieldErrors.file ? "payment-proof-file" : "payment-proof-reference")?.focus();
      return;
    }
    const cleaned = reference.replace(/\s+/g, " ").trim();
    if (attempt.current.file !== file || attempt.current.reference !== cleaned) attempt.current = { key: newUploadKey(), file, reference: cleaned };

    setStatus({ state: "busy", message: "Uploading your screenshot…" });
    setProgress(0);
    try {
      const prepared = await prepareProofImage(file);
      const response = await uploadPaymentProof({
        orderId: order.id,
        file: prepared,
        transactionReference: cleaned,
        quoteVersion: instructions.quote.quoteVersion,
        headers,
        idempotencyKey: attempt.current.key,
        onProgress: setProgress,
      });
      if (response.ok) {
        setStatus({ state: "done", message: "Payment submitted — under review. Your order is not confirmed yet." });
        onSubmitted();
        return;
      }
      if (response.status === 404 || response.status === 401) {
        onSessionExpired();
        return;
      }
      const serverFields = response.data?.fields || {};
      setErrors({ file: serverFields.proofImage, reference: serverFields.transactionReference });
      setStatus({ state: "error", message: uploadErrorMessage(response) });
      if (["STALE_QUOTE", "PROOF_ALREADY_SUBMITTED", "QUOTE_EXPIRED", "NOT_AWAITING_PAYMENT"].includes(response.data?.code)) onSubmitted();
    } catch {
      setStatus({ state: "error", message: "Upload failed — check your connection and try again. Nothing was submitted twice." });
    }
  };

  return (
    <form className="payment-panel-form" onSubmit={submit} noValidate aria-labelledby="payment-proof-title">
      <h3 id="payment-proof-title">Upload your payment proof</h3>
      <p className="payment-panel-muted">After paying, upload a screenshot of the Mobile Money confirmation and enter its transaction ID.</p>
      <div className="payment-panel-field">
        <label htmlFor="payment-proof-file">Payment screenshot (JPEG, PNG or WebP)</label>
        <input
          id="payment-proof-file"
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          onChange={(event) => {
            setFile(event.target.files?.[0] || null);
            setErrors((current) => ({ ...current, file: undefined }));
          }}
          aria-invalid={errors.file ? "true" : undefined}
          aria-describedby={errors.file ? "payment-proof-file-error" : "payment-proof-file-help"}
          disabled={busy}
        />
        <p id="payment-proof-file-help" className="payment-panel-muted">
          Take a photo or choose a screenshot. Maximum {Math.floor(maxBytes / (1024 * 1024))} MB.
        </p>
        {errors.file && (
          <p className="payment-panel-error" id="payment-proof-file-error">
            {errors.file}
          </p>
        )}
      </div>
      <div className="payment-panel-field">
        <label htmlFor="payment-proof-reference">Mobile Money transaction ID</label>
        <input
          id="payment-proof-reference"
          value={reference}
          onChange={(event) => {
            setReference(event.target.value);
            setErrors((current) => ({ ...current, reference: undefined }));
          }}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck="false"
          maxLength={64}
          aria-invalid={errors.reference ? "true" : undefined}
          aria-describedby={errors.reference ? "payment-proof-reference-error" : undefined}
          disabled={busy}
        />
        {errors.reference && (
          <p className="payment-panel-error" id="payment-proof-reference-error">
            {errors.reference}
          </p>
        )}
      </div>
      {busy && (
        <progress className="payment-panel-progress" max="100" value={progress} aria-label="Upload progress">
          {progress}%
        </progress>
      )}
      <div className={`payment-panel-status is-${status.state}`} role={status.state === "error" ? "alert" : "status"} aria-live="polite">
        {status.message}
      </div>
      <button type="submit" className="payment-panel-button" disabled={busy}>
        {busy ? "Submitting…" : "Submit payment proof"}
      </button>
    </form>
  );
};

// Payment step of the customer order page: quote, Mobile Money instructions
// (from the server, owner only), screenshot upload and review state.
const PaymentPanel = ({ order, user, onChanged }) => {
  const [instructions, setInstructions] = useState(null);
  const [state, setState] = useState("idle");
  const [sessionExpired, setSessionExpired] = useState(false);
  const quote = order.pricing?.finalGHS;
  const payment = order.payment;
  const canSubmit = Boolean(payment?.canSubmitProof);

  const proofHeaders = proofAccessHeader(order.id);
  const headers = Object.keys(proofHeaders).length ? proofHeaders : authHeader(user);
  const hasAccess = Object.keys(headers).length > 0 && !sessionExpired;
  const headerKey = JSON.stringify(headers);

  useEffect(() => {
    if (!canSubmit || !hasAccess) return undefined;
    let active = true;
    setState("loading");
    apiRequest(`/api/orders/${encodeURIComponent(order.id)}/payment-instructions`, { headers: JSON.parse(headerKey) })
      .then(({ ok, status, data }) => {
        if (!active) return;
        if (ok) {
          setInstructions(data);
          setState("ready");
        } else if (status === 404 || status === 401) {
          clearProofAccess(order.id);
          setSessionExpired(true);
          setState("idle");
        } else setState("error");
      })
      .catch(() => active && setState("error"));
    return () => {
      active = false;
    };
  }, [order.id, order.status, quote?.quoteVersion, canSubmit, hasAccess, headerKey]);

  if (!payment || order.legacy) return null;

  const reverify = (
    <p>
      <Link className="payment-panel-link" to={`/track-order?order=${encodeURIComponent(order.orderNumber)}`}>
        Confirm your email to pay and upload proof
      </Link>
    </p>
  );

  let body;
  if (PAID.includes(order.status) || payment.verified) {
    body = (
      <p className="payment-panel-notice is-good">
        <strong>Payment verified — order confirmed.</strong> We checked that your payment arrived in our account.
      </p>
    );
  } else if (order.status === "payment_review") {
    body = (
      <div className="payment-panel-notice is-review" role="status">
        <strong>Payment submitted — under review. Your order is not confirmed yet.</strong>
        <p>
          We are checking that the money has arrived in our Mobile Money account. We'll email you once it is verified.
          {payment.proof && (
            <>
              {" "}
              Submitted {formatDate(payment.proof.submittedAt)} · transaction ID {payment.proof.referenceMasked}.
            </>
          )}
        </p>
      </div>
    );
  } else if (["pending_contact", "awaiting_customer"].includes(order.status)) {
    body = (
      <p className="payment-panel-notice">
        <strong>Don't pay yet.</strong> We're checking availability and the final cost. We'll email you the final GHS quote and how to pay.
      </p>
    );
  } else if (quote && ["awaiting_payment", "payment_issue"].includes(order.status)) {
    const issue = order.status === "payment_issue" && (
      <p className="payment-panel-notice is-warning" role="alert">
        <strong>We couldn't verify your payment.</strong> Please read our email about what's needed. When asked, upload a new screenshot below.
      </p>
    );
    if (quote.expired) {
      body = (
        <>
          {issue}
          <p className="payment-panel-notice is-warning">
            <strong>This quote expired on {formatDate(quote.expiresAt)}.</strong> Please don't pay this amount. Reply to our quote email to request an
            updated quote.
          </p>
        </>
      );
    } else if (!hasAccess) {
      body = (
        <>
          {issue}
          <p>
            Amount to pay: <strong>{formatGHS(quote.totalMinor)}</strong> (valid until {formatDate(quote.expiresAt)}).
          </p>
          <p className="payment-panel-muted">
            {sessionExpired ? "Your secure session has expired. " : ""}For your security, confirm your email to see the payment details and upload your
            screenshot.
          </p>
          {reverify}
        </>
      );
    } else if (state === "loading" || state === "idle") {
      body = <p role="status">Loading payment details…</p>;
    } else if (state === "error" || !instructions) {
      body = <p role="alert">We couldn't load the payment details. Please refresh the page or check our quote email.</p>;
    } else if (!instructions.available) {
      body = (
        <p className="payment-panel-notice is-warning">
          {instructions.reason === "QUOTE_EXPIRED"
            ? "This quote has expired. Please reply to our quote email to request an updated quote before paying."
            : "Payment details are not available online right now. Please use the details in our quote email."}
        </p>
      );
    } else {
      body = (
        <>
          {issue}
          <Breakdown quote={instructions.quote} />
          <p>
            Valid until <strong>{formatDate(instructions.quote.expiresAt)}</strong>. Customs and delivery to your address are included — you won't
            pay anything extra on arrival.
          </p>
          <div className="payment-panel-instructions">
            <h3>How to pay by Mobile Money</h3>
            <p className="payment-panel-pre">{instructions.instructions}</p>
            <p>
              Send exactly <strong>{formatGHS(instructions.quote.totalMinor)}</strong> and use reference <strong>{instructions.paymentReference}</strong>.
            </p>
          </div>
          <UploadForm
            order={order}
            instructions={instructions}
            headers={headers}
            onSubmitted={onChanged}
            onSessionExpired={() => {
              clearProofAccess(order.id);
              setSessionExpired(true);
            }}
          />
          <p className="payment-panel-muted">Uploading a screenshot does not confirm your order. We confirm it only after the money reaches our account.</p>
        </>
      );
    }
  } else {
    return null;
  }

  return (
    <section className="payment-panel" aria-labelledby="payment-panel-title">
      <h2 id="payment-panel-title" className="order-details-heading">
        Payment
      </h2>
      {body}
    </section>
  );
};

export default PaymentPanel;
