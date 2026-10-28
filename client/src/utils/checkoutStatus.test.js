import { fetchCheckoutStatus } from "./checkoutStatus";

const respond = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  global.fetch = jest.fn();
});

test("reports open or closed from the server", async () => {
  global.fetch.mockReturnValueOnce(respond(200, { open: true })).mockReturnValueOnce(respond(200, { open: false }));
  expect(await fetchCheckoutStatus()).toBe(true);
  expect(await fetchCheckoutStatus()).toBe(false);
  expect(global.fetch).toHaveBeenCalledWith("/api/orders/checkout-status", expect.objectContaining({ method: "GET" }));
});

test("is unknown (null) on a server error, an unexpected body or a network failure", async () => {
  global.fetch
    .mockReturnValueOnce(respond(500, { error: "boom" }))
    .mockReturnValueOnce(respond(200, { open: "yes" }))
    .mockRejectedValueOnce(new Error("offline"));
  expect(await fetchCheckoutStatus()).toBeNull();
  expect(await fetchCheckoutStatus()).toBeNull();
  expect(await fetchCheckoutStatus()).toBeNull();
});
