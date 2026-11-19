import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { NetworkError } from "../../utils/api";
import { clearPendingVerification, verifyEmailToken } from "../../utils/verification";
import "../PasswordRecovery/passwordRecovery.styles.css";
import "./verifyEmail.styles.css";

// Opened from the emailed link. The customer confirms with a button rather
// than on page load, so mail scanners that open links cannot use up the
// single-use token.
const VerifyEmail = () => {
  const location = useLocation();
  const navigate = useNavigate();
  // Copy once into component memory, then drop it from the address bar and
  // history so the credential cannot leak through copying or navigation.
  const [token, setToken] = useState(() => new URLSearchParams(location.search).get("token") || "");
  const [state, setState] = useState(token ? "ready" : "invalid");
  const [error, setError] = useState("");

  useEffect(() => {
    if (new URLSearchParams(location.search).has("token")) navigate(location.pathname, { replace: true });
  }, [location.pathname, location.search, navigate]);

  const verify = async () => {
    if (state === "verifying") return;
    setState("verifying");
    setError("");
    try {
      const response = await verifyEmailToken(token);
      if (response.ok) {
        clearPendingVerification();
        setToken("");
        setState("verified");
        return;
      }
      setToken("");
      setState("invalid");
    } catch (requestError) {
      // The link may still be valid: let the customer try again.
      setState("ready");
      setError(requestError instanceof NetworkError ? "We couldn't reach EscoWear. Check your connection and try again." : "Something went wrong. Please try again.");
    }
  };

  if (state === "verified") {
    return (
      <main className="recovery-page">
        <section className="recovery-panel" aria-labelledby="verify-email-title">
          <p className="recovery-kicker">Verify your email</p>
          <h1 id="verify-email-title">You're verified.</h1>
          <p className="recovery-success" role="status">
            Your email is verified. You can now sign in.
          </p>
          <p className="recovery-footer">
            <Link to="/login">Sign in</Link>
          </p>
        </section>
      </main>
    );
  }

  if (state === "invalid") {
    return (
      <main className="recovery-page">
        <section className="recovery-panel" aria-labelledby="verify-email-title">
          <p className="recovery-kicker">Verify your email</p>
          <h1 id="verify-email-title">Link unavailable.</h1>
          <p className="recovery-error" role="alert">
            This verification link is invalid, has expired or has already been used.
          </p>
          <p className="recovery-intro">
            If you already verified, just sign in. Otherwise sign in with your email and password to get a new link. Only the newest link works.
          </p>
          <p className="recovery-footer">
            <Link to="/login">Sign in</Link>
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="recovery-page">
      <section className="recovery-panel" aria-labelledby="verify-email-title">
        <p className="recovery-kicker">Verify your email</p>
        <h1 id="verify-email-title">Confirm your email.</h1>
        <p className="recovery-intro">Confirm that this is your email address to finish creating your EscoWear account.</p>
        <div className="recovery-form">
          {error && (
            <p className="recovery-error" role="alert">
              {error}
            </p>
          )}
          <button type="button" onClick={verify} disabled={state === "verifying"} aria-busy={state === "verifying"}>
            {state === "verifying" ? "Verifying…" : "Verify my email"}
          </button>
        </div>
      </section>
    </main>
  );
};

export default VerifyEmail;
