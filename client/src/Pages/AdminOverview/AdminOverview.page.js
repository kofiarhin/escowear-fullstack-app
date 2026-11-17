import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { logoutUser } from "../../redux/actions/user.action";
import { apiRequest, authHeader } from "../../utils/api";
import { STATUS_GROUPS, formatDateTime, humanize, isAdmin } from "../../utils/admin";
import { AdminGate } from "../AdminOrders/AdminOrders.page";
import AdminLayout from "../../components/AdminLayout/AdminLayout.component";
import StatusBadge from "../../components/AdminLayout/StatusBadge.component";
import "../AdminOrderDetail/admin.styles.css";
import "./adminOverview.styles.css";

const MAX_ACTIVE_SLIDES = 8;

const greeting = (date = new Date()) => {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
};

const ordersLink = (status) => (status ? `/admin/orders?status=${status}` : "/admin/orders");
const sum = (byStatus, statuses) => statuses.reduce((total, status) => total + (byStatus[status] || 0), 0);

// Per-status counts inside a stat card; each row opens the filtered list.
const Breakdown = ({ byStatus, statuses, label }) => (
  <ul className="admin-stat__breakdown" aria-label={label}>
    {statuses.map((status) => (
      <li key={status}>
        <Link to={ordersLink(status)}>
          <span>{humanize(status)}</span>
          <strong>{byStatus[status] || 0}</strong>
        </Link>
      </li>
    ))}
  </ul>
);

const StatCard = ({ tone, label, value, detail, children }) => (
  <article className={`admin-stat is-tone-${tone}`} aria-label={label}>
    <h3 className="admin-stat__label">{label}</h3>
    <p className="admin-stat__value">{value}</p>
    {detail && <p className="admin-stat__detail">{detail}</p>}
    {children}
  </article>
);

const OrderList = ({ orders, label, empty }) =>
  orders.length === 0 ? (
    <div className="admin-state is-empty">{empty}</div>
  ) : (
    <ul className="admin-order-list" aria-label={label}>
      {orders.map((order) => (
        <li key={order.id} className="admin-order-list__item">
          <div className="admin-order-list__main">
            <Link to={`/admin/orders/${order.id}`} className="admin-order-list__link">
              {order.orderNumber}
            </Link>
            <span className="admin-muted">
              {order.customer?.name || "Customer"} · {formatDateTime(order.createdAt)}
            </span>
          </div>
          <div className="admin-order-list__status">
            <StatusBadge status={order.status} />
            {order.proofAwaitingReview && <strong className="admin-proof-flag">New proof to check</strong>}
          </div>
        </li>
      ))}
    </ul>
  );

const QuickActions = () => (
  <section className="admin-card admin-overview__quick" aria-labelledby="admin-quick-title">
    <h2 id="admin-quick-title">Quick actions</h2>
    <div className="admin-overview__quick-grid">
      <Link to="/admin/products/new" className="admin-button admin-button-dark">
        Add product
      </Link>
      <Link to="/admin/orders" className="admin-button">
        View all orders
      </Link>
      <Link to="/admin/products/featured" className="admin-button">
        Manage featured
      </Link>
      <Link to="/admin/hero-slides" className="admin-button">
        Hero slides
      </Link>
    </div>
  </section>
);

const LoadingStats = () => (
  <div className="admin-overview__loading">
    <p className="visually-hidden" role="status">
      Loading dashboard…
    </p>
    <div className="admin-stat-grid" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <span key={index} className="admin-skeleton admin-overview__skeleton" />
      ))}
    </div>
  </div>
);

const Stats = ({ stats }) => {
  const { byStatus, attentionStatuses = STATUS_GROUPS.attention } = stats.orders;
  const attention = sum(byStatus, attentionStatuses);
  const progress = sum(byStatus, STATUS_GROUPS.progress);
  const waitingOnAdmin = attentionStatuses.filter((status) => byStatus[status] > 0);

  return (
    <>
      <section className="admin-overview__section" aria-labelledby="admin-orders-glance">
        <h2 id="admin-orders-glance" className="admin-overview__heading">
          Orders
        </h2>
        <div className="admin-stat-grid">
          <StatCard tone="attention" label="Needs action" value={attention} detail={attention === 0 ? "Nothing is waiting on you." : "Orders waiting on an admin step."}>
            {waitingOnAdmin.length > 0 ? <Breakdown byStatus={byStatus} statuses={waitingOnAdmin} label="Orders needing action by status" /> : <Link to={ordersLink("payment_review")} className="admin-stat__link">View payment review queue</Link>}
          </StatCard>
          <StatCard tone="progress" label="In progress" value={progress} detail="Paid orders being sourced or delivered.">
            <Breakdown byStatus={byStatus} statuses={STATUS_GROUPS.progress} label="Orders in progress by status" />
          </StatCard>
          <StatCard tone="done" label="Completed" value={byStatus.completed || 0}>
            <Link to={ordersLink("completed")} className="admin-stat__link">
              View completed orders
            </Link>
          </StatCard>
          <StatCard tone="neutral" label="Total orders" value={stats.orders.total}>
            <Link to={ordersLink()} className="admin-stat__link">
              Browse all orders
            </Link>
          </StatCard>
        </div>
      </section>

      <section className="admin-overview__section" aria-labelledby="admin-store-glance">
        <h2 id="admin-store-glance" className="admin-overview__heading">
          Catalogue & homepage
        </h2>
        <div className="admin-stat-grid">
          <StatCard tone="neutral" label="Published products" value={stats.products.published} detail={`${stats.products.draft} draft${stats.products.draft === 1 ? "" : "s"} · ${stats.products.total} total`}>
            <div className="admin-stat__links">
              <Link to="/admin/products?status=active" className="admin-stat__link">
                Published
              </Link>
              <Link to="/admin/products?status=draft" className="admin-stat__link">
                Drafts
              </Link>
            </div>
          </StatCard>
          <StatCard tone="neutral" label="Hero slides active" value={`${stats.heroSlides.active}/${MAX_ACTIVE_SLIDES}`} detail={`${stats.heroSlides.total} slide${stats.heroSlides.total === 1 ? "" : "s"} in total`}>
            <Link to="/admin/hero-slides" className="admin-stat__link">
              Manage hero slides
            </Link>
          </StatCard>
          <StatCard
            tone={stats.featured.count < stats.featured.max ? "attention" : "neutral"}
            label="Featured sneakers set"
            value={`${stats.featured.count}/${stats.featured.max}`}
            detail={stats.featured.count < stats.featured.max ? `${stats.featured.max - stats.featured.count} homepage slot${stats.featured.max - stats.featured.count === 1 ? "" : "s"} free` : "Every homepage slot is filled."}
          >
            <Link to="/admin/products/featured" className="admin-stat__link">
              Edit featured selection
            </Link>
          </StatCard>
        </div>
      </section>

      <div className="admin-overview__lists">
        <section className="admin-card" aria-labelledby="admin-attention-title">
          <div className="admin-overview__card-heading">
            <h2 id="admin-attention-title">Needs attention</h2>
          </div>
          <OrderList
            orders={stats.attentionOrders}
            label="Latest orders needing action"
            empty={
              <>
                <strong>All caught up</strong>
                <p className="admin-muted">No orders are waiting on you right now.</p>
              </>
            }
          />
        </section>

        <section className="admin-card" aria-labelledby="admin-recent-title">
          <div className="admin-overview__card-heading">
            <h2 id="admin-recent-title">Recent orders</h2>
            <Link to={ordersLink()} className="admin-stat__link">
              View all
            </Link>
          </div>
          <OrderList
            orders={stats.recentOrders}
            label="Most recent orders"
            empty={
              <>
                <strong>No orders yet</strong>
                <p className="admin-muted">New orders appear here as soon as customers place them.</p>
              </>
            }
          />
        </section>
      </div>
    </>
  );
};

const AdminOverview = () => {
  const { user } = useSelector((state) => state.userReducer);
  const dispatch = useDispatch();
  const [stats, setStats] = useState(null);
  const [state, setState] = useState("loading");

  const load = useCallback(async () => {
    if (!isAdmin(user)) return;
    setState("loading");
    try {
      const response = await apiRequest("/api/admin/stats", { headers: authHeader(user) });
      if (response.ok && response.data?.orders) {
        setStats(response.data);
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
  }, [user, dispatch]);

  useEffect(() => {
    load();
  }, [load]);

  const firstName = user?.name ? user.name.split(" ")[0] : "";

  return (
    <AdminGate user={user}>
      <AdminLayout
        className="admin-overview"
        eyebrow="Overview"
        title={`${greeting()}${firstName ? `, ${firstName}` : ""}`}
        description="What needs you today across orders, the catalogue and the homepage."
      >
        {state === "loading" && <LoadingStats />}
        {state === "error" && (
          <div className="admin-state is-error admin-overview__section" role="alert">
            <p>Dashboard figures could not be loaded.</p>
            <button type="button" className="admin-button" onClick={load}>
              Retry
            </button>
          </div>
        )}
        {state === "forbidden" && (
          <p className="admin-state is-error admin-overview__section" role="alert">
            Your account is not allowed to view the admin dashboard.
          </p>
        )}
        {state === "ready" && stats && <Stats stats={stats} />}
        <QuickActions />
      </AdminLayout>
    </AdminGate>
  );
};

export default AdminOverview;
