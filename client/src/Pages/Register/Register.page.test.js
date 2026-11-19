import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { applyMiddleware, createStore } from "redux";
import thunkMiddleware from "redux-thunk";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import reducers from "../../redux/reducers";
import Register from "./Register.page";

const renderRegister = () =>
  render(
    <Provider store={createStore(reducers, applyMiddleware(thunkMiddleware))}>
      <MemoryRouter initialEntries={["/register"]}>
        <Routes>
          <Route path="/register" element={<Register />} />
          <Route path="/account" element={<p>Account page</p>} />
          <Route path="/check-email" element={<p>Check email page</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  global.fetch = jest.fn();
});

test("starts empty: no pre-filled name, email or password", () => {
  renderRegister();
  screen.getAllByRole("textbox").forEach((input) => expect(input).toHaveValue(""));
  [screen.getByLabelText("Password"), screen.getByLabelText("Confirm Password")].forEach((input) => {
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("minLength", "10");
    expect(input).toHaveAttribute("autoComplete", "new-password");
  });
});

test("short passwords are refused before anything is sent; success asks for email verification without signing in", async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      message: "We have sent a verification link to kofi@example.test.",
      user: { id: "u1", name: "Kofi", email: "kofi@example.test" },
      verification: { pendingToken: "pending-1", email: "kofi@example.test", deadline: "2026-11-27T10:00:00.000Z" },
    }),
  });
  renderRegister();
  const password = screen.getByLabelText("Password");
  const confirm = screen.getByLabelText("Confirm Password");
  await userEvent.type(screen.getByPlaceholderText("Enter name"), "Kofi");
  await userEvent.type(screen.getAllByRole("textbox")[1], "kofi@example.test");
  await userEvent.type(password, "short");
  await userEvent.type(confirm, "short");
  await userEvent.click(screen.getByRole("button"));
  expect(await screen.findByText(/at least 10 characters/i)).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();

  await userEvent.clear(password);
  await userEvent.clear(confirm);
  await userEvent.type(password, "a-much-longer-password");
  await userEvent.type(confirm, "a-much-longer-password");
  await userEvent.click(screen.getByRole("button"));
  expect(await screen.findByText("Check email page")).toBeInTheDocument();
  // New accounts verify their email first (IDE-152): no sign-in, no session.
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const [url, options] = global.fetch.mock.calls[0];
  expect(url).toBe("/api/users/register");
  expect(JSON.parse(options.body)).toEqual({ name: "Kofi", email: "kofi@example.test", password: "a-much-longer-password", passwordConfirmation: "a-much-longer-password" });
  expect(localStorage.getItem("user")).toBeNull();
  expect(JSON.parse(sessionStorage.getItem("escowear-pending-verification-v1")).pendingToken).toBe("pending-1");
});

test("mismatched passwords and server errors are shown without leaving the page", async () => {
  global.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Email already in use", code: "EMAIL_IN_USE" }) });
  renderRegister();
  await userEvent.type(screen.getByPlaceholderText("Enter name"), "Kofi");
  await userEvent.type(screen.getAllByRole("textbox")[1], "kofi@example.test");
  await userEvent.type(screen.getByLabelText("Password"), "a-much-longer-password");
  await userEvent.type(screen.getByLabelText("Confirm Password"), "a-different-password");
  await userEvent.click(screen.getByRole("button", { name: "Register" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Password does not match");
  expect(global.fetch).not.toHaveBeenCalled();

  await userEvent.clear(screen.getByLabelText("Confirm Password"));
  await userEvent.type(screen.getByLabelText("Confirm Password"), "a-much-longer-password");
  await userEvent.click(screen.getByRole("button", { name: "Register" }));
  expect(await screen.findByText("Email already in use")).toBeInTheDocument();
  expect(screen.queryByText("Check email page")).not.toBeInTheDocument();
});
