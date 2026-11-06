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
