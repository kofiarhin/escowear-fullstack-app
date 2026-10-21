import { buildOrderPayload, emptyCheckoutForm, forgetCheckoutAttempt, idempotencyKeyFor, isGhanaPhone, mapServerErrors, validateCheckoutForm } from "./checkout";

beforeEach(() => {
  sessionStorage.clear();
  forgetCheckoutAttempt();
});

test("Ghana phone formats", () => {
  ["0241234567", "024 123 4567", "+233241234567", "233 55 123 4567", "020-765-4321"].forEach((value) => expect(isGhanaPhone(value)).toBe(true));
  ["07700900123", "+447700900123", "024123456", "0141234567", ""].forEach((value) => expect(isGhanaPhone(value)).toBe(false));
});

test("idempotency key is stable for the same payload and changes when the payload changes", () => {
  const payload = buildOrderPayload({ ...emptyCheckoutForm(), name: "Ama" }, [{ productId: "p", size: "UK 9", quantity: 1, price: 1 }]);
  const first = idempotencyKeyFor(payload);
  expect(idempotencyKeyFor(payload)).toBe(first);
  expect(sessionStorage.getItem("escowear-checkout-attempt-v1")).not.toMatch(/Ama/);
  const changed = idempotencyKeyFor({ ...payload, termsVersion: "other" });
  expect(changed).not.toBe(first);
  forgetCheckoutAttempt();
  expect(idempotencyKeyFor(payload)).not.toBe(first);
});

test("payload never carries prices and validation covers required fields", () => {
  const payload = buildOrderPayload(emptyCheckoutForm(), [{ productId: "p", size: "UK 9", quantity: 1, price: 99, name: "x" }]);
  expect(payload.items).toEqual([{ productId: "p", size: "UK 9", quantity: 1 }]);
  expect(Object.keys(validateCheckoutForm(emptyCheckoutForm())).sort()).toEqual(["city", "email", "line1", "name", "phone", "region", "termsAccepted"]);
});

test("server errors map to form fields and item rows", () => {
  expect(mapServerErrors({ "customer.email": "bad", "items.1": "gone", other: "x" })).toEqual({
    formErrors: { email: "bad" },
    itemErrors: { 1: "gone" },
    other: "x",
  });
});
