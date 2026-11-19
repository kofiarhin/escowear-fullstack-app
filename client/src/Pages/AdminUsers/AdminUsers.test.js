import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { applyMiddleware, createStore } from "redux";
import thunkMiddleware from "redux-thunk";
import App from "../../App";
import reducers from "../../redux/reducers";

const account = (overrides = {}) => ({ id: "672b0e3a1a2b3c4d5e6f7001", email: "ama@example.test", name: "Ama", role: "customer", createdAt: "2026-11-01T10:00:00.000Z", blocked: false, blockedAt: null, ...overrides });
const admin = account({ id: "672b0e3a1a2b3c4d5e6f7000", email: "admin@example.test", name: "Esco Admin", role: "admin" });
const listResponse = (items) => ({ ok: true, status: 200, json: async () => ({ items, pagination: { total: items.length, page: 1, limit: 20, pages: 1 } }) });

const renderAdmin = () => {
  const store = createStore(reducers, applyMiddleware(thunkMiddleware));
  store.dispatch({ type: "LOGIN_SUCCESS", payload: { name: "Esco Admin", role: "admin", token: "test-token" } });
  return render(<Provider store={store}><App /></Provider>);
};

let users;
beforeEach(() => {
  users = [account(), admin];
  window.history.pushState({}, "", "/admin/users");
  global.fetch = jest.fn().mockImplementation((path, options = {}) => {
    if (String(path).startsWith("/api/admin/users?")) return Promise.resolve(listResponse(users));
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
});

afterEach(() => { localStorage.clear(); jest.restoreAllMocks(); });

test("lists users with role, status and only customer actions", async () => {
  renderAdmin();
  await screen.findByText("ama@example.test");
  const row = screen.getByRole("row", { name: /ama@example\.test/ });
  expect(within(row).getByText("Active")).toBeInTheDocument();
  expect(within(row).getByRole("button", { name: "Block ama@example.test" })).toBeInTheDocument();
  expect(within(row).getByRole("button", { name: "Delete ama@example.test" })).toBeInTheDocument();
  const adminRow = screen.getByRole("row", { name: /admin@example\.test/ });
  expect(within(adminRow).queryByRole("button")).not.toBeInTheDocument();
  expect(within(adminRow).getByText("Protected")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute("aria-current", "page");
});

test("email search sends the query to the API", async () => {
  renderAdmin();
  await screen.findByText("ama@example.test");
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: " ama@ " } });
  await userEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByText("ama@example.test");
  expect(global.fetch).toHaveBeenLastCalledWith("/api/admin/users?page=1&limit=20&q=ama%40", expect.anything());
});

test("block asks for confirmation and does nothing when cancelled", async () => {
  jest.spyOn(window, "confirm").mockReturnValue(false);
  renderAdmin();
  await userEvent.click(await screen.findByRole("button", { name: "Block ama@example.test" }));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/^Block ama@example.test\?/));
  expect(global.fetch.mock.calls.some(([, options]) => options?.method === "PATCH")).toBe(false);
});

test("confirmed block calls the API and shows the blocked state", async () => {
  jest.spyOn(window, "confirm").mockReturnValue(true);
  global.fetch.mockImplementation((path, options = {}) => {
    if (options.method === "PATCH") {
      users = [account({ blocked: true }), admin];
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ item: users[0] }) });
    }
    return Promise.resolve(listResponse(users));
  });
  renderAdmin();
  await userEvent.click(await screen.findByRole("button", { name: "Block ama@example.test" }));
  expect(await screen.findByText("ama@example.test is now blocked.")).toBeInTheDocument();
  const patch = global.fetch.mock.calls.find(([, options]) => options?.method === "PATCH");
  expect(patch[0]).toBe("/api/admin/users/672b0e3a1a2b3c4d5e6f7001/block");
  expect(JSON.parse(patch[1].body)).toEqual({ blocked: true });
  expect(await screen.findByRole("button", { name: "Unblock ama@example.test" })).toBeInTheDocument();
  expect(screen.getByText("Blocked")).toBeInTheDocument();
});

test("confirmed delete removes the user and a server refusal is shown", async () => {
  jest.spyOn(window, "confirm").mockReturnValue(true);
  let refuse = true;
  global.fetch.mockImplementation((path, options = {}) => {
    if (options.method === "DELETE") {
      if (refuse) return Promise.resolve({ ok: false, status: 409, json: async () => ({ error: "Admin accounts cannot be blocked or deleted", code: "ADMIN_ACCOUNT" }) });
      users = [admin];
      return Promise.resolve({ ok: true, status: 204, json: async () => { throw new Error("no body"); } });
    }
    return Promise.resolve(listResponse(users));
  });
  renderAdmin();
  await userEvent.click(await screen.findByRole("button", { name: "Delete ama@example.test" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Admin accounts cannot be blocked or deleted");

  refuse = false;
  await userEvent.click(screen.getByRole("button", { name: "Delete ama@example.test" }));
  expect(await screen.findByText("ama@example.test was deleted.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Delete ama@example.test" })).not.toBeInTheDocument();
});

test("shows a retry state when users cannot be loaded", async () => {
  global.fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "Users could not be loaded" }) });
  renderAdmin();
  expect(await screen.findByText("Users could not be loaded.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

test("an empty page past the end moves back to the last page", async () => {
  window.history.pushState({}, "", "/admin/users?q=ama&page=3");
  global.fetch.mockImplementation((path) => {
    if (String(path).includes("page=3")) return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: [], pagination: { total: 2, page: 3, limit: 20, pages: 1 } }) });
    return Promise.resolve(listResponse(users));
  });
  renderAdmin();
  expect(await screen.findByText("ama@example.test")).toBeInTheDocument();
  const lastCall = global.fetch.mock.calls[global.fetch.mock.calls.length - 1][0];
  expect(String(lastCall)).toContain("page=1");
});
