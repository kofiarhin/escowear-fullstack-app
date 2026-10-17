import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { applyMiddleware, createStore } from "redux";
import thunkMiddleware from "redux-thunk";
import App from "./App";
import reducers from "./redux/reducers";

const products = [
  {
    _id: "product-1",
    name: "Nike Air Max Dn8",
    category: "shoes",
    color: "black",
    price: 164.99,
    currency: "GBP",
    image: "https://example.test/nike-air-max-dn8.jpg",
    sizes: ["8", "9", "10"],
    inStock: true,
    retailer: { slug: "nike", name: "Nike" },
    productUrl: "https://example.test/products/nike-air-max-dn8",
    source: { category: "lifestyle-shoes" },
  },
];

const productPage = {
  items: products,
  pagination: { total: 25, page: 1, limit: 8, pages: 4 },
};

beforeEach(() => {
  window.history.pushState({}, "", "/");
  localStorage.clear();
  sessionStorage.clear();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => productPage,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

const renderApp = () => {
  const store = createStore(reducers, applyMiddleware(thunkMiddleware));
  return render(
    <Provider store={store}>
      <App />
    </Provider>
  );
};

test("renders the sneaker homepage and products from the API", async () => {
  renderApp();

  expect(
    screen.getByRole("heading", { name: /uk sneakers to ghana/i })
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Shop Sneakers" })).toHaveAttribute(
    "href",
    "/store"
  );

  expect(await screen.findByText("Nike Air Max Dn8")).toBeInTheDocument();
  expect(screen.getByText("£164.99")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /nike air max dn8/i })).toHaveAttribute(
    "src",
    "https://example.test/nike-air-max-dn8.jpg"
  );
  await waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/products?limit=8&page=1"
    )
  );
});

test("opens and closes the accessible navigation menu", async () => {
  renderApp();
  await screen.findByText("Nike Air Max Dn8");

  await userEvent.click(
    screen.getByRole("button", { name: /open navigation/i })
  );

  const navigation = screen.getByRole("dialog", { name: /site navigation/i });
  expect(navigation).toBeInTheDocument();
  expect(within(navigation).getByRole("link", { name: /shop/i })).toHaveAttribute(
    "href",
    "/store"
  );
  expect(within(navigation).getByRole("link", { name: /new releases/i })).toHaveAttribute(
    "href",
    "/#latest-releases"
  );

  await userEvent.click(
    screen.getByRole("button", { name: /close navigation/i })
  );
  expect(
    screen.queryByRole("dialog", { name: /site navigation/i })
  ).not.toBeInTheDocument();
});

test("loads the store from search and page query parameters", async () => {
  window.history.pushState(
    {},
    "",
    "/store?search=nike&page=2"
  );
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      items: products,
      pagination: { total: 25, page: 2, limit: 24, pages: 4 },
    }),
  });

  renderApp();

  expect(await screen.findByText("Nike Air Max Dn8")).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Sneakers / nike" })
  ).toBeInTheDocument();
  expect(screen.getByText("25 sneakers")).toBeInTheDocument();
  expect(screen.getByText("Page 2 of 4")).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(
    "/api/products?search=nike&limit=24&page=2"
  );
});

test("renders imported product details and preserves cart navigation", async () => {
  window.history.pushState({}, "", "/details/product-1");
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => products[0],
  });

  renderApp();

  expect(
    await screen.findByRole("heading", { name: "Nike Air Max Dn8" })
  ).toBeInTheDocument();
  expect(screen.getByText("£164.99")).toBeInTheDocument();
  expect(screen.getByText("UK 8")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /view at nike/i })).toHaveAttribute(
    "href",
    "https://example.test/products/nike-air-max-dn8"
  );

  await userEvent.click(screen.getByRole("button", { name: /add to cart/i }));
  expect(window.location.pathname).toBe("/cart");
  expect(JSON.parse(sessionStorage.getItem("cartData"))).toHaveLength(1);
});
