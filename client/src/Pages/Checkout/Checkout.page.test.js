import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { applyMiddleware, createStore } from "redux";
import thunkMiddleware from "redux-thunk";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import reducers from "../../redux/reducers";
import Checkout from "./Checkout.page";
import OrderConfirmation from "../OrderConfirmation/OrderConfirmation.page";
import { CART_KEY } from "../../utils/cart";
import review from "../../policies/review.json";
import { getOrderAccess, getProofAccess } from "../../utils/orderAccess";
import { fetchCheckoutStatus } from "../../utils/checkoutStatus";

// Checkout status stays "unknown" (form shown) unless a test sets it.
jest.mock("../../utils/checkoutStatus", () => ({ fetchCheckoutStatus: jest.fn() }));

const cartItems = [
  { productId: "64b000000000000000000001", size: "UK 9", quantity: 2, name: "Nike Air Max Dn8", image: "https://example.test/dn8.jpg", price: 164.99, currency: "GBP" },
];

const createdOrder = {
  orderId: "64b0000000000000000000aa",
  orderNumber: "EW-ABCDE-23456",
  status: "pending_contact",
  statusLabel: "Order received — awaiting our email",
  trackingHandoff: { accessToken: "access-token-1", expiresInMinutes: 60, proofToken: "proof-token-1" },
  order: {
    id: "64b0000000000000000000aa",
    orderNumber: "EW-ABCDE-23456",
    status: "pending_contact",
    customer: { name: "Ama Mensah", email: "ama@example.test" },
    items: [{ productId: "64b000000000000000000001", name: "Nike Air Max Dn8", size: "UK 9", quantity: 2, unitPriceGBPMinor: 16499, lineTotalGBPMinor: 32998 }],
    pricing: { currency: "GBP", subtotalGBPMinor: 32998, estimatedOnly: true, finalGHS: null },
    history: [],
  },
};

const jsonResponse = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

const renderCheckout = ({ user } = {}) => {
  const store = createStore(reducers, applyMiddleware(thunkMiddleware));
  if (user) store.dispatch({ type: "LOGIN_SUCCESS", payload: user });
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/checkout"]}>
        <Routes>
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/orders/:id/confirmation" element={<OrderConfirmation />} />
          <Route path="/login" element={<p>Login page</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
};

const fillValidForm = async () => {
  await userEvent.type(screen.getByLabelText("Full name"), "Ama Mensah");
  await userEvent.type(screen.getByLabelText("Email"), "ama@example.test");
  await userEvent.type(screen.getByLabelText("Ghana phone number"), "024 123 4567");
  await userEvent.type(screen.getByLabelText("Street address or house number"), "12 Ring Road East");
  await userEvent.type(screen.getByLabelText("Town or city"), "Accra");
  await userEvent.selectOptions(screen.getByLabelText("Region"), "Greater Accra");
  await userEvent.click(screen.getByLabelText(/i understand this is an order request/i));
};

const submit = () => userEvent.click(screen.getByRole("button", { name: /place order request/i }));
const storedCart = () => JSON.parse(localStorage.getItem(CART_KEY));
const orderCalls = () => global.fetch.mock.calls.filter(([url, options]) => url === "/api/orders" && options?.method === "POST");

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(CART_KEY, JSON.stringify(cartItems));
  global.fetch = jest.fn();
  fetchCheckoutStatus.mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("guest checkout explains no payment now and GBP estimate vs final GHS amount, without login", () => {
  renderCheckout();
  expect(screen.getByRole("heading", { name: "Checkout" })).toBeInTheDocument();
  expect(screen.getByRole("note")).toHaveTextContent(/no payment now\. we will email confirmed ghs payment details after checking availability and costs/i);
  expect(screen.getByText(/checking out as a guest/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  const summary = screen.getByRole("complementary", { name: /order summary/i });
  expect(within(summary).getByText("£329.98", { selector: "dd" })).toBeInTheDocument();
  expect(within(summary).getByText(/indicative subtotal \(gbp\)/i)).toBeInTheDocument();
  expect(within(summary).getByText(/final amount in ghs/i)).toBeInTheDocument();
});

test("empty cart cannot check out", () => {
  localStorage.clear();
  renderCheckout();
  expect(screen.getByText(/your cart is empty/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /place order/i })).not.toBeInTheDocument();
});

test("required fields, Ghana phone and agreement are validated before anything is sent", async () => {
  renderCheckout();
  await submit();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent(/correct the highlighted fields/i);
  expect(screen.getByLabelText("Full name")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Full name")).toHaveFocus();
  expect(screen.getByText("Enter a valid email address")).toBeInTheDocument();
  expect(screen.getByText(/enter a ghana phone number/i)).toBeInTheDocument();
  expect(screen.getByText("Select your region")).toBeInTheDocument();
  expect(screen.getByText(/please confirm you understand/i)).toBeInTheDocument();

  await userEvent.type(screen.getByLabelText("Ghana phone number"), "07700 900123");
  await submit();
  expect(screen.getByLabelText("Ghana phone number")).toHaveAttribute("aria-invalid", "true");
  expect(global.fetch).not.toHaveBeenCalled();
  expect(storedCart()).toEqual(cartItems);
});

test("successful order sends only ids/sizes/quantities, clears the cart and shows a received-only confirmation", async () => {
  global.fetch.mockImplementation((url, options) =>
    options?.method === "POST" ? jsonResponse(201, createdOrder) : jsonResponse(200, createdOrder.order)
  );
  renderCheckout();
  await fillValidForm();
  await submit();

  expect(await screen.findByRole("heading", { name: "Order received — awaiting our email" })).toBeInTheDocument();
  expect(screen.getByText(/it is not paid and not yet confirmed/i)).toBeInTheDocument();
  expect(screen.getAllByText("EW-ABCDE-23456").length).toBeGreaterThan(0);
  expect(screen.queryByText(/payment verified|order confirmed/i)).not.toBeInTheDocument();

  const [[, options]] = orderCalls();
  const body = JSON.parse(options.body);
  expect(body.items).toEqual([{ productId: "64b000000000000000000001", size: "UK 9", quantity: 2 }]);
  expect(JSON.stringify(body)).not.toMatch(/price|164\.99/);
  expect(body.termsAccepted).toBe(true);
  expect(body.termsVersion).toBeTruthy();
  expect(body.shippingAddress.region).toBe("Greater Accra");
  expect(options.headers["Idempotency-Key"]).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  expect(options.headers.Authorization).toBeUndefined();

  expect(storedCart()).toEqual([]);
  expect(getOrderAccess(createdOrder.orderId)).toBe("access-token-1");
  expect(getProofAccess(createdOrder.orderId)).toBe("proof-token-1");
  expect(screen.getByText(/upload your payment screenshot and transaction ID/i)).toBeInTheDocument();
  await waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith(
      `/api/orders/${createdOrder.orderId}`,
      expect.objectContaining({ headers: expect.objectContaining({ "X-Order-Access-Token": "access-token-1" }) })
    )
  );
});

test("server error keeps the cart and a retry reuses the same idempotency key", async () => {
  global.fetch
    .mockImplementationOnce(() => jsonResponse(500, { error: "boom" }))
    .mockImplementation((url, options) => (options?.method === "POST" ? jsonResponse(201, createdOrder) : jsonResponse(200, createdOrder.order)));
  renderCheckout();
  await fillValidForm();
  await submit();

  expect(await screen.findByRole("alert")).toHaveTextContent(/your cart has been kept/i);
  expect(storedCart()).toEqual(cartItems);

  await submit();
  expect(await screen.findByRole("heading", { name: "Order received — awaiting our email" })).toBeInTheDocument();
  const keys = orderCalls().map(([, options]) => options.headers["Idempotency-Key"]);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});

test("network uncertainty keeps the cart and says retrying is safe", async () => {
  global.fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  renderCheckout();
  await fillValidForm();
  await submit();
  expect(await screen.findByRole("alert")).toHaveTextContent(/trying again is safe/i);
  expect(storedCart()).toEqual(cartItems);
  expect(screen.getByRole("button", { name: /place order request/i })).toBeEnabled();
});

test("unavailable items are flagged and the cart is kept", async () => {
  global.fetch.mockImplementation(() =>
    jsonResponse(422, { code: "ITEMS_UNAVAILABLE", error: "Some items…", fields: { "items.0": "This size is not available" } })
  );
  renderCheckout();
  await fillValidForm();
  await submit();
  expect(await screen.findByRole("alert")).toHaveTextContent(/can no longer be ordered/i);
  expect(screen.getByText("This size is not available")).toBeInTheDocument();
  expect(storedCart()).toEqual(cartItems);
});

test("server field errors are shown against the right inputs", async () => {
  global.fetch.mockImplementation(() =>
    jsonResponse(422, { code: "VALIDATION_FAILED", error: "Please correct the highlighted fields", fields: { "shippingAddress.city": "Town or city is required" } })
  );
  renderCheckout();
  await fillValidForm();
  await submit();
  expect(await screen.findByText("Town or city is required")).toBeInTheDocument();
  expect(screen.getByLabelText("Town or city")).toHaveAttribute("aria-invalid", "true");
});

test("double submit sends a single request while processing", async () => {
  let resolve;
  global.fetch.mockImplementation((url, options) =>
    options?.method === "POST" ? new Promise((done) => (resolve = done)) : jsonResponse(200, createdOrder.order)
  );
  renderCheckout();
  await fillValidForm();
  const button = screen.getByRole("button", { name: /place order request/i });
  await userEvent.click(button);
  expect(screen.getByRole("button", { name: /placing order/i })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: /placing order/i }));
  expect(orderCalls()).toHaveLength(1);
  resolve({ ok: true, status: 201, json: async () => createdOrder });
  expect(await screen.findByRole("heading", { name: "Order received — awaiting our email" })).toBeInTheDocument();
});

test("signed-in customers send their token and get prefilled details", async () => {
  global.fetch.mockImplementation((url, options) => (options?.method === "POST" ? jsonResponse(201, createdOrder) : jsonResponse(200, createdOrder.order)));
  renderCheckout({ user: { id: "u1", name: "Ama Mensah", email: "ama@example.test", token: "user-token" } });
  expect(screen.getByLabelText("Full name")).toHaveValue("Ama Mensah");
  expect(screen.getByText(/signed in as ama@example.test/i)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Ghana phone number"), "0241234567");
  await userEvent.type(screen.getByLabelText("Street address or house number"), "12 Ring Road East");
  await userEvent.type(screen.getByLabelText("Town or city"), "Accra");
  await userEvent.selectOptions(screen.getByLabelText("Region"), "Ashanti");
  await userEvent.click(screen.getByLabelText(/i understand this is an order request/i));
  await submit();
  await screen.findByRole("heading", { name: "Order received — awaiting our email" });
  expect(orderCalls()[0][1].headers.Authorization).toBe("Bearer user-token");
});

test("an expired sign-in signs the customer out and lets them retry as a guest", async () => {
  global.fetch.mockImplementationOnce(() => jsonResponse(401, { error: "Unauthorized - invalid token" }));
  global.fetch.mockImplementation((url, options) => (options?.method === "POST" ? jsonResponse(201, createdOrder) : jsonResponse(200, createdOrder.order)));
  renderCheckout({ user: { id: "u1", name: "Ama Mensah", email: "ama@example.test", token: "expired-token" } });
  await userEvent.type(screen.getByLabelText("Ghana phone number"), "0241234567");
  await userEvent.type(screen.getByLabelText("Street address or house number"), "12 Ring Road East");
  await userEvent.type(screen.getByLabelText("Town or city"), "Accra");
  await userEvent.selectOptions(screen.getByLabelText("Region"), "Ashanti");
  await userEvent.click(screen.getByLabelText(/i understand this is an order request/i));
  await submit();
  expect(await screen.findByRole("alert")).toHaveTextContent(/sign-in has expired/i);
  expect(storedCart()).toEqual(cartItems);
  expect(screen.getByText(/checking out as a guest/i)).toBeInTheDocument();
  await submit();
  await screen.findByRole("heading", { name: "Order received — awaiting our email" });
  const calls = orderCalls();
  expect(calls[0][1].headers.Authorization).toBe("Bearer expired-token");
  expect(calls[1][1].headers.Authorization).toBeUndefined();
});

test("policy link and policy lines appear in checkout only when policies are visible", () => {
  renderCheckout();
  expect(screen.queryByRole("link", { name: /shop policies/i })).not.toBeInTheDocument();
  expect(screen.queryByText(review.business.delivery)).not.toBeInTheDocument();
});

test("with published policies, checkout links to them in a new tab and states the key terms", () => {
  process.env.REACT_APP_POLICIES_STATUS = "published";
  try {
    renderCheckout();
    const link = screen.getByRole("link", { name: /shop policies \(opens in a new tab\)/i });
    expect(link).toHaveAttribute("href", "/policies");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(/pay nothing extra on arrival\. Quotes are valid for 48 hours/i)).toBeInTheDocument();
    expect(screen.getByText(review.business.delivery)).toBeInTheDocument();
    expect(screen.queryByText(/10–21 days/)).not.toBeInTheDocument();
  } finally {
    delete process.env.REACT_APP_POLICIES_STATUS;
  }
});

test("closed checkout says ordering opens soon, keeps the cart and shows no form", async () => {
  fetchCheckoutStatus.mockResolvedValueOnce(false);
  renderCheckout();
  expect(await screen.findByText(/online ordering opens soon/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /place order request/i })).not.toBeInTheDocument();
  expect(storedCart()).toEqual(cartItems);
});

test("a server-side closed checkout on submit switches to the opening-soon notice", async () => {
  global.fetch.mockImplementation(() => jsonResponse(503, { error: "Online ordering opens soon.", code: "CHECKOUT_CLOSED" }));
  renderCheckout();
  await fillValidForm();
  await submit();
  expect(await screen.findByText(/online ordering opens soon/i)).toBeInTheDocument();
  expect(storedCart()).toEqual(cartItems);
});
