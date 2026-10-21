import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useSelector } from "react-redux";
import { apiRequest, authHeader } from "../../utils/api";
import { formatGBP, formatGHS } from "../../utils/money";
import { ORDER_STATUSES, formatDateTime, humanize, isAdmin } from "../../utils/admin";
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
      } else {
        setState(response.status === 403 || response.status === 401 ? "forbidden" : "error");
      }
    } catch {
      setState("error");
    }
  }, [user, page, status, q]);

  useEffect(() => {
    load();
  }, [load]);

  const updateParams = (next) => {
    const merged = { status, q, page: "1", ...next };
    setParams(Object.fromEntries(Object.entries(merged).filter(([, value]) => value)));
  };

  return (
    <AdminGate user={user}>
      <main className="admin container">
        <header className="admin-header">
          <p className="admin-eyebrow">Admin</p>
          <h1 className="title">Orders</h1>
        </header>

        <form
          className="admin-filters"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            updateParams({ q: query.trim() });
          }}
        >
          <div>
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
          <div>
            <label htmlFor="admin-search">Order number, name or email</label>
            <input id="admin-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <button type="submit" className="admin-button">
            Search
          </button>
        </form>

        {state === "loading" && <p role="status">Loading orders…</p>}
        {state === "error" && (
          <p role="alert">
            Orders could not be loaded.{" "}
            <button type="button" className="admin-link-button" onClick={load}>
              Try again
            </button>
          </p>
        )}
        {state === "forbidden" && <p role="alert">Your account is not allowed to view orders.</p>}
        {state === "ready" && data && (
          <>
            {data.items.length === 0 ? (
              <p>No orders match.</p>
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
                        <td>
                          <Link to={`/admin/orders/${order.id}`}>{order.orderNumber}</Link>
                        </td>
                        <td>{formatDateTime(order.createdAt)}</td>
                        <td>
                          {order.customer?.name}
                          <br />
                          <span className="admin-muted">{order.customer?.email}</span>
                        </td>
                        <td>
                          <span className={`admin-badge is-${order.status}`}>{humanize(order.status)}</span>
                        </td>
                        <td>{humanize(order.paymentStatus)}</td>
                        <td>{formatGBP(order.subtotalGBPMinor)}</td>
                        <td>{order.quoteTotalGHSMinor !== null ? formatGHS(order.quoteTotalGHSMinor) : "—"}</td>
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
      </main>
    </AdminGate>
  );
};

export default AdminOrders;
