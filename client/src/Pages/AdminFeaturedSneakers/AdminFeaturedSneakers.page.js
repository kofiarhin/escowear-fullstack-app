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
import "./adminFeaturedSneakers.styles.css";

export const MAX_FEATURED = 4;
const ENDPOINT = "/api/admin/featured-sneakers";
const WARNING_COPY = {
  draft: "This product is a draft, so it is hidden from the homepage. Remove or replace it.",
  missing: "This product no longer exists, so it is hidden from the homepage. Remove or replace it.",
  unavailable: "This product is no longer available to feature. Remove or replace it.",
};

const productId = (product) => String(product?._id ?? product?.id ?? "").toLowerCase();
const productName = (product) => product?.name || product?.title || "Untitled product";
const stockLabel = (product) => (product?.inStock === false ? "Sold out" : "In stock");

// Pair each saved id with its resolved product (if any) and admin warning.
const entriesFrom = ({ item, warnings = [] }) => {
  const products = new Map((item.products || []).map((product) => [productId(product), product]));
  const reasons = new Map(warnings.map((warning) => [String(warning.productId).toLowerCase(), warning.reason]));
  return item.productIds.map((id) => ({ id, product: products.get(id) || null, warning: reasons.get(id) || null }));
};

const savedFrom = (data) => ({ version: data.item.version, entries: entriesFrom(data) });

const sameOrder =(left, right) => left.length === right.length && left.every((entry, index) => entry.id === right[index].id);

const AdminFeaturedSneakers = () => {
  const { user } = useSelector((state) => state.userReducer);
  const dispatch = useDispatch();
  const [loadState, setLoadState] = useState("loading");
  const [saved, setSaved] = useState({ version: 0, entries: [] });
  const [draft, setDraft] = useState([]);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState({ state: "idle", term: "", results: [] });
  const searchRef = useRef(null);

  const dirty = !sameOrder(draft, saved.entries);
  const full = draft.length >= MAX_FEATURED;
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

  const runSearch = async (event) => {
    event.preventDefault();
    const term = query.trim();
    if (!term) { setSearch({ state: "invalid", term: "", results: [] }); return; }
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

  const edit = (next) => { setDraft(next); setStatus(null); };
  const add = (product) => {
    const id = productId(product);
    if (!id || full || selectedIds.has(id)) return;
    edit([...draft, { id, product, warning: null }]);
  };
  const remove = (index) => edit(draft.filter((_, position) => position !== index));
  const move = (index, offset) => {
    const target = index + offset;
    if (target < 0 || target >= draft.length) return;
    const next = [...draft];
    [next[index], next[target]] = [next[target], next[index]];
    edit(next);
  };
  const discard = () => { setDraft(saved.entries); setStatus(null); };

  const save = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    setStatus(null);
    try {
      const response = await apiRequest(ENDPOINT, { method: "PUT", headers: authHeader(user), body: { productIds: draft.map((entry) => entry.id), expectedVersion: saved.version } });
      if (response.ok) {
        const next = savedFrom(response.data);
        setSaved(next);
        setDraft(next.entries);
        setStatus({ type: "done", text: "Featured sneakers saved. The homepage now shows this selection." });
      } else if (response.status === 401) dispatch(logoutUser());
      else if (response.status === 409) {
        setConflict(true);
        setStatus({ type: "error", text: "Someone changed this selection. Reload before saving." });
      } else if (response.status === 403) setStatus({ type: "error", text: "Your account is not allowed to change featured sneakers." });
      else if (response.status === 422) {
        const unavailable = new Set(response.data?.unavailable || []);
        setDraft((current) => current.map((entry) => (unavailable.has(entry.id) ? { ...entry, warning: entry.warning || "unavailable" } : entry)));
        setStatus({ type: "error", text: `${response.data?.error || "One or more products are unavailable"}. Remove the flagged products and save again.` });
      } else {
        const detail = response.data?.fields ? Object.values(response.data.fields).join(" ") : "";
        setStatus({ type: "error", text: [response.data?.error || "Featured sneakers could not be saved.", detail].filter(Boolean).join(": ") });
      }
    } catch {
      setStatus({ type: "error", text: "Featured sneakers could not be saved. Check your connection and try again; your changes are kept." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminGate user={user}>
      <AdminLayout
        className="featured-admin"
        eyebrow="Admin / Catalogue"
        title="Manage Featured Sneakers"
        description="Choose up to four sneakers for the homepage. Changes go live only after you save."
        actions={<Link to="/admin/products" className="admin-button">Back to products</Link>}
      >
        {loadState === "loading" && <p className="admin-state" role="status">Loading featured sneakers…</p>}
        {loadState === "error" && (
          <div className="admin-state is-error" role="alert">
            <p>Featured sneakers could not be loaded.</p>
            <button type="button" className="admin-button" onClick={load}>Try again</button>
          </div>
        )}
        {loadState === "forbidden" && <p className="admin-state is-error" role="alert">Your account is not allowed to manage featured sneakers.</p>}

        {loadState === "ready" && (
          <div className="featured-admin__layout">
            <section className="admin-panel featured-admin__selection" aria-labelledby="featured-selection-title">
              <div className="featured-admin__panel-heading">
                <h2 id="featured-selection-title">Current selection</h2>
                <p className="admin-muted"><strong>{draft.length}/{MAX_FEATURED}</strong> slots used{dirty && " · unsaved changes"}</p>
              </div>
              {draft.length === 0 ? (
                <p className="featured-admin__empty">No sneakers selected. The homepage will show its empty Featured message until you add some.</p>
              ) : (
                <ol className="featured-admin__slots">
                  {draft.map((entry, index) => {
                    const label = entry.product ? productName(entry.product) : `Missing product ${entry.id}`;
                    return (
                      <li className="featured-admin__slot" key={entry.id}>
                        <span className="featured-admin__position" aria-hidden="true">{index + 1}</span>
                        {entry.product ? <img src={getProductImage(entry.product)} alt="" onError={useFallbackProductImage} /> : <span className="featured-admin__placeholder" aria-hidden="true">?</span>}
                        <div className="featured-admin__details">
                          <strong>{label}</strong>
                          {entry.product && <small>{[entry.product.brand, formatProductPrice(entry.product), stockLabel(entry.product)].filter(Boolean).join(" · ")}</small>}
                          {!entry.product && <small>ID {entry.id}</small>}
                          {entry.warning && <p className="admin-warning">{WARNING_COPY[entry.warning] || WARNING_COPY.unavailable}</p>}
                        </div>
                        <div className="featured-admin__slot-actions">
                          <button type="button" className="admin-button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${label} up`}>Move up</button>
                          <button type="button" className="admin-button" onClick={() => move(index, 1)} disabled={index === draft.length - 1} aria-label={`Move ${label} down`}>Move down</button>
                          <button type="button" className="admin-link-button" onClick={() => remove(index)} aria-label={`Remove ${label}`}>Remove</button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}

              <div className="featured-admin__actions">
                <button type="button" className="admin-button admin-button-dark" onClick={save} disabled={!dirty || saving || conflict}>{saving ? "Saving…" : "Save changes"}</button>
                <button type="button" className="admin-button" onClick={discard} disabled={!dirty || saving}>Discard changes</button>
                {conflict && <button type="button" className="admin-button" onClick={load}>Reload saved selection</button>}
              </div>
              <p className={`admin-status ${status?.type === "error" ? "is-error" : status ? "is-done" : ""}`} role="status" aria-live="polite">{status?.text || ""}</p>
            </section>

            <section className="admin-panel featured-admin__search" aria-labelledby="featured-search-title">
              <h2 id="featured-search-title">Find products</h2>
              <form className="featured-admin__search-form" role="search" onSubmit={runSearch}>
                <div className="admin-field">
                  <label htmlFor="featured-product-search">Name or brand</label>
                  <input id="featured-product-search" type="search" value={query} maxLength="100" onChange={(event) => setQuery(event.target.value)} />
                </div>
                <button type="submit" className="admin-button">Search</button>
              </form>
              {full && <p className="admin-muted">All four slots are full. Remove a sneaker to add another.</p>}
              {search.state === "invalid" && <p className="admin-error" role="alert">Enter a name or brand to search.</p>}
              {search.state === "loading" && <p role="status">Searching…</p>}
              {search.state === "error" && <p role="alert">Search failed. Try again.</p>}
              {search.state === "ready" && search.results.length === 0 && <p>No published products match “{search.term}”.</p>}
              {search.state === "ready" && search.results.length > 0 && (
                <ul className="featured-admin__results" aria-label="Search results">
                  {search.results.map((product) => {
                    const id = productId(product);
                    const selected = selectedIds.has(id);
                    return (
                      <li key={id}>
                        <img src={getProductImage(product)} alt="" onError={useFallbackProductImage} />
                        <span><strong>{productName(product)}</strong><small>{[product.brand, formatProductPrice(product), stockLabel(product)].filter(Boolean).join(" · ")}</small></span>
                        <button type="button" className="admin-button" onClick={() => add(product)} disabled={selected || full} aria-label={`Add ${productName(product)}`}>{selected ? "Added" : "Add"}</button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="admin-panel featured-admin__preview" aria-labelledby="featured-preview-title">
              <h2 id="featured-preview-title">Homepage preview</h2>
              {preview.length === 0 ? <p className="admin-muted">The Featured section will show its empty message.</p> : (
                <ol className="featured-admin__preview-grid">
                  {preview.map((entry) => (
                    <li key={entry.id}>
                      <img src={getProductImage(entry.product)} alt="" onError={useFallbackProductImage} />
                      <strong>{productName(entry.product)}</strong>
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

export default AdminFeaturedSneakers;
