import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { logoutUser } from "../../redux/actions/user.action";
import { apiRequest, authHeader } from "../../utils/api";
import { getProductImage, useFallbackProductImage } from "../../utils/product";
import { isAdmin } from "../../utils/admin";
import { AdminGate } from "../AdminOrders/AdminOrders.page";
import "../AdminOrderDetail/admin.styles.css";
import "./adminHeroSlides.styles.css";

const blankForm = (order = 0) => ({ productId: "", headline: "", description: "", desktopImage: "", mobileImage: "", order: String(order), isActive: false });
const formFromSlide = (slide) => ({ productId: slide.productId, headline: slide.headline, description: slide.description || "", desktopImage: slide.desktopImage || "", mobileImage: slide.mobileImage || "", order: String(slide.order), isActive: Boolean(slide.isActive) });

const ProductPreview = ({ product, label }) => product ? <div className="hero-admin-preview"><img src={getProductImage(product)} alt="" onError={useFallbackProductImage} /><div><strong>{label || product.name}</strong><span>{product.inStock === false ? "Out of stock" : "In stock"}</span>{product.id && <Link to={`/details/${product.id}`}>View product</Link>}</div></div> : null;

const AdminHeroSlides = () => {
  const { user } = useSelector((state) => state.userReducer);
  const dispatch = useDispatch();
  const [slides, setSlides] = useState([]);
  const [state, setState] = useState("loading");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(blankForm());
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");

  const activeCount = useMemo(() => slides.filter((slide) => slide.isActive).length, [slides]);
  const load = useCallback(async () => {
    if (!isAdmin(user)) return;
    setState("loading");
    try {
      const response = await apiRequest("/api/admin/hero-slides", { headers: authHeader(user) });
      if (response.ok) { setSlides(response.data.items || []); setState("ready"); }
      else if (response.status === 401) dispatch(logoutUser());
      else setState(response.status === 403 ? "forbidden" : "error");
    } catch { setState("error"); }
  }, [dispatch, user]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!isAdmin(user) || search.trim().length < 2) { setResults([]); return undefined; }
    const controller = new AbortController();
    const findProducts = async () => {
      try {
        const response = await fetch(`/api/products?search=${encodeURIComponent(search.trim())}&limit=10`, { signal: controller.signal });
        const data = response.ok ? await response.json() : { items: [] };
        setResults(Array.isArray(data.items) ? data.items : []);
      } catch (error) { if (error.name !== "AbortError") setResults([]); }
    };
    findProducts();
    return () => controller.abort();
  }, [search, user]);

  const resetForm = () => { setShowForm(false); setEditingId(null); setForm(blankForm(slides.length)); setSelectedProduct(null); setSearch(""); setResults([]); setErrors({}); setMessage(""); };
  const openNew = () => { setEditingId(null); setForm(blankForm(slides.length)); setSelectedProduct(null); setSearch(""); setResults([]); setErrors({}); setMessage(""); setShowForm(true); };
  const openEdit = (slide) => { setEditingId(slide.id); setForm(formFromSlide(slide)); setSelectedProduct(slide.product); setSearch(""); setResults([]); setErrors({}); setMessage(""); setShowForm(true); };
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const chooseProduct = (product) => { setSelectedProduct({ ...product, id: product._id }); update("productId", product._id); setSearch(product.name || product.title || ""); setResults([]); };
  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setErrors({}); setMessage("");
    const body = { ...form, order: Number(form.order) };
    try {
      const response = await apiRequest(editingId ? `/api/admin/hero-slides/${editingId}` : "/api/admin/hero-slides", { method: editingId ? "PATCH" : "POST", headers: authHeader(user), body });
      if (response.ok) { await load(); resetForm(); }
      else if (response.status === 401) dispatch(logoutUser());
      else { setErrors(response.data?.fields || {}); setMessage(response.data?.error || "Hero slide could not be saved."); }
    } catch { setMessage("Hero slide could not be saved. Check your connection and try again."); }
    finally { setSaving(false); }
  };
  const remove = async (slide) => {
    if (!window.confirm(`Delete the slide for ${slide.productName}?`)) return;
    setMessage("");
    try {
      const response = await apiRequest(`/api/admin/hero-slides/${slide.id}`, { method: "DELETE", headers: authHeader(user) });
      if (response.ok) await load();
      else if (response.status === 401) dispatch(logoutUser());
      else setMessage(response.data?.error || "Hero slide could not be deleted.");
    } catch { setMessage("Hero slide could not be deleted."); }
  };

  return <AdminGate user={user}><main className="admin container hero-admin"><header className="admin-header hero-admin__header"><div><p className="admin-eyebrow">Admin / Homepage</p><h1 className="title">Hero slides</h1><p>Publish up to eight catalogue-led homepage features. The CTA is always Shop Now and goes to the selected product.</p></div><button className="admin-button admin-button-dark" type="button" onClick={openNew}>Add slide</button></header><p className="hero-admin__count"><strong>{activeCount}/8</strong> active slides</p>{message && <p className="admin-status is-error" role="alert">{message}</p>}{state === "loading" && <p role="status">Loading hero slides…</p>}{state === "error" && <p role="alert">Hero slides could not be loaded. <button type="button" className="admin-link-button" onClick={load}>Try again</button></p>}{state === "forbidden" && <p role="alert">Your account is not allowed to manage hero slides.</p>}{state === "ready" && <><div className="hero-admin__list">{slides.length === 0 ? <p className="hero-admin__empty">No slides yet. Add a draft to prepare the homepage.</p> : slides.map((slide) => <article className="hero-admin__item" key={slide.id}><img src={slide.desktopImage || getProductImage(slide.product || {})} alt="" onError={useFallbackProductImage} /><div><p className={`admin-badge ${slide.isActive ? "is-confirmed" : ""}`}>{slide.isActive ? "Active" : "Draft"}</p><h2>{slide.productName}</h2><p>{slide.headline}</p><small>Order {slide.order}</small>{slide.productInStock === false && <p className="admin-warning">This product is out of stock. The slide remains visible but customers will see availability on its product page.</p>}</div><div className="hero-admin__actions"><button type="button" className="admin-button" onClick={() => openEdit(slide)}>Edit</button><button type="button" className="admin-link-button" onClick={() => remove(slide)}>Delete</button></div></article>)}</div>{showForm && <form className="hero-admin__form" onSubmit={submit} noValidate><div className="hero-admin__form-heading"><h2>{editingId ? "Edit slide" : "Add slide"}</h2><button type="button" className="admin-link-button" onClick={resetForm}>Cancel</button></div><div className="admin-field"><label htmlFor="hero-product-search">Search catalogue products</label><input id="hero-product-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, brand or category" aria-describedby="hero-product-help"/><span id="hero-product-help" className="admin-muted">Search results come from the existing product catalogue.</span>{results.length > 0 && <ul className="hero-admin__search-results">{results.map((product) => <li key={product._id}><button type="button" onClick={() => chooseProduct(product)}><img src={getProductImage(product)} alt="" onError={useFallbackProductImage} /><span>{product.name || product.title}</span></button></li>)}</ul>}{errors.productId && <span className="admin-error">{errors.productId}</span>}</div><ProductPreview product={selectedProduct} label="Selected product"/><div className="admin-field"><label htmlFor="hero-headline">Headline</label><input id="hero-headline" value={form.headline} maxLength="90" onChange={(event) => update("headline", event.target.value)} required/>{errors.headline && <span className="admin-error">{errors.headline}</span>}</div><div className="admin-field"><label htmlFor="hero-description">Description <span className="admin-muted">optional</span></label><textarea id="hero-description" value={form.description} maxLength="180" onChange={(event) => update("description", event.target.value)} />{errors.description && <span className="admin-error">{errors.description}</span>}</div><div className="hero-admin__image-fields"><div className="admin-field"><label htmlFor="hero-desktop-image">Desktop image URL/path <span className="admin-muted">optional</span></label><input id="hero-desktop-image" value={form.desktopImage} maxLength="2048" onChange={(event) => update("desktopImage", event.target.value)} placeholder="https://… or /images/…"/>{errors.desktopImage && <span className="admin-error">{errors.desktopImage}</span>}</div><div className="admin-field"><label htmlFor="hero-mobile-image">Mobile image URL/path <span className="admin-muted">optional</span></label><input id="hero-mobile-image" value={form.mobileImage} maxLength="2048" onChange={(event) => update("mobileImage", event.target.value)} placeholder="Falls back to desktop image"/>{errors.mobileImage && <span className="admin-error">{errors.mobileImage}</span>}</div></div><div className="hero-admin__creative-previews"><ProductPreview product={form.desktopImage ? { image: form.desktopImage, name: "Desktop creative" } : selectedProduct} label="Desktop hero crop"/><ProductPreview product={form.mobileImage ? { image: form.mobileImage, name: "Mobile creative" } : (form.desktopImage ? { image: form.desktopImage, name: "Mobile uses desktop creative" } : selectedProduct)} label="Mobile hero crop"/></div><p className="admin-muted">No upload or crop tool is included. If no custom image is supplied, the product catalogue image is used. A preview does not guarantee an external URL remains available.</p><div className="hero-admin__settings"><div className="admin-field"><label htmlFor="hero-order">Order</label><input id="hero-order" type="number" min="0" max="999" value={form.order} onChange={(event) => update("order", event.target.value)} required/>{errors.order && <span className="admin-error">{errors.order}</span>}</div><label className="admin-field is-checkbox"><input type="checkbox" checked={form.isActive} onChange={(event) => update("isActive", event.target.checked)} /><span>Publish this slide</span>{errors.isActive && <span className="admin-error">{errors.isActive}</span>}</label></div><button type="submit" className="admin-button admin-button-dark" disabled={saving}>{saving ? "Saving…" : editingId ? "Save slide" : "Create slide"}</button></form>}</>}</main></AdminGate>;
};

export default AdminHeroSlides;
