import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { createStore } from "redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import reducers from "../../redux/reducers";
import AdminOrderDetail from "./AdminOrderDetail.page";
import AdminOrders from "../AdminOrders/AdminOrders.page";
import { toMinorUnits } from "../../utils/admin";

const admin = { id: "a1", name: "Esco Admin", email: "admin@example.test", role: "admin", token: "admin-token" };

const baseOrder = {
  id: "64b0000000000000000000aa",
  orderNumber: "EW-ABCDE-23456",
  status: "payment_review",
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T11:00:00.000Z",
  customer: { name: "Ama Mensah", email: "ama@example.test", phone: "+233241234567" },
  shippingAddress: { recipient: "Kojo", phone: "+233207654321", line1: "12 Ring Road", city: "Accra", region: "Greater Accra" },
  items: [{ productId: "p1", name: "Nike Air Max Dn8", size: "UK 9", quantity: 1, unitPriceGBPMinor: 16499, lineTotalGBPMinor: 16499 }],
  pricing: { subtotalGBPMinor: 16499, finalGHS: { quoteVersion: 1, totalMinor: 300000, subtotalMinor: 280000, feesMinor: 5000, shippingMinor: 15000, dutiesMinor: 0, expiresAt: "2099-01-01T00:00:00.000Z" } },
  payment: { status: "under_review" },
  fulfilment: {},
  allowedActions: ["payment-issue", "verify-payment"],
  paymentChannelConfigured: true,
  events: [{ id: "e1", type: "order_created", actorType: "system", toStatus: "pending_contact", createdAt: "2026-10-20T10:00:00.000Z", details: {} }],
  emails: [{ id: "m1", kind: "order_received", dedupeKey: "order_received:x", state: "failed", attempts: 5, lastError: "SMTP 421", subject: "EscoWear order received" }],
  internalNotes: [],
};

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

const renderAt = (path, user = admin) => {
  const store = createStore(reducers);
  if (user) store.dispatch({ type: "LOGIN_SUCCESS", payload: user });
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/orders" element={<AdminOrders />} />
          <Route path="/admin/orders/:id" element={<AdminOrderDetail />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
};

beforeEach(() => {
  localStorage.clear();
  global.fetch = jest.fn();
});

test("non-admins see no admin data and nothing is fetched", () => {
  renderAt("/admin/orders", { ...admin, role: "customer" });
  expect(screen.getByRole("alert")).toHaveTextContent(/administrators only/i);
  expect(global.fetch).not.toHaveBeenCalled();
});

test("signed-out visitors are asked to sign in", () => {
  renderAt(`/admin/orders/${baseOrder.id}`, null);
  expect(screen.getByRole("link", { name: "sign in" })).toHaveAttribute("href", "/login");
  expect(global.fetch).not.toHaveBeenCalled();
});

test("order list loads with the admin token and links to details", async () => {
  global.fetch.mockImplementation(() =>
    ok({ items: [{ id: baseOrder.id, orderNumber: baseOrder.orderNumber, status: "pending_contact", customer: baseOrder.customer, subtotalGBPMinor: 16499, quoteTotalGHSMinor: null, paymentStatus: "not_requested" }], pagination: { total: 1, page: 1, limit: 20, pages: 1 } })
  );
  renderAt("/admin/orders");
  expect(await screen.findByRole("link", { name: baseOrder.orderNumber })).toHaveAttribute("href", `/admin/orders/${baseOrder.id}`);
  expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer admin-token");
});

test("verifying payment requires the bank-receipt attestation and sends the expected status", async () => {
  global.fetch.mockImplementation((url, options) => (options?.method === "POST" ? ok({ ok: true, status: "confirmed", email: { queued: true } }) : ok(baseOrder)));
  renderAt(`/admin/orders/${baseOrder.id}`);
  expect(await screen.findByRole("heading", { name: baseOrder.orderNumber })).toBeInTheDocument();
  expect(screen.getByText(/a screenshot is never enough/i)).toBeInTheDocument();

  await userEvent.type(screen.getByLabelText("Amount received (GHS)"), "3000.00");
  await userEvent.type(screen.getByLabelText("Bank transaction reference"), "TXN-1");
  fireEvent.change(screen.getByLabelText("Funds received at"), { target: { value: "2026-10-20T12:00" } });
  await userEvent.click(screen.getByRole("button", { name: "Confirm payment verified" }));
  expect(screen.getAllByText("Required").length).toBeGreaterThan(0);
  expect(global.fetch.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);

  await userEvent.click(screen.getByLabelText(/personally confirmed these funds arrived/i));
  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "Confirm payment verified" }));
  });
  await waitFor(() => expect(global.fetch.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1));
  const [url, options] = global.fetch.mock.calls.find(([, opts]) => opts?.method === "POST");
  expect(url).toBe(`/api/admin/orders/${baseOrder.id}/verify-payment`);
  const body = JSON.parse(options.body);
  expect(body).toMatchObject({ expectedStatus: "payment_review", amountReceivedGHSMinor: 300000, bankReference: "TXN-1", bankReceiptConfirmed: true });
  expect(await screen.findByText(/saved\. email queued/i)).toBeInTheDocument();
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
});

test("quote form is blocked when no payment channel is configured", async () => {
  global.fetch.mockImplementation(() =>
    ok({ ...baseOrder, status: "pending_contact", allowedActions: ["payment-instructions"], paymentChannelConfigured: false, pricing: { subtotalGBPMinor: 16499 } })
  );
  renderAt(`/admin/orders/${baseOrder.id}`);
  expect(await screen.findByText(/payment instructions are not configured/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send payment instructions" })).toBeDisabled();
});

test("failed emails show their error and can be retried", async () => {
  global.fetch.mockImplementation(() => ok(baseOrder));
  renderAt(`/admin/orders/${baseOrder.id}`);
  expect(await screen.findByText(/last error: smtp 421/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/admin/emails/m1/retry", expect.objectContaining({ method: "POST" })));
  expect(await screen.findByText(/retry email: done/i)).toBeInTheDocument();
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
});

test("stale action reloads the order and explains why", async () => {
  global.fetch.mockImplementation((url, options) =>
    options?.method === "POST" ? Promise.resolve({ ok: false, status: 409, json: async () => ({ error: "Order is now confirmed; reload before acting" }) }) : ok(baseOrder)
  );
  renderAt(`/admin/orders/${baseOrder.id}`);
  await screen.findByRole("heading", { name: baseOrder.orderNumber });
  await userEvent.type(screen.getByLabelText("Message to customer"), "Amount short by GHS 50.");
  await userEvent.click(screen.getByRole("button", { name: "Send payment issue email" }));
  expect(await screen.findByText(/reload before acting/i)).toBeInTheDocument();
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
});

test("GHS input converts to pesewas without float errors", () => {
  expect(toMinorUnits("5,200.50")).toBe(520050);
  expect(toMinorUnits("0.1")).toBe(10);
  expect(toMinorUnits("19.99")).toBe(1999);
  expect(toMinorUnits("12.345")).toBeNull();
  expect(toMinorUnits("-1")).toBeNull();
  expect(toMinorUnits("")).toBeNull();
});

test("re-quotes send the current quote version and uncertain-funds cancels ask about refunds", async () => {
  const order = { ...baseOrder, status: "payment_issue", allowedActions: ["payment-instructions", "cancel"], payment: { status: "rejected" } };
  global.fetch.mockImplementation((url, options) => (options?.method === "POST" ? ok({ ok: true, status: "refund_pending", email: null }) : ok(order)));
  renderAt(`/admin/orders/${order.id}`);
  await screen.findByRole("heading", { name: order.orderNumber });
  await userEvent.type(screen.getByLabelText("Reason (internal)"), "Customer cannot pay the balance");
  await userEvent.click(screen.getByLabelText(/money was received for this order and must be refunded/i));
  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "Cancel order" }));
  });
  await waitFor(() => expect(global.fetch.mock.calls.some(([, options]) => options?.method === "POST")).toBe(true));
  const [, options] = global.fetch.mock.calls.find(([, opts]) => opts?.method === "POST");
  expect(JSON.parse(options.body)).toMatchObject({ expectedStatus: "payment_issue", refundRequired: true });
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
});
