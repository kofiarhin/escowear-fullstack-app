import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { applyMiddleware, createStore } from "redux";
import thunkMiddleware from "redux-thunk";
import reducers from "../../redux/reducers";
import Home from "./Home.page";

const makeProduct = (index) => ({
  _id: `product-${index}`,
  name: `Catalogue Runner ${index}`,
  brand: "Nike",
  category: "shoes",
  price: 100 + index,
  currency: "GBP",
  image: `https://example.test/runner-${index}.jpg`,
  sizes: ["8", "9"],
  inStock: true,
});

const products = Array.from({ length: 9 }, (_, index) => makeProduct(index + 1));

const catalogue = { items: products, pagination: { total: 3258, page: 1, limit: 4, pages: 815 } };
const featuredPicks = { items: [makeProduct(12), makeProduct(10), { ...makeProduct(11), inStock: false }, makeProduct(13)], version: 3 };
const classicSearches = ["air force", "dunk", "air max", "samba", "spezial", "campus"];
const classicNames = ["Air Force 1", "Dunk", "Air Max", "Samba", "Spezial", "Campus"];
const classicProducts = classicSearches.map((search, index) => ({ ...makeProduct(index + 20), name: `${classicNames[index]} catalogue pair` }));

// Each homepage request is answered independently so one can fail alone.
const respond = (productBody, { ok = true, featured = featuredPicks, featuredOk = true, classics = classicProducts } = {}) => (path) => {
  if (path === "/api/hero-slides") return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  if (path === "/api/featured-sneakers") return Promise.resolve({ ok: featuredOk, json: async () => (featuredOk ? featured : { error: "Unable to load featured sneakers" }) });
  const search = new URL(path, "https://example.test").searchParams.get("search");
  if (search) return Promise.resolve({ ok: true, json: async () => ({ items: [classics[classicSearches.indexOf(search)]].filter(Boolean) }) });
  return Promise.resolve({ ok, json: async () => productBody });
};

const renderHome = () => {
  const store = createStore(reducers, applyMiddleware(thunkMiddleware));
  return render(
    <Provider store={store}>
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    </Provider>
  );
};

afterEach(() => {
  jest.restoreAllMocks();
});

test("shows the admin-selected featured sneakers in order and the newest catalogue products as latest releases", async () => {
  global.fetch = jest.fn(respond(catalogue));
  renderHome();

  const featured = screen.getByRole("region", { name: /featured sneakers/i });
  const latest = screen.getByRole("region", { name: /latest releases/i });

  expect(await within(featured).findByText("Catalogue Runner 12")).toBeInTheDocument();
  const featuredLinks = within(featured).getAllByRole("link", { name: /catalogue runner/i });
  expect(featuredLinks.map((link) => link.getAttribute("href"))).toEqual(["/details/product-12", "/details/product-10", "/details/product-11", "/details/product-13"]);
  expect(within(featuredLinks[2]).getByText("Sold out")).toBeInTheDocument();
  expect(within(featured).queryByText("Catalogue Runner 1")).not.toBeInTheDocument();

  const latestLinks = await within(latest).findAllByRole("link", { name: /catalogue runner/i });
  expect(latestLinks.map((link) => link.getAttribute("href"))).toEqual(["/details/product-1", "/details/product-2", "/details/product-3", "/details/product-4"]);
  expect(within(featured).getByText("3,258")).toBeInTheDocument();
  expect(within(featured).getByRole("link", { name: /shop all sneakers/i })).toHaveAttribute("href", "/store");
  expect(global.fetch).toHaveBeenCalledWith("/api/products?limit=4&page=1");
  expect(global.fetch).toHaveBeenCalledWith("/api/featured-sneakers", expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

test("never renders more than four featured sneakers", async () => {
  global.fetch = jest.fn(respond(catalogue, { featured: { items: products.slice(0, 6), version: 1 } }));
  renderHome();
  const featured = screen.getByRole("region", { name: /featured sneakers/i });
  await within(featured).findByText("Catalogue Runner 1");
  expect(within(featured).getAllByRole("link", { name: /catalogue runner/i })).toHaveLength(4);
});

test("a featured failure retries on its own without hiding latest releases", async () => {
  global.fetch = jest.fn(respond(catalogue, { featuredOk: false }));
  renderHome();

  const featured = screen.getByRole("region", { name: /featured sneakers/i });
  const latest = screen.getByRole("region", { name: /latest releases/i });
  const alert = await within(featured).findByRole("alert");
  expect(await within(latest).findByText("Catalogue Runner 1")).toBeInTheDocument();
  expect(within(latest).queryByRole("alert")).not.toBeInTheDocument();

  global.fetch.mockImplementation(respond(catalogue));
  await userEvent.click(within(alert).getByRole("button", { name: /try again/i }));
  expect(await within(featured).findByText("Catalogue Runner 12")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(global.fetch.mock.calls.filter(([path]) => path === "/api/products?limit=4&page=1")).toHaveLength(1);
});

test("an empty featured selection shows the empty state instead of catalogue products", async () => {
  global.fetch = jest.fn(respond(catalogue, { featured: { items: [], version: 0 } }));
  renderHome();

  const featured = screen.getByRole("region", { name: /featured sneakers/i });
  expect(await within(featured).findByText(/no sneakers are available/i)).toBeInTheDocument();
  expect(within(featured).getByRole("link", { name: /browse all sneakers/i })).toHaveAttribute("href", "/store");
  expect(await screen.findByText("Catalogue Runner 1")).toBeInTheDocument();
  expect(within(featured).queryByRole("link", { name: /catalogue runner/i })).not.toBeInTheDocument();
});

test("a catalogue failure does not hide the featured selection", async () => {
  global.fetch = jest.fn(respond({}, { ok: false }));
  renderHome();

  const featured = screen.getByRole("region", { name: /featured sneakers/i });
  const latest = screen.getByRole("region", { name: /latest releases/i });
  expect(await within(featured).findByText("Catalogue Runner 12")).toBeInTheDocument();
  expect(await within(latest).findByRole("alert")).toBeInTheDocument();
  expect(within(featured).queryByRole("alert")).not.toBeInTheDocument();
});

test("links brand and classic discovery to live catalogue searches", async () => {
  global.fetch = jest.fn(respond({ items: products, pagination: { total: 9, page: 1, limit: 4, pages: 3 } }));
  renderHome();
  await screen.findByText("Catalogue Runner 1");

  const collections = screen.getByRole("region", { name: /shop by brand/i });
  expect(collections).toHaveAttribute("id", "collections");
  expect(within(collections).getByRole("link", { name: /new balance/i })).toHaveAttribute("href", "/store?search=new%20balance");
  expect(within(collections).getByRole("link", { name: /jordan/i })).toHaveAttribute("href", "/store?search=jordan");
  [
    ["Nike", "nike"], ["adidas", "adidas"], ["Jordan", "jordan"],
    ["New Balance", "new%20balance"], ["ASICS", "asics"], ["On Running", "on%20running"],
  ].forEach(([name, search]) => {
    const link = within(collections).getByRole("link", { name, exact: true });
    expect(link).toHaveAttribute("href", `/store?search=${search}`);
    const logo = within(link).getByTestId("brand-logo");
    // Decorative logos share the visible brand label; don't announce it twice.
    expect(logo).toHaveAttribute("aria-hidden", "true");
    expect(logo).toHaveAttribute("fill", "currentColor");
    expect(logo).toHaveAttribute("viewBox");
  });

  const classics = screen.getByRole("navigation", { name: /shop classic silhouettes/i });
  expect(within(classics).getByRole("link", { name: /air force 1/i })).toHaveAttribute("href", "/store?search=air%20force");
  expect(screen.getByRole("link", { name: /shop the classics/i })).toHaveAttribute("href", "/store?search=nike");

  expect(screen.getByRole("region", { name: /latest releases/i })).toHaveAttribute("id", "latest-releases");
  expect(screen.getByRole("region", { name: /how escowear works/i })).toHaveAttribute("id", "how-it-works");
  // The hero fallback shares this headline, so match the about region by id.
  expect(screen.getAllByRole("region", { name: /authentic uk sneakers/i }).map((region) => region.id)).toContain("about");
});

test("renders The Classics with catalogue photos and the existing silhouette search links", async () => {
  global.fetch = jest.fn(respond(catalogue));
  renderHome();
  await screen.findByText("Catalogue Runner 1");

  const section = screen.getByRole("region", { name: /the classics/i });
  expect(section).toHaveAttribute("id", "classics");
  expect(within(section).getByRole("heading", { level: 2, name: /the classics/i })).toBeInTheDocument();
  expect(within(section).getByText(/icons, always in rotation/i)).toBeInTheDocument();

  const nav = within(section).getByRole("navigation", { name: /shop classic silhouettes/i });
  await within(nav).findByRole("img", { name: "Campus catalogue pair" });
  const links = within(nav).getAllByRole("link");
  expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
    ["Air Force 1", "/store?search=air%20force"],
    ["Dunk", "/store?search=dunk"],
    ["Air Max", "/store?search=air%20max"],
    ["Samba", "/store?search=samba"],
    ["Spezial", "/store?search=spezial"],
    ["Campus", "/store?search=campus"],
  ]);
  links.forEach((link, index) => {
    expect(link).toHaveAccessibleName(classicNames[index]);
    expect(within(link).getByRole("img", { name: classicProducts[index].name })).toHaveAttribute("src", classicProducts[index].image);
    expect(global.fetch).toHaveBeenCalledWith(`/api/products?search=${classicSearches[index].replace(/ /g, "+")}&limit=1`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
  // Product alt text must not duplicate the silhouette link's accessible name.
  expect(within(nav).getByRole("link", { name: "Air Max" })).toBeInTheDocument();
  expect(within(section).getByRole("link", { name: /shop the classics/i })).toHaveAttribute("href", "/store?search=nike");
});

test.each([
  ["an empty search", () => Promise.resolve({ ok: true, json: async () => ({ items: [] }) })],
  ["missing image fields", () => Promise.resolve({ ok: true, json: async () => ({ items: [{ name: "Air Force 1 pair" }] }) })],
  ["an HTTP failure", () => Promise.resolve({ ok: false })],
  ["a network failure", () => Promise.reject(new Error("Offline"))],
  ["invalid JSON", () => Promise.resolve({ ok: true, json: async () => { throw new SyntaxError("Invalid JSON"); } })],
])("uses the default classic image for %s without hiding other tiles or releases", async (_, response) => {
  const normalResponse = respond(catalogue);
  global.fetch = jest.fn((path) => path.includes("search=air+force") ? response() : normalResponse(path));
  renderHome();
  const nav = screen.getByRole("navigation", { name: /shop classic silhouettes/i });
  const link = within(nav).getByRole("link", { name: "Air Force 1" });
  expect(await within(link).findByRole("img")).toHaveAttribute("src", "/images/default.jpg");
  expect(link).toHaveAttribute("href", "/store?search=air%20force");
  expect(within(nav).getByRole("img", { name: "Dunk catalogue pair" })).toHaveAttribute("src", classicProducts[1].image);
  expect(await screen.findByText("Catalogue Runner 1")).toBeInTheDocument();
});

test("uses catalogue image arrays and handles both a broken photo and a broken default", async () => {
  const classics = [...classicProducts];
  classics[0] = { name: "Air Force 1 pair", images: ["", "https://example.test/af1.jpg"] };
  global.fetch = jest.fn(respond(catalogue, { classics }));
  renderHome();
  const image = await screen.findByRole("img", { name: "Air Force 1 pair" });
  expect(image).toHaveAttribute("src", "https://example.test/af1.jpg");
  fireEvent.error(image);
  expect(image).toHaveAttribute("src", "/images/default.jpg");
  fireEvent.error(image);
  expect(image).not.toBeVisible();
  expect(screen.getByRole("link", { name: "Air Force 1" })).toBeVisible();
});

test("loads classics independently and aborts their requests on unmount", async () => {
  let resolveAirForce;
  const normalResponse = respond(catalogue);
  global.fetch = jest.fn((path) => path.includes("search=air+force")
    ? new Promise((resolve) => { resolveAirForce = resolve; })
    : normalResponse(path));
  const { unmount } = renderHome();
  expect(screen.getByRole("status", { name: "Loading Air Force 1 image" })).toBeInTheDocument();
  expect(await screen.findByRole("img", { name: "Dunk catalogue pair" })).toBeInTheDocument();
  const requests = global.fetch.mock.calls.filter(([path]) => path.includes("search="));
  expect(requests).toHaveLength(6);
  unmount();
  requests.forEach(([, options]) => expect(options.signal.aborted).toBe(true));
  // A body resolving after navigation must not cause another state update.
  await act(async () => resolveAirForce({ ok: true, json: async () => ({ items: [classicProducts[0]] }) }));
});

test("offers a retry when the catalogue request fails", async () => {
  global.fetch = jest.fn(respond({}, { ok: false }));
  renderHome();

  const latest = screen.getByRole("region", { name: /latest releases/i });
  const alert = await within(latest).findByRole("alert");
  global.fetch.mockImplementation(respond({ items: products, pagination: { total: 9, page: 1, limit: 4, pages: 3 } }));
  await userEvent.click(within(alert).getByRole("button", { name: /try again/i }));

  expect(await screen.findByText("Catalogue Runner 1")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("shows an empty state that routes to the store when no sneakers are available", async () => {
  global.fetch = jest.fn(respond({ items: [], pagination: { total: 0, page: 1, limit: 4, pages: 0 } }, { featured: { items: [], version: 0 } }));
  renderHome();

  expect(await screen.findByText(/no sneakers are available/i)).toBeInTheDocument();
  expect(screen.getByText(/new releases are on the way/i)).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: /browse all sneakers/i })[0]).toHaveAttribute("href", "/store");
  expect(screen.queryByText(/pairs in the catalogue/i)).not.toBeInTheDocument();
});
