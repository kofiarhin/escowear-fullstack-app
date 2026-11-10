import { loginUser } from "./user.action";

beforeEach(() => {
  global.fetch = jest.fn();
});

test("login uses the same relative backend API route as password recovery", async () => {
  global.fetch.mockResolvedValue({ json: async () => ({ id: "u1", email: "ama@example.test", role: "admin", token: "test-token" }) });
  const dispatch = jest.fn();

  await loginUser("AMA@example.test", "test-only-password")(dispatch);

  expect(global.fetch).toHaveBeenCalledWith("/api/users/login", expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ email: "AMA@example.test", password: "test-only-password" }),
  }));
  expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ type: "LOGIN_SUCCESS", payload: expect.objectContaining({ role: "admin" }) }));
});
