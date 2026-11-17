import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import OrderList from "../../components/OrderList/OrderList.component";
import { logoutUser } from "../../redux/actions/user.action";
import { apiRequest, authHeader } from "../../utils/api";
import { isAdmin } from "../../utils/admin";
import "./account.styles.css";

const Account = () => {
  const [orders, setOrders] = useState([]);
  const [state, setState] = useState("loading");
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const { user } = useSelector((state) => state.userReducer);

  // Signed-out visitors go to login and come straight back here afterwards.
  useEffect(() => {
    if (!user) {
      navigate("/login", { replace: true, state: { from: "/account" } });
    }
  }, [user, navigate]);

  // Only the signed-in customer's own orders are returned by the API.
  useEffect(() => {
    if (!user?.token) return undefined;
    let active = true;
    apiRequest("/api/orders", { headers: authHeader(user) })
      .then(({ ok, status, data }) => {
        if (!active) return;
        // Expired sign-in: sign out (the effect above then redirects to login).
        if (status === 401) {
          dispatch(logoutUser());
          return;
        }
        if (ok && Array.isArray(data?.items)) {
          setOrders(data.items);
          setState("ready");
        } else setState("error");
      })
      .catch(() => active && setState("error"));
    return () => {
      active = false;
    };
  }, [user, dispatch]);

  const handleLogout = () => {
    dispatch(logoutUser());
    navigate("/login", { replace: true });
  };

  if (!user) return null;

  const firstName = (user.name || "").split(" ")[0] || "there";

  return (
    <main className="account">
      <div className="container">
        <header className="account-intro">
          <p className="account-eyebrow">My account</p>
          <h1 className="title account-title">Welcome back, {firstName}</h1>
          {user.email && <p className="account-email">Signed in as {user.email}</p>}
        </header>

        <div className="account-layout">
          <section className="account-card account-orders" aria-labelledby="account-orders-heading">
            <div className="account-card-head">
              <h2 id="account-orders-heading">Recent orders</h2>
              {state === "ready" && orders.length > 0 && (
                <span className="account-count">
                  {orders.length} {orders.length === 1 ? "order" : "orders"}
                </span>
              )}
            </div>
            {state === "loading" && <p role="status" className="account-muted">Loading your orders…</p>}
            {state === "error" && (
              <p role="alert" className="account-error">
                Your orders could not be loaded. Please try again later.
              </p>
            )}
            {state === "ready" &&
              (orders.length > 0 ? (
                <OrderList data={orders} />
              ) : (
                <div className="account-empty">
                  <p>There are no orders yet.</p>
                  <Link to="/store" className="account-button">Shop sneakers</Link>
                </div>
              ))}
            <p className="account-note">
              Ordered as a guest? <Link to="/track-order">Track an order</Link> with your order number.
            </p>
          </section>

          <aside className="account-side" aria-label="Account details">
            <section className="account-card" aria-labelledby="account-profile-heading">
              <h2 id="account-profile-heading">Profile</h2>
              <dl className="account-details">
                <div>
                  <dt>Name</dt>
                  <dd>{user.name || "—"}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{user.email || "—"}</dd>
                </div>
              </dl>
              <Link to="/forgot-password" className="account-link">Change password</Link>
            </section>

            <section className="account-card" aria-labelledby="account-addresses-heading">
              <h2 id="account-addresses-heading">Addresses</h2>
              <p className="account-muted">
                No saved addresses yet. You enter your delivery address at checkout for each order.
              </p>
            </section>

            <section className="account-card" aria-labelledby="account-session-heading">
              <h2 id="account-session-heading">Session</h2>
              {isAdmin(user) && (
                <Link to="/admin" className="account-button account-button--ghost">Go to admin</Link>
              )}
              <button type="button" className="account-button" onClick={handleLogout}>
                Log out
              </button>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
};

export default Account;
