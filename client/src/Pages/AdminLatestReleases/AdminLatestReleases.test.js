import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { applyMiddleware, createStore } from "redux";
import thunkMiddleware from "redux-thunk";
import App from "../../App";
import reducers from "../../redux/reducers";

const ENDPOINT = "/api/admin/latest-releases";
const product = (index, overrides = {}) => ({ _id: `672b0e3a1a2b3c4d5e6f70${String(index).padStart(2, "0")}`, name: `Runner ${index}`, brand: "Nike", price: 100 + index, currency: "GBP", image: `https://example.test/${index}.jpg`, inStock: true, ...overrides });
const json = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const adminBody = (products, { version = 1, configured = true, productIds = products.map((item) => item._id), warnings = [] } = {}) => ({ item: { configured, productIds, version, updatedAt: "2026-11-19T10:00:00.000Z", products }, warnings });

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

const selection = () => screen.getByRole("region", { name: "Current selection" });
// Slot order, read from each slot's labelled Remove control.
const slotNames = () => within(selection()).queryAllByRole("button", { name: /^Remove / }).map((button) => button.getAttribute("aria-label").replace(/^Remove /, ""));
const previewNames = () => within(screen.getByRole("region", { name: "Homepage preview" })).queryAllByRole("listitem").map((item) => within(item).getByText(/^Runner/).textContent);
const putBodies = () => global.fetch.mock.calls.filter(([path, options = {}]) => path === ENDPOINT && options.method === "PUT").map(([, options]) => JSON.parse(options.body));
const searchFor = async (term) => {
  await userEvent.clear(screen.getByLabelText("Name or brand"));
  await userEvent.type(screen.getByLabelText("Name or brand"), `${term}{enter}`);
  return screen.findByRole("list", { name: "Search results" });
};

afterEach(() => { localStorage.clear(); jest.restoreAllMocks(); });

test("the Products page and the admin sidebar link to Latest Releases management", async () => {
  mockApi({
    "GET /api/admin/products": () => json(200, { items: [], pagination: { total: 0, page: 1, pages: 0 } }),
    [`GET ${ENDPOINT}`]: () => json(200, adminBody([], { version: 0, configured: false })),
  });
  renderAt("/admin/products");
  await userEvent.click(await screen.findByRole("link", { name: "Manage Latest Releases" }));
  expect(await screen.findByRole("heading", { name: "Manage Latest Releases" })).toBeInTheDocument();
  expect(await screen.findByText(/no products selected/i)).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(ENDPOINT, expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-token" }) }));
  const nav = screen.getByRole("navigation", { name: "Admin sections" });
  expect(within(nav).getByRole("link", { name: "Latest releases" })).toHaveAttribute("aria-current", "page");
});

test("before the first save the newest products are shown as defaults and can be saved as they are", async () => {
  const defaults = [product(4), product(3), product(2), product(1)];
  mockApi({
    [`GET ${ENDPOINT}`]: () => json(200, adminBody(defaults, { version: 0, configured: false })),
    [`PUT ${ENDPOINT}`]: () => json(200, adminBody(defaults, { version: 1 })),
  });
  renderAt("/admin/products/latest-releases");
  await screen.findByRole("button", { name: "Remove Runner 4" });
  expect(screen.getByText(/not saved yet: the homepage shows the newest catalogue products/i)).toBeInTheDocument();
  expect(slotNames()).toEqual(["Runner 4", "Runner 3", "Runner 2", "Runner 1"]);
  expect(previewNames()).toEqual(["Runner 4", "Runner 3", "Runner 2", "Runner 1"]);
  expect(screen.getByRole("button", { name: "Discard changes" })).toBeDisabled();

  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText(/latest releases saved/i)).toBeInTheDocument();
  expect(putBodies()).toEqual([{ productIds: defaults.map((item) => item._id), expectedVersion: 0 }]);
  expect(screen.queryByText(/not saved yet/i)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
});

test("admin searches, adds up to eight, reorders, replaces, removes, previews and saves with the loaded version", async () => {
  const saved = [product(1), product(2)];
  const results = Array.from({ length: 9 }, (_, index) => product(index + 3));
  mockApi({
    [`GET ${ENDPOINT}`]: () => json(200, adminBody(saved, { version: 4 })),
    "GET /api/products": () => json(200, { items: [product(1), ...results] }),
    [`PUT ${ENDPOINT}`]: (path, options) => {
      const ids = JSON.parse(options.body).productIds;
      const all = [...saved, ...results];
      return json(200, adminBody(ids.map((id) => all.find((item) => item._id === id)), { version: 5 }));
    },
  });
  renderAt("/admin/products/latest-releases");
  await screen.findByRole("button", { name: "Remove Runner 2" });
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(screen.queryByText(/not saved yet/i)).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(screen.getByText(/enter a name or brand/i)).toBeInTheDocument();
  const resultList = await searchFor("nike");
  expect(global.fetch).toHaveBeenCalledWith("/api/products?search=nike&limit=10", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(within(resultList).getByRole("button", { name: "Add: Runner 1" })).toBeDisabled();

  for (const index of [3, 4, 5, 6, 7, 8]) await userEvent.click(within(resultList).getByRole("button", { name: `Add: Runner ${index}` }));
  expect(slotNames()).toEqual(["Runner 1", "Runner 2", "Runner 3", "Runner 4", "Runner 5", "Runner 6", "Runner 7", "Runner 8"]);
  expect(screen.getByText("8/8")).toBeInTheDocument();
  expect(screen.getByText(/all eight slots are full/i)).toBeInTheDocument();
  expect(within(resultList).getByRole("button", { name: "Add: Runner 9" })).toBeDisabled();

  await userEvent.click(screen.getByRole("button", { name: "Move Runner 3 up" }));
  await userEvent.click(screen.getByRole("button", { name: "Move Runner 1 down" }));
  // Replace works even when every slot is full, and keeps the slot's position.
  await userEvent.click(screen.getByRole("button", { name: "Replace Runner 5" }));
  expect(screen.getByText("Choosing a replacement for slot 5.")).toBeInTheDocument();
  expect(screen.getByLabelText("Name or brand")).toHaveFocus();
  expect(within(resultList).getByRole("button", { name: "Use for slot 5: Runner 1" })).toBeDisabled();
  await userEvent.click(within(resultList).getByRole("button", { name: "Use for slot 5: Runner 9" }));
  await userEvent.click(screen.getByRole("button", { name: "Remove Runner 8" }));
  expect(screen.getByRole("heading", { name: "Current selection" })).toHaveFocus();

  const expected = ["Runner 3", "Runner 1", "Runner 2", "Runner 4", "Runner 9", "Runner 6", "Runner 7"];
  expect(slotNames()).toEqual(expected);
  expect(previewNames()).toEqual(expected);
  expect(screen.getByText(/unsaved changes/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText(/latest releases saved/i)).toBeInTheDocument();
  const ids = { 1: product(1)._id, 2: product(2)._id, 3: product(3)._id, 4: product(4)._id, 6: product(6)._id, 7: product(7)._id, 9: product(9)._id };
  expect(putBodies()).toEqual([{ productIds: [ids[3], ids[1], ids[2], ids[4], ids[9], ids[6], ids[7]], expectedVersion: 4 }]);
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
});

test("an admin can clear and save an empty selection, or discard unsaved edits", async () => {
  const saved = [product(1), product(2)];
  mockApi({
    [`GET ${ENDPOINT}`]: () => json(200, adminBody(saved, { version: 2 })),
    [`PUT ${ENDPOINT}`]: () => json(200, adminBody([], { version: 3 })),
  });
  renderAt("/admin/products/latest-releases");
  await userEvent.click(await screen.findByRole("button", { name: "Remove Runner 1" }));
  await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(slotNames()).toEqual(["Runner 1", "Runner 2"]);

  await userEvent.click(screen.getByRole("button", { name: "Remove Runner 1" }));
  await userEvent.click(screen.getByRole("button", { name: "Remove Runner 2" }));
  expect(screen.getByText(/no products selected/i)).toBeInTheDocument();
  expect(screen.getByText(/will show its empty message/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText(/latest releases saved/i)).toBeInTheDocument();
  expect(putBodies()).toEqual([{ productIds: [], expectedVersion: 2 }]);
});

test("draft and missing products are flagged, left out of the preview, and can be replaced", async () => {
  const draft = product(2, { status: "draft" });
  const missingId = product(9)._id;
  mockApi({
    [`GET ${ENDPOINT}`]: () => json(200, adminBody([product(1), draft], { productIds: [product(1)._id, draft._id, missingId], warnings: [{ productId: draft._id, reason: "draft" }, { productId: missingId, reason: "missing" }] })),
    "GET /api/products": () => json(200, { items: [product(3)] }),
  });
  renderAt("/admin/products/latest-releases");
  expect(await screen.findByText(/this product is a draft/i)).toBeInTheDocument();
  expect(screen.getByText(/this product no longer exists/i)).toBeInTheDocument();
  expect(screen.getByText(`ID ${missingId}`)).toBeInTheDocument();
  expect(previewNames()).toEqual(["Runner 1"]);

  await userEvent.click(screen.getByRole("button", { name: `Replace Missing product ${missingId}` }));
  const resultList = await searchFor("runner");
  await userEvent.click(within(resultList).getByRole("button", { name: "Use for slot 3: Runner 3" }));
  expect(slotNames()).toEqual(["Runner 1", "Runner 2", "Runner 3"]);
  expect(screen.queryByText(/no longer exists/i)).not.toBeInTheDocument();
  expect(previewNames()).toEqual(["Runner 1", "Runner 3"]);
});

test("a 422 flags unavailable products and keeps the edits", async () => {
  mockApi({
    [`GET ${ENDPOINT}`]: () => json(200, adminBody([product(1), product(2)])),
    [`PUT ${ENDPOINT}`]: () => json(422, { error: "One or more products are unavailable", code: "INELIGIBLE_LATEST_RELEASES_PRODUCTS", unavailable: [product(2)._id] }),
  });
  renderAt("/admin/products/latest-releases");
  await userEvent.click(await screen.findByRole("button", { name: "Move Runner 2 up" }));
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/remove or replace the flagged products/i);
  expect(screen.getByText(/no longer available for latest releases/i)).toBeInTheDocument();
  expect(slotNames()).toEqual(["Runner 2", "Runner 1"]);
});

test("a stale save blocks further saves until the admin reloads the latest selection", async () => {
  let version = 1;
  mockApi({
    [`GET ${ENDPOINT}`]: () => json(200, adminBody(version === 1 ? [product(1), product(2)] : [product(7)], { version })),
    [`PUT ${ENDPOINT}`]: () => json(409, { error: "Latest releases changed elsewhere. Refresh and try again.", code: "STALE_LATEST_RELEASES_SELECTION" }),
  });
  renderAt("/admin/products/latest-releases");
  await userEvent.click(await screen.findByRole("button", { name: "Remove Runner 1" }));
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/someone changed this selection/i);
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();

  version = 2;
  await userEvent.click(screen.getByRole("button", { name: "Reload saved selection" }));
  await screen.findByRole("button", { name: "Remove Runner 7" });
  expect(slotNames()).toEqual(["Runner 7"]);
  expect(screen.queryByRole("button", { name: "Reload saved selection" })).not.toBeInTheDocument();
});

test("server, network and search failures are reported without losing edits", async () => {
  let searchOk = false;
  let putCall = 0;
  mockApi({
    [`GET ${ENDPOINT}`]: () => json(200, adminBody([product(1), product(2)])),
    "GET /api/products": () => (searchOk ? json(200, { items: [product(5)] }) : json(500, {})),
    [`PUT ${ENDPOINT}`]: () => {
      putCall += 1;
      return putCall === 1 ? json(400, { error: "Invalid latest releases selection", fields: { productIds: "Choose at most 8 products" } }) : Promise.reject(new TypeError("Network down"));
    },
  });
  renderAt("/admin/products/latest-releases");
  await userEvent.click(await screen.findByRole("button", { name: "Remove Runner 2" }));
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Invalid latest releases selection: Choose at most 8 products");
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/check your connection/i));
  expect(slotNames()).toEqual(["Runner 1"]);

  await userEvent.type(screen.getByLabelText("Name or brand"), "first{enter}");
  expect(await screen.findByText("Search failed.")).toBeInTheDocument();
  // Retry repeats the failed search, not whatever is typed now.
  await userEvent.clear(screen.getByLabelText("Name or brand"));
  await userEvent.type(screen.getByLabelText("Name or brand"), "second");
  searchOk = true;
  await userEvent.click(screen.getByRole("button", { name: "Retry search" }));
  expect(await screen.findByRole("list", { name: "Search results" })).toBeInTheDocument();
  expect(global.fetch).toHaveBeenLastCalledWith("/api/products?search=first&limit=10", expect.anything());
});

test("load failures can be retried and non-admin responses are explained", async () => {
  let attempt = 0;
  mockApi({ [`GET ${ENDPOINT}`]: () => { attempt += 1; return attempt === 1 ? json(500, {}) : json(403, {}); } });
  renderAt("/admin/products/latest-releases");
  expect(await screen.findByText("Latest releases could not be loaded.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText(/not allowed to manage latest releases/i)).toBeInTheDocument();
});
