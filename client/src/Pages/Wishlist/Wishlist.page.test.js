import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Wishlist from "./Wishlist.page";
import { WISHLIST_KEY } from "../../utils/wishlist";
import { CART_KEY } from "../../utils/cart";

const samba = { _id: "p1", name: "Adidas Samba", category: "shoes", price: 90, currency: "GBP", image: "https://example.test/samba.jpg", sizes: ["8", "9"], inStock: true };
const dn8 = { _id: "p2", name: "Nike Air Max Dn8", category: "shoes", price: 164.99, currency: "GBP", image: "https://example.test/dn8.jpg", sizes: ["10"], inStock: false };
const noSizes = { _id: "p3", name: "Asics Gel-1130", price: 110, currency: "GBP", image: "https://example.test/asics.jpg", sizes: [], inStock: true };

const json = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
const catalogue = { p1: samba, p2: dn8, p3: noSizes };

const mockProducts = (overrides = {}) => {
  global.fetch = jest.fn((path) => {
    const id = decodeURIComponent(path.split("/").pop());
    if (overrides[id]) return overrides[id]();
    return catalogue[id] ? json(200, catalogue[id]) : json(404, { error: "Product not found" });
  });
};

const save = (ids) => localStorage.setItem(WISHLIST_KEY, JSON.stringify(ids));
const storedWishlist = () => JSON.parse(localStorage.getItem(WISHLIST_KEY) || "[]");
const storedCart = () => JSON.parse(localStorage.getItem(CART_KEY) || "[]");
const renderWishlist = () => render(<MemoryRouter><Wishlist /></MemoryRouter>);

beforeEach(() => {
  localStorage.clear();
  mockProducts();
});

test("shows an empty state that points back to the store", () => {
  renderWishlist();
  expect(screen.getByRole("heading", { name: "Your wishlist is empty" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Browse sneakers" })).toHaveAttribute("href", "/store?category=shoes");
  expect(global.fetch).not.toHaveBeenCalled();
});

test("corrupt storage shows the empty state instead of crashing", () => {
  localStorage.setItem(WISHLIST_KEY, "{broken");
  renderWishlist();
  expect(screen.getByRole("heading", { name: "Your wishlist is empty" })).toBeInTheDocument();
});

test("lists saved sneakers with current price, image, availability and sizes", async () => {
  save(["p1", "p2"]);
  renderWishlist();
  expect(screen.getByText("Loading your saved sneakers…")).toBeInTheDocument();

  const samba = within(await screen.findByRole("listitem", { name: "Adidas Samba" }));
  expect(samba.getByText("£90.00")).toBeInTheDocument();
  expect(samba.getByText("2 sizes available")).toBeInTheDocument();
  expect(samba.getByRole("button", { name: "UK 8" })).toBeInTheDocument();
  expect(samba.getByRole("button", { name: "UK 9" })).toBeInTheDocument();
  expect(samba.getByRole("link", { name: "Adidas Samba" })).toHaveAttribute("href", "/details/p1");
  expect(samba.getByRole("img", { name: "Adidas Samba" })).toHaveAttribute("src", "https://example.test/samba.jpg");
  expect(screen.getByText("2 saved pairs")).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith("/api/products/p1", expect.anything());
});

test("adds a saved sneaker to the cart using the existing size rules", async () => {
  save(["p1"]);
  renderWishlist();
  const item = within(await screen.findByRole("listitem", { name: "Adidas Samba" }));

  const addButton = item.getByRole("button", { name: "Add to cart" });
  expect(addButton).toBeDisabled();

  await userEvent.click(item.getByRole("button", { name: "UK 9" }));
  expect(item.getByRole("button", { name: "UK 9" })).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(addButton);

  expect(storedCart()).toEqual([expect.objectContaining({ productId: "p1", size: "UK 9", quantity: 1, price: 90, currency: "GBP" })]);
  expect(item.getByRole("status")).toHaveTextContent("Adidas Samba (UK 9) added to your cart.");
  expect(item.getByRole("link", { name: "View cart" })).toHaveAttribute("href", "/cart");
  expect(storedWishlist()).toEqual(["p1"]);

  await userEvent.click(addButton);
  expect(storedCart()[0].quantity).toBe(2);
});

test("sold-out sneakers and products without sizes cannot be added to the cart", async () => {
  save(["p2", "p3"]);
  renderWishlist();

  const soldOut = within(await screen.findByRole("listitem", { name: "Nike Air Max Dn8" }));
  expect(soldOut.getByText("Sold out")).toBeInTheDocument();
  expect(soldOut.getByRole("button", { name: "Currently unavailable" })).toBeDisabled();
  expect(soldOut.queryByRole("button", { name: /^UK/ })).not.toBeInTheDocument();

  const sizeless = within(screen.getByRole("listitem", { name: "Asics Gel-1130" }));
  expect(sizeless.getByText(/size information is unavailable/i)).toBeInTheDocument();
  expect(sizeless.getByRole("button", { name: "Add to cart" })).toBeDisabled();
  expect(storedCart()).toEqual([]);
});

test("a size the cart rules reject shows an error instead of adding", async () => {
  // A non-GBP price fails addCartItem's validation even with a size chosen.
  mockProducts({ p1: () => json(200, { ...samba, currency: "USD" }) });
  save(["p1"]);
  renderWishlist();
  const item = within(await screen.findByRole("listitem", { name: "Adidas Samba" }));
  await userEvent.click(item.getByRole("button", { name: "UK 8" }));
  await userEvent.click(item.getByRole("button", { name: "Add to cart" }));
  expect(storedCart()).toEqual([]);
  expect(item.getByRole("status")).toHaveTextContent(/couldn't be added to your cart/i);
});

test("does not report success when the cart line is already at its maximum quantity", async () => {
  localStorage.setItem(CART_KEY, JSON.stringify([{ productId: "p1", size: "UK 9", quantity: 10, name: "Adidas Samba", price: 90, currency: "GBP" }]));
  save(["p1"]);
  renderWishlist();
  const item = within(await screen.findByRole("listitem", { name: "Adidas Samba" }));
  await userEvent.click(item.getByRole("button", { name: "UK 9" }));
  await userEvent.click(item.getByRole("button", { name: "Add to cart" }));
  expect(storedCart()[0].quantity).toBe(10);
  expect(item.getByRole("status")).toHaveTextContent(/couldn't be added to your cart/i);
});

test("removed or unknown products are flagged and can be removed", async () => {
  save(["gone", "p1"]);
  renderWishlist();

  expect(await screen.findByText("This sneaker is no longer available.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Remove Unavailable sneaker 1 from wishlist" }));

  expect(storedWishlist()).toEqual(["p1"]);
  expect(screen.getByText("Unavailable sneaker 1 removed from your wishlist.")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Wishlist" })).toHaveFocus();
  expect(screen.queryByText("This sneaker is no longer available.")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Adidas Samba" })).toBeInTheDocument();
});

test("API and network errors offer a retry that reloads only that sneaker", async () => {
  let attempts = 0;
  mockProducts({
    p1: () => {
      attempts += 1;
      return attempts === 1 ? json(500, { error: "Server error" }) : json(200, samba);
    },
    p2: () => Promise.reject(new TypeError("Failed to fetch")),
  });
  save(["p1", "p2"]);
  renderWishlist();

  const failures = await screen.findAllByRole("listitem", { name: "We couldn't load this sneaker." });
  expect(failures).toHaveLength(2);

  await userEvent.click(within(failures[0]).getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { name: "Adidas Samba" })).toBeInTheDocument();
  expect(attempts).toBe(2);
  expect(screen.getAllByText("We couldn't load this sneaker.")).toHaveLength(1);
});

test("removing a saved sneaker updates storage and shows the empty state when none remain", async () => {
  save(["p1"]);
  renderWishlist();
  await userEvent.click(await screen.findByRole("button", { name: "Remove Adidas Samba from wishlist" }));
  expect(storedWishlist()).toEqual([]);
  expect(screen.getByRole("heading", { name: "Your wishlist is empty" })).toHaveFocus();
  expect(screen.getByText("Adidas Samba removed from your wishlist.")).toBeInTheDocument();
});

test("sneakers saved in another tab appear without a reload", async () => {
  save(["p1"]);
  renderWishlist();
  await screen.findByRole("heading", { name: "Adidas Samba" });

  act(() => {
    save(["p1", "p3"]);
    window.dispatchEvent(new StorageEvent("storage", { key: WISHLIST_KEY }));
  });
  expect(await screen.findByRole("heading", { name: "Asics Gel-1130" })).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(2);
});
