import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { applyMiddleware, createStore } from "redux";
import thunkMiddleware from "redux-thunk";
import App from "../../App";
import reducers from "../../redux/reducers";

const product = { _id: "672b0e3a1a2b3c4d5e6f7002", name: "Nike Air Max Dn8", image: "https://example.test/dn8.jpg", inStock: true };
const VIDEO = "https://res.cloudinary.com/demo/video/upload/hero.mp4";
const listSlide = (index, overrides = {}) => ({
  id: `slide-${index}`, productId: `672b0e3a1a2b3c4d5e6f71${String(index).padStart(2, "0")}`, productName: `Pair ${index}`, headline: `HEADLINE ${index}`,
  description: "", desktopImage: "", mobileImage: "", desktopVideo: VIDEO, mobileVideo: "", posterImage: "", order: index, isActive: false,
  product: { id: `672b0e3a1a2b3c4d5e6f71${String(index).padStart(2, "0")}`, name: `Pair ${index}`, image: product.image, inStock: true },
  ...overrides,
});
const renderAdmin = () => {
  const store = createStore(reducers, applyMiddleware(thunkMiddleware));
  store.dispatch({ type: "LOGIN_SUCCESS", payload: { name: "Admin User", role: "admin", token: "test-token" } });
  return render(<Provider store={store}><App /></Provider>);
};

beforeEach(() => {
  localStorage.setItem("user", JSON.stringify({ name: "Admin User", role: "admin", token: "test-token" }));
  window.history.pushState({}, "", "/admin/hero-slides");
  global.fetch = jest.fn().mockImplementation((path, options = {}) => {
    if (path === "/api/admin/hero-slides" && options.method === "POST") {
      return Promise.resolve({ ok: false, status: 400, json: async () => ({ error: "Invalid hero slide", fields: { headline: "Use plain text between 1 and 90 characters" } }) });
    }
    if (path === "/api/admin/hero-slides") return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: [] }) });
    if (String(path).startsWith("/api/products?search=")) return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: [product] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
});

afterEach(() => { localStorage.clear(); jest.restoreAllMocks(); });

test("admin can select a catalogue product and keeps form inputs after a server validation error", async () => {
  const store = createStore(reducers, applyMiddleware(thunkMiddleware));
  store.dispatch({ type: "LOGIN_SUCCESS", payload: { name: "Admin User", role: "admin", token: "test-token" } });
  render(<Provider store={store}><App /></Provider>);
  await screen.findByText(/no hero videos yet/i);
  await userEvent.click(screen.getByRole("button", { name: /add slide/i }));
  fireEvent.change(screen.getByLabelText(/search catalogue products/i), { target: { value: "nike" } });
  await userEvent.click(await screen.findByRole("button", { name: /nike air max dn8/i }));
  await userEvent.type(screen.getByLabelText("Headline"), "A headline that remains visible");
  fireEvent.change(screen.getByLabelText(/desktop video url/i), { target: { value: VIDEO } });
  await userEvent.click(screen.getByRole("button", { name: /create slide/i }));
  expect(await screen.findByText(/use plain text between 1 and 90 characters/i)).toBeInTheDocument();
  expect(screen.getByLabelText("Headline")).toHaveValue("A headline that remains visible");
  expect(screen.getByText("Selected product")).toBeInTheDocument();
});

test("admin create sends the selected product id and can publish the slide", async () => {
  let submitted;
  global.fetch.mockImplementation((path, options = {}) => {
    if (path === "/api/admin/hero-slides" && options.method === "POST") {
      submitted = JSON.parse(options.body);
      return Promise.resolve({ ok: true, status: 201, json: async () => ({ item: { id: "slide-1", productId: product._id, productName: product.name, headline: submitted.headline, order: submitted.order, isActive: submitted.isActive } }) });
    }
    if (path === "/api/admin/hero-slides") return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: [] }) });
    if (String(path).startsWith("/api/products?search=")) return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: [{ id: product._id, name: product.name, image: product.image, inStock: true }] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });

  const store = createStore(reducers, applyMiddleware(thunkMiddleware));
  store.dispatch({ type: "LOGIN_SUCCESS", payload: { name: "Admin User", role: "admin", token: "test-token" } });
  render(<Provider store={store}><App /></Provider>);
  await screen.findByText(/no hero videos yet/i);
  await userEvent.click(screen.getByRole("button", { name: /add slide/i }));
  fireEvent.change(screen.getByLabelText(/search catalogue products/i), { target: { value: "nike" } });
  await userEvent.click(await screen.findByRole("button", { name: /nike air max dn8/i }));
  await userEvent.type(screen.getByLabelText("Headline"), "New season, ready to move");
  fireEvent.change(screen.getByLabelText(/desktop video url/i), { target: { value: VIDEO } });
  await userEvent.click(screen.getByLabelText(/publish this slide/i));
  await userEvent.click(screen.getByRole("button", { name: /create slide/i }));

  expect(submitted).toMatchObject({ productId: product._id, headline: "New season, ready to move", desktopVideo: VIDEO, order: 0, isActive: true });
  expect(screen.queryByRole("button", { name: /create slide/i })).not.toBeInTheDocument();
});

test("form includes video and poster fields that submit correctly", async () => {
  let submitted;
  global.fetch.mockImplementation((path, options = {}) => {
    if (path === "/api/admin/hero-slides" && options.method === "POST") {
      submitted = JSON.parse(options.body);
      return Promise.resolve({ ok: true, status: 201, json: async () => ({ item: { id: "slide-v", productId: product._id, productName: product.name, headline: submitted.headline, desktopVideo: submitted.desktopVideo, mobileVideo: submitted.mobileVideo, posterImage: submitted.posterImage, order: submitted.order, isActive: false } }) });
    }
    if (path === "/api/admin/hero-slides") return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: [] }) });
    if (String(path).startsWith("/api/products?search=")) return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: [{ id: product._id, name: product.name, image: product.image, inStock: true }] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });

  const store = createStore(reducers, applyMiddleware(thunkMiddleware));
  store.dispatch({ type: "LOGIN_SUCCESS", payload: { name: "Admin User", role: "admin", token: "test-token" } });
  render(<Provider store={store}><App /></Provider>);
  await screen.findByText(/no hero videos yet/i);
  await userEvent.click(screen.getByRole("button", { name: /add slide/i }));

  // Verify video fields exist
  expect(screen.getByLabelText(/desktop video url/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/mobile video url/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/poster image url/i)).toBeInTheDocument();

  // Fill form including video fields
  fireEvent.change(screen.getByLabelText(/search catalogue products/i), { target: { value: "nike" } });
  await userEvent.click(await screen.findByRole("button", { name: /nike air max dn8/i }));
  await userEvent.type(screen.getByLabelText("Headline"), "Video hero");
  fireEvent.change(screen.getByLabelText(/desktop video url/i), { target: { value: "https://res.cloudinary.com/dlsiabgiw/video/upload/hero-video-1_kcv6pl.mp4" } });
  fireEvent.change(screen.getByLabelText(/poster image url/i), { target: { value: "https://res.cloudinary.com/dlsiabgiw/video/upload/so_0/hero-video-1_kcv6pl.jpg" } });
  await userEvent.click(screen.getByRole("button", { name: /create slide/i }));

  expect(submitted).toMatchObject({
    desktopVideo: "https://res.cloudinary.com/dlsiabgiw/video/upload/hero-video-1_kcv6pl.mp4",
    posterImage: "https://res.cloudinary.com/dlsiabgiw/video/upload/so_0/hero-video-1_kcv6pl.jpg",
  });
});

test("slide list shows Video badge for video slides and Image badge for image slides", async () => {
  const videoSlide = {
    id: "slide-v1", productId: product._id, productName: product.name, headline: "VIDEO",
    desktopImage: "", mobileImage: "", desktopVideo: "https://res.cloudinary.com/dlsiabgiw/video/upload/v.mp4",
    mobileVideo: "", posterImage: "", order: 0, isActive: true,
    product: { id: product._id, name: product.name, image: product.image, inStock: true },
  };
  const imageSlide = {
    id: "slide-i1", productId: "672b0e3a1a2b3c4d5e6f7003", productName: "Other Shoe", headline: "IMAGE",
    desktopImage: "https://example.test/shoe.jpg", mobileImage: "", desktopVideo: "",
    mobileVideo: "", posterImage: "", order: 1, isActive: false,
    product: { id: "672b0e3a1a2b3c4d5e6f7003", name: "Other Shoe", image: "https://example.test/shoe.jpg", inStock: true },
  };

  global.fetch.mockImplementation((path) => {
    if (path === "/api/admin/hero-slides") return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: [videoSlide, imageSlide] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });

  const store = createStore(reducers, applyMiddleware(thunkMiddleware));
  store.dispatch({ type: "LOGIN_SUCCESS", payload: { name: "Admin User", role: "admin", token: "test-token" } });
  render(<Provider store={store}><App /></Provider>);
  await screen.findByText("VIDEO");
  expect(screen.getByText("Video")).toBeInTheDocument();
  expect(screen.getByText("Image")).toBeInTheDocument();
});

test("edit pre-fills video fields from existing slide", async () => {
  const existingSlide = {
    id: "slide-v2", productId: product._id, productName: product.name, headline: "EXISTING VIDEO",
    desktopImage: "", mobileImage: "", desktopVideo: "https://res.cloudinary.com/dlsiabgiw/video/upload/test.mp4",
    mobileVideo: "https://res.cloudinary.com/dlsiabgiw/video/upload/test-m.mp4",
    posterImage: "https://res.cloudinary.com/dlsiabgiw/video/upload/so_0/test.jpg",
    order: 0, isActive: true,
    product: { id: product._id, name: product.name, image: product.image, inStock: true },
  };

  global.fetch.mockImplementation((path) => {
    if (path === "/api/admin/hero-slides") return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: [existingSlide] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });

  const store = createStore(reducers, applyMiddleware(thunkMiddleware));
  store.dispatch({ type: "LOGIN_SUCCESS", payload: { name: "Admin User", role: "admin", token: "test-token" } });
  render(<Provider store={store}><App /></Provider>);
  await screen.findByText("EXISTING VIDEO");
  await userEvent.click(screen.getByRole("button", { name: /edit/i }));

  expect(screen.getByLabelText(/desktop video url/i)).toHaveValue("https://res.cloudinary.com/dlsiabgiw/video/upload/test.mp4");
  expect(screen.getByLabelText(/mobile video url/i)).toHaveValue("https://res.cloudinary.com/dlsiabgiw/video/upload/test-m.mp4");
  expect(screen.getByLabelText(/poster image url/i)).toHaveValue("https://res.cloudinary.com/dlsiabgiw/video/upload/so_0/test.jpg");
});

test("product search distinguishes errors from an empty result and retries without losing the slide", async () => {
  let searches = 0;
  global.fetch.mockImplementation((path) => {
    if (path === "/api/admin/hero-slides") return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: [] }) });
    searches += 1;
    return Promise.resolve({ ok: searches > 1, status: searches > 1 ? 200 : 503, json: async () => ({ items: [] }) });
  });
  const store = createStore(reducers, applyMiddleware(thunkMiddleware));
  store.dispatch({ type: "LOGIN_SUCCESS", payload: { name: "Admin User", role: "admin", token: "test-token" } });
  render(<Provider store={store}><App /></Provider>);
  await screen.findByText(/no hero videos yet/i);
  fireEvent.click(screen.getByRole("button", { name: "Add slide" }));
  fireEvent.change(screen.getByLabelText("Headline"), { target: { value: "Keep this headline" } });
  fireEvent.change(screen.getByLabelText(/search catalogue products/i), { target: { value: "nike" } });
  expect(await screen.findByRole("alert")).toHaveTextContent("Products could not be found");
  fireEvent.click(screen.getByRole("button", { name: "Retry search" }));
  expect(await screen.findByText("No products match. Try another name or brand.")).toBeInTheDocument();
  expect(screen.getByLabelText("Headline")).toHaveValue("Keep this headline");
  expect(searches).toBe(2);
});

const mockAdminApi = (items, onRequest = () => undefined) => {
  global.fetch.mockImplementation((path, options = {}) => {
    const handled = onRequest(path, options);
    if (handled) return Promise.resolve(handled);
    if (path === "/api/admin/hero-slides") return Promise.resolve({ ok: true, status: 200, json: async () => ({ items }) });
    if (String(path).startsWith("/api/products?search=")) return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: [product] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
};

test("page and navigation are labelled Hero videos with a total slide count", async () => {
  mockAdminApi([listSlide(0, { isActive: true }), listSlide(1)]);
  renderAdmin();
  await screen.findByText("HEADLINE 1");
  expect(screen.getByRole("heading", { level: 1, name: "Hero videos" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Hero videos" })).toHaveAttribute("href", "/admin/hero-slides");
  expect(screen.getByText("2/8")).toBeInTheDocument();
  expect(screen.getByText(/1 published/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add slide" })).toBeEnabled();
});

test("Add slide is disabled at eight slides and the form cannot be opened", async () => {
  mockAdminApi(Array.from({ length: 8 }, (_, index) => listSlide(index)));
  renderAdmin();
  await screen.findByText("HEADLINE 7");
  expect(screen.getByText("8/8")).toBeInTheDocument();
  const add = screen.getByRole("button", { name: "Add slide" });
  expect(add).toBeDisabled();
  expect(screen.getByText(/delete one to add another/i)).toBeInTheDocument();
  fireEvent.click(add);
  expect(screen.queryByRole("button", { name: /create slide/i })).not.toBeInTheDocument();
});

test("video-first form requires a desktop video and creates a slide with video, headline and product", async () => {
  let submitted;
  mockAdminApi([], (path, options) => {
    if (path === "/api/admin/hero-slides" && options.method === "POST") {
      submitted = JSON.parse(options.body);
      return { ok: true, status: 201, json: async () => ({ item: { id: "slide-new" } }) };
    }
    return null;
  });
  renderAdmin();
  await screen.findByText(/no hero videos yet/i);
  await userEvent.click(screen.getByRole("button", { name: "Add slide" }));
  expect(screen.getByText("Legacy image fallback (optional)")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText(/search catalogue products/i), { target: { value: "nike" } });
  await userEvent.click(await screen.findByRole("button", { name: /nike air max dn8/i }));
  await userEvent.type(screen.getByLabelText("Headline"), "Video first");
  await userEvent.click(screen.getByRole("button", { name: /create slide/i }));
  expect(await screen.findByText("Add a desktop video URL to create a hero slide")).toBeInTheDocument();
  expect(submitted).toBeUndefined();

  fireEvent.change(screen.getByLabelText(/desktop video url/i), { target: { value: VIDEO } });
  await userEvent.click(screen.getByRole("button", { name: /create slide/i }));
  expect(submitted).toMatchObject({ productId: product._id, headline: "Video first", desktopVideo: VIDEO, desktopImage: "", mobileImage: "" });
});

test("editing a legacy image slide keeps its images and does not require a video while it stays published", async () => {
  let patched;
  const legacy = listSlide(0, { desktopVideo: "", desktopImage: "https://example.test/legacy.jpg", mobileImage: "https://example.test/legacy-m.jpg", isActive: true });
  mockAdminApi([legacy], (path, options) => {
    if (options.method === "PATCH") {
      patched = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => ({ item: legacy }) };
    }
    return null;
  });
  renderAdmin();
  await screen.findByText("HEADLINE 0");
  expect(screen.getByText("Image")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByLabelText(/desktop image url/i)).toHaveValue("https://example.test/legacy.jpg");
  fireEvent.change(screen.getByLabelText("Headline"), { target: { value: "New copy" } });
  await userEvent.click(screen.getByRole("button", { name: /save slide/i }));
  await waitFor(() => expect(patched).toBeDefined());
  expect(patched.headline).toBe("New copy");
  expect(patched).not.toHaveProperty("desktopImage");
  expect(patched).not.toHaveProperty("mobileImage");
});

test("publishing a draft image slide asks for a video first", async () => {
  let patched;
  mockAdminApi([listSlide(0, { desktopVideo: "", desktopImage: "https://example.test/legacy.jpg" })], (path, options) => {
    if (options.method === "PATCH") { patched = JSON.parse(options.body); return { ok: true, status: 200, json: async () => ({}) }; }
    return null;
  });
  renderAdmin();
  await screen.findByText("HEADLINE 0");
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  await userEvent.click(screen.getByLabelText(/publish this slide/i));
  await userEvent.click(screen.getByRole("button", { name: /save slide/i }));
  expect(await screen.findByText("Add a desktop video URL before publishing")).toBeInTheDocument();
  expect(patched).toBeUndefined();
});

test("Move down swaps two slides by patching their order", async () => {
  const patches = [];
  mockAdminApi([listSlide(0), listSlide(1), listSlide(2)], (path, options) => {
    if (options.method === "PATCH") {
      patches.push({ path, body: JSON.parse(options.body) });
      return { ok: true, status: 200, json: async () => ({}) };
    }
    return null;
  });
  renderAdmin();
  await screen.findByText("HEADLINE 0");
  expect(screen.getByRole("button", { name: "Move Pair 0 up" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Move Pair 0 down" }));
  await waitFor(() => expect(patches).toHaveLength(2));
  expect(patches).toEqual([
    { path: "/api/admin/hero-slides/slide-1", body: { order: 0 } },
    { path: "/api/admin/hero-slides/slide-0", body: { order: 1 } },
  ]);
});
