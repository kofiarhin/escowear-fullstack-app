import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { logoutUser } from "../../redux/actions/user.action";
import { apiRequest, authHeader } from "../../utils/api";
import { getProductImage, useFallbackProductImage } from "../../utils/product";
import { isAdmin } from "../../utils/admin";
import { AdminGate } from "../AdminOrders/AdminOrders.page";
import AdminLayout from "../../components/AdminLayout/AdminLayout.component";
import { heroVideoPosterUrl } from "../../components/HeroCarousel/heroMedia";
import "../AdminOrderDetail/admin.styles.css";
import "./adminHeroSlides.styles.css";

const blankForm = (order = 0) => ({ productId: "", headline: "", description: "", desktopImage: "", mobileImage: "", desktopVideo: "", mobileVideo: "", posterImage: "", order: String(order), isActive: false });
const formFromSlide = (slide) => ({ productId: slide.productId, headline: slide.headline, description: slide.description || "", desktopImage: slide.desktopImage || "", mobileImage: slide.mobileImage || "", desktopVideo: slide.desktopVideo || "", mobileVideo: slide.mobileVideo || "", posterImage: slide.posterImage || "", order: String(slide.order), isActive: Boolean(slide.isActive) });
const productIdentifier = (product) => {
  const value = product?._id ?? product?.id;
  return value == null ? "" : String(value);
};

// Matches the server's MAX_TOTAL_SLIDES; the API enforces it as well.
const MAX_SLIDES = 8;
const LEGACY_IMAGE_FIELDS = ["desktopImage", "mobileImage"];

const ProductPreview = ({ product, label }) => product ? <div className="hero-admin-preview"><img src={getProductImage(product)} alt="" onError={useFallbackProductImage} /><div><strong>{label || product.name}</strong><span>{product.inStock === false ? "Out of stock" : "In stock"}</span>{product.id && <Link to={`/details/${product.id}`}>View product</Link>}</div></div> : null;

const slideThumbnail = (slide) => slide.posterImage || heroVideoPosterUrl(slide.desktopVideo) || slide.desktopImage || getProductImage(slide.product || {});

const SlideItem = ({ slide, canMoveUp, canMoveDown, reordering, onMove, onEdit, onDelete }) => <article className="hero-admin__item">
  <div className="hero-admin__thumb">
    <img src={slideThumbnail(slide)} alt="" onError={useFallbackProductImage} />
    {slide.desktopVideo && <span className="hero-admin__play" aria-hidden="true">▶</span>}
  </div>
  <div>
    <p className={`admin-badge ${slide.isActive ? "is-confirmed" : ""}`}>{slide.isActive ? "Active" : "Draft"}</p>
    <p className="admin-badge hero-admin__type-badge">{slide.desktopVideo ? "Video" : "Image"}</p>
    <h2>{slide.productName}</h2>
    <p>{slide.headline}</p>
    <small>Order {slide.order}</small>
    {!slide.desktopVideo && <p className="admin-warning">No video yet. The homepage shows the legacy image for this slide until a video is added.</p>}
    {slide.productInStock === false && <p className="admin-warning">This product is out of stock. The slide remains visible but customers will see availability on its product page.</p>}
  </div>
  <div className="hero-admin__actions">
    <button type="button" className="admin-button" onClick={onEdit}>Edit</button>
    <button type="button" className="admin-link-button" onClick={() => onMove(-1)} disabled={!canMoveUp || reordering} aria-label={`Move ${slide.productName} up`}>Move up</button>
    <button type="button" className="admin-link-button" onClick={() => onMove(1)} disabled={!canMoveDown || reordering} aria-label={`Move ${slide.productName} down`}>Move down</button>
    <button type="button" className="admin-link-button" onClick={onDelete}>Delete</button>
  </div>
</article>;

const AdminHeroSlides = () => {
  const { user } = useSelector((state) => state.userReducer);
  const dispatch = useDispatch();
  const [slides, setSlides] = useState([]);
  const [state, setState] = useState("loading");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(blankForm());
  const [initialForm, setInitialForm] = useState(blankForm());
  const [reordering, setReordering] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [searchState, setSearchState] = useState("idle");
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");

  const activeCount = useMemo(() => slides.filter((slide) => slide.isActive).length, [slides]);
  const atLimit = slides.length >= MAX_SLIDES;
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
  const openNew = () => { if (atLimit) return; setEditingId(null); setForm(blankForm(slides.length)); setInitialForm(blankForm(slides.length)); setSelectedProduct(null); setSearch(""); setResults([]); setErrors({}); setMessage(""); setShowForm(true); };
  const openEdit = (slide) => { setEditingId(slide.id); setForm(formFromSlide(slide)); setInitialForm(formFromSlide(slide)); setSelectedProduct(slide.product); setSearch(""); setResults([]); setErrors({}); setMessage(""); setShowForm(true); };
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
    // Existing image-only slides stay editable; a video is required to create
    // a slide or to publish a draft.
    const needsVideo = !editingId || (form.isActive && !initialForm.isActive);
    if (needsVideo && !form.desktopVideo.trim()) {
      setErrors({ desktopVideo: editingId ? "Add a desktop video URL before publishing" : "Add a desktop video URL to create a hero slide" });
      setMessage("Hero video could not be saved.");
      return;
    }
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
    // The admin API returns resolved images (product image fallback), so an
    // untouched legacy field is omitted rather than written back.
    if (editingId) LEGACY_IMAGE_FIELDS.forEach((key) => { if (form[key] === initialForm[key]) delete body[key]; });
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
  // Swap two neighbours, then renumber the list 0..n-1 so duplicate or sparse
  // order values cannot make the move a no-op.
  const move = async (index, delta) => {
    const target = index + delta;
    if (reordering || target < 0 || target >= slides.length) return;
    const reordered = [...slides];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const changes = reordered.map((slide, order) => ({ slide, order })).filter(({ slide, order }) => slide.order !== order);
    setReordering(true); setMessage("");
    try {
      for (const { slide, order } of changes) {
        const response = await apiRequest(`/api/admin/hero-slides/${slide.id}`, { method: "PATCH", headers: authHeader(user), body: { order } });
        if (response.status === 401) { dispatch(logoutUser()); return; }
        if (!response.ok) { setMessage(response.data?.error || "Hero slides could not be reordered."); break; }
      }
    } catch { setMessage("Hero slides could not be reordered. Check your connection and try again."); }
    finally { setReordering(false); }
    await load();
  };

  const addDisabled = atLimit || reordering;
  const field = (id, key, label, props = {}) => <div className="admin-field"><label htmlFor={id}>{label}</label><input id={id} value={form[key]} maxLength="2048" onChange={(event) => update(key, event.target.value)} {...props}/>{errors[key] && <span className="admin-error">{errors[key]}</span>}</div>;

  return <AdminGate user={user}><AdminLayout className="hero-admin" eyebrow="Admin / Homepage" title="Hero videos" description="Publish up to eight homepage hero videos. Each plays muted behind its headline, and Shop Now goes to the selected product." actions={<button className="admin-button admin-button-dark" type="button" onClick={openNew} disabled={addDisabled}>Add slide</button>}>
    <p className="hero-admin__count"><strong>{`${slides.length}/${MAX_SLIDES}`}</strong> slides <span className="admin-muted">· {activeCount} published</span></p>
    {atLimit && <p className="admin-muted" role="status">The limit is eight hero slides. Delete one to add another.</p>}
    {message && <p className="admin-status is-error" role="alert">{message}</p>}
    {state === "loading" && <p className="admin-state" role="status">Loading hero videos…</p>}
    {state === "error" && <div className="admin-state is-error" role="alert"><p>Hero videos could not be loaded.</p><button type="button" className="admin-button" onClick={load}>Try again</button></div>}
    {state === "forbidden" && <p className="admin-state is-error" role="alert">Your account is not allowed to manage hero videos.</p>}
    {state === "ready" && <>
      <div className="hero-admin__list">{slides.length === 0
        ? <div className="admin-state is-empty"><strong>No hero videos yet</strong><p className="admin-muted">Add a video slide as a draft to prepare the homepage.</p><button className="admin-button" type="button" onClick={openNew} disabled={addDisabled}>Add the first slide</button></div>
        : slides.map((slide, index) => <SlideItem key={slide.id} slide={slide} canMoveUp={index > 0} canMoveDown={index < slides.length - 1} reordering={reordering} onMove={(delta) => move(index, delta)} onEdit={() => openEdit(slide)} onDelete={() => remove(slide)} />)}
      </div>
      {showForm && <form className="hero-admin__form" onSubmit={submit} noValidate>
        <div className="hero-admin__form-heading"><h2>{editingId ? "Edit hero video" : "Add hero video"}</h2><button type="button" className="admin-link-button" onClick={resetForm}>Cancel</button></div>
        <div className="hero-admin__video-fields">
          <h3>Video</h3>
          {field("hero-desktop-video", "desktopVideo", <>Desktop video URL <span className="admin-muted">required to create or publish</span></>, { placeholder: "https://res.cloudinary.com/…/video/upload/….mp4", "aria-describedby": "hero-desktop-video-help" })}
          <span id="hero-desktop-video-help" className="admin-muted">Use a Cloudinary delivery URL ending in .mp4 or .webm. Do not use player.cloudinary.com/embed links. Target optimised videos under 15 MB.</span>
          {field("hero-mobile-video", "mobileVideo", <>Mobile video URL <span className="admin-muted">optional, falls back to desktop video</span></>, { placeholder: "Falls back to desktop video" })}
          {field("hero-poster-image", "posterImage", <>Poster image URL <span className="admin-muted">optional, auto-derived from Cloudinary video</span></>, { placeholder: "Shown while the video loads" })}
          {form.desktopVideo && <div className="hero-admin__video-preview"><video src={form.desktopVideo} poster={form.posterImage || undefined} muted playsInline controls onError={(event) => { event.currentTarget.style.display = "none"; }} /><span className="admin-muted">Video preview (desktop)</span></div>}
        </div>
        <div className="admin-field"><label htmlFor="hero-headline">Headline</label><input id="hero-headline" value={form.headline} maxLength="90" onChange={(event) => update("headline", event.target.value)} required/>{errors.headline && <span className="admin-error">{errors.headline}</span>}</div>
        <div className="admin-field"><label htmlFor="hero-description">Description <span className="admin-muted">optional</span></label><textarea id="hero-description" value={form.description} maxLength="180" onChange={(event) => update("description", event.target.value)} />{errors.description && <span className="admin-error">{errors.description}</span>}</div>
        <div className="admin-field"><label htmlFor="hero-product-search">Search catalogue products</label><input id="hero-product-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, brand or category" aria-describedby="hero-product-help"/><span id="hero-product-help" className="admin-muted">Shop Now links to this product.</span>{searchState === "loading" && <p role="status">Searching products…</p>}{searchState === "error" && <div role="alert"><p>Products could not be found. Try again.</p><button type="button" className="admin-button" onClick={() => setSearchAttempt((attempt) => attempt + 1)}>Retry search</button></div>}{searchState === "ready" && results.length === 0 && <p role="status">No products match. Try another name or brand.</p>}{results.length > 0 && <ul className="hero-admin__search-results">{results.map((product) => <li key={product._id}><button type="button" onClick={() => chooseProduct(product)}><img src={getProductImage(product)} alt="" onError={useFallbackProductImage} /><span>{product.name || product.title}</span></button></li>)}</ul>}{errors.productId && <span className="admin-error">{errors.productId}</span>}</div>
        <ProductPreview product={selectedProduct} label="Selected product"/>
        <div className="hero-admin__settings"><div className="admin-field"><label htmlFor="hero-order">Order</label><input id="hero-order" type="number" min="0" max="999" value={form.order} onChange={(event) => update("order", event.target.value)} required/>{errors.order && <span className="admin-error">{errors.order}</span>}</div><label className="admin-field is-checkbox"><input type="checkbox" checked={form.isActive} onChange={(event) => update("isActive", event.target.checked)} /><span>Publish this slide</span>{errors.isActive && <span className="admin-error">{errors.isActive}</span>}</label></div>
        <details className="hero-admin__legacy" open={Boolean(errors.desktopImage || errors.mobileImage)}>
          <summary>Legacy image fallback (optional)</summary>
          <p className="admin-muted">Only used when a slide has no video. Existing values are kept unless you change them here.</p>
          <div className="hero-admin__image-fields">
            {field("hero-desktop-image", "desktopImage", <>Desktop image URL/path <span className="admin-muted">optional</span></>, { placeholder: "https://… or /images/…" })}
            {field("hero-mobile-image", "mobileImage", <>Mobile image URL/path <span className="admin-muted">optional</span></>, { placeholder: "Falls back to desktop image" })}
          </div>
        </details>
        <button type="submit" className="admin-button admin-button-dark" disabled={saving}>{saving ? "Saving…" : editingId ? "Save slide" : "Create slide"}</button>
      </form>}
    </>}
  </AdminLayout></AdminGate>;
};

export default AdminHeroSlides;
