import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { logoutUser } from "../../redux/actions/user.action";
import { apiRequest, authHeader } from "../../utils/api";
import { formatDateTime, isAdmin } from "../../utils/admin";
import AdminLayout from "../../components/AdminLayout/AdminLayout.component";
import { AdminGate } from "../AdminOrders/AdminOrders.page";
import "../AdminOrderDetail/admin.styles.css";
import "./adminUsers.styles.css";

// Text is always shown; colour only reinforces the account state.
const AccountBadge = ({ blocked }) => <span className={`admin-badge ${blocked ? "is-tone-attention" : "is-tone-done"}`}>{blocked ? "Blocked" : "Active"}</span>;

const VERIFICATION_LABELS = {
  not_required: ["Existing account", "is-tone-closed"],
  verified: ["Verified", "is-tone-done"],
  pending: ["Pending", "is-tone-progress"],
  expired: ["Expired", "is-tone-attention"],
};
const MAIL_LABELS = { sent: "Email accepted by mail server", queued: "Email queued", sending: "Email sending", failed: "Email not delivered" };

// Email verification for accounts created after IDE-152. Existing accounts
// have no requirement and are never removed automatically.
const VerificationCell = ({ verification }) => {
  const info = verification || { state: "not_required" };
  const [label, tone] = VERIFICATION_LABELS[info.state] || VERIFICATION_LABELS.not_required;
  const mail = info.deliveryEmail ? MAIL_LABELS[info.deliveryEmail.state] : info.state === "verified" || info.state === "not_required" ? "" : "No email sent yet";
  return (
    <div className="admin-users__verification">
      <span className={`admin-badge ${tone}`}>{label}</span>
      {info.state === "pending" && info.deadline && <span className="admin-muted">Verify by {formatDateTime(info.deadline)}</span>}
      {info.state === "verified" && info.verifiedAt && <span className="admin-muted">{formatDateTime(info.verifiedAt)}</span>}
      {mail && info.state !== "verified" && <span className="admin-muted">{mail}</span>}
      {info.finalWarningAt && info.state !== "verified" && <span className="admin-muted">Final reminder {formatDateTime(info.finalWarningAt)}</span>}
      {info.deletionPaused && <strong className="admin-users__paused">Deletion paused: verification email not delivered</strong>}
    </div>
  );
};

const AdminUsers = () => {
  const { user } = useSelector((state) => state.userReducer);
  const dispatch = useDispatch();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState({ tone: "", text: "" });
  const q = params.get("q") || "";
  const page = Number(params.get("page")) || 1;
  const [query, setQuery] = useState(q);

  const load = useCallback(async () => {
    if (!isAdmin(user)) return;
    setState("loading");
    const search = new URLSearchParams({ page: String(page), limit: "20" });
    if (q) search.set("q", q);
    try {
      const response = await apiRequest(`/api/admin/users?${search}`, { headers: authHeader(user) });
      if (response.ok) {
        // Deleting the last user on the last page would leave an empty page past the end.
        if (response.data.items.length === 0 && page > 1) {
          setParams({ ...(q ? { q } : {}), page: String(Math.max(1, response.data.pagination.pages)) });
          return;
        }
        setData(response.data);
        setState("ready");
      } else if (response.status === 401) {
        dispatch(logoutUser());
      } else {
        setState(response.status === 403 ? "forbidden" : "error");
      }
    } catch {
      setState("error");
    }
  }, [user, page, q, dispatch, setParams]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setQuery(q);
  }, [q]);

  const updateParams = (next) => {
    const merged = { q, page: "1", ...next };
    setParams(Object.fromEntries(Object.entries(merged).filter(([, value]) => value)));
  };

  // Shared by block, unblock and delete: confirm, call, then reload the page of results.
  const runAction = async (account, { confirmText, path, method, body, done, failed }) => {
    if (busyId || !window.confirm(confirmText)) return;
    setBusyId(account.id);
    setMessage({ tone: "", text: "" });
    try {
      const response = await apiRequest(path, { method, headers: authHeader(user), body });
      if (response.status === 401) {
        dispatch(logoutUser());
        return;
      }
      if (!response.ok) {
        setMessage({ tone: "error", text: response.data?.error || failed });
        return;
      }
      setMessage({ tone: "done", text: done });
      await load();
    } catch {
      setMessage({ tone: "error", text: `${failed} Check your connection and try again.` });
    } finally {
      setBusyId(null);
    }
  };

  const toggleBlock = (account) =>
    runAction(account, {
      confirmText: account.blocked ? `Unblock ${account.email}? They will be able to sign in again.` : `Block ${account.email}? They will be signed out and unable to sign in.`,
      path: `/api/admin/users/${account.id}/block`,
      method: "PATCH",
      body: { blocked: !account.blocked },
      done: `${account.email} is now ${account.blocked ? "active" : "blocked"}.`,
      failed: "The account could not be updated.",
    });

  const resendVerification = (account) =>
    runAction(account, {
      confirmText: `Send a new verification link to ${account.email}? Earlier links will stop working. The deadline does not change.`,
      path: `/api/admin/users/${account.id}/resend-verification`,
      method: "POST",
      done: `A new verification link is queued for ${account.email}.`,
      failed: "The verification email could not be sent.",
    });

  const remove = (account) =>
    runAction(account, {
      confirmText: `Delete ${account.email}? This permanently removes the account. Their orders are kept.`,
      path: `/api/admin/users/${account.id}`,
      method: "DELETE",
      done: `${account.email} was deleted.`,
      failed: "The account could not be deleted.",
    });

  return (
    <AdminGate user={user}>
      <AdminLayout className="admin-users" title="Users" description="See who has an account and whether new accounts have verified their email, and block or delete customer accounts. Admin accounts are managed from the server.">
        <form
          className="admin-filters admin-users__filters"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            updateParams({ q: query.trim() });
          }}
        >
          <div className="admin-users__search">
            <label htmlFor="admin-users-search">Email</label>
            <input id="admin-users-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <button type="submit" className="admin-button admin-button-dark">
            Search
          </button>
        </form>

        {message.text && (
          <p className={`admin-status ${message.tone === "error" ? "is-error" : "is-done"}`} role={message.tone === "error" ? "alert" : "status"}>
            {message.text}
          </p>
        )}
        {state === "loading" && (
          <p className="admin-state" role="status">
            Loading users…
          </p>
        )}
        {state === "error" && (
          <div className="admin-state is-error" role="alert">
            <p>Users could not be loaded.</p>
            <button type="button" className="admin-button" onClick={load}>
              Try again
            </button>
          </div>
        )}
        {state === "forbidden" && (
          <p className="admin-state is-error" role="alert">
            Your account is not allowed to manage users.
          </p>
        )}
        {state === "ready" && data && (
          <>
            {data.items.length === 0 ? (
              <div className="admin-state is-empty">
                <strong>No users match</strong>
                <p className="admin-muted">{q ? "Try another email." : "Accounts appear here as soon as customers register."}</p>
                {q && (
                  <button type="button" className="admin-button" onClick={() => setParams({})}>
                    Clear search
                  </button>
                )}
              </div>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <caption className="visually-hidden">Users, newest first</caption>
                  <thead>
                    <tr>
                      <th scope="col">Email</th>
                      <th scope="col">Name</th>
                      <th scope="col">Role</th>
                      <th scope="col">Joined</th>
                      <th scope="col">Status</th>
                      <th scope="col">Email verification</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((account) => {
                      const manageable = account.role !== "admin";
                      const busy = busyId === account.id;
                      return (
                        <tr key={account.id}>
                          <td className="is-primary is-wrap">{account.email}</td>
                          <td className="is-wrap" data-label="Name">{account.name || "—"}</td>
                          <td data-label="Role">{account.role === "admin" ? "Admin" : "Customer"}</td>
                          <td data-label="Joined">{formatDateTime(account.createdAt)}</td>
                          <td className="admin-users__status-cell" data-label="Status">
                            <AccountBadge blocked={account.blocked} />
                          </td>
                          <td data-label="Email verification">
                            <VerificationCell verification={account.verification} />
                          </td>
                          <td className="is-full" data-label="Actions">
                            {manageable ? (
                              <div className="admin-users__actions">
                                <button type="button" className="admin-button" disabled={Boolean(busyId)} aria-busy={busy} onClick={() => toggleBlock(account)} aria-label={`${account.blocked ? "Unblock" : "Block"} ${account.email}`}>
                                  {busy ? "Saving…" : account.blocked ? "Unblock" : "Block"}
                                </button>
                                {account.verification?.state === "pending" && (
                                  <button type="button" className="admin-button" disabled={Boolean(busyId)} onClick={() => resendVerification(account)} aria-label={`Resend verification email to ${account.email}`}>
                                    Resend link
                                  </button>
                                )}
                                <button type="button" className="admin-link-button" disabled={Boolean(busyId)} onClick={() => remove(account)} aria-label={`Delete ${account.email}`}>
                                  Delete
                                </button>
                              </div>
                            ) : (
                              <span className="admin-muted">Protected</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <nav className="admin-pagination" aria-label="User pages">
              <button type="button" className="admin-button" disabled={page <= 1} onClick={() => updateParams({ page: String(page - 1) })}>
                Previous
              </button>
              <span>
                Page {data.pagination.page} of {Math.max(1, data.pagination.pages)} · {data.pagination.total} users
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

export default AdminUsers;
