import { render, screen, waitFor } from "@testing-library/react";
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
          <Route path="/dashboard" element={<p>Dashboard page</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );

beforeEach(() => {
  localStorage.clear();
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

test("short passwords are refused before anything is sent; success signs in", async () => {
  global.fetch
    .mockResolvedValueOnce({ ok: true, json: async () => ({ _id: "u1", name: "Kofi", email: "kofi@example.test" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "u1", name: "Kofi", email: "kofi@example.test", token: "t" }) });
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
  expect(await screen.findByText("Dashboard page")).toBeInTheDocument();
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/users/login", expect.anything()));
  expect(JSON.parse(localStorage.getItem("user")).token).toBe("t");
});
