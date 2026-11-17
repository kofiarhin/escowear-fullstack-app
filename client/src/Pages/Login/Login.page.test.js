import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { applyMiddleware, createStore } from "redux";
import thunkMiddleware from "redux-thunk";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import reducers from "../../redux/reducers";
import Login from "./Login.page";
import { postLoginPath, safeReturnPath } from "../../utils/authRedirect";

const renderLogin = (entry = "/login") =>
  render(
    <Provider store={createStore(reducers, applyMiddleware(thunkMiddleware))}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/admin" element={<p>Admin page</p>} />
          <Route path="/account" element={<p>Account page</p>} />
          <Route path="/checkout" element={<p>Checkout page</p>} />
          <Route path="/orders/:id" element={<p>Order page</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );

const signIn = async (payload) => {
  global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ name: "Ama Mensah", email: "ama@example.test", token: "t", ...payload }) });
  await userEvent.type(screen.getByPlaceholderText("Enter Email"), "ama@example.test");
  await userEvent.type(screen.getByPlaceholderText("Enter Password"), "a-long-password");
  await userEvent.click(screen.getByRole("button", { name: /login/i }));
};

beforeEach(() => {
  localStorage.clear();
  global.fetch = jest.fn();
});

test("admins land on /admin after signing in", async () => {
  renderLogin();
  await signIn({ role: "admin" });
  expect(await screen.findByText("Admin page")).toBeInTheDocument();
});

test("customers land on /account after signing in", async () => {
  renderLogin();
  await signIn({ role: "customer" });
  expect(await screen.findByText("Account page")).toBeInTheDocument();
});

test("checkout's return path wins over the role default", async () => {
  renderLogin({ pathname: "/login", state: { from: "/checkout" } });
  await signIn({ role: "admin" });
  expect(await screen.findByText("Checkout page")).toBeInTheDocument();
});

test("a safe ?redirect= query is honoured", async () => {
  renderLogin("/login?redirect=%2Forders%2Fo1");
  await signIn({ role: "customer" });
  expect(await screen.findByText("Order page")).toBeInTheDocument();
});

test.each(["//evil.com", "https://evil.com"])("an unsafe redirect (%s) falls back to the role default", async (target) => {
  renderLogin(`/login?redirect=${encodeURIComponent(target)}`);
  await signIn({ role: "customer" });
  expect(await screen.findByText("Account page")).toBeInTheDocument();
});

describe("postLoginPath", () => {
  const customer = { role: "customer", token: "t" };
  const admin = { role: "admin", token: "t" };

  test("role defaults", () => {
    expect(postLoginPath(admin)).toBe("/admin");
    expect(postLoginPath(customer)).toBe("/account");
    expect(postLoginPath({ token: "t" })).toBe("/account");
  });

  test("state.from beats query parameters, and every query alias works", () => {
    expect(postLoginPath(customer, { from: "/checkout", search: "?redirect=/cart" })).toBe("/checkout");
    expect(postLoginPath(customer, { search: "?redirect=/cart" })).toBe("/cart");
    expect(postLoginPath(customer, { search: "?return-to=%2Fcart" })).toBe("/cart");
    expect(postLoginPath(admin, { search: "?returnTo=/store?brand=nike" })).toBe("/store?brand=nike");
  });

  // eslint-disable-next-line no-script-url
  test.each(["//evil.com", "https://evil.com", "http:/evil.com", "/\\evil.com", "%2F%2Fevil.com", "evil.com", "javascript:alert(1)", "/a\nb", "", "%E0%A4%A"])(
    "rejects %p",
    (target) => {
      expect(safeReturnPath(target)).toBeNull();
      expect(postLoginPath(customer, { from: target, search: `?redirect=${encodeURIComponent(target)}` })).toBe("/account");
    }
  );

  test("ignores non-string state", () => {
    expect(postLoginPath(admin, { from: { pathname: "/checkout" } })).toBe("/admin");
  });
});
