import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { applyMiddleware, createStore } from "redux";
import thunkMiddleware from "redux-thunk";
import App from "../../App";
import reducers from "../../redux/reducers";

const product = { _id: "672b0e3a1a2b3c4d5e6f7002", name: "Nike Air Max Dn8", image: "https://example.test/dn8.jpg", inStock: true };

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
  await screen.findByText(/no slides yet/i);
  await userEvent.click(screen.getByRole("button", { name: /add slide/i }));
  fireEvent.change(screen.getByLabelText(/search catalogue products/i), { target: { value: "nike" } });
  await userEvent.click(await screen.findByRole("button", { name: /nike air max dn8/i }));
  await userEvent.type(screen.getByLabelText("Headline"), "A headline that remains visible");
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
  await screen.findByText(/no slides yet/i);
  await userEvent.click(screen.getByRole("button", { name: /add slide/i }));
  fireEvent.change(screen.getByLabelText(/search catalogue products/i), { target: { value: "nike" } });
  await userEvent.click(await screen.findByRole("button", { name: /nike air max dn8/i }));
  await userEvent.type(screen.getByLabelText("Headline"), "New season, ready to move");
  await userEvent.click(screen.getByLabelText(/publish this slide/i));
  await userEvent.click(screen.getByRole("button", { name: /create slide/i }));

  expect(submitted).toMatchObject({ productId: product._id, headline: "New season, ready to move", order: 0, isActive: true });
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
  await screen.findByText(/no slides yet/i);
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
  await screen.findByText(/no slides yet/i);
  fireEvent.click(screen.getByRole("button", { name: "Add slide" }));
  fireEvent.change(screen.getByLabelText("Headline"), { target: { value: "Keep this headline" } });
  fireEvent.change(screen.getByLabelText(/search catalogue products/i), { target: { value: "nike" } });
  expect(await screen.findByRole("alert")).toHaveTextContent("Products could not be found");
  fireEvent.click(screen.getByRole("button", { name: "Retry search" }));
  expect(await screen.findByText("No products match. Try another name or brand.")).toBeInTheDocument();
  expect(screen.getByLabelText("Headline")).toHaveValue("Keep this headline");
  expect(searches).toBe(2);
});
