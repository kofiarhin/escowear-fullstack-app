import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { createStore } from "redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import reducers from "../../redux/reducers";
import TrackOrder from "./TrackOrder.page";
import OrderDetails from "../OrderDetails/OrderDetails.page";
import { getOrderAccess, saveOrderAccess } from "../../utils/orderAccess";

const order = {
  id: "64b0000000000000000000aa",
  orderNumber: "EW-ABCDE-23456",
  status: "dispatched",
  statusLabel: "Dispatched",
  items: [{ productId: "p1", name: "Nike Air Max Dn8", size: "UK 9", quantity: 1, lineTotalGBPMinor: 16499 }],
  pricing: { subtotalGBPMinor: 16499, finalGHS: { totalMinor: 300000, expiresAt: "2099-01-01T00:00:00.000Z" } },
  shippingAddress: { recipient: "Kojo", city: "Accra", region: "Greater Accra", country: "GH" },
  fulfilment: { carrier: "DHL", trackingNumber: "JD0001", trackingUrl: "https://dhl.example.test/JD0001", dispatchedAt: "2026-10-20T12:00:00.000Z" },
  history: [
    { status: "pending_contact", label: "Order received — awaiting our email", at: "2026-10-19T10:00:00.000Z" },
    { status: "dispatched", label: "Dispatched", at: "2026-10-20T12:00:00.000Z" },
  ],
};

const json = (status, body) => Promise.resolve({ ok: status < 300, status, json: async () => body });

const renderAt = (path, user) => {
  const store = createStore(reducers);
  if (user) store.dispatch({ type: "LOGIN_SUCCESS", payload: user });
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/track-order" element={<TrackOrder />} />
          <Route path="/orders/:id" element={<OrderDetails />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
};

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  global.fetch = jest.fn();
});

test("guest tracks an order with order number, email and emailed code", async () => {
  global.fetch.mockImplementation((url) => {
    if (url === "/api/orders/tracking/request") return json(202, { message: "If the order number and email match an order, we have emailed a 6-digit code." });
    if (url === "/api/orders/tracking/verify") return json(200, { orderId: order.id, accessToken: "tracking-token", expiresInMinutes: 30 });
    return json(200, order);
  });
  renderAt("/track-order?order=ew-abcde-23456");
  expect(screen.getByLabelText("Order number")).toHaveValue("EW-ABCDE-23456");
  await userEvent.type(screen.getByLabelText("Email"), "ama@example.test");
  await userEvent.click(screen.getByRole("button", { name: "Email me a code" }));

  expect(await screen.findByText(/if the order number and email match an order/i)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText("6-digit code")).toHaveFocus());
  await userEvent.type(screen.getByLabelText("6-digit code"), "123456");
  await userEvent.click(screen.getByRole("button", { name: "View my order" }));

  expect(await screen.findByRole("heading", { name: "Dispatched" })).toBeInTheDocument();
  expect(getOrderAccess(order.id)).toBe("tracking-token");
  expect(global.fetch).toHaveBeenCalledWith(`/api/orders/${order.id}`, expect.objectContaining({ headers: { "X-Order-Access-Token": "tracking-token" } }));
  expect(screen.getByText("DHL")).toBeInTheDocument();
  expect(screen.getByText("JD0001")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Track with carrier" })).toHaveAttribute("rel", "noopener noreferrer");
  expect(screen.getByText("Order received — awaiting our email")).toBeInTheDocument();
});

test("invalid inputs are caught before sending and wrong codes show a generic error", async () => {
  global.fetch.mockImplementation((url) =>
    url === "/api/orders/tracking/request" ? json(202, { message: "generic" }) : json(400, { code: "INVALID_CODE", error: "That code is not valid or has expired. Request a new code." })
  );
  renderAt("/track-order");
  await userEvent.click(screen.getByRole("button", { name: "Email me a code" }));
  expect(screen.getByText(/enter the order number from your email/i)).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();

  await userEvent.type(screen.getByLabelText("Order number"), "EW-ABCDE-23456");
  await userEvent.type(screen.getByLabelText("Email"), "ama@example.test");
  await userEvent.click(screen.getByRole("button", { name: "Email me a code" }));
  await screen.findByLabelText("6-digit code");
  await userEvent.type(screen.getByLabelText("6-digit code"), "12");
  await userEvent.click(screen.getByRole("button", { name: "View my order" }));
  expect(screen.getByText(/enter the 6-digit code/i)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("6-digit code"), "3456");
  await userEvent.click(screen.getByRole("button", { name: "View my order" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/not valid or has expired/i);
});

test("order page without access asks the visitor to verify and makes no request", async () => {
  renderAt(`/orders/${order.id}`);
  expect(await screen.findByRole("link", { name: "Track an order" })).toHaveAttribute("href", "/track-order");
  expect(global.fetch).not.toHaveBeenCalled();
});

test("order page shows a safe state when there are no shipping details and hides unsafe links", async () => {
  saveOrderAccess(order.id, "token", 30);
  global.fetch.mockImplementation(() =>
    json(200, { ...order, status: "processing", statusLabel: "Sourcing your order", fulfilment: { carrier: null, trackingNumber: null, trackingUrl: "javascript:alert(1)" } })
  );
  renderAt(`/orders/${order.id}`);
  expect(await screen.findByText(/no shipping details yet/i)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Track with carrier" })).not.toBeInTheDocument();
});

test("signed-in owners load their order with their login", async () => {
  global.fetch.mockImplementation(() => json(200, order));
  renderAt(`/orders/${order.id}`, { name: "Ama", email: "ama@example.test", token: "user-token" });
  await screen.findByRole("heading", { name: "Dispatched" });
  await waitFor(() => expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer user-token"));
});

test("order page prefers the scoped token over a stored (possibly stale) login", async () => {
  saveOrderAccess(order.id, "scoped", 30);
  global.fetch.mockImplementation(() => json(200, order));
  renderAt(`/orders/${order.id}`, { name: "Ama", email: "ama@example.test", token: "stale-login" });
  await screen.findByRole("heading", { name: "Dispatched" });
  expect(global.fetch.mock.calls[0][1].headers).toEqual({ "X-Order-Access-Token": "scoped" });
});
