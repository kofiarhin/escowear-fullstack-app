import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { createStore } from "redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import reducers from "../../redux/reducers";
import OrderDetails from "../../Pages/OrderDetails/OrderDetails.page";
import { getProofAccess, saveOrderAccess, saveProofAccess } from "../../utils/orderAccess";
import * as proofApi from "../../utils/paymentProof";

const quote = { subtotalMinor: 150000, feesMinor: 5000, shippingMinor: 30000, dutiesMinor: 15000, totalMinor: 200000, quoteVersion: 1, expiresAt: "2099-01-01T00:00:00.000Z", expired: false };
const baseOrder = {
  id: "64b0000000000000000000aa",
  orderNumber: "EW-ABCDE-23456",
  status: "awaiting_payment",
  statusLabel: "Quote ready — awaiting your payment",
  items: [{ productId: "p1", name: "Nike Air Max Dn8", size: "UK 9", quantity: 1, lineTotalGBPMinor: 16499 }],
  pricing: { subtotalGBPMinor: 16499, finalGHS: quote },
  payment: { status: "awaiting_payment", verified: false, canSubmitProof: true, proof: null },
  shippingAddress: { recipient: "Kojo", city: "Accra", region: "Greater Accra", country: "GH" },
  fulfilment: {},
  history: [],
};
const instructions = {
  available: true,
  orderNumber: baseOrder.orderNumber,
  quote,
  instructions: "MTN Mobile Money\nNumber: TEST-NUMBER\nName: TEST NAME",
  paymentReference: baseOrder.orderNumber,
  maxUploadBytes: 5 * 1024 * 1024,
};

const json = (status, body) => Promise.resolve({ ok: status < 300, status, json: async () => body });

const renderOrder = (order, { user } = {}) => {
  let current = order;
  global.fetch.mockImplementation((url, options = {}) => {
    if (url.endsWith("/payment-instructions")) {
      return options.headers?.["X-Order-Proof-Token"] === "proof-token" || options.headers?.Authorization ? json(200, instructions) : json(404, { code: "NOT_FOUND" });
    }
    return json(200, current);
  });
  const store = createStore(reducers);
  if (user) store.dispatch({ type: "LOGIN_SUCCESS", payload: user });
  const view = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[`/orders/${order.id}`]}>
        <Routes>
          <Route path="/orders/:id" element={<OrderDetails />} />
          <Route path="/track-order" element={<p>Track page</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  return { ...view, setOrder: (next) => (current = next) };
};

const png = (name = "proof.png", size = 2048, type = "image/png") => new File([new Uint8Array(size)], name, { type });

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  global.fetch = jest.fn();
  saveOrderAccess(baseOrder.id, "read-token", 60);
});

afterEach(async () => {
  // Let pending reloads settle inside act before the next test.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  jest.restoreAllMocks();
});

test("owner with proof capability sees GHS breakdown, server MoMo instructions and an accessible upload form", async () => {
  saveProofAccess(baseOrder.id, "proof-token", 60);
  renderOrder(baseOrder);
  expect(await screen.findByText(/Number: TEST-NUMBER/)).toBeInTheDocument();
  expect(screen.getByText("Total to pay")).toBeInTheDocument();
  expect(screen.getAllByText(/GH₵2,000\.00|GHS\s?2,000\.00/).length).toBeGreaterThan(0);
  expect(screen.getByText(/use reference/i)).toHaveTextContent(baseOrder.orderNumber);
  expect(screen.getByLabelText(/payment screenshot/i)).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
  expect(screen.getByLabelText(/mobile money transaction id/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Submit payment proof" })).toBeEnabled();
  expect(screen.getByText(/uploading a screenshot does not confirm your order/i)).toBeInTheDocument();
  // The read-only token is never used to fetch payment details.
  const call = global.fetch.mock.calls.find(([url]) => url.endsWith("/payment-instructions"));
  expect(call[1].headers).toEqual({ "X-Order-Proof-Token": "proof-token" });
});

test("empty submit shows field errors and moves focus; wrong file type is refused before upload", async () => {
  saveProofAccess(baseOrder.id, "proof-token", 60);
  const upload = jest.spyOn(proofApi, "uploadPaymentProof");
  renderOrder(baseOrder);
  await userEvent.click(await screen.findByRole("button", { name: "Submit payment proof" }));
  expect(screen.getByText("Choose a screenshot of your payment")).toBeInTheDocument();
  expect(screen.getByText(/enter the transaction id/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/payment screenshot/i)).toHaveFocus();

  await userEvent.upload(screen.getByLabelText(/payment screenshot/i), png("doc.pdf", 100, "application/pdf"), { applyAccept: false });
  await userEvent.type(screen.getByLabelText(/transaction id/i), "MP241027.1234");
  await userEvent.click(screen.getByRole("button", { name: "Submit payment proof" }));
  expect(screen.getByText(/upload a jpeg, png or webp/i)).toBeInTheDocument();
  expect(upload).not.toHaveBeenCalled();
});

test("successful upload says under review (not confirmed) and reloads into the review state", async () => {
  saveProofAccess(baseOrder.id, "proof-token", 60);
  const upload = jest.spyOn(proofApi, "uploadPaymentProof").mockImplementation(async ({ onProgress }) => {
    onProgress(50);
    return { ok: true, status: 201, data: { status: "under_review" } };
  });
  const { setOrder } = renderOrder(baseOrder);
  await userEvent.upload(await screen.findByLabelText(/payment screenshot/i), png());
  await userEvent.type(screen.getByLabelText(/transaction id/i), "  mp241027.1234 ");
  setOrder({
    ...baseOrder,
    status: "payment_review",
    statusLabel: "Payment submitted — under review",
    payment: { status: "under_review", verified: false, canSubmitProof: false, proof: { submittedAt: "2026-10-27T10:00:00.000Z", referenceMasked: "••••1234" } },
  });
  await userEvent.click(screen.getByRole("button", { name: "Submit payment proof" }));

  expect(upload).toHaveBeenCalledWith(
    expect.objectContaining({ orderId: baseOrder.id, transactionReference: "mp241027.1234", quoteVersion: 1, headers: { "X-Order-Proof-Token": "proof-token" } })
  );
  expect(upload.mock.calls[0][0].idempotencyKey).toEqual(expect.any(String));
  expect(await screen.findByRole("heading", { name: "Payment submitted — under review" })).toBeInTheDocument();
  expect(screen.getByText(/your order is not confirmed yet/i)).toBeInTheDocument();
  expect(screen.getByText(/••••1234/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Submit payment proof" })).not.toBeInTheDocument();
});

test("network failure keeps the form, offers retry with the same idempotency key", async () => {
  saveProofAccess(baseOrder.id, "proof-token", 60);
  const upload = jest.spyOn(proofApi, "uploadPaymentProof").mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ok: true, status: 201, data: {} });
  renderOrder(baseOrder);
  await userEvent.upload(await screen.findByLabelText(/payment screenshot/i), png());
  await userEvent.type(screen.getByLabelText(/transaction id/i), "REF12345");
  await userEvent.click(screen.getByRole("button", { name: "Submit payment proof" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/upload failed/i);
  await userEvent.click(screen.getByRole("button", { name: "Submit payment proof" }));
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
  expect(upload.mock.calls[1][0].idempotencyKey).toBe(upload.mock.calls[0][0].idempotencyKey);
  expect(await screen.findByText(/payment submitted — under review\. your order is not confirmed yet/i)).toBeInTheDocument();
});

test("server rejections show real errors: expired quote and oversized image", async () => {
  saveProofAccess(baseOrder.id, "proof-token", 60);
  jest
    .spyOn(proofApi, "uploadPaymentProof")
    .mockResolvedValueOnce({ ok: false, status: 413, data: { code: "FILE_TOO_LARGE", error: "too big", fields: { proofImage: "The screenshot must be 5 MB or smaller" } } })
    .mockResolvedValueOnce({ ok: false, status: 410, data: { code: "QUOTE_EXPIRED", error: "expired" } });
  renderOrder(baseOrder);
  await userEvent.upload(await screen.findByLabelText(/payment screenshot/i), png());
  await userEvent.type(screen.getByLabelText(/transaction id/i), "REF12345");
  await userEvent.click(screen.getByRole("button", { name: "Submit payment proof" }));
  expect(await screen.findByText("The screenshot must be 5 MB or smaller")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Submit payment proof" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/quote has expired/i);
  await waitFor(() => expect(global.fetch.mock.calls.filter(([url]) => url === `/api/orders/${baseOrder.id}`).length).toBeGreaterThan(1));
});

test("an expired upload session asks the customer to confirm their email again", async () => {
  saveProofAccess(baseOrder.id, "proof-token", 60);
  jest.spyOn(proofApi, "uploadPaymentProof").mockResolvedValue({ ok: false, status: 404, data: { code: "NOT_FOUND" } });
  renderOrder(baseOrder);
  await userEvent.upload(await screen.findByLabelText(/payment screenshot/i), png());
  await userEvent.type(screen.getByLabelText(/transaction id/i), "REF12345");
  await userEvent.click(screen.getByRole("button", { name: "Submit payment proof" }));
  expect(await screen.findByRole("link", { name: /confirm your email to pay and upload proof/i })).toHaveAttribute(
    "href",
    `/track-order?order=${baseOrder.orderNumber}`
  );
  expect(getProofAccess(baseOrder.id)).toBeNull();
});

test("read-only access shows the amount but no payment details or upload form", async () => {
  renderOrder(baseOrder);
  expect(await screen.findByRole("link", { name: /confirm your email to pay and upload proof/i })).toBeInTheDocument();
  expect(screen.queryByLabelText(/payment screenshot/i)).not.toBeInTheDocument();
  expect(global.fetch.mock.calls.some(([url]) => url.endsWith("/payment-instructions"))).toBe(false);
});

test("expired quote asks for an updated quote and never solicits payment", async () => {
  saveProofAccess(baseOrder.id, "proof-token", 60);
  renderOrder({ ...baseOrder, pricing: { ...baseOrder.pricing, finalGHS: { ...quote, expired: true } }, payment: { ...baseOrder.payment, canSubmitProof: false } });
  expect(await screen.findByText(/this quote expired/i)).toBeInTheDocument();
  expect(screen.getByText(/request an updated quote/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/payment screenshot/i)).not.toBeInTheDocument();
});

test("payment issue explains the problem and allows a new upload", async () => {
  saveProofAccess(baseOrder.id, "proof-token", 60);
  renderOrder({ ...baseOrder, status: "payment_issue", statusLabel: "Payment needs attention", payment: { ...baseOrder.payment, status: "rejected" } });
  expect(await screen.findByText(/we couldn't verify your payment/i)).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "Submit payment proof" })).toBeInTheDocument();
});

test("verified and shipped orders show payment verified, estimate and admin updates", async () => {
  renderOrder({
    ...baseOrder,
    status: "dispatched",
    statusLabel: "Dispatched",
    payment: { status: "verified", verified: true, canSubmitProof: false, proof: null },
    fulfilment: { carrier: "DHL", trackingNumber: "DHL1", estimatedDeliveryAt: "2026-11-10T00:00:00.000Z" },
    history: [{ type: "update", label: "Update from EscoWear", message: "Customs is taking two extra days.", at: "2026-10-30T10:00:00.000Z" }],
  });
  expect(await screen.findByText(/payment verified — order confirmed/i)).toBeInTheDocument();
  expect(screen.getByText(/estimated delivery: 10 nov 2026/i)).toBeInTheDocument();
  expect(screen.getByText("Customs is taking two extra days.")).toBeInTheDocument();
});

test("before a quote the customer is told not to pay; no estimate is invented", async () => {
  renderOrder({ ...baseOrder, status: "pending_contact", statusLabel: "Order received", pricing: { subtotalGBPMinor: 16499, finalGHS: null }, payment: { status: "not_requested", canSubmitProof: false } });
  expect(await screen.findByText(/don't pay yet/i)).toBeInTheDocument();
  expect(screen.getByText(/estimated delivery will be confirmed/i)).toBeInTheDocument();
});

describe("paymentProof utils", () => {
  test("reference and file validation", () => {
    expect(proofApi.validateReference("")).toMatch(/enter the transaction id/i);
    expect(proofApi.validateReference("<script>")).toMatch(/letters and numbers/i);
    expect(proofApi.validateReference("MP241027.1234.A5678")).toBeNull();
    expect(proofApi.validateProofFile(null)).toMatch(/choose/i);
    expect(proofApi.validateProofFile(png("a.svg", 10, "image/svg+xml"))).toMatch(/jpeg, png or webp/i);
    expect(proofApi.validateProofFile(png("a.png", 0))).toMatch(/empty/i);
    expect(proofApi.validateProofFile(png("a.png", 6 * 1024 * 1024))).toMatch(/5 MB/);
    expect(proofApi.validateProofFile(png("a.webp", 10, "image/webp"))).toBeNull();
  });

  test("small files are uploaded unchanged", async () => {
    const file = png();
    expect(await proofApi.prepareProofImage(file)).toBe(file);
  });
});
