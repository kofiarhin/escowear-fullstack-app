import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Cart from "./Cart.page";
import { CART_KEY } from "../../utils/cart";

const items = [
  { productId: "p1", size: "UK 8", quantity: 2, name: "Nike Air Max Dn8", image: "https://example.test/dn8.jpg", price: 164.99, currency: "GBP" },
  { productId: "p2", size: "UK 9", quantity: 1, name: "Adidas Samba", image: "https://example.test/samba.jpg", price: 90, currency: "GBP" },
];

const renderCart = () => render(<MemoryRouter><Cart /></MemoryRouter>);
const storedCart = () => JSON.parse(localStorage.getItem(CART_KEY));
const subtotal = () => within(screen.getByRole("complementary", { name: /order summary/i })).getByText(/^£/);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(CART_KEY, JSON.stringify(items));
});

test("shows image, name, size, unit price, line total and subtotal for each item", () => {
  renderCart();
  expect(screen.getByRole("img", { name: "Nike Air Max Dn8" })).toHaveAttribute("src", "https://example.test/dn8.jpg");
  expect(screen.getByText("Size: UK 8")).toBeInTheDocument();
  expect(screen.getByText("£164.99 each")).toBeInTheDocument();
  expect(screen.getByText("£329.98")).toBeInTheDocument();
  expect(subtotal()).toHaveTextContent("£419.98");
  expect(screen.getByText("3 items")).toBeInTheDocument();
});

test("steps quantity within limits and persists the change", async () => {
  renderCart();
  await userEvent.click(screen.getByRole("button", { name: "Increase quantity of Adidas Samba" }));
  expect(storedCart()[1].quantity).toBe(2);
  expect(subtotal()).toHaveTextContent("£509.98");

  const decrease = screen.getByRole("button", { name: "Decrease quantity of Adidas Samba" });
  await userEvent.click(decrease);
  expect(storedCart()[1].quantity).toBe(1);
  expect(decrease).toBeDisabled();
});

test("removes a single item and clears the cart", async () => {
  renderCart();
  await userEvent.click(screen.getByRole("button", { name: "Remove Nike Air Max Dn8 UK 8" }));
  expect(storedCart()).toEqual([items[1]]);
  expect(screen.queryByText("Nike Air Max Dn8")).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Clear Cart" }));
  expect(storedCart()).toEqual([]);
  expect(screen.getByRole("heading", { name: /your cart is empty/i })).toBeInTheDocument();
});

test("links to guest checkout", () => {
  renderCart();
  expect(screen.getByRole("link", { name: /continue to checkout/i })).toHaveAttribute("href", "/checkout");
});

test("empty cart shows a continue shopping link to the store", () => {
  localStorage.clear();
  renderCart();
  expect(screen.getByRole("heading", { name: /your cart is empty/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Continue Shopping" })).toHaveAttribute("href", "/store");
});
