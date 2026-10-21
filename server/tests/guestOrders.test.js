const test = require("node:test");
const assert = require("node:assert/strict");
const { Types } = require("mongoose");
const { newIdempotencyKey, sampleProduct, startTestApp, userToken, validOrderBody } = require("./helpers/testApp");
const { validateGuestOrder, normalizeGhanaPhone } = require("../validators/orderValidator");
const { generateOrderNumber } = require("../services/orderService");
const { issueOrderAccessToken, verifyOrderAccessToken } = require("../services/orderAccess");
const Order = require("../Models/Order.model");

const setup = async (t, options) => {
  const ctx = await startTestApp(options);
  t.after(ctx.close);
  const product = await ctx.models.Product.create(sampleProduct());
  return { ...ctx, product };
};

const placeOrder = (ctx, body, key = newIdempotencyKey(), extra = {}) =>
  ctx.request("POST", "/api/orders", { body, headers: { "Idempotency-Key": key }, ...extra });

test("guest can place an order without an account and gets a pending_contact reference", async (t) => {
  const ctx = await setup(t);
  const response = await placeOrder(ctx, validOrderBody(ctx.product._id));

  assert.equal(response.status, 201);
  assert.match(response.body.orderNumber, /^EW-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  assert.equal(response.body.status, "pending_contact");
  assert.equal(response.body.statusLabel, "Order received — awaiting our email");
  assert.ok(response.body.trackingHandoff.accessToken);
  assert.equal(verifyOrderAccessToken(response.body.trackingHandoff.accessToken), response.body.orderId);

  const [stored] = ctx.models.Order.docs;
  assert.equal(stored.status, "pending_contact");
  assert.equal(stored.user, undefined);
  assert.equal(stored.customer.emailNormalized, "ama.mensah@example.test");
  assert.equal(stored.customer.phone, "+233241234567");
  assert.equal(stored.shippingAddress.phone, "+233207654321");
  assert.equal(stored.shippingAddress.country, "GH");
  assert.equal(stored.payment.status, "not_requested");
  assert.equal(stored.pricing.estimatedOnly, true);
  assert.equal(stored.termsVersion, "2026-10-draft");
  // The raw idempotency key is never stored.
  assert.notEqual(stored.idempotencyKeyHash, undefined);
  assert.ok(!JSON.stringify(stored).includes("Idempotency"));

  // Response never leaks internal fields.
  const serialized = JSON.stringify(response.body);
  ["idempotencyKeyHash", "requestFingerprint", "internalNotes", "phone", "line1"].forEach((field) =>
    assert.ok(!serialized.includes(field), `${field} must not be in response`)
  );
});

test("server prices from the catalogue and ignores tampered client prices, status, user and payment", async (t) => {
  const ctx = await setup(t);
  const attacker = new Types.ObjectId();
  const body = validOrderBody(ctx.product._id, {
    status: "confirmed",
    user: String(attacker),
    payment: { status: "verified" },
    pricing: { subtotalGBPMinor: 1 },
    items: [{ productId: String(ctx.product._id), size: "9", quantity: 2, price: 0.01, unitPriceGBPMinor: 1, name: "Free shoes" }],
  });
  const response = await placeOrder(ctx, body);
  assert.equal(response.status, 201);

  const [stored] = ctx.models.Order.docs;
  assert.equal(stored.status, "pending_contact");
  assert.equal(stored.user, undefined);
  assert.equal(stored.payment.status, "not_requested");
  assert.equal(stored.items.length, 1);
  assert.equal(stored.items[0].name, "Nike Air Max Dn8");
  assert.equal(stored.items[0].size, "UK 9");
  assert.equal(stored.items[0].unitPriceGBPMinor, 16499);
  assert.equal(stored.items[0].lineTotalGBPMinor, 32998);
  assert.equal(stored.pricing.subtotalGBPMinor, 32998);
  assert.equal(response.body.order.pricing.subtotalGBPMinor, 32998);
});

test("duplicate lines for the same variant are merged; different sizes stay separate", async (t) => {
  const ctx = await setup(t);
  const id = String(ctx.product._id);
  const response = await placeOrder(
    ctx,
    validOrderBody(id, {
      items: [
        { productId: id, size: "UK 9", quantity: 1 },
        { productId: id, size: "9", quantity: 2 },
        { productId: id, size: "UK 10", quantity: 1 },
      ],
    })
  );
  assert.equal(response.status, 201);
  const [stored] = ctx.models.Order.docs;
  assert.deepEqual(
    stored.items.map((item) => [item.size, item.quantity]),
    [
      ["UK 9", 3],
      ["UK 10", 1],
    ]
  );
  assert.equal(stored.pricing.subtotalGBPMinor, 16499 * 4);
});

test("invalid or unavailable items are rejected without creating an order", async (t) => {
  const ctx = await setup(t);
  const outOfStock = await ctx.models.Product.create(sampleProduct({ inStock: false }));
  const archived = await ctx.models.Product.create(sampleProduct({ status: "archived" }));
  const noSizes = await ctx.models.Product.create(sampleProduct({ sizes: [] }));
  const nonGbp = await ctx.models.Product.create(sampleProduct({ currency: "USD" }));
  const freeProduct = await ctx.models.Product.create(sampleProduct({ price: 0 }));

  const cases = [
    [{ productId: String(new Types.ObjectId()), size: "UK 9", quantity: 1 }, "ITEMS_UNAVAILABLE"],
    [{ productId: String(outOfStock._id), size: "UK 9", quantity: 1 }, "ITEMS_UNAVAILABLE"],
    [{ productId: String(archived._id), size: "UK 9", quantity: 1 }, "ITEMS_UNAVAILABLE"],
    [{ productId: String(noSizes._id), size: "UK 9", quantity: 1 }, "ITEMS_UNAVAILABLE"],
    [{ productId: String(nonGbp._id), size: "UK 9", quantity: 1 }, "ITEMS_UNAVAILABLE"],
    [{ productId: String(freeProduct._id), size: "UK 9", quantity: 1 }, "ITEMS_UNAVAILABLE"],
    [{ productId: String(ctx.product._id), size: "UK 12", quantity: 1 }, "ITEMS_UNAVAILABLE"],
    [{ productId: String(ctx.product._id), size: "", quantity: 1 }, "VALIDATION_FAILED"],
    [{ productId: String(ctx.product._id), size: "UK 9", quantity: 0 }, "VALIDATION_FAILED"],
    [{ productId: String(ctx.product._id), size: "UK 9", quantity: 11 }, "VALIDATION_FAILED"],
    [{ productId: String(ctx.product._id), size: "UK 9", quantity: 1.5 }, "VALIDATION_FAILED"],
    [{ productId: String(ctx.product._id), size: "UK 9", quantity: "2" }, "VALIDATION_FAILED"],
    [{ productId: "not-an-id", size: "UK 9", quantity: 1 }, "VALIDATION_FAILED"],
    [{ productId: { $gt: "" }, size: "UK 9", quantity: 1 }, "VALIDATION_FAILED"],
  ];
  for (const [item, code] of cases) {
    const response = await placeOrder(ctx, validOrderBody(ctx.product._id, { items: [item] }));
    assert.equal(response.status, 422, JSON.stringify(item));
    assert.equal(response.body.code, code, JSON.stringify(item));
    assert.ok(response.body.fields);
  }
  assert.equal(ctx.models.Order.docs.length, 0);
  assert.equal(ctx.models.EmailOutbox.docs.length, 0);
});

test("customer, Ghana address and terms are validated", async (t) => {
  const ctx = await setup(t);
  const base = validOrderBody(ctx.product._id);
  const cases = [
    [{ ...base, customer: { ...base.customer, email: "not-an-email" } }, "customer.email"],
    [{ ...base, customer: { ...base.customer, name: "" } }, "customer.name"],
    [{ ...base, customer: { ...base.customer, phone: "07700 900123" } }, "customer.phone"],
    [{ ...base, shippingAddress: { ...base.shippingAddress, region: "Lagos" } }, "shippingAddress.region"],
    [{ ...base, shippingAddress: { ...base.shippingAddress, line1: "" } }, "shippingAddress.line1"],
    [{ ...base, shippingAddress: { ...base.shippingAddress, city: "" } }, "shippingAddress.city"],
    [{ ...base, shippingAddress: { ...base.shippingAddress, country: "NG" } }, "shippingAddress.country"],
    [{ ...base, termsAccepted: false }, "termsAccepted"],
    [{ ...base, termsAccepted: "true" }, "termsAccepted"],
    [{ ...base, termsVersion: "" }, "termsVersion"],
    [{ ...base, items: [] }, "items"],
  ];
  for (const [body, field] of cases) {
    const response = await placeOrder(ctx, body);
    assert.equal(response.status, 422, field);
    assert.ok(response.body.fields[field], `expected error for ${field}`);
  }
  assert.equal(ctx.models.Order.docs.length, 0);
});

test("missing or malformed idempotency key and malformed JSON are rejected", async (t) => {
  const ctx = await setup(t);
  const missing = await ctx.request("POST", "/api/orders", { body: validOrderBody(ctx.product._id) });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, "IDEMPOTENCY_KEY_REQUIRED");

  const short = await placeOrder(ctx, validOrderBody(ctx.product._id), "short");
  assert.equal(short.status, 400);

  const badJson = await ctx.request("POST", "/api/orders", { body: "{nope", headers: { "Idempotency-Key": newIdempotencyKey() } });
  assert.equal(badJson.status, 400);
  assert.equal(badJson.body.code, "INVALID_JSON");

  const legacyArray = await placeOrder(ctx, [{ productId: String(ctx.product._id), size: "9", name: "x", price: 1 }]);
  assert.equal(legacyArray.status, 422);
  assert.equal(ctx.models.Order.docs.length, 0);
});

test("retrying with the same idempotency key returns the same order and queues one acknowledgement", async (t) => {
  const ctx = await setup(t);
  const key = newIdempotencyKey();
  const body = validOrderBody(ctx.product._id);

  const first = await placeOrder(ctx, body, key);
  const second = await placeOrder(ctx, body, key);
  const [third, fourth] = await Promise.all([placeOrder(ctx, body, key), placeOrder(ctx, body, key)]);

  assert.equal(first.status, 201);
  [second, third, fourth].forEach((response) => {
    assert.equal(response.status, 200);
    assert.equal(response.body.orderId, first.body.orderId);
    assert.equal(response.body.orderNumber, first.body.orderNumber);
  });
  assert.equal(ctx.models.Order.docs.length, 1);
  assert.equal(ctx.models.EmailOutbox.docs.length, 1);
  assert.equal(ctx.models.OrderEvent.docs.filter((event) => event.type === "order_created").length, 1);

  const ack = ctx.models.EmailOutbox.docs[0];
  assert.equal(ack.kind, "order_received");
  assert.equal(ack.state, "queued");
  assert.equal(ack.to, "ama.mensah@example.test");
  assert.match(ack.payload.subject, new RegExp(`#${first.body.orderNumber}$`));
  assert.match(ack.payload.text, /not a payment request/);
  assert.match(ack.payload.text, /not yet confirmed/);
  assert.match(ack.payload.text, /track-order\?order=EW-/);
  assert.ok(!ack.payload.text.includes(first.body.trackingHandoff.accessToken), "tokens never go in emails");
  assert.equal(ctx.models.Order.docs[0].email.acknowledgementState, "queued");
});

test("reusing an idempotency key for a different order is a conflict", async (t) => {
  const ctx = await setup(t);
  const key = newIdempotencyKey();
  await placeOrder(ctx, validOrderBody(ctx.product._id), key);
  const changed = validOrderBody(ctx.product._id, { items: [{ productId: String(ctx.product._id), size: "UK 10", quantity: 1 }] });
  const response = await placeOrder(ctx, changed, key);
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(ctx.models.Order.docs.length, 1);
});

test("a failed acknowledgement enqueue keeps the order and a retry repairs it without duplicates", async (t) => {
  const ctx = await setup(t);
  const originalCreate = ctx.models.EmailOutbox.create;
  ctx.models.EmailOutbox.create = async () => {
    throw new Error("mail queue unavailable");
  };
  const key = newIdempotencyKey();
  const body = validOrderBody(ctx.product._id);
  const first = await placeOrder(ctx, body, key);
  assert.equal(first.status, 201);
  assert.equal(ctx.models.Order.docs.length, 1);
  assert.equal(ctx.models.EmailOutbox.docs.length, 0);
  assert.equal(ctx.models.Order.docs[0].email.acknowledgementState, "not_queued");

  ctx.models.EmailOutbox.create = originalCreate;
  const retry = await placeOrder(ctx, body, key);
  assert.equal(retry.status, 200);
  assert.equal(ctx.models.EmailOutbox.docs.length, 1);
  assert.equal(ctx.models.Order.docs[0].email.acknowledgementState, "queued");
});

test("order number collisions are retried", async (t) => {
  let call = 0;
  const randomBytes = (size) => {
    call += 1;
    // First two orders draw identical bytes; the third draw differs.
    return Buffer.alloc(size, call <= 2 ? 7 : 9);
  };
  const ctx = await setup(t, { deps: { orders: { randomBytes } } });
  const a = await placeOrder(ctx, validOrderBody(ctx.product._id));
  const b = await placeOrder(ctx, validOrderBody(ctx.product._id));
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.notEqual(a.body.orderNumber, b.body.orderNumber);
});

test("signed-in customers can check out and their order is linked to them", async (t) => {
  const ctx = await setup(t);
  const user = await ctx.addUser();
  const response = await placeOrder(ctx, validOrderBody(ctx.product._id), newIdempotencyKey(), { token: userToken(user._id) });
  assert.equal(response.status, 201);
  assert.equal(String(ctx.models.Order.docs[0].user), String(user._id));

  const invalidToken = await placeOrder(ctx, validOrderBody(ctx.product._id), newIdempotencyKey(), { token: "garbage" });
  assert.equal(invalidToken.status, 401);
});

test("order list requires login and returns only the caller's orders, including legacy orders", async (t) => {
  const ctx = await setup(t);
  const owner = await ctx.addUser();
  const other = await ctx.addUser();
  await placeOrder(ctx, validOrderBody(ctx.product._id), newIdempotencyKey(), { token: userToken(owner._id) });
  await placeOrder(ctx, validOrderBody(ctx.product._id), newIdempotencyKey(), { token: userToken(other._id) });
  await placeOrder(ctx, validOrderBody(ctx.product._id));
  // A legacy record shaped like the pre-checkout schema.
  await ctx.models.Order.create({
    user: owner._id,
    products: [{ productId: ctx.product._id, size: "9", name: "Legacy sneaker", price: 99 }],
    status: "Pending",
  });

  const anonymous = await ctx.request("GET", "/api/orders");
  assert.equal(anonymous.status, 401);

  const list = await ctx.request("GET", "/api/orders", { token: userToken(owner._id) });
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 2);
  assert.equal(list.body.pagination.total, 2);
  const legacy = list.body.items.find((order) => order.legacy);
  assert.equal(legacy.status, "Pending");
  assert.equal(legacy.items[0].name, "Legacy sneaker");
  assert.equal(legacy.pricing, null);
  assert.ok(list.body.items.every((order) => !JSON.stringify(order).includes("idempotency")));
});

test("single order read is scoped to its owner or a matching access token", async (t) => {
  const ctx = await setup(t);
  const owner = await ctx.addUser();
  const stranger = await ctx.addUser();
  const guest = await placeOrder(ctx, validOrderBody(ctx.product._id));
  const owned = await placeOrder(ctx, validOrderBody(ctx.product._id), newIdempotencyKey(), { token: userToken(owner._id) });

  const guestPath = `/api/orders/${guest.body.orderId}`;
  const ownedPath = `/api/orders/${owned.body.orderId}`;

  assert.equal((await ctx.request("GET", guestPath)).status, 404);
  assert.equal((await ctx.request("GET", guestPath, { token: userToken(stranger._id) })).status, 404);
  assert.equal((await ctx.request("GET", ownedPath, { token: userToken(stranger._id) })).status, 404);
  // A token for one order cannot read another.
  assert.equal(
    (await ctx.request("GET", ownedPath, { headers: { "X-Order-Access-Token": guest.body.trackingHandoff.accessToken } })).status,
    404
  );
  // An order access token is not a login token.
  assert.equal((await ctx.request("GET", "/api/orders", { token: guest.body.trackingHandoff.accessToken })).status, 401);
  assert.equal((await ctx.request("GET", "/api/orders/not-an-id")).status, 404);

  const viaToken = await ctx.request("GET", guestPath, {
    headers: { "X-Order-Access-Token": guest.body.trackingHandoff.accessToken },
  });
  assert.equal(viaToken.status, 200);
  assert.equal(viaToken.headers.get("cache-control"), "no-store");
  assert.equal(viaToken.body.orderNumber, guest.body.orderNumber);
  assert.deepEqual(viaToken.body.history.map((entry) => entry.status), ["pending_contact"]);

  const viaOwner = await ctx.request("GET", ownedPath, { token: userToken(owner._id) });
  assert.equal(viaOwner.status, 200);
  assert.equal(viaOwner.body.id, owned.body.orderId);
});

test("order creation is rate limited per client", async (t) => {
  const ctx = await setup(t);
  const responses = [];
  for (let index = 0; index < 21; index += 1) {
    responses.push(await ctx.request("POST", "/api/orders", { body: {}, headers: { "Idempotency-Key": newIdempotencyKey() } }));
  }
  assert.equal(responses[19].status, 422);
  assert.equal(responses[20].status, 429);
  assert.equal(responses[20].body.code, "RATE_LIMITED");
  assert.ok(responses[20].headers.get("retry-after"));
});

test("registration ignores privileged fields", async (t) => {
  const ctx = await setup(t);
  const User = require("../Models/User.model");
  const saved = [];
  const original = User.prototype.save;
  User.prototype.save = async function save() {
    saved.push(this.toObject());
    return this;
  };
  t.after(() => {
    User.prototype.save = original;
  });
  const response = await ctx.request("POST", "/api/users/register", {
    body: { name: "Mallory", email: "mallory@example.test", password: "pw-123456", role: "admin", _id: "x" },
  });
  assert.equal(response.status, 201);
  assert.notEqual(saved[0].role, "admin");
});

test("validator unit rules", () => {
  assert.equal(normalizeGhanaPhone("0241234567"), "+233241234567");
  assert.equal(normalizeGhanaPhone("+233 24 123 4567"), "+233241234567");
  assert.equal(normalizeGhanaPhone("233-55-123-4567"), "+233551234567");
  assert.equal(normalizeGhanaPhone("0141234567"), null);
  assert.equal(normalizeGhanaPhone("+44 7700 900123"), null);
  assert.equal(validateGuestOrder(null).ok, false);
  const region = validateGuestOrder(validOrderBody(new Types.ObjectId(), { shippingAddress: { ...validOrderBody(new Types.ObjectId()).shippingAddress, region: "greater accra" } }));
  assert.equal(region.value.shippingAddress.region, "Greater Accra");
});

test("order numbers and access tokens", () => {
  const numbers = new Set(Array.from({ length: 2000 }, () => generateOrderNumber()));
  assert.equal(numbers.size, 2000);
  const id = String(new Types.ObjectId());
  const token = issueOrderAccessToken(id, 5);
  assert.equal(verifyOrderAccessToken(token), id);
  assert.equal(verifyOrderAccessToken(token + "x"), null);
  assert.equal(verifyOrderAccessToken(issueOrderAccessToken(id, 5, { secret: "another-secret" })), null);
  assert.equal(verifyOrderAccessToken(undefined), null);
});

test("Order schema accepts legacy and guest documents", () => {
  const legacy = new Order({ user: new Types.ObjectId(), products: [{ productId: new Types.ObjectId(), size: "9", name: "x", price: 10 }] });
  assert.equal(legacy.validateSync(), undefined);
  assert.equal(legacy.status, "Pending");

  const guest = new Order({
    orderNumber: "EW-ABCDE-12345",
    status: "pending_contact",
    items: [{ productId: new Types.ObjectId(), name: "x", size: "UK 9", quantity: 1, unitPriceGBPMinor: 100, lineTotalGBPMinor: 100 }],
    pricing: { currency: "GBP", subtotalGBPMinor: 100, estimatedOnly: true },
  });
  assert.equal(guest.validateSync(), undefined);

  const fractional = new Order({
    items: [{ productId: new Types.ObjectId(), name: "x", size: "UK 9", quantity: 1.5, unitPriceGBPMinor: 99.5, lineTotalGBPMinor: 100 }],
  });
  const error = fractional.validateSync();
  assert.ok(error.errors["items.0.quantity"]);
  assert.ok(error.errors["items.0.unitPriceGBPMinor"]);
});
