import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import { AdminGate } from "../AdminOrders/AdminOrders.page";
import { apiRequest, authHeader } from "../../utils/api";
import { formatGBP, formatGHS } from "../../utils/money";
import { FULFILMENT_STEPS, formatDateTime, humanize, isAdmin, localDateTimeToIso, toMinorUnits } from "../../utils/admin";
import "./admin.styles.css";

const money = (name, label, required = true) => ({ name, label, type: "money", required });

// Form definitions for each admin action. `build` turns form values into the
// API body; anything returning an error string blocks submission.
const ACTIONS = {
  "payment-instructions": {
    title: "Send GHS quote and payment instructions",
    help: "Enter the final amounts you have agreed after checking availability. The email uses the payment channel configured on the server.",
    submit: "Send payment instructions",
    fields: [
      money("subtotal", "Items (GHS)"),
      money("fees", "Fees (GHS)"),
      money("shipping", "Shipping (GHS)"),
      money("duties", "Duties (GHS)"),
      { name: "expiresAt", label: "Quote valid until", type: "datetime-local", required: true },
      { name: "rateSnapshot", label: "Rate / calculation note (internal, optional)", type: "text" },
      { name: "message", label: "Message to customer (optional)", type: "textarea" },
    ],
    build: (v) => ({
      quote: {
        subtotalMinor: toMinorUnits(v.subtotal),
        feesMinor: toMinorUnits(v.fees),
        shippingMinor: toMinorUnits(v.shipping),
        dutiesMinor: toMinorUnits(v.duties),
        expiresAt: localDateTimeToIso(v.expiresAt),
        rateSnapshot: v.rateSnapshot || undefined,
      },
      message: v.message || undefined,
    }),
  },
  "awaiting-customer": {
    title: "Waiting for the customer",
    submit: "Mark as waiting for customer",
    fields: [{ name: "note", label: "What are you waiting for? (internal)", type: "textarea", required: true }],
    build: (v) => ({ note: v.note }),
  },
  "payment-review": {
    title: "Payment proof received by email",
    help: "Use this when the customer has emailed a screenshot. This does not verify payment.",
    submit: "Mark proof under review",
    fields: [{ name: "note", label: "Note (internal, optional)", type: "textarea" }],
    build: (v) => ({ note: v.note || undefined }),
  },
  "verify-payment": {
    title: "Verify bank receipt",
    help: "Only confirm after you have checked the receiving account yourself. A screenshot is never enough.",
    submit: "Confirm payment verified",
    fields: [
      money("amount", "Amount received (GHS)"),
      { name: "bankReference", label: "Bank transaction reference", type: "text", required: true },
      { name: "receivedAt", label: "Funds received at", type: "datetime-local", required: true },
      {
        name: "bankReceiptConfirmed",
        label: "I have personally confirmed these funds arrived in the receiving account.",
        type: "checkbox",
        required: true,
      },
    ],
    build: (v) => ({
      amountReceivedGHSMinor: toMinorUnits(v.amount),
      bankReference: v.bankReference,
      receivedAt: localDateTimeToIso(v.receivedAt),
      bankReceiptConfirmed: v.bankReceiptConfirmed === true,
    }),
  },
  "payment-issue": {
    title: "Record a payment issue",
    submit: "Send payment issue email",
    fields: [
      { name: "customerMessage", label: "Message to customer", type: "textarea", required: true },
      { name: "note", label: "Note (internal, optional)", type: "textarea" },
    ],
    build: (v) => ({ customerMessage: v.customerMessage, note: v.note || undefined }),
  },
  fulfilment: {
    title: "Update fulfilment",
    submit: "Save fulfilment step",
    fields: [
      { name: "toStatus", label: "Next step", type: "select", required: true },
      { name: "supplierReference", label: "Retailer order reference (processing)", type: "text", when: (v) => v.toStatus === "processing" },
      { name: "carrier", label: "Carrier", type: "text", when: (v) => v.toStatus === "dispatched" },
      { name: "trackingNumber", label: "Tracking number", type: "text", when: (v) => v.toStatus === "dispatched" },
      { name: "trackingUrl", label: "Tracking link", type: "url", when: (v) => v.toStatus === "dispatched" },
      { name: "note", label: "Note (internal; required if sourcing failed)", type: "textarea" },
      { name: "customerMessage", label: "Extra message to customer (optional)", type: "textarea" },
    ],
    build: (v) => ({
      toStatus: v.toStatus,
      supplierReference: v.supplierReference || undefined,
      carrier: v.carrier || undefined,
      trackingNumber: v.trackingNumber || undefined,
      trackingUrl: v.trackingUrl || undefined,
      note: v.note || undefined,
      customerMessage: v.customerMessage || undefined,
    }),
  },
  cancel: {
    title: "Cancel order",
    submit: "Cancel order",
    fields: [
      { name: "reason", label: "Reason (internal)", type: "textarea", required: true },
      { name: "customerMessage", label: "Message to customer (optional)", type: "textarea" },
    ],
    build: (v) => ({ reason: v.reason, customerMessage: v.customerMessage || undefined }),
  },
  refund: {
    title: "Record refund sent",
    submit: "Record refund",
    fields: [
      money("amount", "Amount refunded (GHS)"),
      { name: "refundReference", label: "Refund transaction reference", type: "text", required: true },
      { name: "refundSentConfirmed", label: "I have confirmed the refund has been sent.", type: "checkbox", required: true },
      { name: "note", label: "Note (internal, optional)", type: "textarea" },
    ],
    build: (v) => ({
      amountRefundedGHSMinor: toMinorUnits(v.amount),
      refundReference: v.refundReference,
      refundSentConfirmed: v.refundSentConfirmed === true,
      note: v.note || undefined,
    }),
  },
};

const ActionForm = ({ action, order, user, onDone }) => {
  const definition = ACTIONS[action];
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState({ state: "idle", message: "" });
  const prefix = `action-${action}`;
  const paid = order.payment?.status === "verified";
  const blocked = action === "payment-instructions" && !order.paymentChannelConfigured;

  const set = (name) => (event) => setValues((current) => ({ ...current, [name]: event.target.type === "checkbox" ? event.target.checked : event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    const fieldErrors = {};
    definition.fields.forEach((field) => {
      if (field.when && !field.when(values)) return;
      const value = values[field.name];
      if (field.type === "money" && (value || field.required) && toMinorUnits(value) === null) fieldErrors[field.name] = "Enter an amount like 1250.00";
      else if (field.required && (value === undefined || value === "" || value === false)) fieldErrors[field.name] = "Required";
    });
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) return;

    setStatus({ state: "submitting", message: "Saving…" });
    try {
      const response = await apiRequest(`/api/admin/orders/${order.id}/${action}`, {
        method: "POST",
        headers: authHeader(user),
        body: { expectedStatus: order.status, ...definition.build(values) },
      });
      if (response.ok) {
        const emailNote = response.data?.email
          ? response.data.email.queued
            ? " Email queued."
            : " Email could NOT be queued — use “Requeue email” in the history."
          : "";
        onDone(`${definition.submit}: saved.${emailNote}`);
      } else {
        const details = Object.values(response.data?.fields || {}).filter((value) => typeof value === "string");
        const message = [response.data?.error || "The action failed.", ...details].join(" — ");
        if (response.status === 409) onDone(message);
        else setStatus({ state: "error", message });
      }
    } catch {
      setStatus({ state: "error", message: "Network error — check the order state before trying again." });
    }
  };

  const title = action === "cancel" && paid ? "Cancel order and start refund" : definition.title;
  return (
    <form className="admin-action" onSubmit={submit} aria-labelledby={`${prefix}-title`} noValidate>
      <h3 id={`${prefix}-title`}>{title}</h3>
      {definition.help && <p className="admin-muted">{definition.help}</p>}
      {blocked && (
        <p role="alert" className="admin-warning">
          Payment instructions are not configured on the server (ESCOWEAR_PAYMENT_INSTRUCTIONS). Quotes cannot be sent until the owner configures the
          receiving channel.
        </p>
      )}
      {definition.fields
        .filter((field) => !field.when || field.when(values))
        .map((field) => {
          const id = `${prefix}-${field.name}`;
          const error = errors[field.name];
          const common = {
            id,
            name: field.name,
            "aria-invalid": error ? "true" : undefined,
            "aria-describedby": error ? `${id}-error` : undefined,
            disabled: status.state === "submitting" || blocked,
          };
          let control;
          if (field.type === "textarea") control = <textarea {...common} rows={3} value={values[field.name] || ""} onChange={set(field.name)} />;
          else if (field.type === "checkbox") control = <input {...common} type="checkbox" checked={values[field.name] === true} onChange={set(field.name)} />;
          else if (field.type === "select")
            control = (
              <select {...common} value={values[field.name] || ""} onChange={set(field.name)}>
                <option value="">Choose…</option>
                {(FULFILMENT_STEPS[order.status] || []).map((step) => (
                  <option key={step} value={step}>
                    {humanize(step)}
                  </option>
                ))}
              </select>
            );
          else
            control = (
              <input
                {...common}
                type={field.type === "money" ? "text" : field.type}
                inputMode={field.type === "money" ? "decimal" : undefined}
                value={values[field.name] || ""}
                onChange={set(field.name)}
              />
            );
          return (
            <div key={field.name} className={`admin-field ${field.type === "checkbox" ? "is-checkbox" : ""}`}>
              {field.type === "checkbox" ? (
                <>
                  {control}
                  <label htmlFor={id}>{field.label}</label>
                </>
              ) : (
                <>
                  <label htmlFor={id}>{field.label}</label>
                  {control}
                </>
              )}
              {error && (
                <p className="admin-error" id={`${id}-error`}>
                  {error}
                </p>
              )}
            </div>
          );
        })}
      <div role={status.state === "error" ? "alert" : "status"} className={`admin-status is-${status.state}`}>
        {status.message}
      </div>
      <button type="submit" className="admin-button admin-button-dark" disabled={status.state === "submitting" || blocked}>
        {definition.submit}
      </button>
    </form>
  );
};

const NoteForm = ({ order, user, onDone }) => {
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    if (!body.trim()) return;
    const response = await apiRequest(`/api/admin/orders/${order.id}/notes`, { method: "POST", headers: authHeader(user), body: { body } }).catch(() => null);
    if (response?.ok) {
      setBody("");
      onDone("Note added.");
    } else setMessage("Note could not be saved.");
  };
  return (
    <form className="admin-action" onSubmit={submit}>
      <h3>Internal note</h3>
      <div className="admin-field">
        <label htmlFor="admin-note">Note (never shown to the customer)</label>
        <textarea id="admin-note" rows={3} value={body} onChange={(event) => setBody(event.target.value)} />
      </div>
      <div role="status" className="admin-status">
        {message}
      </div>
      <button type="submit" className="admin-button">
        Add note
      </button>
    </form>
  );
};

const AdminOrderDetail = () => {
  const { id } = useParams();
  const { user } = useSelector((state) => state.userReducer);
  const [order, setOrder] = useState(null);
  const [state, setState] = useState("loading");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!isAdmin(user)) return;
    try {
      const response = await apiRequest(`/api/admin/orders/${encodeURIComponent(id)}`, { headers: authHeader(user) });
      if (response.ok) {
        setOrder(response.data);
        setState("ready");
      } else setState(response.status === 404 ? "missing" : response.status === 403 ? "forbidden" : "error");
    } catch {
      setState("error");
    }
  }, [id, user]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = (message) => {
    if (message) setNotice(message);
    load();
  };

  const post = async (path, label) => {
    const response = await apiRequest(path, { method: "POST", headers: authHeader(user) }).catch(() => null);
    setNotice(response?.ok ? `${label}: done.` : `${label}: ${response?.data?.error || "failed"}.`);
    load();
  };

  const content = () => {
    if (state === "loading") return <p role="status">Loading order…</p>;
    if (state === "missing") return <p role="alert">Order not found.</p>;
    if (state === "forbidden") return <p role="alert">Your account is not allowed to view orders.</p>;
    if (state === "error" || !order)
      return (
        <p role="alert">
          The order could not be loaded.{" "}
          <button type="button" className="admin-link-button" onClick={load}>
            Try again
          </button>
        </p>
      );
    const quote = order.pricing?.finalGHS;
    const queuedKeys = new Set(order.emails.map((message) => message.dedupeKey));
    return (
      <>
        <header className="admin-header">
          <p className="admin-eyebrow">
            <Link to="/admin/orders">← All orders</Link>
          </p>
          <h1 className="title">{order.orderNumber}</h1>
          <p>
            <span className={`admin-badge is-${order.status}`}>{humanize(order.status)}</span> · Payment {humanize(order.payment?.status)} · Placed{" "}
            {formatDateTime(order.createdAt)}
          </p>
        </header>
        {notice && (
          <p role="status" className="admin-status is-done">
            {notice}
          </p>
        )}

        <div className="admin-detail-grid">
          <section className="admin-panel" aria-labelledby="admin-customer">
            <h2 id="admin-customer">Customer & delivery</h2>
            <dl className="admin-dl">
              <dt>Name</dt>
              <dd>{order.customer?.name}</dd>
              <dt>Email</dt>
              <dd>{order.customer?.email}</dd>
              <dt>Phone</dt>
              <dd>{order.customer?.phone}</dd>
              <dt>Recipient</dt>
              <dd>
                {order.shippingAddress?.recipient} ({order.shippingAddress?.phone})
              </dd>
              <dt>Address</dt>
              <dd>
                {[order.shippingAddress?.line1, order.shippingAddress?.line2, order.shippingAddress?.landmark && `Landmark: ${order.shippingAddress.landmark}`, order.shippingAddress?.city, order.shippingAddress?.region]
                  .filter(Boolean)
                  .join(", ")}
              </dd>
              <dt>Account</dt>
              <dd>{order.user ? "Linked to a registered customer" : "Guest"}</dd>
            </dl>
          </section>

          <section className="admin-panel" aria-labelledby="admin-items">
            <h2 id="admin-items">Items</h2>
            <ul className="admin-items">
              {order.items.map((item) => (
                <li key={`${item.productId}:${item.size}`}>
                  <strong>{item.name}</strong> — {item.size} × {item.quantity} @ {formatGBP(item.unitPriceGBPMinor)} = {formatGBP(item.lineTotalGBPMinor)}
                  {item.retailerSnapshot?.productUrl && (
                    <>
                      {" "}
                      ·{" "}
                      <a href={item.retailerSnapshot.productUrl} target="_blank" rel="noreferrer noopener">
                        retailer page
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <p>
              Indicative subtotal: <strong>{formatGBP(order.pricing?.subtotalGBPMinor)}</strong> (GBP estimate)
            </p>
          </section>

          <section className="admin-panel" aria-labelledby="admin-payment">
            <h2 id="admin-payment">Quote & payment</h2>
            {quote ? (
              <dl className="admin-dl">
                <dt>Quote v{quote.quoteVersion}</dt>
                <dd>
                  <strong>{formatGHS(quote.totalMinor)}</strong> (items {formatGHS(quote.subtotalMinor)}, fees {formatGHS(quote.feesMinor)}, shipping{" "}
                  {formatGHS(quote.shippingMinor)}, duties {formatGHS(quote.dutiesMinor)})
                </dd>
                <dt>Valid until</dt>
                <dd>
                  {formatDateTime(quote.expiresAt)}
                  {new Date(quote.expiresAt) < new Date() && <strong> — expired</strong>}
                </dd>
                {quote.rateSnapshot && (
                  <>
                    <dt>Rate note</dt>
                    <dd>{quote.rateSnapshot}</dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="admin-muted">No GHS quote yet.</p>
            )}
            {order.payment?.status === "verified" && (
              <dl className="admin-dl">
                <dt>Received</dt>
                <dd>
                  {formatGHS(order.payment.amountReceivedGHSMinor)} · ref {order.payment.bankReference} · {formatDateTime(order.payment.receivedAt)}
                </dd>
                <dt>Verified</dt>
                <dd>{formatDateTime(order.payment.verifiedAt)}</dd>
              </dl>
            )}
            {order.fulfilment?.carrier && (
              <p>
                Shipped with {order.fulfilment.carrier} {order.fulfilment.trackingNumber && `(${order.fulfilment.trackingNumber})`}
              </p>
            )}
          </section>
        </div>

        <section className="admin-actions" aria-labelledby="admin-actions-title">
          <h2 id="admin-actions-title">Actions</h2>
          {order.allowedActions.length === 0 && <p className="admin-muted">No further status changes are possible for this order.</p>}
          <div className="admin-actions-grid">
            {order.allowedActions.map((action) => (
              <ActionForm key={`${action}:${order.status}:${order.updatedAt}`} action={action} order={order} user={user} onDone={refresh} />
            ))}
            <NoteForm order={order} user={user} onDone={refresh} />
          </div>
        </section>

        <div className="admin-detail-grid">
          <section className="admin-panel" aria-labelledby="admin-emails">
            <h2 id="admin-emails">Emails</h2>
            <ul className="admin-timeline">
              {order.emails.map((message) => (
                <li key={message.id}>
                  <strong>{humanize(message.kind)}</strong> — {message.state} ({message.attempts} attempts)
                  <br />
                  <span className="admin-muted">{message.subject}</span>
                  {message.lastError && <p className="admin-error">Last error: {message.lastError}</p>}
                  {message.state === "failed" && (
                    <button type="button" className="admin-link-button" onClick={() => post(`/api/admin/emails/${message.id}/retry`, "Retry email")}>
                      Retry
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <p className="admin-muted">"queued" means not sent yet. If no mail transport is configured, emails stay queued.</p>
          </section>

          <section className="admin-panel" aria-labelledby="admin-history">
            <h2 id="admin-history">History</h2>
            <ol className="admin-timeline">
              {order.events.map((event) => (
                <li key={event.id}>
                  <strong>{humanize(event.type)}</strong>
                  {event.toStatus && ` → ${humanize(event.toStatus)}`} · {event.actorType} · {formatDateTime(event.createdAt)}
                  {event.details?.note && <p>{event.details.note}</p>}
                  {event.details?.reason && <p>Reason: {event.details.reason}</p>}
                  {event.details?.email && !queuedKeys.has(event.details.email.dedupeKey) && (
                    <button
                      type="button"
                      className="admin-link-button"
                      onClick={() => post(`/api/admin/orders/${order.id}/events/${event.id}/requeue-email`, "Requeue email")}
                    >
                      Requeue email
                    </button>
                  )}
                </li>
              ))}
            </ol>
            {order.internalNotes?.length > 0 && (
              <>
                <h3>Internal notes</h3>
                <ul className="admin-timeline">
                  {order.internalNotes.map((note) => (
                    <li key={note._id || note.createdAt}>
                      {note.body} <span className="admin-muted">· {formatDateTime(note.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      </>
    );
  };

  return (
    <AdminGate user={user}>
      <main className="admin container">{content()}</main>
    </AdminGate>
  );
};

export default AdminOrderDetail;
