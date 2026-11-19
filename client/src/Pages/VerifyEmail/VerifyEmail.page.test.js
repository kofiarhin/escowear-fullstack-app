import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import CheckEmail from "./CheckEmail.page";
import VerifyEmail from "./VerifyEmail.page";
import { savePendingVerification } from "../../utils/verification";

const jsonResponse = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

const LocationProbe = () => <p data-testid="location">{useLocation().search}</p>;

const renderAt = (entry) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/check-email" element={<CheckEmail />} />
        <Route
          path="/verify-email"
          element={
            <>
              <VerifyEmail />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );

const status = (overrides = {}) => ({ email: "ama@example.test", state: "pending", deadline: "2026-11-27T10:00:00.000Z", resendsRemaining: 3, nextResendAt: null, ...overrides });

beforeEach(() => {
  sessionStorage.clear();
  global.fetch = jest.fn();
});

describe("check email page", () => {
  test("without a pending verification it asks the customer to sign in", () => {
    renderAt("/check-email");
    expect(screen.getByRole("heading", { name: /sign in to continue/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("shows the address and deadline, resends with the restricted credential and reports remaining resends", async () => {
    savePendingVerification({ pendingToken: "pending-1", email: "ama@example.test", deadline: "2026-11-27T10:00:00.000Z" });
    global.fetch
      .mockImplementationOnce(() => jsonResponse(200, status()))
      .mockImplementationOnce(() => jsonResponse(200, { ...status({ resendsRemaining: 2 }), message: "We have sent a new verification link to ama@example.test." }));
    renderAt("/check-email");

    expect(screen.getByText("ama@example.test")).toBeInTheDocument();
    expect(await screen.findByText("3 of 3 resends left in the next 24 hours.")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith("/api/users/verification", expect.objectContaining({ headers: { Authorization: "Bearer pending-1" } }));

    await userEvent.click(screen.getByRole("button", { name: "Resend link" }));
    expect(await screen.findByText(/we have sent a new verification link/i)).toBeInTheDocument();
    expect(screen.getByText("2 of 3 resends left in the next 24 hours.")).toBeInTheDocument();
    const [url, options] = global.fetch.mock.calls[1];
    expect(url).toBe("/api/users/verification/resend");
    expect(options.method).toBe("POST");
  });

  test("a running cooldown disables resend with a countdown; the daily limit is explained", async () => {
    savePendingVerification({ pendingToken: "pending-1", email: "ama@example.test" });
    global.fetch.mockImplementationOnce(() => jsonResponse(200, status({ resendsRemaining: 0, nextResendAt: new Date(Date.now() + 30000).toISOString() })));
    const { unmount } = renderAt("/check-email");
    const button = await screen.findByRole("button", { name: /resend link in \d+s/i });
    expect(button).toBeDisabled();
    expect(screen.getByText(/used all 3 resends/i)).toBeInTheDocument();
    // Stops the countdown timer before the test ends.
    unmount();
  });

  test("the email can be corrected; the page then shows the new address", async () => {
    savePendingVerification({ pendingToken: "pending-1", email: "ama@exmaple.test" });
    global.fetch
      .mockImplementationOnce(() => jsonResponse(200, status({ email: "ama@exmaple.test" })))
      .mockImplementationOnce(() => jsonResponse(200, { ...status({ resendsRemaining: 2 }), message: "We have sent a verification link to ama@example.test." }));
    renderAt("/check-email");
    await screen.findByText("3 of 3 resends left in the next 24 hours.");

    await userEvent.click(screen.getByRole("button", { name: /wrong email/i }));
    await userEvent.type(screen.getByLabelText("Correct email address"), "not-valid");
    await userEvent.click(screen.getByRole("button", { name: /send link to this email/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a valid email address.");
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await userEvent.clear(screen.getByLabelText("Correct email address"));
    await userEvent.type(screen.getByLabelText("Correct email address"), "ama@example.test");
    await userEvent.click(screen.getByRole("button", { name: /send link to this email/i }));
    expect(await screen.findByText(/we have sent a verification link to ama@example\.test/i)).toBeInTheDocument();
    const [url, options] = global.fetch.mock.calls[1];
    expect(url).toBe("/api/users/verification/email");
    expect(JSON.parse(options.body)).toEqual({ email: "ama@example.test" });
    expect(JSON.parse(sessionStorage.getItem("escowear-pending-verification-v1")).email).toBe("ama@example.test");
    expect(screen.queryByLabelText("Correct email address")).not.toBeInTheDocument();
  });

  test.each([
    ["VERIFICATION_SESSION_EXPIRED", 401, /sign in to continue/i],
    ["ALREADY_VERIFIED", 409, /email verified/i],
    ["ACCOUNT_EXPIRED", 410, /account expired/i],
  ])("%s shows a recovery state", async (code, httpStatus, heading) => {
    savePendingVerification({ pendingToken: "pending-1", email: "ama@example.test" });
    global.fetch.mockImplementationOnce(() => jsonResponse(httpStatus, { code, error: "x" }));
    renderAt("/check-email");
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
  });
});

describe("verify email page", () => {
  test("removes the token from the address, verifies only on click and then offers sign-in", async () => {
    global.fetch.mockImplementationOnce(() => jsonResponse(200, { message: "Your email is verified. You can now sign in." }));
    savePendingVerification({ pendingToken: "pending-1", email: "ama@example.test" });
    renderAt(`/verify-email?token=${"a".repeat(64)}`);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(""));
    expect(global.fetch).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Verify my email" }));
    expect(await screen.findByRole("heading", { name: /you're verified/i })).toBeInTheDocument();
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ token: "a".repeat(64) });
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(sessionStorage.getItem("escowear-pending-verification-v1")).toBeNull();
  });

  test("an invalid, expired or used link explains how to get a new one", async () => {
    global.fetch.mockImplementationOnce(() => jsonResponse(400, { code: "INVALID_LINK", error: "This verification link is invalid or has expired." }));
    renderAt(`/verify-email?token=${"b".repeat(64)}`);
    await userEvent.click(screen.getByRole("button", { name: "Verify my email" }));
    expect(await screen.findByRole("heading", { name: /link unavailable/i })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/invalid, has expired or has already been used/i);
  });

  test("a link without a token is unavailable", () => {
    renderAt("/verify-email");
    expect(screen.getByRole("heading", { name: /link unavailable/i })).toBeInTheDocument();
  });

  test("a network failure keeps the link usable", async () => {
    global.fetch.mockImplementationOnce(() => Promise.reject(new TypeError("Failed to fetch"))).mockImplementationOnce(() => jsonResponse(200, { message: "ok" }));
    renderAt(`/verify-email?token=${"c".repeat(64)}`);
    await userEvent.click(screen.getByRole("button", { name: "Verify my email" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't reach escowear/i);
    await userEvent.click(screen.getByRole("button", { name: "Verify my email" }));
    expect(await screen.findByRole("heading", { name: /you're verified/i })).toBeInTheDocument();
  });
});
