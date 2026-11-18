import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { createStore } from "redux";
import reducers from "../../redux/reducers";
import Header from "../Header/Header.component";
import Product from "../Product/Product.component";
import WishlistButton from "./WishlistButton.component";
import { MAX_WISHLIST_ITEMS, WISHLIST_KEY } from "../../utils/wishlist";

const product = { _id: "p1", name: "Adidas Samba", price: 90, currency: "GBP", image: "https://example.test/samba.jpg", sizes: ["8"], inStock: true };
const stored = () => JSON.parse(localStorage.getItem(WISHLIST_KEY) || "[]");

const renderWithHeader = (ui) =>
  render(
    <Provider store={createStore(reducers)}>
      <MemoryRouter>
        <Header setShowSideNav={() => {}} />
        {ui}
      </MemoryRouter>
    </Provider>
  );

beforeEach(() => localStorage.clear());
afterEach(() => jest.restoreAllMocks());

test("heart saves and removes a sneaker and announces the change", async () => {
  render(<WishlistButton productId="p1" productName="Adidas Samba" />);

  await userEvent.click(screen.getByRole("button", { name: "Save Adidas Samba to wishlist" }));
  expect(stored()).toEqual(["p1"]);
  expect(screen.getByRole("status")).toHaveTextContent("Adidas Samba saved to your wishlist");

  await userEvent.click(screen.getByRole("button", { name: "Remove Adidas Samba from wishlist" }));
  expect(stored()).toEqual([]);
  expect(screen.getByRole("status")).toHaveTextContent("Adidas Samba removed from your wishlist");
});

test("heart is keyboard operable", async () => {
  render(<WishlistButton productId="p1" productName="Adidas Samba" />);
  await userEvent.tab();
  expect(screen.getByRole("button", { name: "Save Adidas Samba to wishlist" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(stored()).toEqual(["p1"]);
});

test("product card heart sits beside the details link and stays in sync with the header counter", async () => {
  renderWithHeader(<Product data={product} index={0} />);

  const detailsLink = screen.getByRole("link", { name: /adidas samba/i });
  const heart = screen.getByRole("button", { name: "Save Adidas Samba to wishlist" });
  expect(detailsLink).toHaveAttribute("href", "/details/p1");
  expect(detailsLink).not.toContainElement(heart);
  expect(screen.getByRole("link", { name: "Wishlist" })).toHaveAttribute("href", "/wishlist");

  await userEvent.click(heart);
  expect(screen.getByRole("link", { name: "Wishlist, 1 saved item" })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Remove Adidas Samba from wishlist" }));
  expect(screen.getByRole("link", { name: "Wishlist" })).toBeInTheDocument();
});

test("separate hearts for the same sneaker stay synchronized", async () => {
  render(
    <>
      <WishlistButton productId="p1" productName="Card heart" />
      <WishlistButton productId="p1" productName="Detail heart" />
    </>
  );
  await userEvent.click(screen.getByRole("button", { name: "Save Card heart to wishlist" }));
  expect(screen.getByRole("button", { name: "Remove Detail heart from wishlist" })).toBeInTheDocument();
});

test("changes made in another browser tab update hearts and the counter", () => {
  renderWithHeader(<WishlistButton productId="p1" productName="Adidas Samba" />);

  act(() => {
    localStorage.setItem(WISHLIST_KEY, JSON.stringify(["p1", "p2"]));
    window.dispatchEvent(new StorageEvent("storage", { key: WISHLIST_KEY }));
  });
  expect(screen.getByRole("button", { name: "Remove Adidas Samba from wishlist" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Wishlist, 2 saved items" })).toBeInTheDocument();

  act(() => {
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
  });
  expect(screen.getByRole("button", { name: "Save Adidas Samba to wishlist" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Wishlist" })).toBeInTheDocument();
});

test("corrupt storage renders an unsaved heart instead of crashing", () => {
  localStorage.setItem(WISHLIST_KEY, "not json");
  render(<WishlistButton productId="p1" productName="Adidas Samba" />);
  expect(screen.getByRole("button", { name: "Save Adidas Samba to wishlist" })).toBeInTheDocument();
});

test("a full wishlist explains why the sneaker was not saved", async () => {
  localStorage.setItem(WISHLIST_KEY, JSON.stringify(Array.from({ length: MAX_WISHLIST_ITEMS }, (_, index) => `x${index}`)));
  render(<WishlistButton productId="p1" productName="Adidas Samba" />);
  await userEvent.click(screen.getByRole("button", { name: "Save Adidas Samba to wishlist" }));
  expect(stored()).not.toContain("p1");
  expect(screen.getByRole("status")).toHaveTextContent(/wishlist is full/i);
});

test("a storage failure is reported to the customer", async () => {
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("QuotaExceededError");
  });
  render(<WishlistButton productId="p1" productName="Adidas Samba" />);
  await userEvent.click(screen.getByRole("button", { name: "Save Adidas Samba to wishlist" }));
  expect(screen.getByRole("status")).toHaveTextContent("We couldn't update your wishlist on this device.");
});
