import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { logoutUser } from "../../redux/actions/user.action";
import { apiRequest, authHeader } from "../../utils/api";
import { getProductImage, useFallbackProductImage } from "../../utils/product";
import { isAdmin } from "../../utils/admin";
import { AdminGate } from "../AdminOrders/AdminOrders.page";
import AdminLayout from "../../components/AdminLayout/AdminLayout.component";
import "../AdminOrderDetail/admin.styles.css";
import "./adminHeroSlides.styles.css";

const blankForm = (order = 0) => ({ productId: "", headline: "", description: "", desktopImage: "", mobileImage: "", desktopVideo: "", mobileVideo: "", posterImage: "", order: String(order), isActive: false });
const formFromSlide = (slide) => ({ productId: slide.productId, headline: slide.headline, description: slide.description || "", desktopImage: slide.desktopImage || "", mobileImage: slide.mobileImage || "", desktopVideo: slide.desktopVideo || "", mobileVideo: slide.mobileVideo || "", posterImage: slide.posterImage || "", order: String(slide.order), isActive: Boolean(slide.isActive) });
const productIdentifier = (product) => {
  const value = product?._id ?? product?.id;
  return value == null ? "" : String(value);
};

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
  const [searchState, setSearchState] = useState("idle");
  const [searchAttempt, setSearchAttempt] = useState(0);
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
    if (!isAdmin(user) || search.trim().length < 2) { setResults([]); setSearchState("idle"); return undefined; }
    const controller = new AbortController();
    const findProducts = async () => {
      setSearchState("loading");
      setResults([]);
      try {
        const response = await fetch(`/api/products?search=${encodeURIComponent(search.trim())}&limit=10`, { signal: controller.signal });
        if (!response.ok) throw new Error("Product search failed");
        const data = await response.json();
        if (controller.signal.aborted) return;
        setResults(Array.isArray(data.items) ? data.items : []);
        setSearchState("ready");
      } catch (error) { if (error.name !== "AbortError") setSearchState("error"); }
    };
    findProducts();
    return () => controller.abort();
  }, [search, searchAttempt, user]);

  const resetForm = () => { setShowForm(false); setEditingId(null); setForm(blankForm(slides.length)); setSelectedProduct(null); setSearch(""); setResults([]); setErrors({}); setMessage(""); };
  const openNew = () => { setEditingId(null); setForm(blankForm(slides.length)); setSelectedProduct(null); setSearch(""); setResults([]); setErrors({}); setMessage(""); setShowForm(true); };
  const openEdit = (slide) => { setEditingId(slide.id); setForm(formFromSlide(slide)); setSelectedProduct(slide.product); setSearch(""); setResults([]); setErrors({}); setMessage(""); setShowForm(true); };
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const chooseProduct = (product) => {
    const id = productIdentifier(product);
    if (!id) return;
    setSelectedProduct({ ...product, id });
    update("productId", id);
    setSearch(product.name || product.title || "");
    setResults([]);
  };
  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setErrors({}); setMessage("");
    const body = {
      ...form,
      productId: productIdentifier(selectedProduct) || form.productId,
      headline: form.headline.trim(),
      description: form.description.trim(),
      desktopImage: form.desktopImage.trim(),
      mobileImage: form.mobileImage.trim(),
      desktopVideo: form.desktopVideo.trim(),
      mobileVideo: form.mobileVideo.trim(),
      posterImage: form.posterImage.trim(),
      order: Number(form.order),
      isActive: Boolean(form.isActive),
    };
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

  return <AdminGate user={user}><AdminLayout className="hero-admin" eyebrow="Admin / Homepage" title="Hero slides" description="Publish up to eight catalogue-led homepage features. The CTA is always Shop Now and goes to the selected product." actions={<button className="admin-button admin-button-dark" type="button" onClick={openNew}>Add slide</button>}><p className="hero-admin__count"><strong>{activeCount}/8</strong> active slides</p>{message && <p className="admin-status is-error" role="alert">{message}</p>}{state === "loading" && <p className="admin-state" role="status">Loading hero slides…</p>}{state === "error" && <div className="admin-state is-error" role="alert"><p>Hero slides could not be loaded.</p><button type="button" className="admin-button" onClick={load}>Try again</button></div>}{state === "forbidden" && <p className="admin-state is-error" role="alert">Your account is not allowed to manage hero slides.</p>}{state === "ready" && <><div className="hero-admin__list">{slides.length === 0 ? <div className="admin-state is-empty"><strong>No slides yet</strong><p className="admin-muted">Add a draft to prepare the homepage.</p><button className="admin-button" type="button" onClick={openNew}>Add the first slide</button></div> : slides.map((slide) => <article className="hero-admin__item" key={slide.id}><img src={slide.desktopImage || getProductImage(slide.product || {})} alt="" onError={useFallbackProductImage} /><div><p className={`admin-badge ${slide.isActive ? "is-confirmed" : ""}`}>{slide.isActive ? "Active" : "Draft"}</p><p className="admin-badge hero-admin__type-badge">{slide.desktopVideo ? "Video" : "Image"}</p><h2>{slide.productName}</h2><p>{slide.headline}</p><small>Order {slide.order}</small>{slide.productInStock === false && <p className="admin-warning">This product is out of stock. The slide remains visible but customers will see availability on its product page.</p>}</div><div className="hero-admin__actions"><button type="button" className="admin-button" onClick={() => openEdit(slide)}>Edit</button><button type="button" className="admin-link-button" onClick={() => remove(slide)}>Delete</button></div></article>)}</div>{showForm && <form className="hero-admin__form" onSubmit={submit} noValidate><div className="hero-admin__form-heading"><h2>{editingId ? "Edit slide" : "Add slide"}</h2><button type="button" className="admin-link-button" onClick={resetForm}>Cancel</button></div><div className="admin-field"><label htmlFor="hero-product-search">Search catalogue products</label><input id="hero-product-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, brand or category" aria-describedby="hero-product-help"/><span id="hero-product-help" className="admin-muted">Search results come from the existing product catalogue.</span>{searchState === "loading" && <p role="status">Searching products…</p>}{searchState === "error" && <div role="alert"><p>Products could not be found. Try again.</p><button type="button" className="admin-button" onClick={() => setSearchAttempt((attempt) => attempt + 1)}>Retry search</button></div>}{searchState === "ready" && results.length === 0 && <p role="status">No products match. Try another name or brand.</p>}{results.length > 0 && <ul className="hero-admin__search-results">{results.map((product) => <li key={product._id}><button type="button" onClick={() => chooseProduct(product)}><img src={getProductImage(product)} alt="" onError={useFallbackProductImage} /><span>{product.name || product.title}</span></button></li>)}</ul>}{errors.productId && <span className="admin-error">{errors.productId}</span>}</div><ProductPreview product={selectedProduct} label="Selected product"/><div className="admin-field"><label htmlFor="hero-headline">Headline</label><input id="hero-headline" value={form.headline} maxLength="90" onChange={(event) => update("headline", event.target.value)} required/>{errors.headline && <span className="admin-error">{errors.headline}</span>}</div><div className="admin-field"><label htmlFor="hero-description">Description <span className="admin-muted">optional</span></label><textarea id="hero-description" value={form.description} maxLength="180" onChange={(event) => update("description", event.target.value)} />{errors.description && <span className="admin-error">{errors.description}</span>}</div><div className="hero-admin__image-fields"><div className="admin-field"><label htmlFor="hero-desktop-image">Desktop image URL/path <span className="admin-muted">optional</span></label><input id="hero-desktop-image" value={form.desktopImage} maxLength="2048" onChange={(event) => update("desktopImage", event.target.value)} placeholder="https://… or /images/…"/>{errors.desktopImage && <span className="admin-error">{errors.desktopImage}</span>}</div><div className="admin-field"><label htmlFor="hero-mobile-image">Mobile image URL/path <span className="admin-muted">optional</span></label><input id="hero-mobile-image" value={form.mobileImage} maxLength="2048" onChange={(event) => update("mobileImage", event.target.value)} placeholder="Falls back to desktop image"/>{errors.mobileImage && <span className="admin-error">{errors.mobileImage}</span>}</div></div><div className="hero-admin__creative-previews"><ProductPreview product={form.desktopImage ? { image: form.desktopImage, name: "Desktop creative" } : selectedProduct} label="Desktop hero crop"/><ProductPreview product={form.mobileImage ? { image: form.mobileImage, name: "Mobile creative" } : (form.desktopImage ? { image: form.desktopImage, name: "Mobile uses desktop creative" } : selectedProduct)} label="Mobile hero crop"/></div><p className="admin-muted">No upload or crop tool is included. If no custom image is supplied, the product catalogue image is used. A preview does not guarantee an external URL remains available.</p><div className="hero-admin__video-fields"><h3>Video slide <span className="admin-muted">optional — adds video behind the text overlay</span></h3><div className="admin-field"><label htmlFor="hero-desktop-video">Desktop video URL</label><input id="hero-desktop-video" value={form.desktopVideo} maxLength="2048" onChange={(event) => update("desktopVideo", event.target.value)} placeholder="https://res.cloudinary.com/…/video/upload/….mp4"/><span className="admin-muted">Use a Cloudinary delivery URL ending in .mp4 or .webm. Do not use player.cloudinary.com/embed links.</span>{errors.desktopVideo && <span className="admin-error">{errors.desktopVideo}</span>}</div><div className="admin-field"><label htmlFor="hero-mobile-video">Mobile video URL <span className="admin-muted">optional, falls back to desktop video</span></label><input id="hero-mobile-video" value={form.mobileVideo} maxLength="2048" onChange={(event) => update("mobileVideo", event.target.value)} placeholder="Falls back to desktop video"/>{errors.mobileVideo && <span className="admin-error">{errors.mobileVideo}</span>}</div><div className="admin-field"><label htmlFor="hero-poster-image">Poster image URL <span className="admin-muted">optional, auto-derived from Cloudinary video</span></label><input id="hero-poster-image" value={form.posterImage} maxLength="2048" onChange={(event) => update("posterImage", event.target.value)} placeholder="Falls back to desktop image or video first frame"/>{errors.posterImage && <span className="admin-error">{errors.posterImage}</span>}</div>{form.desktopVideo && <div className="hero-admin__video-preview"><video src={form.desktopVideo} muted playsInline controls onError={(event) => { event.currentTarget.style.display = "none"; }} /><span className="admin-muted">Video preview (desktop)</span></div>}<p className="admin-muted">Video slides should have a poster image for immediate display while the video loads. Target optimized videos under 15 MB where practical.</p></div><div className="hero-admin__settings"><div className="admin-field"><label htmlFor="hero-order">Order</label><input id="hero-order" type="number" min="0" max="999" value={form.order} onChange={(event) => update("order", event.target.value)} required/>{errors.order && <span className="admin-error">{errors.order}</span>}</div><label className="admin-field is-checkbox"><input type="checkbox" checked={form.isActive} onChange={(event) => update("isActive", event.target.checked)} /><span>Publish this slide</span>{errors.isActive && <span className="admin-error">{errors.isActive}</span>}</label></div><button type="submit" className="admin-button admin-button-dark" disabled={saving}>{saving ? "Saving…" : editingId ? "Save slide" : "Create slide"}</button></form>}</>}</AdminLayout></AdminGate>;
};

export default AdminHeroSlides;
