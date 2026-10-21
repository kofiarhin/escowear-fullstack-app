import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { createStore } from "redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import reducers from "../../redux/reducers";
import OrderConfirmation from "./OrderConfirmation.page";
import { saveOrderAccess } from "../../utils/orderAccess";

const order = {
  id: "64b0000000000000000000aa",
  orderNumber: "EW-ABCDE-23456",
  status: "pending_contact",
  customer: { name: "Ama Mensah", email: "ama@example.test" },
  items: [{ productId: "p1", name: "Nike Air Max Dn8", size: "UK 9", quantity: 2, lineTotalGBPMinor: 32998 }],
  pricing: { currency: "GBP", subtotalGBPMinor: 32998, estimatedOnly: true, finalGHS: null },
  history: [],
};

const renderAt = (path) =>
  render(
    <Provider store={createStore(reducers)}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/orders/:id/confirmation" element={<OrderConfirmation />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );

beforeEach(() => {
  sessionStorage.clear();
  global.fetch = jest.fn();
});

test("does not fetch or reveal an order from the URL alone", async () => {
  renderAt(`/orders/${order.id}/confirmation`);
  expect(await screen.findByRole("heading", { name: /order details unavailable/i })).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(screen.queryByText("EW-ABCDE-23456")).not.toBeInTheDocument();
});

test("loads the order with this tab's scoped access token", async () => {
  saveOrderAccess(order.id, "scoped-token", 60);
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => order });
  renderAt(`/orders/${order.id}/confirmation`);
  expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
  expect(await screen.findByRole("heading", { name: "Order received — awaiting our email" })).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(`/api/orders/${order.id}`, expect.objectContaining({ headers: { "X-Order-Access-Token": "scoped-token" } }));
  expect(screen.getByText("ama@example.test")).toBeInTheDocument();
  expect(screen.getAllByText("£329.98").length).toBeGreaterThan(0);
});

test("an expired or rejected token shows the safe unavailable state", async () => {
  saveOrderAccess(order.id, "old-token", 60);
  global.fetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: "Order not found" }) });
  renderAt(`/orders/${order.id}/confirmation`);
  expect(await screen.findByRole("heading", { name: /order details unavailable/i })).toBeInTheDocument();
});

test("expired tokens are not sent", async () => {
  saveOrderAccess(order.id, "stale", 60, Date.now() - 2 * 60 * 60 * 1000);
  renderAt(`/orders/${order.id}/confirmation`);
  expect(await screen.findByRole("heading", { name: /order details unavailable/i })).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});

test("the scoped token is used even when a (possibly stale) login is stored", async () => {
  saveOrderAccess(order.id, "scoped-token", 60);
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => order });
  const store = createStore(reducers);
  store.dispatch({ type: "LOGIN_SUCCESS", payload: { name: "Ama", email: "ama@example.test", token: "stale-login" } });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[`/orders/${order.id}/confirmation`]}>
        <Routes>
          <Route path="/orders/:id/confirmation" element={<OrderConfirmation />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  expect(await screen.findByRole("heading", { name: "Order received — awaiting our email" })).toBeInTheDocument();
  expect(global.fetch.mock.calls[0][1].headers).toEqual({ "X-Order-Access-Token": "scoped-token" });
  localStorage.clear();
});
