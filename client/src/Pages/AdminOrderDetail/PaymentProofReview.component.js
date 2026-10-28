import { useEffect, useState } from "react";
import { authHeader } from "../../utils/api";
import { formatGHS } from "../../utils/money";
import { formatDateTime, humanize } from "../../utils/admin";

// Loads a stored screenshot with the admin's token and shows it from a blob
// URL (revoked on unmount). The image is never given a public URL.
const ProofImage = ({ order, proof, user }) => {
  const [state, setState] = useState({ status: "idle", url: null, message: "" });

  useEffect(() => () => state.url && URL.revokeObjectURL(state.url), [state.url]);

  const load = async () => {
    setState({ status: "loading", url: null, message: "" });
    try {
      const response = await fetch(`/api/admin/orders/${order.id}/payment-proof/${proof.id}`, { headers: authHeader(user), cache: "no-store" });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setState({ status: "error", url: null, message: data?.error || `Could not load the screenshot (${response.status})` });
        return;
      }
      const blob = await response.blob();
      setState({ status: "ready", url: URL.createObjectURL(blob), message: "" });
    } catch {
      setState({ status: "error", url: null, message: "Network error loading the screenshot" });
    }
  };

  if (state.status === "ready") {
    return (
      <figure className="admin-proof-figure">
        <img src={state.url} alt={`Payment screenshot uploaded for ${order.orderNumber}`} />
        <figcaption>
          <button
            type="button"
            className="admin-link-button"
            onClick={() => {
              URL.revokeObjectURL(state.url);
              setState({ status: "idle", url: null, message: "" });
            }}
          >
            Hide screenshot
          </button>
        </figcaption>
      </figure>
    );
  }
  return (
    <>
      <button type="button" className="admin-button" onClick={load} disabled={state.status === "loading"}>
        {state.status === "loading" ? "Loading…" : "View screenshot"}
      </button>
      {state.status === "error" && (
        <p role="alert" className="admin-error">
          {state.message}
        </p>
      )}
    </>
  );
};

const PaymentProofReview = ({ order, user }) => {
  const proofs = order.paymentProofs || [];
  const quote = order.pricing?.finalGHS;
  if (!proofs.length) return null;
  return (
    <section className="admin-panel admin-proofs" aria-labelledby="admin-proofs-title">
      <h2 id="admin-proofs-title">Payment proof uploads</h2>
      {order.status === "payment_review" && (
        <p className="admin-warning">
          New proof to review. Check the receiving Mobile Money account for <strong>{quote ? formatGHS(quote.totalMinor) : "the quoted amount"}</strong>{" "}
          with the transaction ID below before verifying. The screenshot alone is not proof of payment.
        </p>
      )}
      <ul className="admin-proof-list">
        {proofs.map((proof) => (
          <li key={proof.id} className={proof.active ? "is-active" : undefined}>
            <dl className="admin-dl">
              <dt>Transaction ID</dt>
              <dd>
                <strong>{proof.transactionReference}</strong>
              </dd>
              <dt>Status</dt>
              <dd>
                {humanize(proof.reviewStatus)}
                {proof.active ? " (current)" : ""}
              </dd>
              <dt>Submitted</dt>
              <dd>
                {formatDateTime(proof.submittedAt)} · {proof.submitterType === "customer" ? "signed-in customer" : "guest (email verified)"}
              </dd>
              <dt>For quote</dt>
              <dd>
                v{proof.quoteVersion}
                {quote && proof.quoteVersion === quote.quoteVersion ? ` — expected ${formatGHS(quote.totalMinor)}` : " — not the current quote"}
              </dd>
              <dt>File</dt>
              <dd>
                {proof.contentType} · {Math.round(proof.sizeBytes / 1024)} KB · {proof.width}×{proof.height}
              </dd>
            </dl>
            {proof.duplicateReferenceOrderIds?.length > 0 && (
              <p className="admin-warning" role="note">
                This transaction ID was also submitted on {proof.duplicateReferenceOrderIds.length} other order(s). Check carefully before verifying.
              </p>
            )}
            <ProofImage order={order} proof={proof} user={user} />
          </li>
        ))}
      </ul>
    </section>
  );
};

export default PaymentProofReview;
