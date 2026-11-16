import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { applyMiddleware, createStore } from "redux";
import thunkMiddleware from "redux-thunk";
import App from "../../App";
import reducers from "../../redux/reducers";

const ENDPOINT = "/api/admin/featured-sneakers";
const product = (index, overrides = {}) => ({ _id: `672b0e3a1a2b3c4d5e6f70${String(index).padStart(2, "0")}`, name: `Runner ${index}`, brand: "Nike", price: 100 + index, currency: "GBP", image: `https://example.test/${index}.jpg`, inStock: true, ...overrides });
const json = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const adminBody = (products, { version = 1, productIds = products.map((item) => item._id), warnings = [] } = {}) => ({ item: { productIds, version, updatedAt: "2026-11-10T10:00:00.000Z", products }, warnings });

// `routes` answers each call; unknown paths succeed with an empty body.
const mockApi = (routes) => {
  global.fetch = jest.fn().mockImplementation((path, options = {}) => {
    const method = options.method || "GET";
    const route = routes[`${method} ${String(path).split("?")[0]}`];
    return route ? route(path, options) : json(200, {});
  });
};

const renderAt = (path) => {
  localStorage.setItem("user", JSON.stringify({ name: "Admin User", role: "admin", token: "test-token" }));
  window.history.pushState({}, "", path);
  const store = createStore(reducers, applyMiddleware(thunkMiddleware));
  store.dispatch({ type: "LOGIN_SUCCESS", payload: { name: "Admin User", role: "admin", token: "test-token" } });
  return render(<Provider store={store}><App /></Provider>);
};

// Slot order, read from each slot's labelled Remove control.
const slotNames = () => within(screen.getByRole("region", { name: "Current selection" })).queryAllByRole("button", { name: /^Remove / }).map((button) => button.getAttribute("aria-label").replace(/^Remove /, ""));
const putBodies = () => global.fetch.mock.calls.filter(([path, options = {}]) => path === ENDPOINT && options.method === "PUT").map(([, options]) => JSON.parse(options.body));

afterEach(() => { localStorage.clear(); jest.restoreAllMocks(); });

test("the Products page links to Featured Sneakers management", async () => {
  mockApi({
    "GET /api/admin/products": () => json(200, { items: [], pagination: { total: 0, page: 1, pages: 0 } }),
    [`GET ${ENDPOINT}`]: () => json(200, adminBody([])),
  });
  renderAt("/admin/products");
  await userEvent.click(await screen.findByRole("link", { name: "Manage Featured Sneakers" }));
  expect(await screen.findByRole("heading", { name: "Manage Featured Sneakers" })).toBeInTheDocument();
  expect(await screen.findByText(/no sneakers selected/i)).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(ENDPOINT, expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-token" }) }));
});

test("admin searches, adds, reorders, removes and saves the selection with the loaded version", async () => {
  const saved = [product(1), product(2)];
  const results = [product(1), product(3), product(4, { inStock: false })];
  mockApi({
    [`GET ${ENDPOINT}`]: () => json(200, adminBody(saved, { version: 4 })),
    "GET /api/products": () => json(200, { items: results }),
    [`PUT ${ENDPOINT}`]: (path, options) => {
      const ids = JSON.parse(options.body).productIds;
      const all = [...saved, ...results];
      return json(200, adminBody(ids.map((id) => all.find((item) => item._id === id)), { version: 5 }));
    },
  });
  renderAt("/admin/products/featured");
  await screen.findByRole("button", { name: "Remove Runner 2" });
  expect(slotNames()).toEqual(["Runner 1", "Runner 2"]);
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();

  await userEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(screen.getByText(/enter a name or brand/i)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Name or brand"), "nike{enter}");
  const resultList = await screen.findByRole("list", { name: "Search results" });
  expect(global.fetch).toHaveBeenCalledWith("/api/products?search=nike&limit=10", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(within(resultList).getByRole("button", { name: "Add Runner 1" })).toBeDisabled();

  await userEvent.click(within(resultList).getByRole("button", { name: "Add Runner 3" }));
  await userEvent.click(within(resultList).getByRole("button", { name: "Add Runner 4" }));
  expect(slotNames()).toEqual(["Runner 1", "Runner 2", "Runner 3", "Runner 4"]);
  expect(screen.getByText(/all four slots are full/i)).toBeInTheDocument();
  expect(within(resultList).getByRole("button", { name: "Add Runner 3" })).toBeDisabled();

  await userEvent.click(screen.getByRole("button", { name: "Move Runner 3 up" }));
  await userEvent.click(screen.getByRole("button", { name: "Remove Runner 1" }));
  expect(slotNames()).toEqual(["Runner 3", "Runner 2", "Runner 4"]);
  const preview = screen.getByRole("region", { name: "Homepage preview" });
  expect(within(preview).getByText("Sold out")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText(/featured sneakers saved/i)).toBeInTheDocument();
  expect(putBodies()).toEqual([{ productIds: [product(3)._id, product(2)._id, product(4)._id], expectedVersion: 4 }]);
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
});

test("discard restores the last saved selection", async () => {
  mockApi({ [`GET ${ENDPOINT}`]: () => json(200, adminBody([product(1), product(2)])) });
  renderAt("/admin/products/featured");
  await screen.findByRole("button", { name: "Remove Runner 2" });
  await userEvent.click(screen.getByRole("button", { name: "Move Runner 2 up" }));
  await userEvent.click(screen.getByRole("button", { name: "Remove Runner 1" }));
  expect(slotNames()).toEqual(["Runner 2"]);
  await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(slotNames()).toEqual(["Runner 1", "Runner 2"]);
  expect(putBodies()).toEqual([]);
});

test("draft and missing saved products show warnings, stay out of the preview, and can be removed", async () => {
  const draft = product(2, { status: "draft" });
  const missingId = "672b0e3a1a2b3c4d5e6f7099";
  mockApi({ [`GET ${ENDPOINT}`]: () => json(200, adminBody([product(1), draft], { productIds: [product(1)._id, draft._id, missingId], warnings: [{ productId: draft._id, reason: "draft" }, { productId: missingId, reason: "missing" }] })) });
  renderAt("/admin/products/featured");
  expect(await screen.findByText(/this product is a draft/i)).toBeInTheDocument();
  expect(screen.getByText(/no longer exists/i)).toBeInTheDocument();
  expect(screen.getByText(`ID ${missingId}`)).toBeInTheDocument();
  const preview = screen.getByRole("region", { name: "Homepage preview" });
  expect(within(preview).getByText("Runner 1")).toBeInTheDocument();
  expect(within(preview).queryByText("Runner 2")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: `Remove Missing product ${missingId}` }));
  expect(screen.queryByText(/no longer exists/i)).not.toBeInTheDocument();
});

test("a stale save keeps the draft and offers to reload the saved selection", async () => {
  let reads = 0;
  mockApi({
    [`GET ${ENDPOINT}`]: () => { reads += 1; return json(200, reads === 1 ? adminBody([product(1), product(2)], { version: 2 }) : adminBody([product(3)], { version: 3 })); },
    [`PUT ${ENDPOINT}`]: () => json(409, { error: "Featured sneakers changed elsewhere. Refresh and try again.", code: "STALE_FEATURED_SELECTION" }),
  });
  renderAt("/admin/products/featured");
  await screen.findByRole("button", { name: "Remove Runner 2" });
  await userEvent.click(screen.getByRole("button", { name: "Remove Runner 1" }));
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText(/someone changed this selection/i)).toBeInTheDocument();
  expect(slotNames()).toEqual(["Runner 2"]);
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();

  await userEvent.click(screen.getByRole("button", { name: "Reload saved selection" }));
  await screen.findByRole("button", { name: "Remove Runner 3" });
  expect(slotNames()).toEqual(["Runner 3"]);
  expect(screen.queryByRole("button", { name: "Reload saved selection" })).not.toBeInTheDocument();
});

test("server rejections and network failures keep the draft with actionable errors", async () => {
  let attempt = 0;
  mockApi({
    [`GET ${ENDPOINT}`]: () => json(200, adminBody([product(1), product(2)])),
    [`PUT ${ENDPOINT}`]: () => {
      attempt += 1;
      if (attempt === 1) return json(422, { error: "One or more products are unavailable", code: "INELIGIBLE_FEATURED_PRODUCTS", unavailable: [product(2)._id] });
      return Promise.reject(new TypeError("Failed to fetch"));
    },
  });
  renderAt("/admin/products/featured");
  await screen.findByRole("button", { name: "Remove Runner 2" });
  await userEvent.click(screen.getByRole("button", { name: "Move Runner 2 up" }));
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText(/remove the flagged products/i)).toBeInTheDocument();
  expect(screen.getByText(/no longer available to feature/i)).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText(/check your connection/i)).toBeInTheDocument();
  expect(slotNames()).toEqual(["Runner 2", "Runner 1"]);
});

test("load failures offer a retry and non-admin responses are denied", async () => {
  let reads = 0;
  mockApi({ [`GET ${ENDPOINT}`]: () => { reads += 1; return reads === 1 ? json(500, { error: "Unable to load featured selection" }) : json(403, { error: "Forbidden" }); } });
  renderAt("/admin/products/featured");
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(/could not be loaded/i);
  await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/not allowed to manage featured sneakers/i));
});
