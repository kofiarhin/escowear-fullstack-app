import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import "./passwordRecovery.styles.css";

const ResetPassword = () => {
  const location = useLocation();
  const navigate = useNavigate();
  // Copy once into component memory, then replace the browser history entry so
  // the credential cannot be leaked by copying the URL or later navigation.
  const [token, setToken] = useState(() => new URLSearchParams(location.search).get("token") || "");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(location.search).has("token")) navigate(location.pathname, { replace: true });
  }, [location.pathname, location.search, navigate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (password.length < 10 || password.length > 128) {
      setError("Password must be between 10 and 128 characters.");
      return;
    }
    if (password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    setError("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/users/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "This password reset link is invalid or has expired.");
      setStatus(data.message);
      setPassword("");
      setConfirmation("");
      setToken("");
    } catch (requestError) {
      setError(requestError.message || "This password reset link is invalid or has expired.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!token && !status) {
    return (
      <main className="recovery-page"><section className="recovery-panel"><p className="recovery-kicker">Account recovery</p><h1>Link unavailable.</h1><p className="recovery-error" role="alert">This password reset link is invalid or incomplete.</p><p className="recovery-footer"><Link to="/forgot-password">Request a new link</Link></p></section></main>
    );
  }

  return (
    <main className="recovery-page">
      <section className="recovery-panel" aria-labelledby="reset-password-title">
        <p className="recovery-kicker">Account recovery</p>
        <h1 id="reset-password-title">Set a new password.</h1>
        <p className="recovery-intro">Choose a password with 10 to 128 characters. This link can only be used once.</p>
        {status ? <p className="recovery-success" role="status">{status}</p> : <form className="recovery-form" onSubmit={handleSubmit} noValidate>
          <div className="recovery-field"><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength="10" maxLength="128" /></div>
          <div className="recovery-field"><label htmlFor="confirm-new-password">Confirm new password</label><input id="confirm-new-password" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength="10" maxLength="128" /></div>
          {error && <p className="recovery-error" role="alert">{error}</p>}
          <button type="submit" disabled={isSubmitting}>{isSubmitting ? "Resetting password…" : "Reset password"}</button>
        </form>}
        <p className="recovery-footer"><Link to="/login">Back to sign in</Link></p>
      </section>
    </main>
  );
};

export default ResetPassword;
