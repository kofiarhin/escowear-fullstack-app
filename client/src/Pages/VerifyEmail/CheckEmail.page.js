import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { NetworkError } from "../../utils/api";
import {
  changeVerificationEmail,
  clearPendingVerification,
  fetchVerificationStatus,
  formatDeadline,
  readPendingVerification,
  resendVerification,
  savePendingVerification,
} from "../../utils/verification";
import "../PasswordRecovery/passwordRecovery.styles.css";
import "./verifyEmail.styles.css";

// Shown after registration and after an unverified sign-in attempt (IDE-152).
// Offers resend (with cooldown and daily limit) and correction of a mistyped
// email. Neither extends the account's verification deadline.

const secondsUntil = (value, now) => (value ? Math.max(0, Math.ceil((new Date(value).getTime() - now) / 1000)) : 0);

// Responses that mean this page can no longer act for the customer.
const ENDED = {
  VERIFICATION_SESSION_EXPIRED: "session",
  ALREADY_VERIFIED: "verified",
  ACCOUNT_EXPIRED: "expired",
  ACCOUNT_BLOCKED: "blocked",
};

const Ended = ({ reason }) => {
  const content = {
    session: { title: "Sign in to continue.", text: "For your security, this page has timed out. Sign in with your email and password to resend your link or change your email.", link: ["/login", "Sign in"] },
    verified: { title: "Email verified.", text: "Your email is already verified. You can sign in now.", link: ["/login", "Sign in"] },
    expired: { title: "Account expired.", text: "This account was not verified within 7 days. Please register again.", link: ["/register", "Register again"] },
    blocked: { title: "Account unavailable.", text: "This account has been blocked. Reply to any EscoWear email if you think this is a mistake.", link: ["/", "Back to the shop"] },
  }[reason];
  return (
    <main className="recovery-page">
      <section className="recovery-panel" aria-labelledby="check-email-title">
        <p className="recovery-kicker">Verify your email</p>
        <h1 id="check-email-title">{content.title}</h1>
        <p className="recovery-intro">{content.text}</p>
        <p className="recovery-footer">
          <Link to={content.link[0]}>{content.link[1]}</Link>
        </p>
      </section>
    </main>
  );
};

const CheckEmail = () => {
  const [pending, setPending] = useState(readPendingVerification);
  const [status, setStatus] = useState(null);
  const [ended, setEnded] = useState(pending ? "" : "session");
  const [message, setMessage] = useState({ tone: "", text: "" });
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const handleFailure = useCallback((response, fallback) => {
    const reason = ENDED[response?.data?.code];
    if (reason) {
      if (reason !== "session") clearPendingVerification();
      setEnded(reason);
      return;
    }
    setMessage({ tone: "error", text: response?.data?.error || fallback });
  }, []);

  // Loaded once per credential; a correction updates the status from its own response.
  const pendingToken = pending?.pendingToken;
  useEffect(() => {
    if (!pendingToken) return undefined;
    let active = true;
    fetchVerificationStatus(pendingToken)
      .then((response) => {
        if (!active) return;
        if (response.ok) setStatus(response.data);
        else handleFailure(response, "We could not load your verification status.");
      })
      .catch(() => active && setMessage({ tone: "error", text: "We couldn't reach EscoWear. Check your connection and refresh the page." }));
    return () => {
      active = false;
    };
  }, [pendingToken, handleFailure]);

  // Ticks only while a cooldown is running, to update the countdown.
  const wait = secondsUntil(status?.nextResendAt, now);
  useEffect(() => {
    if (!wait) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [wait]);

  const run = async (kind, request, fallback) => {
    if (busy) return;
    setBusy(kind);
    setMessage({ tone: "", text: "" });
    try {
      const response = await request();
      if (response.ok) {
        setStatus(response.data);
        setNow(Date.now());
        setMessage({ tone: "done", text: response.data.message });
        return response;
      }
      if (response.status === 429 && response.data?.retryAfterSeconds) {
        setStatus((current) => current && { ...current, nextResendAt: new Date(Date.now() + response.data.retryAfterSeconds * 1000).toISOString() });
        setNow(Date.now());
      }
      handleFailure(response, fallback);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof NetworkError ? "We couldn't reach EscoWear. Please try again." : fallback });
    } finally {
      setBusy("");
    }
    return null;
  };

  const resend = () => run("resend", () => resendVerification(pending.pendingToken), "We could not send a new link. Please try again.");

  const submitEmail = async (event) => {
    event.preventDefault();
    const email = newEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      setMessage({ tone: "error", text: "Enter a valid email address." });
      return;
    }
    const response = await run("email", () => changeVerificationEmail(pending.pendingToken, email), "We could not update your email. Please try again.");
    if (response) {
      const next = { ...pending, email: response.data.email };
      savePendingVerification(next);
      setPending(next);
      setEditing(false);
      setNewEmail("");
    }
  };

  if (ended) return <Ended reason={ended} />;

  const email = status?.email || pending.email;
  const deadline = status?.deadline || pending.deadline;
  const remaining = status ? status.resendsRemaining : null;
  // Resend and correction share the same cooldown and daily limit.
  const sendBlocked = Boolean(busy) || !status || wait > 0 || remaining === 0;

  return (
    <main className="recovery-page">
      <section className="recovery-panel" aria-labelledby="check-email-title">
        <p className="recovery-kicker">Verify your email</p>
        <h1 id="check-email-title">Check your email.</h1>
        <p className="recovery-intro">
          We sent a verification link to <strong className="verify-email-address">{email}</strong>. Open it to finish creating your account, then sign in.
        </p>
        <dl className="verify-facts">
          <div>
            <dt>Link valid for</dt>
            <dd>24 hours, one use</dd>
          </div>
          {deadline && (
            <div>
              <dt>Verify before</dt>
              <dd>{formatDeadline(deadline)}</dd>
            </div>
          )}
        </dl>
        <p className="verify-help">Can't find it? Check your spam or junk folder. Unverified accounts are removed after 7 days.</p>

        <div className="verify-actions">
          <button type="button" className="verify-primary" onClick={resend} disabled={sendBlocked} aria-busy={busy === "resend"}>
            {busy === "resend" ? "Sending…" : wait > 0 ? `Resend link in ${wait}s` : "Resend link"}
          </button>
          <button type="button" className="verify-secondary" onClick={() => setEditing((value) => !value)} aria-expanded={editing} aria-controls="verify-change-email">
            Wrong email?
          </button>
        </div>
        {remaining !== null && (
          <p className="verify-help" aria-live="polite">
            {remaining === 0 ? "You have used all 3 resends for the next 24 hours." : `${remaining} of 3 resends left in the next 24 hours.`}
          </p>
        )}

        {editing && (
          <form id="verify-change-email" className="recovery-form verify-change" onSubmit={submitEmail} noValidate>
            <div className="recovery-field">
              <label htmlFor="verify-new-email">Correct email address</label>
              <input id="verify-new-email" type="email" autoComplete="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} />
            </div>
            <p className="verify-help">We'll send a new link to this address. Links sent to {email} will stop working. Your deadline stays the same.</p>
            <button type="submit" disabled={sendBlocked} aria-busy={busy === "email"}>
              {busy === "email" ? "Updating…" : "Send link to this email"}
            </button>
          </form>
        )}

        <div className="verify-status" role={message.tone === "error" ? "alert" : "status"} aria-live="polite">
          {message.text && <p className={message.tone === "error" ? "recovery-error" : "recovery-success"}>{message.text}</p>}
        </div>
        <p className="recovery-footer">
          Already verified? <Link to="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
};

export default CheckEmail;
