import { render, screen, within } from "@testing-library/react";
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

const respond = (productBody, { ok = true } = {}) => (path) =>
  Promise.resolve({
    ok: path === "/api/hero-slides" ? true : ok,
    json: async () => (path === "/api/hero-slides" ? { items: [] } : productBody),
  });

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

test("splits the catalogue into featured and latest sections and shows the catalogue total", async () => {
  global.fetch = jest.fn(respond({ items: products, pagination: { total: 3258, page: 1, limit: 9, pages: 362 } }));
  renderHome();

  const featured = screen.getByRole("region", { name: /featured sneakers/i });
  const latest = screen.getByRole("region", { name: /latest releases/i });

  expect(await within(featured).findByText("Catalogue Runner 1")).toBeInTheDocument();
  expect(within(featured).getAllByRole("link", { name: /catalogue runner/i })).toHaveLength(5);
  expect(within(latest).getAllByRole("link", { name: /catalogue runner/i })).toHaveLength(4);
  expect(within(latest).getByRole("link", { name: /catalogue runner 6/i })).toHaveAttribute("href", "/details/product-6");
  expect(within(featured).getByText("3,258")).toBeInTheDocument();
  expect(within(featured).getByRole("link", { name: /shop all sneakers/i })).toHaveAttribute("href", "/store");
  expect(global.fetch).toHaveBeenCalledWith("/api/products?limit=9&page=1");
});

test("links brand and classic discovery to live catalogue searches", async () => {
  global.fetch = jest.fn(respond({ items: products, pagination: { total: 9, page: 1, limit: 9, pages: 1 } }));
  renderHome();
  await screen.findByText("Catalogue Runner 1");

  const collections = screen.getByRole("region", { name: /shop by brand/i });
  expect(collections).toHaveAttribute("id", "collections");
  expect(within(collections).getByRole("link", { name: /new balance/i })).toHaveAttribute("href", "/store?search=new%20balance");
  expect(within(collections).getByRole("link", { name: /jordan/i })).toHaveAttribute("href", "/store?search=jordan");

  const classics = screen.getByRole("navigation", { name: /shop classic silhouettes/i });
  expect(within(classics).getByRole("link", { name: /air force 1/i })).toHaveAttribute("href", "/store?search=air%20force");
  expect(screen.getByRole("link", { name: /shop the classics/i })).toHaveAttribute("href", "/store?search=nike");

  expect(screen.getByRole("region", { name: /latest releases/i })).toHaveAttribute("id", "latest-releases");
  expect(screen.getByRole("region", { name: /how escowear works/i })).toHaveAttribute("id", "how-it-works");
  // The hero fallback shares this headline, so match the about region by id.
  expect(screen.getAllByRole("region", { name: /authentic uk sneakers/i }).map((region) => region.id)).toContain("about");
});

test("offers a retry when the catalogue request fails", async () => {
  global.fetch = jest.fn(respond({}, { ok: false }));
  renderHome();

  const alerts = await screen.findAllByRole("alert");
  expect(alerts).toHaveLength(2);
  global.fetch.mockImplementation(respond({ items: products, pagination: { total: 9, page: 1, limit: 9, pages: 1 } }));
  await userEvent.click(within(alerts[0]).getByRole("button", { name: /try again/i }));

  expect(await screen.findByText("Catalogue Runner 1")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("shows an empty state that routes to the store when no sneakers are available", async () => {
  global.fetch = jest.fn(respond({ items: [], pagination: { total: 0, page: 1, limit: 9, pages: 0 } }));
  renderHome();

  expect(await screen.findByText(/no sneakers are available/i)).toBeInTheDocument();
  expect(screen.getByText(/new releases are on the way/i)).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: /browse all sneakers/i })[0]).toHaveAttribute("href", "/store");
  expect(screen.queryByText(/pairs in the catalogue/i)).not.toBeInTheDocument();
});
