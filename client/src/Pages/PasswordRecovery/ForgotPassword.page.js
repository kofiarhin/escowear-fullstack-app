import { useState } from "react";
import { Link } from "react-router-dom";
import "./passwordRecovery.styles.css";

const GENERIC_MESSAGE = "Check your email for password reset instructions. If an account matches that address, we will send a link shortly.";

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!email.trim()) {
      setError("Enter your email address to continue.");
      return;
    }
    setError("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/users/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "We could not process that request. Please try again.");
      setStatus(GENERIC_MESSAGE);
    } catch (requestError) {
      setError(requestError.message || "We could not process that request. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="recovery-page">
      <section className="recovery-panel" aria-labelledby="forgot-password-title">
        <p className="recovery-kicker">Account recovery</p>
        <h1 id="forgot-password-title">Find your way back.</h1>
        <p className="recovery-intro">Enter the email address on your account. We’ll send a single-use link if it matches an EscoWear account.</p>
        <form className="recovery-form" onSubmit={handleSubmit} noValidate>
          <div className="recovery-field">
            <label htmlFor="recovery-email">Email</label>
            <input id="recovery-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
          </div>
          {error && <p className="recovery-error" role="alert">{error}</p>}
          {status && <p className="recovery-success" role="status">{status}</p>}
          <button type="submit" disabled={isSubmitting}>{isSubmitting ? "Sending link…" : "Send reset link"}</button>
        </form>
        <p className="recovery-footer">Remembered it? <Link to="/login">Back to sign in</Link></p>
      </section>
    </main>
  );
};

export default ForgotPassword;
