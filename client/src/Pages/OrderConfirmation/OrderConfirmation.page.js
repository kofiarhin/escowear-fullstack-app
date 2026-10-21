import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import OrderItems from "../../components/OrderItems/OrderItems.component";
import { apiRequest, authHeader } from "../../utils/api";
import { orderAccessHeader } from "../../utils/orderAccess";
import "./orderConfirmation.styles.css";

// Shown after checkout. The order is only fetched with this tab's scoped access
// token or the owner's login, so the URL alone never reveals an order.
const OrderConfirmation = () => {
  const { id } = useParams();
  const location = useLocation();
  const { user } = useSelector((state) => state.userReducer);
  const [order, setOrder] = useState(location.state?.order || null);
  const [state, setState] = useState(location.state?.order ? "ready" : "loading");

  useEffect(() => {
    let active = true;
    // Prefer this tab's scoped token: an expired login token would otherwise
    // make the server reject a request the access token alone would allow.
    const access = orderAccessHeader(id);
    const headers = Object.keys(access).length ? access : authHeader(user);
    if (!Object.keys(headers).length) {
      setOrder(null);
      setState("unavailable");
      return undefined;
    }
    apiRequest(`/api/orders/${encodeURIComponent(id)}`, { headers })
      .then(({ ok, data }) => {
        if (!active) return;
        if (ok && data?.id) {
          setOrder(data);
          setState("ready");
        } else {
          setOrder(null);
          setState("unavailable");
        }
      })
      .catch(() => {
        // Keep the summary from checkout if we already have it.
        if (active) setState((current) => (current === "ready" ? "ready" : "error"));
      });
    return () => {
      active = false;
    };
  }, [id, user]);

  if (state === "loading") {
    return (
      <main className="order-confirmation container" aria-busy="true">
        <p role="status">Loading your order…</p>
      </main>
    );
  }

  if (state !== "ready" || !order) {
    return (
      <main className="order-confirmation container">
        <h1 className="title">Order details unavailable</h1>
        <p className="order-confirmation-lead">
          {state === "error"
            ? "We couldn't load this order right now. Please try again shortly."
            : "For your privacy, order details are only shown in the browser tab that placed the order, or to the signed-in account that owns it."}
        </p>
        <p>Your order confirmation email includes your order number and how to track it.</p>
        <p>
          <Link className="order-confirmation-link" to="/track-order">
            Track an order
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="order-confirmation container">
      <p className="order-confirmation-eyebrow">Order #{order.orderNumber}</p>
      <h1 className="title">Order received — awaiting our email</h1>
      <p className="order-confirmation-lead">
        Thank you{order.customer?.name ? `, ${order.customer.name.split(" ")[0]}` : ""}. Your order request has been received.{" "}
        <strong>It is not paid and not yet confirmed.</strong>
      </p>

      <ol className="order-confirmation-next" aria-label="What happens next">
        <li>We check availability of your exact size and the final cost.</li>
        <li>
          We email {order.customer?.email ? <strong>{order.customer.email}</strong> : "you"} the final amount in Ghana cedis
          (GHS) and how to pay.
        </li>
        <li>After you pay, reply to that email with your payment screenshot.</li>
        <li>We confirm your order once the payment is verified in our account, then source and ship it.</li>
      </ol>

      <div className="order-confirmation-reference">
        <span>Your order number</span>
        <strong>{order.orderNumber}</strong>
        <span>Keep it to track your order or contact us.</span>
      </div>

      <OrderItems order={order} />
      <p className="order-confirmation-note">The GBP subtotal is an estimate. You will not be charged until you accept our GHS quote and pay.</p>

      <p className="order-confirmation-actions">
        <Link className="order-confirmation-link" to={`/orders/${order.id}`}>
          View order progress
        </Link>
        <Link className="order-confirmation-link" to="/store">
          Continue shopping
        </Link>
      </p>
    </main>
  );
};

export default OrderConfirmation;
