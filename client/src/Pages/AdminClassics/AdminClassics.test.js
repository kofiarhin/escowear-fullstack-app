import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { applyMiddleware, createStore } from "redux";
import thunkMiddleware from "redux-thunk";
import App from "../../App";
import reducers from "../../redux/reducers";

const ENDPOINT = "/api/admin/classics";
const product = (index, overrides = {}) => ({ _id: `672b0e3a1a2b3c4d5e6f70${String(index).padStart(2, "0")}`, name: `Runner ${index}`, brand: "Nike", price: 100 + index, currency: "GBP", image: `https://example.test/${index}.jpg`, inStock: true, ...overrides });
const entry = (item, title, searchTerm = title.toLowerCase()) => ({ title, searchTerm, productId: item._id });
const json = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const adminBody = (entries, products, { version = 1, configured = true, warnings = [] } = {}) => ({ item: { configured, entries, version, updatedAt: "2026-11-19T10:00:00.000Z", products }, warnings });

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

const cardsRegion = () => screen.getByRole("region", { name: "Homepage cards" });
const titles = () => within(cardsRegion()).queryAllByLabelText(/^Card \d title$/).map((input) => input.value);
const putBodies = () => global.fetch.mock.calls.filter(([path, options = {}]) => path === ENDPOINT && options.method === "PUT").map(([, options]) => JSON.parse(options.body));
const saveButton = () => screen.getByRole("button", { name: "Save changes" });

afterEach(() => { localStorage.clear(); jest.restoreAllMocks(); });

test("the Products page and admin sidebar link to Classics management", async () => {
  mockApi({
    "GET /api/admin/products": () => json(200, { items: [], pagination: { total: 0, page: 1, pages: 0 } }),
    [`GET ${ENDPOINT}`]: () => json(200, adminBody([], [])),
  });
  renderAt("/admin/products");
  const nav = await screen.findByRole("navigation", { name: "Admin sections" });
  expect(within(nav).getByRole("link", { name: "Classics" })).toHaveAttribute("href", "/admin/products/classics");
  await userEvent.click(await screen.findByRole("link", { name: "Manage Classics" }));
  expect(await screen.findByRole("heading", { name: "Manage The Classics" })).toBeInTheDocument();
  expect(await screen.findByText(/no cards\. after saving/i)).toBeInTheDocument();
  expect(within(screen.getByRole("navigation", { name: "Admin sections" })).getByRole("link", { name: "Classics" })).toHaveAttribute("aria-current", "page");
  expect(global.fetch).toHaveBeenCalledWith(ENDPOINT, expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-token" }) }));
});

test("admin edits copy, adds, replaces, reorders, removes and saves cards with the loaded version", async () => {
  const saved = [product(1), product(2)];
  const results = [product(1), product(3), product(4)];
  mockApi({
    [`GET ${ENDPOINT}`]: () => json(200, adminBody([entry(saved[0], "Dunk"), entry(saved[1], "Samba")], saved, { version: 4 })),
    "GET /api/products": () => json(200, { items: results }),
    [`PUT ${ENDPOINT}`]: (path, options) => {
      const entries = JSON.parse(options.body).entries;
      const all = [...saved, ...results];
      return json(200, adminBody(entries, entries.map((item) => all.find((candidate) => candidate._id === item.productId)), { version: 5 }));
    },
  });
  renderAt("/admin/products/classics");
  await screen.findByLabelText("Card 2 title");
  expect(titles()).toEqual(["Dunk", "Samba"]);
  expect(saveButton()).toBeDisabled();

  const title = screen.getByLabelText("Card 1 title");
  await userEvent.clear(title);
  expect(screen.getByText("Title is required.")).toBeInTheDocument();
  expect(title).toHaveAttribute("aria-invalid", "true");
  expect(saveButton()).toBeDisabled();
  await userEvent.type(title, "Dunk Low");
  const search = screen.getByLabelText("Card 1 search term");
  await userEvent.clear(search);
  await userEvent.type(search, "dunk low");
  expect(screen.getByText("Links to /store?search=dunk%20low")).toBeInTheDocument();

  await userEvent.type(screen.getByLabelText("Name or brand"), "jordan 4{enter}");
  const resultList = await screen.findByRole("list", { name: "Search results" });
  expect(global.fetch).toHaveBeenCalledWith("/api/products?search=jordan%204&limit=10", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  // Products already used by a card cannot be picked twice.
  expect(within(resultList).getByRole("button", { name: "Add: Runner 1" })).toBeDisabled();
  await userEvent.click(within(resultList).getByRole("button", { name: "Add: Runner 3" }));
  expect(titles()).toEqual(["Dunk Low", "Samba", "jordan 4"]);
  expect(screen.getByLabelText("Card 3 search term")).toHaveValue("jordan 4");

  await userEvent.click(screen.getByRole("button", { name: "Change product for card 2" }));
  expect(screen.getByText("Choosing a product for card 2.")).toBeInTheDocument();
  await userEvent.click(within(resultList).getByRole("button", { name: "Use for card 2: Runner 4" }));
  expect(within(cardsRegion()).getByText("Runner 4")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Move card 3 up" }));
  await userEvent.click(screen.getByRole("button", { name: "Remove card 1" }));
  expect(titles()).toEqual(["jordan 4", "Samba"]);
  const preview = screen.getByRole("region", { name: "Homepage preview" });
  expect(within(preview).getByText("/store?search=jordan%204")).toBeInTheDocument();

  await userEvent.click(saveButton());
  expect(await screen.findByText(/classics saved/i)).toBeInTheDocument();
  expect(putBodies()).toEqual([{ entries: [entry(product(3), "jordan 4"), entry(product(4), "Samba")], expectedVersion: 4 }]);
  expect(saveButton()).toBeDisabled();
});

test("adding stops at six cards", async () => {
  const saved = [1, 2, 3, 4, 5].map((index) => product(index));
  mockApi({
    [`GET ${ENDPOINT}`]: () => json(200, adminBody(saved.map((item) => entry(item, item.name)), saved)),
    "GET /api/products": () => json(200, { items: [product(6), product(7)] }),
  });
  renderAt("/admin/products/classics");
  await screen.findByLabelText("Card 5 title");
  await userEvent.type(screen.getByLabelText("Name or brand"), "runner{enter}");
  const resultList = await screen.findByRole("list", { name: "Search results" });
  await userEvent.click(within(resultList).getByRole("button", { name: "Add: Runner 6" }));
  expect(screen.getByText(/all six cards are used/i)).toBeInTheDocument();
  expect(within(resultList).getByRole("button", { name: "Add: Runner 7" })).toBeDisabled();
  expect(titles()).toHaveLength(6);
});

test("unsaved defaults can be saved as-is once every card has a product", async () => {
  const air = product(1);
  mockApi({
    [`GET ${ENDPOINT}`]: () => json(200, adminBody([entry(air, "Air Force 1", "air force"), { title: "Dunk", searchTerm: "dunk", productId: null }], [air], { version: 0, configured: false })),
    "GET /api/products": () => json(200, { items: [product(2)] }),
    [`PUT ${ENDPOINT}`]: (path, options) => json(200, adminBody(JSON.parse(options.body).entries, [air, product(2)], { version: 1 })),
  });
  renderAt("/admin/products/classics");
  expect(await screen.findByText(/these are the built-in classics/i)).toBeInTheDocument();
  expect(screen.getByText(/no product chosen, so this card is hidden on the homepage/i)).toBeInTheDocument();
  expect(screen.getByText("No product chosen")).toBeInTheDocument();
  expect(saveButton()).toBeDisabled();

  await userEvent.click(screen.getByRole("button", { name: "Change product for card 2" }));
  await userEvent.type(screen.getByLabelText("Name or brand"), "dunk{enter}");
  await userEvent.click(await screen.findByRole("button", { name: "Use for card 2: Runner 2" }));
  await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(screen.getByText("No product chosen")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Remove card 2" }));
  expect(saveButton()).toBeEnabled();
  await userEvent.click(saveButton());
  expect(await screen.findByText(/classics saved/i)).toBeInTheDocument();
  expect(putBodies()).toEqual([{ entries: [entry(air, "Air Force 1", "air force")], expectedVersion: 0 }]);
  expect(screen.queryByText(/these are the built-in classics/i)).not.toBeInTheDocument();
});

test("draft and missing products show warnings, stay out of the preview, and can be replaced or removed", async () => {
  const draft = product(2, { status: "draft" });
  const missingId = "672b0e3a1a2b3c4d5e6f7099";
  mockApi({
    [`GET ${ENDPOINT}`]: () => json(200, adminBody(
      [entry(product(1), "Dunk"), entry(draft, "Samba"), { title: "Campus", searchTerm: "campus", productId: missingId }],
      [product(1), draft],
      { warnings: [{ productId: draft._id, reason: "draft" }, { productId: missingId, reason: "missing" }] }
    )),
  });
  renderAt("/admin/products/classics");
  expect(await screen.findByText(/this product is a draft/i)).toBeInTheDocument();
  expect(screen.getByText(/no longer exists/i)).toBeInTheDocument();
  expect(screen.getByText(`Missing product ${missingId}`)).toBeInTheDocument();
  const preview = screen.getByRole("region", { name: "Homepage preview" });
  expect(within(preview).getByText("Dunk")).toBeInTheDocument();
  expect(within(preview).queryByText("Samba")).not.toBeInTheDocument();
  expect(within(preview).queryByText("Campus")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Remove card 3" }));
  expect(screen.queryByText(/no longer exists/i)).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Homepage cards" })).toHaveFocus();
});

test("a stale save keeps the edits and offers to reload the saved selection", async () => {
  let reads = 0;
  mockApi({
    [`GET ${ENDPOINT}`]: () => { reads += 1; return json(200, reads === 1 ? adminBody([entry(product(1), "Dunk"), entry(product(2), "Samba")], [product(1), product(2)], { version: 2 }) : adminBody([entry(product(3), "Campus")], [product(3)], { version: 3 })); },
    [`PUT ${ENDPOINT}`]: () => json(409, { error: "The Classics changed elsewhere. Refresh and try again.", code: "STALE_CLASSICS_SELECTION" }),
  });
  renderAt("/admin/products/classics");
  await screen.findByLabelText("Card 2 title");
  await userEvent.click(screen.getByRole("button", { name: "Remove card 1" }));
  await userEvent.click(saveButton());
  expect(await screen.findByText(/someone changed the classics/i)).toBeInTheDocument();
  expect(titles()).toEqual(["Samba"]);
  expect(saveButton()).toBeDisabled();

  await userEvent.click(screen.getByRole("button", { name: "Reload saved selection" }));
  await waitFor(() => expect(titles()).toEqual(["Campus"]));
  expect(screen.queryByRole("button", { name: "Reload saved selection" })).not.toBeInTheDocument();
});

test("server rejections and network failures keep the edits with actionable errors", async () => {
  let attempt = 0;
  mockApi({
    [`GET ${ENDPOINT}`]: () => json(200, adminBody([entry(product(1), "Dunk"), entry(product(2), "Samba")], [product(1), product(2)])),
    [`PUT ${ENDPOINT}`]: () => {
      attempt += 1;
      if (attempt === 1) return json(422, { error: "One or more products are unavailable", code: "INELIGIBLE_CLASSICS_PRODUCTS", unavailable: [product(2)._id] });
      if (attempt === 2) return json(400, { error: "Invalid classics selection", code: "INVALID_CLASSICS_SELECTION", fields: { "entries.0.title": "Title must be 40 characters or fewer" } });
      return Promise.reject(new TypeError("Failed to fetch"));
    },
  });
  renderAt("/admin/products/classics");
  await screen.findByLabelText("Card 2 title");
  await userEvent.click(screen.getByRole("button", { name: "Move card 2 up" }));
  await userEvent.click(saveButton());
  expect(await screen.findByText(/replace the flagged products/i)).toBeInTheDocument();
  expect(screen.getByText(/no longer available/i)).toBeInTheDocument();

  await userEvent.click(saveButton());
  expect(await screen.findByText(/title must be 40 characters or fewer/i)).toBeInTheDocument();

  await userEvent.click(saveButton());
  expect(await screen.findByText(/check your connection/i)).toBeInTheDocument();
  expect(titles()).toEqual(["Samba", "Dunk"]);
});

test("retrying a failed search repeats that search even after the input changes", async () => {
  let searches = 0;
  mockApi({
    [`GET ${ENDPOINT}`]: () => json(200, adminBody([], [])),
    "GET /api/products": () => { searches += 1; return searches === 1 ? json(500, { error: "Unable to load products" }) : json(200, { items: [product(3)] }); },
  });
  renderAt("/admin/products/classics");
  await screen.findByText(/no cards\. after saving/i);
  const input = screen.getByLabelText("Name or brand");
  await userEvent.type(input, "jordan{enter}");
  expect(await screen.findByText("Search failed.")).toBeInTheDocument();
  await userEvent.clear(input);
  await userEvent.click(screen.getByRole("button", { name: "Retry search" }));
  expect(await screen.findByRole("button", { name: "Add: Runner 3" })).toBeEnabled();
  expect(screen.queryByText(/enter a name or brand/i)).not.toBeInTheDocument();
  expect(global.fetch.mock.calls.filter(([path]) => String(path).startsWith("/api/products?")).map(([path]) => path)).toEqual([
    "/api/products?search=jordan&limit=10",
    "/api/products?search=jordan&limit=10",
  ]);
});

test("load failures offer a retry and non-admin responses are denied", async () => {
  let reads = 0;
  mockApi({ [`GET ${ENDPOINT}`]: () => { reads += 1; return reads === 1 ? json(500, { error: "Unable to load classics selection" }) : json(403, { error: "Forbidden" }); } });
  renderAt("/admin/products/classics");
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(/could not be loaded/i);
  await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/not allowed to manage the classics/i));
});
