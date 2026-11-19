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
const classicProducts = classicSearches.map((search, index) => ({ _id: `classic-${index}`, name: `${classicNames[index]} catalogue pair`, image: `https://example.test/classic-${index}.jpg` }));
const defaultClassics = { items: classicSearches.map((searchTerm, index) => ({ title: classicNames[index], searchTerm, product: classicProducts[index] })), configured: false, version: 0 };

// Before an admin saves, /api/latest-releases returns the newest four catalogue products.
const defaultLatest = { items: products.slice(0, 4), configured: false, version: 0 };

// Each homepage request is answered independently so one can fail alone.
const respond = (productBody, { ok = true, featured = featuredPicks, featuredOk = true, classics = defaultClassics, classicsResponse, latest = defaultLatest, latestResponse } = {}) => (path) => {
  if (path === "/api/hero-slides") return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  if (path === "/api/latest-releases") return latestResponse ? latestResponse() : Promise.resolve({ ok: true, json: async () => latest });
  if (path === "/api/featured-sneakers") return Promise.resolve({ ok: featuredOk, json: async () => (featuredOk ? featured : { error: "Unable to load featured sneakers" }) });
  if (path === "/api/classics") return classicsResponse ? classicsResponse() : Promise.resolve({ ok: true, json: async () => classics });
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
  expect(within(latest).getByText("Pulled directly from the Escowear catalogue")).toBeInTheDocument();
  expect(within(latest).getByRole("link", { name: "See every release" })).toHaveAttribute("href", "/store");
  expect(within(featured).getByText("3,258")).toBeInTheDocument();
  expect(within(featured).getByRole("link", { name: /shop all sneakers/i })).toHaveAttribute("href", "/store");
  expect(global.fetch).toHaveBeenCalledWith("/api/products?limit=4&page=1");
  expect(global.fetch).toHaveBeenCalledWith("/api/featured-sneakers", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(global.fetch).toHaveBeenCalledWith("/api/latest-releases", expect.objectContaining({ signal: expect.any(AbortSignal) }));
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

test("a catalogue count failure hides only the count, not featured or latest releases", async () => {
  global.fetch = jest.fn(respond({}, { ok: false }));
  renderHome();

  const featured = screen.getByRole("region", { name: /featured sneakers/i });
  const latest = screen.getByRole("region", { name: /latest releases/i });
  expect(await within(featured).findByText("Catalogue Runner 12")).toBeInTheDocument();
  expect(await within(latest).findByText("Catalogue Runner 1")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByText(/pairs in the catalogue/i)).not.toBeInTheDocument();
});

test("shows admin-saved latest releases in order with product cards, prices and detail links", async () => {
  const picked = [9, 3, 7, 1, 8, 2, 6, 5].map((index) => products[index - 1]);
  global.fetch = jest.fn(respond(catalogue, { latest: { items: [...picked, makeProduct(20)], configured: true, version: 4 } }));
  renderHome();

  const latest = screen.getByRole("region", { name: /latest releases/i });
  const links = await within(latest).findAllByRole("link", { name: /catalogue runner/i });
  // Never more than eight, in the saved order.
  expect(links.map((link) => link.getAttribute("href"))).toEqual(picked.map((item) => `/details/${item._id}`));
  expect(within(latest).getByText("£109.00")).toBeInTheDocument();
  expect(within(latest).getAllByRole("button", { name: /save .* to wishlist/i })).toHaveLength(8);
  expect(within(latest).getByText("Hand-picked from the Escowear catalogue")).toBeInTheDocument();
  expect(within(latest).queryByText(/pulled directly/i)).not.toBeInTheDocument();
  expect(within(latest).getByRole("link", { name: "See every release" })).toHaveAttribute("href", "/store");
  // Featured keeps its own selection.
  const featured = screen.getByRole("region", { name: /featured sneakers/i });
  expect(within(featured).getAllByRole("link", { name: /catalogue runner/i }).map((link) => link.getAttribute("href"))).toEqual(["/details/product-12", "/details/product-10", "/details/product-11", "/details/product-13"]);
});

test("a single saved latest release renders one card", async () => {
  global.fetch = jest.fn(respond(catalogue, { latest: { items: [products[4]], configured: true, version: 1 } }));
  renderHome();
  const latest = screen.getByRole("region", { name: /latest releases/i });
  const links = await within(latest).findAllByRole("link", { name: /catalogue runner/i });
  expect(links.map((link) => link.getAttribute("href"))).toEqual(["/details/product-5"]);
});

test("an intentionally empty latest releases selection shows the empty state, not catalogue products", async () => {
  global.fetch = jest.fn(respond(catalogue, { latest: { items: [], configured: true, version: 2 } }));
  renderHome();
  const latest = screen.getByRole("region", { name: /latest releases/i });
  expect(await within(latest).findByText(/new releases are on the way/i)).toBeInTheDocument();
  expect(within(latest).getByRole("link", { name: /browse all sneakers/i })).toHaveAttribute("href", "/store");
  expect(within(latest).queryByRole("link", { name: /catalogue runner/i })).not.toBeInTheDocument();
  expect(await screen.findByText("Catalogue Runner 12")).toBeInTheDocument();
});

test("aborts the latest releases request on unmount", async () => {
  let resolveLatest;
  global.fetch = jest.fn(respond(catalogue, { latestResponse: () => new Promise((resolve) => { resolveLatest = resolve; }) }));
  const { unmount } = renderHome();
  expect(screen.getByRole("status", { name: "Loading latest releases" })).toBeInTheDocument();
  expect(await screen.findByText("Catalogue Runner 12")).toBeInTheDocument();
  const [, options] = global.fetch.mock.calls.find(([path]) => path === "/api/latest-releases");
  unmount();
  expect(options.signal.aborted).toBe(true);
  await act(async () => resolveLatest({ ok: true, json: async () => defaultLatest }));
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

  const classics = await screen.findByRole("navigation", { name: /shop classic silhouettes/i });
  expect(within(classics).getByRole("link", { name: /air force 1/i })).toHaveAttribute("href", "/store?search=air%20force");
  expect(screen.getByRole("link", { name: /shop the classics/i })).toHaveAttribute("href", "/store");

  expect(screen.getByRole("region", { name: /latest releases/i })).toHaveAttribute("id", "latest-releases");
  expect(screen.getByRole("region", { name: /how escowear works/i })).toHaveAttribute("id", "how-it-works");
  // The hero fallback shares this headline, so match the about region by id.
  expect(screen.getAllByRole("region", { name: /authentic uk sneakers/i }).map((region) => region.id)).toContain("about");
});

const classicsNav = () => screen.findByRole("navigation", { name: /shop classic silhouettes/i });
const cardSummary = (nav) => within(nav).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href"), within(link).getByRole("img").getAttribute("src")]);

test("renders the default Classics from one request with catalogue photos and search links", async () => {
  global.fetch = jest.fn(respond(catalogue));
  renderHome();

  const section = screen.getByRole("region", { name: /the classics/i });
  expect(section).toHaveAttribute("id", "classics");
  expect(within(section).getByRole("heading", { level: 2, name: /the classics/i })).toBeInTheDocument();
  expect(within(section).getByText(/icons, always in rotation/i)).toBeInTheDocument();
  expect(within(section).getByRole("status", { name: "Loading the classics" })).toBeInTheDocument();

  const nav = await classicsNav();
  expect(cardSummary(nav)).toEqual([
    ["Air Force 1", "/store?search=air%20force", classicProducts[0].image],
    ["Dunk", "/store?search=dunk", classicProducts[1].image],
    ["Air Max", "/store?search=air%20max", classicProducts[2].image],
    ["Samba", "/store?search=samba", classicProducts[3].image],
    ["Spezial", "/store?search=spezial", classicProducts[4].image],
    ["Campus", "/store?search=campus", classicProducts[5].image],
  ]);
  within(nav).getAllByRole("link").forEach((link, index) => {
    // Product alt text must not duplicate the card link's accessible name.
    expect(link).toHaveAccessibleName(classicNames[index]);
    expect(within(link).getByRole("img", { name: classicProducts[index].name })).toBeInTheDocument();
  });
  // One Classics request replaces the old per-silhouette product searches.
  expect(global.fetch.mock.calls.filter(([path]) => path === "/api/classics")).toHaveLength(1);
  expect(global.fetch.mock.calls.filter(([path]) => String(path).includes("search="))).toHaveLength(0);
  // Cards span brands, so the section CTA opens the full store rather than one brand.
  expect(within(section).getByRole("link", { name: /shop the classics/i })).toHaveAttribute("href", "/store");
});

test("shows admin-saved Classics in order with encoded search links and no product-detail links", async () => {
  const saved = {
    configured: true,
    version: 4,
    items: [
      { title: "Jordan 4", searchTerm: "jordan 4", product: { _id: "p-1", name: "Air Jordan 4 Retro", image: "https://example.test/j4.jpg" } },
      { title: "990v6", searchTerm: "990 & v6", product: { _id: "p-2", name: "New Balance 990v6", image: "https://example.test/990.jpg" } },
    ],
  };
  global.fetch = jest.fn(respond(catalogue, { classics: saved }));
  renderHome();
  const nav = await classicsNav();
  expect(cardSummary(nav)).toEqual([
    ["Jordan 4", "/store?search=jordan%204", "https://example.test/j4.jpg"],
    ["990v6", "/store?search=990%20%26%20v6", "https://example.test/990.jpg"],
  ]);
  expect(within(nav).queryByRole("link", { name: /air force/i })).not.toBeInTheDocument();
  within(nav).getAllByRole("link").forEach((link) => expect(link.getAttribute("href")).not.toMatch(/^\/details\//));
});

test("never renders more than six Classics cards", async () => {
  const items = Array.from({ length: 8 }, (_, index) => ({ title: `Card ${index + 1}`, searchTerm: `card ${index + 1}`, product: null }));
  global.fetch = jest.fn(respond(catalogue, { classics: { items, configured: true, version: 1 } }));
  renderHome();
  expect(within(await classicsNav()).getAllByRole("link")).toHaveLength(6);
});

test("an intentionally empty Classics selection shows an empty state, not defaults", async () => {
  global.fetch = jest.fn(respond(catalogue, { classics: { items: [], configured: true, version: 2 } }));
  renderHome();
  const section = screen.getByRole("region", { name: /the classics/i });
  expect(await within(section).findByText(/new classics are on the way/i)).toBeInTheDocument();
  expect(within(section).getByRole("link", { name: /browse all sneakers/i })).toHaveAttribute("href", "/store");
  expect(screen.queryByRole("navigation", { name: /shop classic silhouettes/i })).not.toBeInTheDocument();
  // The empty state's own link replaces the section CTA.
  expect(within(section).queryByRole("link", { name: /shop the classics/i })).not.toBeInTheDocument();
  expect(await screen.findByText("Catalogue Runner 1")).toBeInTheDocument();
});

test.each([
  ["an HTTP failure", () => Promise.resolve({ ok: false, json: async () => ({ error: "Unable to load classics" }) })],
  ["a network failure", () => Promise.reject(new Error("Offline"))],
  ["invalid JSON", () => Promise.resolve({ ok: true, json: async () => { throw new SyntaxError("Invalid JSON"); } })],
])("falls back to the built-in Classics links on %s without hiding Featured or Latest Releases", async (_, classicsResponse) => {
  global.fetch = jest.fn(respond(catalogue, { classicsResponse }));
  renderHome();
  const nav = await classicsNav();
  expect(cardSummary(nav)).toEqual(classicSearches.map((search, index) => [classicNames[index], `/store?search=${encodeURIComponent(search)}`, "/images/default.jpg"]));
  expect(within(nav).getByRole("img", { name: "Air Force 1 sneaker" })).toBeInTheDocument();
  expect(await screen.findByText("Catalogue Runner 12")).toBeInTheDocument();
  expect(await screen.findByText("Catalogue Runner 1")).toBeInTheDocument();
});

test("a card without a cover image uses the default image, then hides a broken default", async () => {
  const classics = { ...defaultClassics, items: defaultClassics.items.map((item, index) => (index === 0 ? { ...item, product: { _id: "af1", name: "Air Force 1 pair", image: "" } } : item)) };
  global.fetch = jest.fn(respond(catalogue, { classics }));
  renderHome();
  const image = await screen.findByRole("img", { name: "Air Force 1 pair" });
  expect(image).toHaveAttribute("src", "/images/default.jpg");
  fireEvent.error(image);
  expect(image).not.toBeVisible();
  expect(screen.getByRole("link", { name: "Air Force 1" })).toBeVisible();

  const dunk = screen.getByRole("img", { name: "Dunk catalogue pair" });
  fireEvent.error(dunk);
  expect(dunk).toHaveAttribute("src", "/images/default.jpg");
});

test("aborts the Classics request on unmount", async () => {
  let resolveClassics;
  global.fetch = jest.fn(respond(catalogue, { classicsResponse: () => new Promise((resolve) => { resolveClassics = resolve; }) }));
  const { unmount } = renderHome();
  expect(screen.getByRole("status", { name: "Loading the classics" })).toBeInTheDocument();
  expect(await screen.findByText("Catalogue Runner 1")).toBeInTheDocument();
  const [, options] = global.fetch.mock.calls.find(([path]) => path === "/api/classics");
  unmount();
  expect(options.signal.aborted).toBe(true);
  // A body resolving after navigation must not cause another state update.
  await act(async () => resolveClassics({ ok: true, json: async () => defaultClassics }));
});

test("a latest releases failure retries on its own without hiding Featured or the Classics", async () => {
  global.fetch = jest.fn(respond(catalogue, { latestResponse: () => Promise.resolve({ ok: false, json: async () => ({ error: "Unable to load latest releases" }) }) }));
  renderHome();

  const latest = screen.getByRole("region", { name: /latest releases/i });
  const alert = await within(latest).findByRole("alert");
  expect(alert).toHaveTextContent("Unable to load latest releases");
  expect(await screen.findByText("Catalogue Runner 12")).toBeInTheDocument();
  expect(await classicsNav()).toBeInTheDocument();
  expect(within(latest).queryByText(/from the escowear catalogue/i)).not.toBeInTheDocument();

  global.fetch.mockImplementation(respond(catalogue));
  await userEvent.click(within(alert).getByRole("button", { name: /try again/i }));
  expect(await within(latest).findByText("Catalogue Runner 1")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(global.fetch.mock.calls.filter(([path]) => path === "/api/products?limit=4&page=1")).toHaveLength(1);
});

test("shows an empty state that routes to the store when no sneakers are available", async () => {
  global.fetch = jest.fn(respond({ items: [], pagination: { total: 0, page: 1, limit: 4, pages: 0 } }, { featured: { items: [], version: 0 }, latest: { items: [], configured: false, version: 0 } }));
  renderHome();

  expect(await screen.findByText(/no sneakers are available/i)).toBeInTheDocument();
  expect(screen.getByText(/new releases are on the way/i)).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: /browse all sneakers/i })[0]).toHaveAttribute("href", "/store");
  expect(screen.queryByText(/pairs in the catalogue/i)).not.toBeInTheDocument();
});
