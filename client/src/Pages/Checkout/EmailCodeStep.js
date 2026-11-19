// Guest checkout email confirmation (IDE-152). Rendered inside the checkout
// form, so pressing Enter in the code field submits the form, which verifies
// the code and then places the order.
const EmailCodeStep = ({ email, code, error, notice, busy, onCodeChange, onResend, onCancel, inputRef }) => (
  <fieldset className="checkout-email-code" aria-describedby="checkout-email-code-intro">
    <legend>Confirm your email</legend>
    <p id="checkout-email-code-intro" className="checkout-hint">
      We sent a 6-digit code to <strong>{email}</strong>. It expires in 10 minutes. Enter it to place your order.
    </p>
    <div className={`checkout-field ${error ? "has-error" : ""}`}>
      <label htmlFor="checkout-emailCode">6-digit code</label>
      <input
        ref={inputRef}
        id="checkout-emailCode"
        name="emailCode"
        value={code}
        onChange={(event) => onCodeChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? "checkout-emailCode-error" : undefined}
        disabled={busy}
      />
      {error && (
        <p className="checkout-error" id="checkout-emailCode-error">
          {error}
        </p>
      )}
    </div>
    {notice && (
      <p className="checkout-hint" role="status">
        {notice}
      </p>
    )}
    <div className="checkout-email-code-actions">
      <button type="button" className="checkout-link-button" onClick={onResend} disabled={busy}>
        Send a new code
      </button>
      <button type="button" className="checkout-link-button" onClick={onCancel} disabled={busy}>
        Change my details
      </button>
    </div>
  </fieldset>
);

export default EmailCodeStep;
