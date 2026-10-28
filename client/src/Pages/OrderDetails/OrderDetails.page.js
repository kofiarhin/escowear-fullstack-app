import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import OrderItems from "../../components/OrderItems/OrderItems.component";
import PaymentPanel from "../../components/PaymentPanel/PaymentPanel.component";
import { apiRequest, authHeader } from "../../utils/api";
import { orderAccessHeader } from "../../utils/orderAccess";
import "../OrderConfirmation/orderConfirmation.styles.css";
import "./orderDetails.styles.css";

const formatDate = (value) => (value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "");

const safeLink = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
};

// Customer order view. Requires the owner's login or a scoped access token
// from checkout / tracking; otherwise points the visitor to /track-order.
const OrderDetails = () => {
  const { id } = useParams();
  const { user } = useSelector((state) => state.userReducer);
  const [order, setOrder] = useState(null);
  const [state, setState] = useState("loading");
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let active = true;
    // Prefer the scoped token so a stale login token cannot block access.
    const access = orderAccessHeader(id);
    const headers = Object.keys(access).length ? access : authHeader(user);
    if (!Object.keys(headers).length) {
      setState("unavailable");
      return undefined;
    }
    // Keep the current view while refreshing after a payment upload.
    setState((current) => (current === "ready" ? current : "loading"));
    apiRequest(`/api/orders/${encodeURIComponent(id)}`, { headers })
      .then(({ ok, data }) => {
        if (!active) return;
        if (ok && data?.id) {
          setOrder(data);
          setState("ready");
        } else setState("unavailable");
      })
      .catch(() => active && setState("error"));
    return () => {
      active = false;
    };
  }, [id, user, reloadCount]);

  if (state === "loading") {
    return (
      <main className="order-confirmation container" aria-busy="true">
        <p role="status">Loading your order…</p>
      </main>
    );
  }

  if (state !== "ready") {
    return (
      <main className="order-confirmation container">
        <h1 className="title">View your order</h1>
        <p className="order-confirmation-lead">
          {state === "error"
            ? "We couldn't load this order right now. Please try again shortly."
            : "To protect your privacy, please confirm your email to view this order."}
        </p>
        <Link className="order-details-button" to="/track-order">
          Track an order
        </Link>
      </main>
    );
  }

  const trackingUrl = order.fulfilment?.trackingUrl ? safeLink(order.fulfilment.trackingUrl) : null;
  return (
    <main className="order-confirmation container">
      <p className="order-confirmation-eyebrow">Order #{order.orderNumber || order.id}</p>
      <h1 className="title">{order.statusLabel}</h1>
      {order.legacy && <p className="order-confirmation-lead">This order was placed before online checkout; contact us for details.</p>}

      <PaymentPanel order={order} user={user} onChanged={() => setReloadCount((count) => count + 1)} />

      <section className="order-details-shipping" aria-labelledby="order-shipping">
        <h2 id="order-shipping">Delivery</h2>
        {order.fulfilment?.carrier || order.fulfilment?.trackingNumber ? (
          <dl>
            {order.fulfilment.carrier && (
              <>
                <dt>Carrier</dt>
                <dd>{order.fulfilment.carrier}</dd>
              </>
            )}
            {order.fulfilment.trackingNumber && (
              <>
                <dt>Tracking number</dt>
                <dd>{order.fulfilment.trackingNumber}</dd>
              </>
            )}
            {order.fulfilment.dispatchedAt && (
              <>
                <dt>Dispatched</dt>
                <dd>{formatDate(order.fulfilment.dispatchedAt)}</dd>
              </>
            )}
            {order.fulfilment.deliveredAt && (
              <>
                <dt>Delivered</dt>
                <dd>{formatDate(order.fulfilment.deliveredAt)}</dd>
              </>
            )}
          </dl>
        ) : (
          <p>No shipping details yet. We'll email you when your order is dispatched.</p>
        )}
        {!order.fulfilment?.deliveredAt && !["cancelled", "refunded", "refund_pending"].includes(order.status) && (
          <p>
            {order.fulfilment?.estimatedDeliveryAt
              ? `Estimated delivery: ${new Date(order.fulfilment.estimatedDeliveryAt).toLocaleDateString("en-GB", { dateStyle: "medium" })}`
              : "Estimated delivery will be confirmed once your shoes are bought and shipped."}
          </p>
        )}
        {trackingUrl && (
          <a className="order-details-button" href={trackingUrl} target="_blank" rel="noopener noreferrer">
            Track with carrier
          </a>
        )}
        {order.shippingAddress && (
          <p className="order-confirmation-note">
            Delivering to {order.shippingAddress.recipient}, {order.shippingAddress.city}, {order.shippingAddress.region}.
          </p>
        )}
      </section>

      {order.history?.length > 0 && (
        <section aria-labelledby="order-history">
          <h2 id="order-history" className="order-details-heading">
            Progress
          </h2>
          <ol className="order-details-history">
            {order.history.map((entry, index) => (
              <li key={`${entry.status || entry.type}:${index}`}>
                <strong>{entry.label}</strong>
                {entry.message && <p className="order-details-update">{entry.message}</p>}
                <span>{formatDate(entry.at)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <h2 className="order-details-heading">Items</h2>
      <OrderItems order={order} />
      <p className="order-confirmation-note">Questions? Reply to any of our order emails.</p>
    </main>
  );
};

export default OrderDetails;
