import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { logoutUser } from "../../redux/actions/user.action";
import { apiRequest, authHeader } from "../../utils/api";
import { getProductImage, useFallbackProductImage } from "../../utils/product";
import { isAdmin } from "../../utils/admin";
import { AdminGate } from "../AdminOrders/AdminOrders.page";
import AdminLayout from "../../components/AdminLayout/AdminLayout.component";
import ClassicCardEditor from "./ClassicCardEditor";
import { MAX_CLASSICS, cardErrors, hasErrors, productId, productName, storePath } from "./classicsEditor";
import "../AdminOrderDetail/admin.styles.css";
import "../AdminFeaturedSneakers/adminFeaturedSneakers.styles.css";
import "./adminClassics.styles.css";

const ENDPOINT = "/api/admin/classics";

let nextKey = 0;
const newKey = () => { nextKey += 1; return `card-${nextKey}`; };

// Pair each saved card with its resolved product (if any) and admin warning.
const cardsFrom = ({ item, warnings = [] }) => {
  const products = new Map((item.products || []).map((product) => [productId(product), product]));
  const reasons = new Map(warnings.map((warning) => [String(warning.productId).toLowerCase(), warning.reason]));
  return item.entries.map((entry) => ({
    key: newKey(),
    title: entry.title,
    searchTerm: entry.searchTerm,
    productId: entry.productId,
    product: entry.productId ? products.get(entry.productId) || null : null,
    warning: entry.productId ? reasons.get(entry.productId) || null : null,
  }));
};

const savedFrom = (data) => ({ version: data.item.version, configured: data.item.configured, cards: cardsFrom(data) });
const payloadOf = (cards) => cards.map(({ title, searchTerm, productId: id }) => ({ title: title.trim(), searchTerm: searchTerm.trim(), productId: id }));
const sameCards = (left, right) => JSON.stringify(payloadOf(left)) === JSON.stringify(payloadOf(right));

const AdminClassics = () => {
  const { user } = useSelector((state) => state.userReducer);
  const dispatch = useDispatch();
  const [loadState, setLoadState] = useState("loading");
  const [saved, setSaved] = useState({ version: 0, configured: false, cards: [] });
  const [cards, setCards] = useState([]);
  const [target, setTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState({ state: "idle", term: "", results: [] });
  const searchRef = useRef(null);
  const searchInputRef = useRef(null);
  const cardsHeadingRef = useRef(null);

  const changed = !sameCards(cards, saved.cards);
  // Saving the untouched defaults is meaningful: it takes over from the built-in list.
  const canSave = changed || !saved.configured;
  const invalid = cards.some((card) => hasErrors(cardErrors(card)));
  const full = cards.length >= MAX_CLASSICS;
  const usedIds = new Set(cards.map((card) => card.productId).filter(Boolean));
  const preview = cards.filter((card) => card.product && !card.warning);

  const load = useCallback(async () => {
    if (!isAdmin(user)) return;
    setLoadState("loading");
    try {
      const response = await apiRequest(ENDPOINT, { headers: authHeader(user) });
      if (response.ok) {
        const next = savedFrom(response.data);
        setSaved(next);
        setCards(next.cards);
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
    const leave = (event) => { if (!changed) return; event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [changed]);
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

  const edit = (next) => { setCards(next); setStatus(null); };
  const update = (index, changes) => edit(cards.map((card, position) => (position === index ? { ...card, ...changes } : card)));
  const pick = (product) => {
    const id = productId(product);
    if (!id) return;
    if (target !== null) {
      if (usedIds.has(id) && cards[target]?.productId !== id) return;
      update(target, { productId: id, product, warning: null });
      setTarget(null);
      return;
    }
    if (full || usedIds.has(id)) return;
    // New cards start from the search that found the product; admins refine the copy.
    edit([...cards, { key: newKey(), title: search.term, searchTerm: search.term, productId: id, product, warning: null }]);
  };
  const chooseProduct = (index) => { setTarget(index); searchInputRef.current?.focus(); };
  const remove = (index) => {
    edit(cards.filter((_, position) => position !== index));
    // The focused Remove button unmounts with its card; keep keyboard users in the list.
    cardsHeadingRef.current?.focus();
    if (target === index) setTarget(null);
    else if (target !== null && target > index) setTarget(target - 1);
  };
  const move = (index, offset) => {
    const destination = index + offset;
    if (destination < 0 || destination >= cards.length) return;
    const next = [...cards];
    [next[index], next[destination]] = [next[destination], next[index]];
    edit(next);
    if (target === index) setTarget(destination);
    else if (target === destination) setTarget(index);
  };
  const discard = () => { setCards(saved.cards); setTarget(null); setStatus(null); };

  const save = async () => {
    if (saving || !canSave || invalid) return;
    setSaving(true);
    setStatus(null);
    try {
      const response = await apiRequest(ENDPOINT, { method: "PUT", headers: authHeader(user), body: { entries: payloadOf(cards), expectedVersion: saved.version } });
      if (response.ok) {
        const next = savedFrom(response.data);
        setSaved(next);
        setCards(next.cards);
        setTarget(null);
        setStatus({ type: "done", text: "Classics saved. The homepage now shows these cards." });
      } else if (response.status === 401) dispatch(logoutUser());
      else if (response.status === 409) {
        setConflict(true);
        setStatus({ type: "error", text: "Someone changed the Classics. Reload before saving." });
      } else if (response.status === 403) setStatus({ type: "error", text: "Your account is not allowed to change the Classics." });
      else if (response.status === 422) {
        const unavailable = new Set(response.data?.unavailable || []);
        setCards((current) => current.map((card) => (unavailable.has(card.productId) ? { ...card, warning: card.warning || "unavailable" } : card)));
        setStatus({ type: "error", text: `${response.data?.error || "One or more products are unavailable"}. Replace the flagged products and save again.` });
      } else {
        const detail = response.data?.fields ? Object.values(response.data.fields).join(" ") : "";
        setStatus({ type: "error", text: [response.data?.error || "The Classics could not be saved.", detail].filter(Boolean).join(": ") });
      }
    } catch {
      setStatus({ type: "error", text: "The Classics could not be saved. Check your connection and try again; your changes are kept." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminGate user={user}>
      <AdminLayout
        className="featured-admin classics-admin"
        eyebrow="Admin / Catalogue"
        title="Manage The Classics"
        description="Choose up to six homepage cards. Each links to a catalogue search and shows a product's cover image. Changes go live only after you save."
        actions={<Link to="/admin/products" className="admin-button">Back to products</Link>}
      >
        {loadState === "loading" && <p className="admin-state" role="status">Loading the Classics…</p>}
        {loadState === "error" && (
          <div className="admin-state is-error" role="alert">
            <p>The Classics could not be loaded.</p>
            <button type="button" className="admin-button" onClick={load}>Try again</button>
          </div>
        )}
        {loadState === "forbidden" && <p className="admin-state is-error" role="alert">Your account is not allowed to manage the Classics.</p>}

        {loadState === "ready" && (
          <div className="featured-admin__layout">
            <section className="admin-panel featured-admin__selection" aria-labelledby="classics-cards-title">
              <div className="featured-admin__panel-heading">
                <h2 id="classics-cards-title" ref={cardsHeadingRef} tabIndex={-1}>Homepage cards</h2>
                <p className="admin-muted"><strong>{cards.length}/{MAX_CLASSICS}</strong> cards used{changed && " · unsaved changes"}</p>
              </div>
              {!saved.configured && <p className="classics-admin__note">These are the built-in Classics. The homepage shows them until you save your own selection.</p>}
              {cards.length === 0 ? (
                <p className="featured-admin__empty">No cards. After saving, the homepage shows a short “New classics are on the way” message in place of the cards.</p>
              ) : (
                <ol className="featured-admin__slots">
                  {cards.map((card, index) => (
                    <ClassicCardEditor
                      key={card.key}
                      card={card}
                      index={index}
                      count={cards.length}
                      choosing={target === index}
                      onChange={(changes) => update(index, changes)}
                      onChooseProduct={() => chooseProduct(index)}
                      onMove={(offset) => move(index, offset)}
                      onRemove={() => remove(index)}
                    />
                  ))}
                </ol>
              )}

              <div className="featured-admin__actions">
                <button type="button" className="admin-button admin-button-dark" onClick={save} disabled={!canSave || invalid || saving || conflict}>{saving ? "Saving…" : "Save changes"}</button>
                <button type="button" className="admin-button" onClick={discard} disabled={!changed || saving}>Discard changes</button>
                {conflict && <button type="button" className="admin-button" onClick={load}>Reload saved selection</button>}
              </div>
              {invalid && <p className="admin-muted">Fix the highlighted cards before saving.</p>}
              <p className={`admin-status ${status?.type === "error" ? "is-error" : status ? "is-done" : ""}`} role={status?.type === "error" ? "alert" : "status"} aria-live="polite">{status?.text || ""}</p>
            </section>

            <section className="admin-panel featured-admin__search" aria-labelledby="classics-search-title">
              <h2 id="classics-search-title">Find products</h2>
              <p className="admin-muted" aria-live="polite">
                {target !== null ? `Choosing a product for card ${target + 1}.` : "Add a product as a new card, or use “Change product” on a card."}
              </p>
              {target !== null && <button type="button" className="admin-link-button" onClick={() => setTarget(null)}>Cancel choosing</button>}
              <form className="featured-admin__search-form" role="search" onSubmit={runSearch}>
                <div className="admin-field">
                  <label htmlFor="classics-product-search">Name or brand</label>
                  <input id="classics-product-search" ref={searchInputRef} type="search" value={query} maxLength="60" onChange={(event) => setQuery(event.target.value)} />
                </div>
                <button type="submit" className="admin-button">Search</button>
              </form>
              {full && target === null && <p className="admin-muted">All six cards are used. Remove a card to add another.</p>}
              {search.state === "invalid" && <p className="admin-error" role="alert">Enter a name or brand to search.</p>}
              {search.state === "loading" && <p role="status">Searching…</p>}
              {search.state === "error" && <div role="alert"><p>Search failed.</p><button type="button" className="admin-button" onClick={runSearch}>Retry search</button></div>}
              {search.state === "ready" && search.results.length === 0 && <p>No published products match “{search.term}”.</p>}
              {search.state === "ready" && search.results.length > 0 && (
                <ul className="featured-admin__results" aria-label="Search results">
                  {search.results.map((product) => {
                    const id = productId(product);
                    const name = productName(product);
                    const usedElsewhere = usedIds.has(id) && (target === null || cards[target]?.productId !== id);
                    const label = target !== null ? `Use for card ${target + 1}` : "Add";
                    return (
                      <li key={id}>
                        <img src={getProductImage(product)} alt="" onError={useFallbackProductImage} />
                        <span><strong>{name}</strong><small>{product.brand}</small></span>
                        <button type="button" className="admin-button" onClick={() => pick(product)} disabled={usedElsewhere || (target === null && full)} aria-label={`${label}: ${name}`}>{usedElsewhere ? "In use" : label}</button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="admin-panel featured-admin__preview" aria-labelledby="classics-preview-title">
              <h2 id="classics-preview-title">Homepage preview</h2>
              {preview.length === 0 ? <p className="admin-muted">The Classics section will show its empty message.</p> : (
                <ol className="featured-admin__preview-grid classics-admin__preview-grid">
                  {preview.map((card) => (
                    <li key={card.key}>
                      <img src={getProductImage(card.product)} alt="" onError={useFallbackProductImage} />
                      <strong>{card.title.trim() || "Untitled card"}</strong>
                      <small className="admin-muted">{storePath(card.searchTerm)}</small>
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

export default AdminClassics;
