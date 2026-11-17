import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { createStore } from "redux";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import reducers from "../../redux/reducers";
import Account from "./Account.page";

const LoginProbe = () => {
  const { state } = useLocation();
  return <p>Login page (from {state?.from || "nowhere"})</p>;
};

const renderAccount = (payload = { name: "Ama Mensah", email: "ama@example.test", role: "customer", token: "user-token" }) => {
  const store = createStore(reducers);
  store.dispatch(payload ? { type: "LOGIN_SUCCESS", payload } : { type: "LOGOUT_USER" });
  const view = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/account"]}>
        <Routes>
          <Route path="/account" element={<Account />} />
          <Route path="/login" element={<LoginProbe />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...view };
};

const ordersResponse = (items) => ({ ok: true, status: 200, json: async () => ({ items, pagination: { total: items.length, page: 1, limit: 20, pages: 1 } }) });

beforeEach(() => {
  localStorage.clear();
  global.fetch = jest.fn();
});

test("welcomes the customer and shows their profile and address placeholder", async () => {
  global.fetch.mockResolvedValue(ordersResponse([]));
  renderAccount();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Welcome back, Ama");
  expect(screen.getByText("Signed in as ama@example.test")).toBeInTheDocument();
  const profile = screen.getByRole("region", { name: "Profile" });
  expect(within(profile).getByText("Ama Mensah")).toBeInTheDocument();
  expect(within(profile).getByText("ama@example.test")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Addresses" })).getByText(/no saved addresses yet/i)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Go to admin" })).not.toBeInTheDocument();
  await screen.findByText("There are no orders yet.");
});

test("lists the signed-in customer's orders, including legacy ones", async () => {
  global.fetch.mockResolvedValue(
    ordersResponse([
      { id: "o1", orderNumber: "EW-ABCDE-23456", status: "pending_contact", statusLabel: "Order received — awaiting our email", legacy: false, createdAt: "2026-10-20T10:00:00.000Z", items: [{ productId: "p1", name: "Nike Air Max Dn8", size: "UK 9", quantity: 1 }], pricing: { subtotalGBPMinor: 16499 } },
      { id: "o2", orderNumber: null, status: "Pending", statusLabel: "Pending", legacy: true, createdAt: "2026-01-01T10:00:00.000Z", items: [{ name: "Old sneaker", size: "9", quantity: 1 }], pricing: null },
    ])
  );
  renderAccount();
  expect(screen.getByRole("status")).toHaveTextContent(/loading your orders/i);
  expect(await screen.findByText("Order EW-ABCDE-23456")).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith("/api/orders", expect.objectContaining({ headers: { Authorization: "Bearer user-token" } }));
  expect(screen.getByText("Status: Order received — awaiting our email")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View order" })).toHaveAttribute("href", "/orders/o1");
  expect(screen.getByText("Earlier order")).toBeInTheDocument();
  expect(screen.getByText(/old sneaker/i)).toBeInTheDocument();
  expect(screen.getByText("Indicative subtotal: £164.99")).toBeInTheDocument();
  expect(screen.getByText("2 orders")).toBeInTheDocument();
});

test("shows an empty state and an error state", async () => {
  global.fetch.mockResolvedValueOnce(ordersResponse([]));
  const { unmount } = renderAccount();
  expect(await screen.findByText("There are no orders yet.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Shop sneakers" })).toHaveAttribute("href", "/store");
  unmount();
  global.fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
  renderAccount();
  expect(await screen.findByRole("alert")).toHaveTextContent(/could not be loaded/i);
});

test("a network failure shows the error state", async () => {
  global.fetch.mockRejectedValueOnce(new Error("offline"));
  renderAccount();
  expect(await screen.findByRole("alert")).toHaveTextContent(/could not be loaded/i);
});

test("log out clears the session and goes to login", async () => {
  global.fetch.mockResolvedValue(ordersResponse([]));
  const { store } = renderAccount();
  await screen.findByText("There are no orders yet.");
  await userEvent.click(screen.getByRole("button", { name: "Log out" }));
  expect(store.getState().userReducer.user).toBeNull();
  expect(localStorage.getItem("user")).toBeNull();
  expect(screen.getByText("Login page (from nowhere)")).toBeInTheDocument();
});

test("signed-out visitors are sent to login with a return path to /account", () => {
  renderAccount(null);
  expect(screen.getByText("Login page (from /account)")).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});

test("an expired sign-in signs the customer out", async () => {
  global.fetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: "Unauthorized - invalid token" }) });
  renderAccount();
  await waitFor(() => expect(localStorage.getItem("user")).toBeNull());
  expect(await screen.findByText("Login page (from /account)")).toBeInTheDocument();
  expect(screen.queryByText(/welcome back/i)).not.toBeInTheDocument();
});

test("admins can still use the account page and get a shortcut to admin", async () => {
  global.fetch.mockResolvedValue(ordersResponse([]));
  renderAccount({ name: "Kofi Admin", email: "admin@example.test", role: "admin", token: "admin-token" });
  expect(screen.getByRole("link", { name: "Go to admin" })).toHaveAttribute("href", "/admin");
  await screen.findByText("There are no orders yet.");
});
