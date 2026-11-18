import {
  MAX_WISHLIST_ITEMS,
  WISHLIST_CHANGE_EVENT,
  WISHLIST_KEY,
  readWishlist,
  saveWishlist,
  toggleWishlistId,
  wishlistLinkLabel,
} from "./wishlist";

beforeEach(() => localStorage.clear());
afterEach(() => jest.restoreAllMocks());

test("reads an empty wishlist when nothing is stored", () => {
  expect(readWishlist()).toEqual([]);
});

test("treats corrupt or non-list storage as an empty wishlist", () => {
  localStorage.setItem(WISHLIST_KEY, "{not json");
  expect(readWishlist()).toEqual([]);
  localStorage.setItem(WISHLIST_KEY, JSON.stringify({ id: "p1" }));
  expect(readWishlist()).toEqual([]);
});

test("keeps only unique, well-formed product ids in saved order", () => {
  localStorage.setItem(WISHLIST_KEY, JSON.stringify(["p2", "p1", "p2", 7, null, "", "x".repeat(65), { id: "p3" }, "p3"]));
  expect(readWishlist()).toEqual(["p2", "p1", "p3"]);
});

test("caps the stored list so a tampered entry cannot trigger unbounded requests", () => {
  const ids = Array.from({ length: MAX_WISHLIST_ITEMS + 20 }, (_, index) => `p${index}`);
  localStorage.setItem(WISHLIST_KEY, JSON.stringify(ids));
  expect(readWishlist()).toHaveLength(MAX_WISHLIST_ITEMS);
});

test("toggling adds a missing id and removes a saved one", () => {
  expect(toggleWishlistId(["p1"], "p2")).toEqual(["p1", "p2"]);
  expect(toggleWishlistId(["p1", "p2"], "p1")).toEqual(["p2"]);
});

test("saving persists unique ids and notifies listeners in this tab", () => {
  const listener = jest.fn();
  window.addEventListener(WISHLIST_CHANGE_EVENT, listener);
  expect(saveWishlist(["p1", "p1", "p2"])).toBe(true);
  window.removeEventListener(WISHLIST_CHANGE_EVENT, listener);

  expect(JSON.parse(localStorage.getItem(WISHLIST_KEY))).toEqual(["p1", "p2"]);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener.mock.calls[0][0].detail).toEqual(["p1", "p2"]);
});

test("reports a failed write instead of throwing when storage is unavailable", () => {
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("QuotaExceededError");
  });
  expect(saveWishlist(["p1"])).toBe(false);
});

test("link label announces the saved count", () => {
  expect(wishlistLinkLabel(0)).toBe("Wishlist");
  expect(wishlistLinkLabel(1)).toBe("Wishlist, 1 saved item");
  expect(wishlistLinkLabel(3)).toBe("Wishlist, 3 saved items");
});
