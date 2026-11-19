import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { logoutUser } from "../../redux/actions/user.action";
import { apiRequest, authHeader } from "../../utils/api";
import { formatProductPrice, getProductImage, useFallbackProductImage } from "../../utils/product";
import { isAdmin } from "../../utils/admin";
import { AdminGate } from "../AdminOrders/AdminOrders.page";
import AdminLayout from "../../components/AdminLayout/AdminLayout.component";
import "../AdminOrderDetail/admin.styles.css";
import "../AdminFeaturedSneakers/adminFeaturedSneakers.styles.css";
import "./adminLatestReleases.styles.css";

// Mirrors MAX_LATEST_RELEASES in server/controllers/latestReleasesController.js.
export const MAX_LATEST_RELEASES = 8;
const ENDPOINT = "/api/admin/latest-releases";
const WARNING_COPY = {
  draft: "This product is a draft, so it is hidden from the homepage. Remove or replace it.",
  missing: "This product no longer exists, so it is hidden from the homepage. Remove or replace it.",
  unavailable: "This product is no longer available for Latest Releases. Remove or replace it.",
};

const productId = (product) => String(product?._id ?? product?.id ?? "").toLowerCase();
const productName = (product) => product?.name || product?.title || "Untitled product";
const productMeta = (product) => [product.brand, formatProductPrice(product), product.inStock === false ? "Sold out" : "In stock"].filter(Boolean).join(" · ");

// Pair each saved id with its resolved product (if any) and admin warning.
const entriesFrom = ({ item, warnings = [] }) => {
  const products = new Map((item.products || []).map((product) => [productId(product), product]));
  const reasons = new Map(warnings.map((warning) => [String(warning.productId).toLowerCase(), warning.reason]));
  return item.productIds.map((id) => ({ id, product: products.get(id) || null, warning: reasons.get(id) || null }));
};

const savedFrom = (data) => ({ version: data.item.version, configured: data.item.configured === true, entries: entriesFrom(data) });

const sameOrder = (left, right) => left.length === right.length && left.every((entry, index) => entry.id === right[index].id);

const AdminLatestReleases = () => {
  const { user } = useSelector((state) => state.userReducer);
  const dispatch = useDispatch();
  const [loadState, setLoadState] = useState("loading");
  const [saved, setSaved] = useState({ version: 0, configured: false, entries: [] });
  const [draft, setDraft] = useState([]);
  const [target, setTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState({ state: "idle", term: "", results: [] });
  const searchRef = useRef(null);
  const searchInputRef = useRef(null);
  const listHeadingRef = useRef(null);

  const dirty = !sameOrder(draft, saved.entries);
  // Saving the untouched defaults is meaningful: it pins them in place of the newest products.
  const canSave = dirty || !saved.configured;
  const full = draft.length >= MAX_LATEST_RELEASES;
  const selectedIds = new Set(draft.map((entry) => entry.id));
  const preview = draft.filter((entry) => entry.product && !entry.warning);

  const load = useCallback(async () => {
    if (!isAdmin(user)) return;
    setLoadState("loading");
    try {
      const response = await apiRequest(ENDPOINT, { headers: authHeader(user) });
      if (response.ok) {
        const next = savedFrom(response.data);
        setSaved(next);
        setDraft(next.entries);
        setTarget(null);
        setConflict(false);
        setStatus(null);
        setLoadState("ready");
      } else if (response.status === 401) dispatch(logoutUser());
      else setLoadState(response.status === 403 ? "forbidden" : "error");
    } catch {
      setLoadState("error");
    }
  }, [dispatch, user]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const leave = (event) => { if (!dirty) return; event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  useEffect(() => () => searchRef.current?.abort(), []);

  const searchFor = async (term) => {
    // Abort the previous search so an older response can never overwrite a newer one.
    searchRef.current?.abort();
    const controller = new AbortController();
    searchRef.current = controller;
    setSearch({ state: "loading", term, results: [] });
    try {
      const response = await fetch(`/api/products?search=${encodeURIComponent(term)}&limit=10`, { signal: controller.signal });
      if (!response.ok) throw new Error("Search failed");
      const data = await response.json();
      setSearch({ state: "ready", term, results: Array.isArray(data?.items) ? data.items : [] });
    } catch (error) {
      if (error?.name !== "AbortError") setSearch({ state: "error", term, results: [] });
    }
  };
  const runSearch = (event) => {
    event.preventDefault();
    const term = query.trim();
    if (!term) { setSearch({ state: "invalid", term: "", results: [] }); return; }
    searchFor(term);
  };
  // Retry repeats the search that failed, even if the input has changed since.
  const retrySearch = () => searchFor(search.term);

  const edit = (next) => { setDraft(next); setStatus(null); };
  const pick = (product) => {
    const id = productId(product);
    if (!id) return;
    if (target !== null) {
      if (selectedIds.has(id) && draft[target]?.id !== id) return;
      edit(draft.map((entry, position) => (position === target ? { id, product, warning: null } : entry)));
      setTarget(null);
      return;
    }
    if (full || selectedIds.has(id)) return;
    edit([...draft, { id, product, warning: null }]);
  };
  const replace = (index) => { setTarget(index); searchInputRef.current?.focus(); };
  const remove = (index) => {
    edit(draft.filter((_, position) => position !== index));
    // The focused Remove button unmounts with its slot; keep keyboard users in the list.
    listHeadingRef.current?.focus();
    if (target === index) setTarget(null);
    else if (target !== null && target > index) setTarget(target - 1);
  };
  const move = (index, offset) => {
    const destination = index + offset;
    if (destination < 0 || destination >= draft.length) return;
    const next = [...draft];
    [next[index], next[destination]] = [next[destination], next[index]];
    edit(next);
    if (target === index) setTarget(destination);
    else if (target === destination) setTarget(index);
  };
  const discard = () => { setDraft(saved.entries); setTarget(null); setStatus(null); };

  const save = async () => {
    if (saving || !canSave) return;
    setSaving(true);
    setStatus(null);
    try {
      const response = await apiRequest(ENDPOINT, { method: "PUT", headers: authHeader(user), body: { productIds: draft.map((entry) => entry.id), expectedVersion: saved.version } });
      if (response.ok) {
        const next = savedFrom(response.data);
        setSaved(next);
        setDraft(next.entries);
        setTarget(null);
        setStatus({ type: "done", text: "Latest releases saved. The homepage now shows this selection." });
      } else if (response.status === 401) dispatch(logoutUser());
      else if (response.status === 409) {
        setConflict(true);
        setStatus({ type: "error", text: "Someone changed this selection. Reload before saving." });
      } else if (response.status === 403) setStatus({ type: "error", text: "Your account is not allowed to change latest releases." });
      else if (response.status === 422) {
        const unavailable = new Set(response.data?.unavailable || []);
        setDraft((current) => current.map((entry) => (unavailable.has(entry.id) ? { ...entry, warning: entry.warning || "unavailable" } : entry)));
        setStatus({ type: "error", text: `${response.data?.error || "One or more products are unavailable"}. Remove or replace the flagged products and save again.` });
      } else {
        const detail = response.data?.fields ? Object.values(response.data.fields).join(" ") : "";
        setStatus({ type: "error", text: [response.data?.error || "Latest releases could not be saved.", detail].filter(Boolean).join(": ") });
      }
    } catch {
      setStatus({ type: "error", text: "Latest releases could not be saved. Check your connection and try again; your changes are kept." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminGate user={user}>
      <AdminLayout
        className="featured-admin latest-admin"
        eyebrow="Admin / Catalogue"
        title="Manage Latest Releases"
        description="Choose and order up to eight products for the homepage Latest Releases. Changes go live only after you save."
        actions={<Link to="/admin/products" className="admin-button">Back to products</Link>}
      >
        {loadState === "loading" && <p className="admin-state" role="status">Loading latest releases…</p>}
        {loadState === "error" && (
          <div className="admin-state is-error" role="alert">
            <p>Latest releases could not be loaded.</p>
            <button type="button" className="admin-button" onClick={load}>Try again</button>
          </div>
        )}
        {loadState === "forbidden" && <p className="admin-state is-error" role="alert">Your account is not allowed to manage latest releases.</p>}

        {loadState === "ready" && (
          <div className="featured-admin__layout">
            <section className="admin-panel featured-admin__selection" aria-labelledby="latest-selection-title">
              <div className="featured-admin__panel-heading">
                <h2 id="latest-selection-title" ref={listHeadingRef} tabIndex={-1}>Current selection</h2>
                <p className="admin-muted"><strong>{draft.length}/{MAX_LATEST_RELEASES}</strong> slots used{dirty && " · unsaved changes"}</p>
              </div>
              {!saved.configured && <p className="latest-admin__note">Not saved yet: the homepage shows the newest catalogue products automatically. Save to pin this selection; after that, new products are not added automatically.</p>}
              {draft.length === 0 ? (
                <p className="featured-admin__empty">No products selected. After saving, the homepage shows a short “New releases are on the way” message.</p>
              ) : (
                <ol className="featured-admin__slots">
                  {draft.map((entry, index) => {
                    const label = entry.product ? productName(entry.product) : `Missing product ${entry.id}`;
                    return (
                      <li className={`featured-admin__slot${target === index ? " is-choosing" : ""}`} key={entry.id}>
                        <span className="featured-admin__position" aria-hidden="true">{index + 1}</span>
                        {entry.product ? <img src={getProductImage(entry.product)} alt="" onError={useFallbackProductImage} /> : <span className="featured-admin__placeholder" aria-hidden="true">?</span>}
                        <div className="featured-admin__details">
                          <strong>{label}</strong>
                          <small>{entry.product ? productMeta(entry.product) : `ID ${entry.id}`}</small>
                          {entry.warning && <p className="admin-warning">{WARNING_COPY[entry.warning] || WARNING_COPY.unavailable}</p>}
                        </div>
                        <div className="featured-admin__slot-actions">
                          <button type="button" className="admin-button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${label} up`}>Move up</button>
                          <button type="button" className="admin-button" onClick={() => move(index, 1)} disabled={index === draft.length - 1} aria-label={`Move ${label} down`}>Move down</button>
                          <button type="button" className="admin-button" onClick={() => replace(index)} aria-pressed={target === index} aria-label={`Replace ${label}`}>Replace</button>
                          <button type="button" className="admin-link-button" onClick={() => remove(index)} aria-label={`Remove ${label}`}>Remove</button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}

              <div className="featured-admin__actions">
                <button type="button" className="admin-button admin-button-dark" onClick={save} disabled={!canSave || saving || conflict}>{saving ? "Saving…" : "Save changes"}</button>
                <button type="button" className="admin-button" onClick={discard} disabled={!dirty || saving}>Discard changes</button>
                {conflict && <button type="button" className="admin-button" onClick={load}>Reload saved selection</button>}
              </div>
              <p className={`admin-status ${status?.type === "error" ? "is-error" : status ? "is-done" : ""}`} role={status?.type === "error" ? "alert" : "status"} aria-live="polite">{status?.text || ""}</p>
            </section>

            <section className="admin-panel featured-admin__search" aria-labelledby="latest-search-title">
              <h2 id="latest-search-title">Find products</h2>
              <p className="admin-muted" aria-live="polite">
                {target !== null ? `Choosing a replacement for slot ${target + 1}.` : "Add a product to the end of the list, or use “Replace” on a slot."}
              </p>
              {target !== null && <button type="button" className="admin-link-button" onClick={() => setTarget(null)}>Cancel replacing</button>}
              <form className="featured-admin__search-form" role="search" onSubmit={runSearch}>
                <div className="admin-field">
                  <label htmlFor="latest-product-search">Name or brand</label>
                  <input id="latest-product-search" ref={searchInputRef} type="search" value={query} maxLength="100" onChange={(event) => setQuery(event.target.value)} />
                </div>
                <button type="submit" className="admin-button">Search</button>
              </form>
              {full && target === null && <p className="admin-muted">All eight slots are full. Remove or replace a product to add another.</p>}
              {search.state === "invalid" && <p className="admin-error" role="alert">Enter a name or brand to search.</p>}
              {search.state === "loading" && <p role="status">Searching…</p>}
              {search.state === "error" && <div role="alert"><p>Search failed.</p><button type="button" className="admin-button" onClick={retrySearch}>Retry search</button></div>}
              {search.state === "ready" && search.results.length === 0 && <p>No published products match “{search.term}”.</p>}
              {search.state === "ready" && search.results.length > 0 && (
                <ul className="featured-admin__results" aria-label="Search results">
                  {search.results.map((product) => {
                    const id = productId(product);
                    const name = productName(product);
                    const usedElsewhere = selectedIds.has(id) && (target === null || draft[target]?.id !== id);
                    const label = target !== null ? `Use for slot ${target + 1}` : "Add";
                    return (
                      <li key={id}>
                        <img src={getProductImage(product)} alt="" onError={useFallbackProductImage} />
                        <span><strong>{name}</strong><small>{productMeta(product)}</small></span>
                        <button type="button" className="admin-button" onClick={() => pick(product)} disabled={usedElsewhere || (target === null && full)} aria-label={`${label}: ${name}`}>{usedElsewhere ? "Added" : label}</button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="admin-panel featured-admin__preview" aria-labelledby="latest-preview-title">
              <h2 id="latest-preview-title">Homepage preview</h2>
              {preview.length === 0 ? <p className="admin-muted">The Latest Releases section will show its empty message.</p> : (
                <ol className="featured-admin__preview-grid">
                  {preview.map((entry) => (
                    <li key={entry.id}>
                      <img src={getProductImage(entry.product)} alt="" onError={useFallbackProductImage} />
                      <strong>{productName(entry.product)}</strong>
                      <small className="admin-muted">{formatProductPrice(entry.product)}</small>
                      {entry.product.inStock === false && <span className="admin-badge">Sold out</span>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}
      </AdminLayout>
    </AdminGate>
  );
};

export default AdminLatestReleases;
