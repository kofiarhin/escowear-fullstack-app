import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { createStore } from "redux";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import reducers from "../../redux/reducers";
import DashBoard from "./Dashboard.page";

const LoginProbe = () => {
  const { state } = useLocation();
  return <p>Login page (from {state?.from || "nowhere"})</p>;
};

const renderDashboard = (payload) => {
  const store = createStore(reducers);
  store.dispatch(payload ? { type: "LOGIN_SUCCESS", payload } : { type: "LOGOUT_USER" });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route path="/dashboard" element={<DashBoard />} />
          <Route path="/account" element={<p>Account page</p>} />
          <Route path="/admin" element={<p>Admin page</p>} />
          <Route path="/login" element={<LoginProbe />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
};

beforeEach(() => localStorage.clear());

test("the old /dashboard URL sends a signed-in admin to /admin", () => {
  renderDashboard({ name: "Esco Admin", email: "admin@example.test", role: "admin", token: "admin-token" });
  expect(screen.getByText("Admin page")).toBeInTheDocument();
});

test("the old /dashboard URL sends a signed-in customer to /account", () => {
  renderDashboard({ name: "Ama Mensah", email: "ama@example.test", role: "customer", token: "user-token" });
  expect(screen.getByText("Account page")).toBeInTheDocument();
});

test("the old /dashboard URL sends a signed-out visitor to login and back", () => {
  renderDashboard(null);
  expect(screen.getByText("Login page (from /dashboard)")).toBeInTheDocument();
});
