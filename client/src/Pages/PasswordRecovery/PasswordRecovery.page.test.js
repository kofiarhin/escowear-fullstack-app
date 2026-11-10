import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import ForgotPassword from "./ForgotPassword.page";
import ResetPassword from "./ResetPassword.page";

const renderPage = (path, element) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="/forgot-password" element={element} />
        <Route path="/reset-password" element={element} />
        <Route path="/login" element={<p>Login page</p>} />
      </Routes>
    </MemoryRouter>
  );

const LocationProbe = () => <output data-testid="location-search">{useLocation().search}</output>;

beforeEach(() => {
  global.fetch = jest.fn();
});

test("forgot password submits an email and always shows the generic confirmation", async () => {
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ message: "If an account matches that email address, we have sent password reset instructions." }) });
  renderPage("/forgot-password", <ForgotPassword />);

  await userEvent.type(screen.getByLabelText("Email"), "ama@example.test");
  await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));

  expect(await screen.findByText(/check your email for password reset instructions/i)).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith("/api/users/forgot-password", expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "ama@example.test" }) }));
});

test("forgot password surfaces a proxied backend failure instead of a success message", async () => {
  global.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: "Too many password reset requests. Please wait and try again." }) });
  renderPage("/forgot-password", <ForgotPassword />);

  await userEvent.type(screen.getByLabelText("Email"), "ama@example.test");
  await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(/too many password reset requests/i);
  expect(screen.queryByText(/check your email for password reset instructions/i)).not.toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith("/api/users/forgot-password", expect.objectContaining({ method: "POST" }));
});

test("reset password validates matching 10-character passwords and submits the URL token", async () => {
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ message: "Your password has been reset. You can now sign in." }) });
  renderPage("/reset-password?token=test-token", <ResetPassword />);

  await waitFor(() => expect(screen.getByTestId("location-search")).toHaveTextContent(""));

  await userEvent.type(screen.getByLabelText("New password"), "short");
  await userEvent.type(screen.getByLabelText("Confirm new password"), "different");
  await userEvent.click(screen.getByRole("button", { name: "Reset password" }));
  expect(await screen.findByText(/10 and 128 characters/i)).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();

  await userEvent.clear(screen.getByLabelText("New password"));
  await userEvent.clear(screen.getByLabelText("Confirm new password"));
  await userEvent.type(screen.getByLabelText("New password"), "a-new-secure-password");
  await userEvent.type(screen.getByLabelText("Confirm new password"), "a-new-secure-password");
  await userEvent.click(screen.getByRole("button", { name: "Reset password" }));
  expect(await screen.findByText(/password has been reset/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Reset password" })).not.toBeInTheDocument();
  expect(localStorage).toHaveLength(0);
  expect(sessionStorage).toHaveLength(0);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/users/reset-password", expect.objectContaining({ body: JSON.stringify({ token: "test-token", password: "a-new-secure-password" }) })));
});

test("reset password refuses a missing token without a network request", async () => {
  renderPage("/reset-password", <ResetPassword />);
  expect(screen.getByText(/invalid or incomplete/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Reset password" })).not.toBeInTheDocument();
});
