import { render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { createStore } from "redux";
import { MemoryRouter } from "react-router-dom";
import reducers from "../../redux/reducers";
import DashBoard from "./Dashboard.page";

const renderDashboard = () => {
  const store = createStore(reducers);
  store.dispatch({ type: "LOGIN_SUCCESS", payload: { name: "Ama Mensah", email: "ama@example.test", token: "user-token" } });
  return render(
    <Provider store={store}>
      <MemoryRouter>
        <DashBoard />
      </MemoryRouter>
    </Provider>
  );
};

beforeEach(() => {
  localStorage.clear();
  global.fetch = jest.fn();
});

test("dashboard lists the signed-in customer's orders, including legacy ones", async () => {
  global.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      items: [
        { id: "o1", orderNumber: "EW-ABCDE-23456", status: "pending_contact", statusLabel: "Order received — awaiting our email", legacy: false, createdAt: "2026-10-20T10:00:00.000Z", items: [{ productId: "p1", name: "Nike Air Max Dn8", size: "UK 9", quantity: 1 }], pricing: { subtotalGBPMinor: 16499 } },
        { id: "o2", orderNumber: null, status: "Pending", statusLabel: "Pending", legacy: true, createdAt: "2026-01-01T10:00:00.000Z", items: [{ name: "Old sneaker", size: "9", quantity: 1 }], pricing: null },
      ],
      pagination: { total: 2, page: 1, limit: 20, pages: 1 },
    }),
  });
  renderDashboard();
  expect(await screen.findByText("Order EW-ABCDE-23456")).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith("/api/orders", expect.objectContaining({ headers: { Authorization: "Bearer user-token" } }));
  expect(screen.getByRole("link", { name: "View order" })).toHaveAttribute("href", "/orders/o1");
  expect(screen.getByText("Earlier order")).toBeInTheDocument();
  expect(screen.getByText(/old sneaker/i)).toBeInTheDocument();
  expect(screen.getByText("Indicative subtotal: £164.99")).toBeInTheDocument();
});

test("dashboard shows an empty state and an error state", async () => {
  global.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ items: [], pagination: { total: 0 } }) });
  const { unmount } = renderDashboard();
  expect(await screen.findByText("There are no orders")).toBeInTheDocument();
  unmount();
  global.fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
  renderDashboard();
  expect(await screen.findByRole("alert")).toHaveTextContent(/could not be loaded/i);
});

test("an expired sign-in on the dashboard signs the customer out", async () => {
  global.fetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: "Unauthorized - invalid token" }) });
  renderDashboard();
  await waitFor(() => expect(localStorage.getItem("user")).toBeNull());
  expect(screen.queryByText(/hello/i)).not.toBeInTheDocument();
});
