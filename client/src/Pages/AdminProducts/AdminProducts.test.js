import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { applyMiddleware, createStore } from "redux";
import thunkMiddleware from "redux-thunk";
import App from "../../App";
import reducers from "../../redux/reducers";

const renderAdmin = (path) => {
  localStorage.setItem("user", JSON.stringify({ name: "Admin User", role: "admin", token: "test-token" }));
  window.history.pushState({}, "", path);
  const store = createStore(reducers, applyMiddleware(thunkMiddleware));
  store.dispatch({ type: "LOGIN_SUCCESS", payload: { name: "Admin User", role: "admin", token: "test-token" } });
  return render(<Provider store={store}><App /></Provider>);
};

afterEach(() => { localStorage.clear(); jest.restoreAllMocks(); });

test("admin sees manual and imported products with filters", async () => {
  let calls = 0;
  global.fetch = jest.fn().mockImplementation(() => { calls += 1; return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: [{ _id: "672b0e3a1a2b3c4d5e6f7002", name: calls > 1 ? "Nike P-6000 filtered" : "Nike P-6000", brand: "Nike", price: 124.99, status: "draft", source: { provider: "manual" }, inStock: false, updatedAt: "2026-11-06T12:00:00.000Z" }], pagination: { total: 1, page: 1, pages: 1 } }) }); });
  renderAdmin("/admin/products");
  expect(await screen.findByText("Nike P-6000")).toBeInTheDocument();
  expect(screen.getAllByText("Draft").length).toBeGreaterThan(1);
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "draft" } });
  await waitFor(() => expect(global.fetch).toHaveBeenLastCalledWith(expect.stringContaining("status=draft"), expect.any(Object)));
  expect(await screen.findByText("Nike P-6000 filtered")).toBeInTheDocument();
});

test("admin can save an incomplete product draft and receives validation feedback", async () => {
  let request;
  global.fetch = jest.fn().mockImplementation((path, options = {}) => {
    if (path === "/api/admin/products/brands") return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: ["Nike"] }) });
    if (path === "/api/admin/products" && options.method === "POST") { request = JSON.parse(options.body); return Promise.resolve({ ok: false, status: 422, json: async () => ({ error: "Please correct the highlighted fields", fields: { name: "Product name must not be empty" } }) }); }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
  renderAdmin("/admin/products/new");
  expect(await screen.findByRole("option", { name: "Nike" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Nike" }));
  await userEvent.click(screen.getByRole("button", { name: /save as draft/i }));
  expect(request).toMatchObject({ brand: "Nike", inStock: false, images: [], managedImages: [] });
  expect(await screen.findByText("Product name must not be empty")).toBeInTheDocument();
  expect(screen.getByLabelText("Brand")).toHaveValue("Nike");
});

test("brand selector loads options, searches them, and displays API failures", async () => {
  global.fetch = jest.fn().mockImplementation((path) => {
    if (path === "/api/admin/products/brands") return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: ["Adidas", "Nike", "Puma"] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
  renderAdmin("/admin/products/new");
  expect(await screen.findByRole("option", { name: "Adidas" })).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Brand"), "pu");
  expect(screen.queryByRole("option", { name: "Nike" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Puma" }));
  expect(screen.getByLabelText("Brand")).toHaveValue("Puma");
  expect(global.fetch).toHaveBeenCalledWith("/api/admin/products/brands", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-token" }) }));
});

test("colour selector saves predefined and custom selections as a deduplicated array", async () => {
  let request;
  global.fetch = jest.fn().mockImplementation((path, options = {}) => {
    if (path === "/api/admin/products/brands") return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: ["Nike"] }) });
    if (path === "/api/admin/products" && options.method === "POST") { request = JSON.parse(options.body); return Promise.resolve({ ok: false, status: 422, json: async () => ({ error: "Please correct the highlighted fields", fields: {} }) }); }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
  renderAdmin("/admin/products/new");
  await userEvent.selectOptions(screen.getByLabelText("Add colour"), "Black");
  await userEvent.selectOptions(screen.getByLabelText("Add colour"), "White");
  await userEvent.selectOptions(screen.getByLabelText("Add colour"), "Red");
  await userEvent.selectOptions(screen.getByLabelText("Add colour"), "__custom__");
  await userEvent.type(screen.getByLabelText("Custom colour"), "Seafoam");
  await userEvent.click(screen.getByRole("button", { name: "Add colour" }));
  expect(screen.getAllByLabelText("Selected colours")[0]).toHaveTextContent("Black");
  expect(screen.getAllByLabelText("Selected colours")[0]).toHaveTextContent("Seafoam");
  await userEvent.click(screen.getByRole("button", { name: /save as draft/i }));
  await waitFor(() => expect(request).toMatchObject({ colors: ["Black", "White", "Red", "Seafoam"] }));
});

test("editing a product retains legacy saved colour combinations", async () => {
  global.fetch = jest.fn().mockImplementation((path) => {
    if (path === "/api/admin/products/brands") return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: ["Nike"] }) });
    if (path === "/api/admin/products/672b0e3a1a2b3c4d5e6f7002") return Promise.resolve({ ok: true, status: 200, json: async () => ({ item: { _id: "672b0e3a1a2b3c4d5e6f7002", name: "Nike P-6000", color: "Black / White", colors: ["Black / White", "Red"], status: "draft" } }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
  renderAdmin("/admin/products/672b0e3a1a2b3c4d5e6f7002/edit");
  expect((await screen.findAllByLabelText("Selected colours"))[0]).toHaveTextContent("Black / White");
  expect(screen.getAllByLabelText("Selected colours")[0]).toHaveTextContent("Red");
});

test("brand selector exposes an API loading failure", async () => {
  global.fetch = jest.fn().mockImplementation((path) => Promise.resolve({ ok: path !== "/api/admin/products/brands", status: path === "/api/admin/products/brands" ? 500 : 200, json: async () => ({}) }));
  renderAdmin("/admin/products/new");
  expect(await screen.findByText(/brands could not be loaded/i)).toBeInTheDocument();
});

test("brand selector shows loading and empty states from the API", async () => {
  let resolveBrands;
  global.fetch = jest.fn().mockImplementation((path) => path === "/api/admin/products/brands" ? new Promise((resolve) => { resolveBrands = resolve; }) : Promise.resolve({ ok: true, status: 200, json: async () => ({}) }));
  renderAdmin("/admin/products/new");
  expect(await screen.findByText(/loading available brands/i)).toBeInTheDocument();
  resolveBrands({ ok: true, status: 200, json: async () => ({ items: [] }) });
  expect(await screen.findByText(/no brands are available yet/i)).toBeInTheDocument();
});
