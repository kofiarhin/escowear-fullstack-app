import { fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { createStore } from "redux";
import App from "../../App";
import reducers from "../../redux/reducers";

const stats = {
  orders: { total: 12, byStatus: { payment_review: 2, pending_contact: 1, confirmed: 3, processing: 1, completed: 5 } },
  products: { total: 9, published: 7, draft: 2 },
  heroSlides: { total: 3, active: 2 },
  featured: { count: 3, max: 4 },
  recentOrders: [{ id: "recent", orderNumber: "EW-RECENT", status: "completed", customer: { name: "Ama" } }],
  attentionOrders: [{ id: "attention", orderNumber: "EW-REVIEW", status: "payment_review", proofAwaitingReview: true }],
};
const response = (status, data) => ({ ok: status === 200, status, json: async () => data });
const renderOverview = (role = "admin") => {
  window.history.pushState({}, "", "/admin");
  const store = createStore(reducers);
  if (role) store.dispatch({ type: "LOGIN_SUCCESS", payload: { name: "Admin User", role, token: "test-token" } });
  else store.dispatch({ type: "LOGOUT_USER" });
  return { ...render(<Provider store={store}><App /></Provider>), store };
};
const card = (name) => screen.getByRole("article", { name });

afterEach(() => { localStorage.clear(); jest.restoreAllMocks(); });

test("/admin renders counts, safe order rows and filtered links from stats", async () => {
  global.fetch = jest.fn().mockResolvedValue(response(200, stats));
  renderOverview();
  expect(screen.getByRole("status")).toHaveTextContent("Loading dashboard");
  await screen.findByRole("heading", { name: "Needs action" });
  expect(within(card("Needs action")).getByText("3")).toBeInTheDocument();
  expect(within(card("In progress")).getByText("4")).toBeInTheDocument();
  expect(within(card("Total orders")).getByText("12")).toBeInTheDocument();
  expect(within(card("Published products")).getByText("7")).toBeInTheDocument();
  expect(within(card("Hero slides active")).getByText("2/8")).toBeInTheDocument();
  expect(within(card("Featured sneakers set")).getByText("3/4")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /payment review 2/i })).toHaveAttribute("href", "/admin/orders?status=payment_review");
  expect(screen.getByRole("link", { name: "View completed orders" })).toHaveAttribute("href", "/admin/orders?status=completed");
  expect(screen.getByRole("link", { name: "Drafts" })).toHaveAttribute("href", "/admin/products?status=draft");
  expect(screen.getByRole("link", { name: "EW-REVIEW" })).toHaveAttribute("href", "/admin/orders/attention");
  expect(screen.getByRole("link", { name: "EW-RECENT" })).toHaveAttribute("href", "/admin/orders/recent");
  expect(screen.getByText("New proof to check")).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith("/api/admin/stats", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-token" }) }));
});

test("failed stats show Retry and recover", async () => {
  global.fetch = jest.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(response(200, stats));
  renderOverview();
  expect(await screen.findByRole("alert")).toHaveTextContent("Dashboard figures could not be loaded");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("heading", { name: "Needs action" })).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test("empty stats retain helpful actions", async () => {
  global.fetch = jest.fn().mockResolvedValue(response(200, { ...stats, orders: { total: 0, byStatus: {} }, recentOrders: [], attentionOrders: [] }));
  renderOverview();
  expect(await screen.findByText("All caught up")).toBeInTheDocument();
  expect(screen.getByText("No orders yet")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Add product" })).toHaveAttribute("href", "/admin/products/new");
  expect(screen.getByRole("link", { name: "View payment review queue" })).toHaveAttribute("href", "/admin/orders?status=payment_review");
});

test("expired sessions sign out and show the admin gate", async () => {
  global.fetch = jest.fn().mockResolvedValue(response(401, {}));
  const { store } = renderOverview();
  expect(await screen.findByRole("link", { name: "sign in" })).toHaveAttribute("href", "/login");
  expect(store.getState().userReducer.user).toBeFalsy();
});

test.each([null, "customer"])("the gate makes no stats request for %s", (role) => {
  global.fetch = jest.fn();
  renderOverview(role);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Menu" })).not.toBeInTheDocument();
});

test("a revoked admin role displays a forbidden state", async () => {
  global.fetch = jest.fn().mockResolvedValue(response(403, {}));
  renderOverview();
  expect(await screen.findByRole("alert")).toHaveTextContent("not allowed");
});
