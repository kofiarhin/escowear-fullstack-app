import { addCartItem, cartSubtotal, readCart, saveCart, CART_KEY } from "./cart";
const product = { _id: "p1", name: "Sneaker", sizes: ["8", "9"], price: 120, currency: "GBP" };
beforeEach(() => localStorage.clear());
test("merges matching sizes and keeps different sizes separate", () => {
  const first = addCartItem([], product, "UK 8", 1);
  const merged = addCartItem(first, product, "UK 8", 2);
  expect(merged).toHaveLength(1);
  expect(merged[0].quantity).toBe(3);
  expect(addCartItem(merged, product, "UK 9", 1)).toHaveLength(2);
  expect(cartSubtotal(merged)).toBe(36000);
});
test("rejects invalid sizes, stock and quantity", () => {
  expect(addCartItem([], product, "UK 10", 1)).toEqual([]);
  expect(addCartItem([], product, "UK 8", 0)).toEqual([]);
  expect(addCartItem([], { ...product, inStock: false }, "UK 8", 1)).toEqual([]);
});
test("persists valid cart and recovers corrupt storage", () => {
  const cart = addCartItem([], product, "UK 8", 1);
  saveCart(cart);
  expect(readCart()).toEqual(cart);
  localStorage.setItem(CART_KEY, "{bad json");
  expect(readCart()).toEqual([]);
});
