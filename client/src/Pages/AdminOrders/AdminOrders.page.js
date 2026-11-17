import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { logoutUser } from "../../redux/actions/user.action";
import { apiRequest, authHeader } from "../../utils/api";
import { formatGBP, formatGHS } from "../../utils/money";
import { ORDER_STATUSES, formatDateTime, humanize, isAdmin } from "../../utils/admin";
import AdminLayout from "../../components/AdminLayout/AdminLayout.component";
import StatusBadge from "../../components/AdminLayout/StatusBadge.component";
import "../AdminOrderDetail/admin.styles.css";

export const AdminGate = ({ user, children }) => {
  if (!user) {
    return (
      <main className="admin container">
        <h1 className="title">Admin</h1>
        <p>
          Please <Link to="/login" state={{ from: window.location.pathname }}>sign in</Link> with an admin account.
        </p>
      </main>
    );
  }
  if (!isAdmin(user)) {
    return (
      <main className="admin container">
        <h1 className="title">Admin</h1>
        <p role="alert">This area is for EscoWear administrators only.</p>
      </main>
    );
  }
  return children;
};

const AdminOrders = () => {
  const { user } = useSelector((state) => state.userReducer);
  const dispatch = useDispatch();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const [query, setQuery] = useState(params.get("q") || "");
  const status = params.get("status") || "";
  const page = Number(params.get("page")) || 1;
  const q = params.get("q") || "";

  const load = useCallback(async () => {
    if (!isAdmin(user)) return;
    setState("loading");
    const search = new URLSearchParams({ page: String(page), limit: "20" });
    if (status) search.set("status", status);
    if (q) search.set("q", q);
    try {
      const response = await apiRequest(`/api/admin/orders?${search}`, { headers: authHeader(user) });
      if (response.ok) {
        setData(response.data);
        setState("ready");
      } else if (response.status === 401) {
        // Admin sessions last 12 hours; sign out so the gate asks to sign in again.
        dispatch(logoutUser());
      } else {
        setState(response.status === 403 ? "forbidden" : "error");
      }
    } catch {
      setState("error");
    }
  }, [user, page, status, q, dispatch]);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the search box in step with the URL (overview links, back/forward).
  useEffect(() => {
    setQuery(q);
  }, [q]);

  const updateParams = (next) => {
    const merged = { status, q, page: "1", ...next };
    setParams(Object.fromEntries(Object.entries(merged).filter(([, value]) => value)));
  };

  const filtered = Boolean(status || q);

  return (
    <AdminGate user={user}>
      <AdminLayout title="Orders" description="Find an order, check what it is waiting on and open it to take the next step.">
        <form
          className="admin-filters admin-orders__filters"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            updateParams({ q: query.trim() });
          }}
        >
          <div className="admin-orders__status">
            <label htmlFor="admin-status">Status</label>
            <select id="admin-status" value={status} onChange={(event) => updateParams({ status: event.target.value })}>
              <option value="">All statuses</option>
              {ORDER_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {humanize(value)}
                </option>
              ))}
            </select>
          </div>
          <div className="admin-orders__search">
            <label htmlFor="admin-search">Order number, name or email</label>
            <input id="admin-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <button type="submit" className="admin-button admin-button-dark">
            Search
          </button>
        </form>

        {state === "loading" && (
          <p className="admin-state" role="status">
            Loading orders…
          </p>
        )}
        {state === "error" && (
          <div className="admin-state is-error" role="alert">
            <p>Orders could not be loaded.</p>
            <button type="button" className="admin-button" onClick={load}>
              Try again
            </button>
          </div>
        )}
        {state === "forbidden" && (
          <p className="admin-state is-error" role="alert">
            Your account is not allowed to view orders.
          </p>
        )}
        {state === "ready" && data && (
          <>
            {data.items.length === 0 ? (
              <div className="admin-state is-empty">
                <strong>No orders match</strong>
                <p className="admin-muted">{filtered ? "Try another status or search term." : "New orders appear here as soon as customers place them."}</p>
                {filtered && (
                  <button
                    type="button"
                    className="admin-button"
                    onClick={() => {
                      setQuery("");
                      setParams({});
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <caption className="visually-hidden">Orders, newest first</caption>
                  <thead>
                    <tr>
                      <th scope="col">Order</th>
                      <th scope="col">Placed</th>
                      <th scope="col">Customer</th>
                      <th scope="col">Status</th>
                      <th scope="col">Payment</th>
                      <th scope="col">Estimate</th>
                      <th scope="col">Quote</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((order) => (
                      <tr key={order.id}>
                        <td className="is-primary">
                          <Link to={`/admin/orders/${order.id}`} className="admin-table__link admin-card-link">
                            {order.orderNumber}
                          </Link>
                        </td>
                        <td data-label="Placed">{formatDateTime(order.createdAt)}</td>
                        <td className="is-wrap is-full" data-label="Customer">
                          {order.customer?.name}
                          <br />
                          <span className="admin-muted">{order.customer?.email}</span>
                        </td>
                        <td className="admin-orders__status-cell" data-label="Status">
                          <StatusBadge status={order.status} />
                        </td>
                        <td className="is-wrap" data-label="Payment">
                          {humanize(order.paymentStatus)}
                          {order.proofAwaitingReview && (
                            <>
                              <br />
                              <strong className="admin-proof-flag">New proof to check</strong>
                            </>
                          )}
                        </td>
                        <td data-label="Estimate">{formatGBP(order.subtotalGBPMinor)}</td>
                        <td data-label="Quote">{order.quoteTotalGHSMinor !== null ? formatGHS(order.quoteTotalGHSMinor) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <nav className="admin-pagination" aria-label="Order pages">
              <button type="button" className="admin-button" disabled={page <= 1} onClick={() => updateParams({ page: String(page - 1) })}>
                Previous
              </button>
              <span>
                Page {data.pagination.page} of {Math.max(1, data.pagination.pages)} · {data.pagination.total} orders
              </span>
              <button type="button" className="admin-button" disabled={page >= data.pagination.pages} onClick={() => updateParams({ page: String(page + 1) })}>
                Next
              </button>
            </nav>
          </>
        )}
      </AdminLayout>
    </AdminGate>
  );
};

export default AdminOrders;
