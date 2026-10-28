// IDE-129: website payment-proof upload, guest capability, private storage,
// admin review and the real-funds verification gate.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const sharp = require("sharp");
const { Types } = require("mongoose");
const { newIdempotencyKey, sampleProduct, startTestApp, userToken, validOrderBody } = require("./helpers/testApp");
const { issueOrderAccessToken, issuePaymentProofToken, verifyOrderAccessToken, verifyPaymentProofToken } = require("../services/orderAccess");
const { maskReference } = require("../services/paymentProofService");

const CHANNEL = "TEST MOMO CHANNEL\\nNot a real account";
const futureIso = (hours = 48) => new Date(Date.now() + hours * 3600 * 1000).toISOString();

const png = (width = 240, height = 480) =>
  sharp({ create: { width, height, channels: 3, background: { r: 20, g: 120, b: 60 } } }).png().toBuffer();
const jpegWithExif = () =>
  sharp({ create: { width: 300, height: 600, channels: 3, background: { r: 200, g: 200, b: 0 } } })
    .withExif({ IFD0: { Copyright: "PRIVATE-EXIF-MARKER", Artist: "PRIVATE-EXIF-MARKER" } })
    .jpeg()
    .toBuffer();
const webp = () => sharp({ create: { width: 200, height: 200, channels: 3, background: "#336699" } }).webp().toBuffer();

// A PNG whose header claims 30000x30000 pixels (decompression bomb shape).
const bombPng = () => {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(30000, 0);
  ihdr.writeUInt32BE(30000, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.alloc(30001 * 4))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const filesIn = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true }).filter((name) => fs.statSync(path.join(dir, name)).isFile());
};

const setup = async (t, { env = { ESCOWEAR_PAYMENT_INSTRUCTIONS: CHANNEL }, config = {}, orders = {}, linkUser = false } = {}) => {
  const ctx = await startTestApp({ config, deps: { admin: { env }, orders: { env, ...orders } } });
  t.after(ctx.close);
  const product = await ctx.models.Product.create(sampleProduct());
  const admin = await ctx.addUser({ role: "admin", name: "Esco Admin" });
  const adminToken = userToken(admin._id);
  const owner = await ctx.addUser();

  const placeOrder = async (overrides = {}) => {
    const placed = await ctx.request("POST", "/api/orders", {
      body: validOrderBody(product._id, overrides),
      headers: { "Idempotency-Key": newIdempotencyKey() },
      token: linkUser ? userToken(owner._id) : undefined,
    });
    assert.equal(placed.status, 201);
    return placed.body;
  };
  const act = (orderId, action, body, token = adminToken) => ctx.request("POST", `/api/admin/orders/${orderId}/${action}`, { body, token });
  const quote = (orderId, overrides = {}, extra = {}) =>
    act(orderId, "payment-instructions", {
      expectedStatus: "pending_contact",
      quote: { subtotalMinor: 150000, feesMinor: 5000, shippingMinor: 30000, dutiesMinor: 15000, expiresAt: futureIso(), ...overrides },
      ...extra,
    });

  const upload = async (orderId, { token, proofToken, readToken, image, reference = "MP241027.1234.A5678", quoteVersion = 1, key = newIdempotencyKey(), contentType = "image/png", filename = "proof.png", extraFields = {}, omitFile = false } = {}) => {
    const form = new FormData();
    if (reference !== null) form.append("transactionReference", reference);
    if (quoteVersion !== undefined) form.append("quoteVersion", String(quoteVersion));
    Object.entries(extraFields).forEach(([name, value]) => form.append(name, value));
    if (!omitFile) form.append("proofImage", new Blob([image || (await png())], { type: contentType }), filename);
    const response = await fetch(`${ctx.base}/api/orders/${orderId}/payment-proof`, {
      method: "POST",
      headers: {
        ...(key ? { "Idempotency-Key": key } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(proofToken ? { "X-Order-Proof-Token": proofToken } : {}),
        ...(readToken ? { "X-Order-Access-Token": readToken } : {}),
      },
      body: form,
    });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: response.status, body, headers: response.headers };
  };

  const view = (orderId, readToken) => ctx.request("GET", `/api/orders/${orderId}`, { headers: { "X-Order-Access-Token": readToken } });
  const orderDoc = (orderId) => ctx.models.Order.docs.find((doc) => String(doc._id) === String(orderId));
  return { ...ctx, product, admin, adminToken, owner, placeOrder, act, quote, upload, view, orderDoc };
};

const quotedOrder = async (ctx, quoteOverrides) => {
  const placed = await ctx.placeOrder();
  assert.equal((await ctx.quote(placed.orderId, quoteOverrides)).status, 200);
  return { ...placed, proofToken: placed.trackingHandoff.proofToken, readToken: placed.trackingHandoff.accessToken };
};

// --- tokens ------------------------------------------------------------------------

test("proof capability and read token are distinct: neither verifies as the other", () => {
  const id = String(new Types.ObjectId());
  const read = issueOrderAccessToken(id, 5);
  const proof = issuePaymentProofToken(id, 5);
  assert.equal(verifyOrderAccessToken(read), id);
  assert.equal(verifyPaymentProofToken(proof), id);
  assert.equal(verifyPaymentProofToken(read), null);
  assert.equal(verifyOrderAccessToken(proof), null);
  assert.equal(verifyPaymentProofToken(issuePaymentProofToken(id, -1)), null, "expired");
  assert.equal(maskReference("MP241027.1234.A5678"), "••••5678");
});

// --- happy path ----------------------------------------------------------------------

test("guest uploads PNG proof with checkout capability: under review, private file, receipt email, reload shows state", async (t) => {
  const ctx = await setup(t);
  const order = await quotedOrder(ctx);

  const response = await ctx.upload(order.orderId, { proofToken: order.proofToken });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(response.body.status, "under_review");
  assert.equal(response.body.orderStatus, "payment_review");
  assert.equal(response.body.referenceMasked, "••••5678");
  assert.equal(response.headers.get("cache-control"), "no-store");

  const doc = ctx.orderDoc(order.orderId);
  assert.equal(doc.status, "payment_review");
  assert.equal(doc.payment.status, "under_review", "never verified by an upload");
  assert.equal(String(doc.payment.proof.id), response.body.proofId);

  // Private file under the order's folder, not world-readable.
  const files = filesIn(ctx.proofDir);
  assert.equal(files.length, 1);
  assert.match(files[0], new RegExp(`^${order.orderId}/[a-f0-9]{32}\\.png$`));
  assert.equal(fs.statSync(path.join(ctx.proofDir, files[0])).mode & 0o077, 0);

  const proof = ctx.models.PaymentProof.docs[0];
  assert.equal(proof.reviewStatus, "pending");
  assert.equal(proof.channel, "website_upload");
  assert.equal(proof.submitter.type, "guest");

  const event = ctx.models.OrderEvent.docs.find((entry) => entry.type === "payment_proof_submitted");
  assert.equal(event.toStatus, "payment_review");
  assert.equal(event.fromStatus, "awaiting_payment");
  assert.equal(event.details.proofChannel, "website_upload");
  assert.ok(!JSON.stringify(event.details).includes("MP241027"), "full reference not in the event");

  const receipt = ctx.models.EmailOutbox.docs.find((entry) => entry.kind === "payment_proof_received");
  assert.match(receipt.payload.text, /under review\. Your order is NOT confirmed yet/);
  assert.ok(!/confirmed\./i.test(receipt.payload.subject));
  assert.equal(ctx.models.EmailOutbox.docs.filter((entry) => entry.kind === "order_confirmed").length, 0);

  // Reload: the read-only view shows review state with a masked reference only.
  const viewed = await ctx.view(order.orderId, order.readToken);
  assert.equal(viewed.status, 200);
  assert.equal(viewed.body.statusLabel, "Payment submitted — under review");
  assert.equal(viewed.body.payment.status, "under_review");
  assert.equal(viewed.body.payment.verified, false);
  assert.equal(viewed.body.payment.canSubmitProof, false);
  assert.equal(viewed.body.payment.proof.referenceMasked, "••••5678");
  const serialized = JSON.stringify(viewed.body);
  assert.ok(!/storageKey|MP241027|payment-proofs|\.png/.test(serialized), "no storage path or full reference for customers");
});

test("JPEG EXIF is stripped and WebP is accepted; stored bytes are re-encoded", async (t) => {
  const ctx = await setup(t);
  const first = await quotedOrder(ctx);
  const original = await jpegWithExif();
  assert.ok(original.includes(Buffer.from("PRIVATE-EXIF-MARKER")));
  const jpeg = await ctx.upload(first.orderId, { proofToken: first.proofToken, image: original, contentType: "image/jpeg", filename: "a.jpg" });
  assert.equal(jpeg.status, 201, JSON.stringify(jpeg.body));
  const stored = fs.readFileSync(path.join(ctx.proofDir, filesIn(ctx.proofDir)[0]));
  assert.ok(!stored.includes(Buffer.from("PRIVATE-EXIF-MARKER")), "EXIF removed");
  assert.equal((await sharp(stored).metadata()).format, "jpeg");

  const second = await quotedOrder(ctx);
  // Declared type is ignored: a WebP sent as "image/png" is detected as WebP.
  const result = await ctx.upload(second.orderId, { proofToken: second.proofToken, image: await webp(), contentType: "image/png" });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(ctx.models.PaymentProof.docs.find((entry) => String(entry.orderId) === second.orderId).contentType, "image/webp");
});

test("tracking-code holder gets an order-bound proof capability; logged-in owner can upload without one", async (t) => {
  const ctx = await setup(t, { linkUser: true });
  const order = await quotedOrder(ctx);
  // Simulate the emailed-code handoff by verifying through the real endpoint.
  await ctx.request("POST", "/api/orders/tracking/request", { body: { orderNumber: order.orderNumber, email: "ama.mensah@example.test" } });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const codeMail = ctx.models.EmailOutbox.docs.find((entry) => entry.kind === "tracking_code");
  const code = codeMail.payload.text.match(/is: (\d{6})/)[1];
  const verified = await ctx.request("POST", "/api/orders/tracking/verify", { body: { orderNumber: order.orderNumber, email: "ama.mensah@example.test", code } });
  assert.equal(verified.status, 200);
  assert.equal(verifyPaymentProofToken(verified.body.proofToken), order.orderId);
  assert.equal(verifyPaymentProofToken(verified.body.accessToken), null, "read token stays read-only");

  const instructions = await ctx.request("GET", `/api/orders/${order.orderId}/payment-instructions`, { headers: { "X-Order-Proof-Token": verified.body.proofToken } });
  assert.equal(instructions.status, 200);
  assert.equal(instructions.body.available, true);

  // Owner login works on a second order without any capability token.
  const other = await quotedOrder(ctx);
  const byOwner = await ctx.upload(other.orderId, { token: userToken(ctx.owner._id) });
  assert.equal(byOwner.status, 201, JSON.stringify(byOwner.body));
  assert.equal(ctx.models.PaymentProof.docs.find((entry) => String(entry.orderId) === other.orderId).submitter.type, "customer");

  const viaCode = await ctx.upload(order.orderId, { proofToken: verified.body.proofToken });
  assert.equal(viaCode.status, 201);
});

// --- authorization ---------------------------------------------------------------------

test("read-only token, other order's capability, strangers and anonymous callers cannot upload or read instructions", async (t) => {
  const ctx = await setup(t, { linkUser: true });
  const order = await quotedOrder(ctx);
  const other = await quotedOrder(ctx);
  const stranger = await ctx.addUser();

  const attempts = [
    ["anonymous", {}],
    ["read-only token", { readToken: order.readToken }],
    ["other order's proof token", { proofToken: other.proofToken }],
    ["stranger login", { token: userToken(stranger._id) }],
    ["forged token", { proofToken: issueOrderAccessToken(order.orderId, 5) }],
  ];
  for (const [label, auth] of attempts) {
    const response = await ctx.upload(order.orderId, auth);
    assert.equal(response.status, 404, label);
    const instructions = await ctx.request("GET", `/api/orders/${order.orderId}/payment-instructions`, {
      headers: { ...(auth.readToken ? { "X-Order-Access-Token": auth.readToken } : {}), ...(auth.proofToken ? { "X-Order-Proof-Token": auth.proofToken } : {}) },
      token: auth.token,
    });
    assert.equal(instructions.status, 404, `${label} instructions`);
    assert.ok(!JSON.stringify(instructions.body).includes("TEST MOMO"), label);
  }
  // Unknown and malformed ids look identical.
  assert.equal((await ctx.upload(String(new Types.ObjectId()), { proofToken: order.proofToken })).status, 404);
  assert.equal((await ctx.upload("not-an-id", { proofToken: order.proofToken })).status, 404);
  assert.equal(ctx.orderDoc(order.orderId).status, "awaiting_payment");
  assert.deepEqual(filesIn(ctx.proofDir), []);
});

test("admin proof image route: admin only, correct order only, no-store and nosniff", async (t) => {
  const ctx = await setup(t, { linkUser: true });
  const order = await quotedOrder(ctx);
  const other = await quotedOrder(ctx);
  const uploaded = await ctx.upload(order.orderId, { proofToken: order.proofToken });
  const proofPath = `/api/admin/orders/${order.orderId}/payment-proof/${uploaded.body.proofId}`;

  const response = await fetch(`${ctx.base}${proofPath}`, { headers: { authorization: `Bearer ${ctx.adminToken}` } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy"), /sandbox/);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal((await sharp(bytes).metadata()).format, "png");

  assert.equal((await ctx.request("GET", proofPath)).status, 401);
  assert.equal((await ctx.request("GET", proofPath, { token: userToken(ctx.owner._id) })).status, 403, "even the order's own customer");
  assert.equal((await ctx.request("GET", proofPath, { headers: { "X-Order-Proof-Token": order.proofToken } })).status, 401);
  assert.equal((await ctx.request("GET", `/api/admin/orders/${other.orderId}/payment-proof/${uploaded.body.proofId}`, { token: ctx.adminToken })).status, 404);
  // Not reachable through any static route either.
  // (In production the SPA fallback answers unknown paths with index.html, so
  // assert the stored image is never what comes back, not just the status.)
  const file = filesIn(ctx.proofDir)[0];
  const stored = fs.readFileSync(path.join(ctx.proofDir, file));
  for (const probe of [`/images/../../data/payment-proofs/${file}`, `/data/payment-proofs/${file}`, `/${file}`]) {
    const leaked = await fetch(`${ctx.base}${probe}`);
    const body = Buffer.from(await leaked.arrayBuffer());
    assert.ok(!/^image\//.test(leaked.headers.get("content-type") || ""), probe);
    assert.ok(!body.equals(stored), probe);
  }

  const detail = await ctx.request("GET", `/api/admin/orders/${order.orderId}`, { token: ctx.adminToken });
  assert.equal(detail.body.paymentProofs.length, 1);
  assert.equal(detail.body.paymentProofs[0].transactionReference, "MP241027.1234.A5678");
  assert.equal(detail.body.paymentProofs[0].active, true);
  assert.ok(!JSON.stringify(detail.body).includes("storageKey"));
  assert.ok(!detail.body.allowedActions.includes("payment-review"), "no second manual proof-received step");
  const list = await ctx.request("GET", "/api/admin/orders?status=payment_review", { token: ctx.adminToken });
  assert.equal(list.body.items[0].proofAwaitingReview, true);
});

// --- validation --------------------------------------------------------------------------

test("unsafe, corrupt, empty, oversized and malformed uploads are rejected with no files left behind", async (t) => {
  const open = (req, res, next) => next();
  const ctx = await setup(t, { config: { proofMaxBytes: 200 * 1024 }, orders: { proofOrderLimiter: open, proofIpLimiter: open } });
  const order = await quotedOrder(ctx);
  const up = (options) => ctx.upload(order.orderId, { proofToken: order.proofToken, ...options });
  const big = await sharp({ create: { width: 1200, height: 1200, channels: 3, background: "#000" } })
    .composite([{ input: Buffer.from(`<svg width="1200" height="1200"><text x="0" y="50">${"x".repeat(2000)}</text></svg>`) }])
    .png({ compressionLevel: 0 })
    .toBuffer();
  assert.ok(big.length > 200 * 1024);

  const cases = [
    ["svg", { image: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), contentType: "image/svg+xml" }, 415, "UNSUPPORTED_IMAGE"],
    ["html as png", { image: Buffer.from("<html><script>alert(1)</script></html>".padEnd(64)), contentType: "image/png" }, 415, "UNSUPPORTED_IMAGE"],
    ["pdf", { image: Buffer.from("%PDF-1.4\n%âãÏÓ\n1 0 obj\n".padEnd(64)), contentType: "application/pdf" }, 415, "UNSUPPORTED_IMAGE"],
    ["exe", { image: Buffer.from("MZ".padEnd(128, "\0")), contentType: "image/png" }, 415, "UNSUPPORTED_IMAGE"],
    ["gif", { image: Buffer.from("GIF89a".padEnd(64, "\0")), contentType: "image/gif" }, 415, "UNSUPPORTED_IMAGE"],
    ["corrupt jpeg", { image: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]), contentType: "image/jpeg" }, 422, "UNREADABLE_IMAGE"],
    ["truncated png", { image: (await png()).subarray(0, 60) }, 422, "UNREADABLE_IMAGE"],
    ["tiny image", { image: await png(10, 10) }, 422, "UNREADABLE_IMAGE"],
    ["decompression bomb", { image: bombPng() }, 413, "IMAGE_TOO_LARGE"],
    ["oversize", { image: big }, 413, "FILE_TOO_LARGE"],
    ["empty file", { image: Buffer.alloc(0) }, 422, "FILE_REQUIRED"],
    ["no file", { omitFile: true }, 422, "FILE_REQUIRED"],
    ["unexpected field", { extraFields: { amount: "1" } }, 400, "UNEXPECTED_FIELD"],
    ["missing reference", { reference: null }, 422, "VALIDATION_FAILED"],
    ["unsafe reference", { reference: "<script>" }, 422, "VALIDATION_FAILED"],
    ["long reference", { reference: "A".repeat(80) }, 422, "VALIDATION_FAILED"],
    ["no idempotency key", { key: null }, 400, "IDEMPOTENCY_KEY_REQUIRED"],
  ];
  for (const [label, options, status, code] of cases) {
    const response = await up(options);
    assert.equal(response.status, status, `${label}: ${JSON.stringify(response.body)}`);
    assert.equal(response.body?.code, code, label);
  }
  // Two files at once.
  const form = new FormData();
  form.append("transactionReference", "REF12345");
  form.append("quoteVersion", "1");
  form.append("proofImage", new Blob([await png()]), "a.png");
  form.append("proofImage", new Blob([await png()]), "b.png");
  const twoFiles = await fetch(`${ctx.base}/api/orders/${order.orderId}/payment-proof`, {
    method: "POST",
    headers: { "Idempotency-Key": newIdempotencyKey(), "X-Order-Proof-Token": order.proofToken },
    body: form,
  });
  assert.equal(twoFiles.status, 400);
  // JSON instead of multipart.
  const json = await ctx.request("POST", `/api/orders/${order.orderId}/payment-proof`, {
    body: { transactionReference: "X" },
    headers: { "Idempotency-Key": newIdempotencyKey(), "X-Order-Proof-Token": order.proofToken },
  });
  assert.equal(json.status, 415);

  assert.equal(ctx.orderDoc(order.orderId).status, "awaiting_payment");
  assert.equal(ctx.models.PaymentProof.docs.length, 0);
  assert.deepEqual(filesIn(ctx.proofDir), [], "no orphan files");

  // A PNG with an HTML payload appended is re-encoded: the payload is not stored.
  const polyglot = Buffer.concat([await png(), Buffer.from("<html><script>alert(document.cookie)</script></html>")]);
  const accepted = await up({ image: polyglot });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
  const stored = fs.readFileSync(path.join(ctx.proofDir, filesIn(ctx.proofDir)[0]));
  assert.ok(!stored.includes(Buffer.from("<script>")));
});

test("expired quote (410), stale quote version (409), wrong status (409) and second proof (409)", async (t) => {
  let clock = Date.now();
  const ctx = await setup(t, { orders: { now: () => new Date(clock) } });
  const order = await quotedOrder(ctx, { expiresAt: new Date(Date.now() + 3600 * 1000).toISOString() });

  const stale = await ctx.upload(order.orderId, { proofToken: order.proofToken, quoteVersion: 2 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "STALE_QUOTE");

  clock += 2 * 3600 * 1000;
  const expired = await ctx.upload(order.orderId, { proofToken: order.proofToken });
  assert.equal(expired.status, 410);
  assert.equal(expired.body.code, "QUOTE_EXPIRED");
  const instructions = await ctx.request("GET", `/api/orders/${order.orderId}/payment-instructions`, { headers: { "X-Order-Proof-Token": order.proofToken } });
  assert.equal(instructions.body.available, false);
  assert.equal(instructions.body.reason, "QUOTE_EXPIRED");
  assert.equal(instructions.body.instructions, undefined, "no payment details for an expired quote");
  clock = Date.now();

  const placed = await ctx.placeOrder();
  const unquoted = await ctx.upload(placed.orderId, { proofToken: placed.trackingHandoff.proofToken });
  assert.equal(unquoted.status, 409);
  assert.equal(unquoted.body.code, "NOT_AWAITING_PAYMENT");

  const fresh = await quotedOrder(ctx);
  assert.equal((await ctx.upload(fresh.orderId, { proofToken: fresh.proofToken })).status, 201);
  const second = await ctx.upload(fresh.orderId, { proofToken: fresh.proofToken, reference: "OTHER9999" });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, "PROOF_ALREADY_SUBMITTED");

  const cancelled = await quotedOrder(ctx);
  assert.equal((await ctx.act(cancelled.orderId, "cancel", { expectedStatus: "awaiting_payment", reason: "customer asked" })).status, 200);
  assert.equal((await ctx.upload(cancelled.orderId, { proofToken: cancelled.proofToken })).status, 409);
  assert.equal(filesIn(ctx.proofDir).length, 1);
});

// --- idempotency and races ----------------------------------------------------------------

test("retrying with the same key returns the same proof once; same key with a different image is refused", async (t) => {
  const ctx = await setup(t);
  const order = await quotedOrder(ctx);
  const image = await png();
  const key = newIdempotencyKey();
  const first = await ctx.upload(order.orderId, { proofToken: order.proofToken, image, key });
  const retry = await ctx.upload(order.orderId, { proofToken: order.proofToken, image, key });
  assert.equal(first.status, 201);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.proofId, first.body.proofId);
  const conflict = await ctx.upload(order.orderId, { proofToken: order.proofToken, image: await png(300, 300), key });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(ctx.models.PaymentProof.docs.length, 1);
  assert.equal(filesIn(ctx.proofDir).length, 1);
  assert.equal(ctx.models.EmailOutbox.docs.filter((entry) => entry.kind === "payment_proof_received").length, 1);
  assert.equal(ctx.models.OrderEvent.docs.filter((entry) => entry.type === "payment_proof_submitted").length, 1);
});

test("concurrent uploads: exactly one wins, losers get 409 and leave no file or record", async (t) => {
  const ctx = await setup(t);
  const order = await quotedOrder(ctx);
  const images = await Promise.all([png(200, 400), png(210, 400), png(220, 400), png(230, 400)]);
  const results = await Promise.all(images.map((image, index) => ctx.upload(order.orderId, { proofToken: order.proofToken, image, reference: `REF000${index}` })));
  const statuses = results.map((result) => result.status).sort();
  assert.deepEqual(statuses, [201, 409, 409, 409], JSON.stringify(results.map((result) => result.body)));
  assert.equal(ctx.models.PaymentProof.docs.length, 1);
  assert.equal(ctx.models.PaymentProof.docs[0].reviewStatus, "pending");
  assert.equal(filesIn(ctx.proofDir).length, 1);
  assert.equal(ctx.models.EmailOutbox.docs.filter((entry) => entry.kind === "payment_proof_received").length, 1);
});

test("admin re-quote or cancel during an upload makes the upload fail safely and cleans up", async (t) => {
  let pause = null;
  const sharpProcess = require("../services/proofImage").processProofImage;
  const ctx = await setup(t, {
    orders: {
      processImage: async (buffer) => {
        if (pause) await pause();
        return sharpProcess(buffer);
      },
    },
  });
  const order = await quotedOrder(ctx);
  pause = async () => {
    pause = null;
    const requote = await ctx.act(order.orderId, "payment-instructions", {
      expectedStatus: "awaiting_payment",
      expectedQuoteVersion: 1,
      quote: { subtotalMinor: 160000, feesMinor: 0, shippingMinor: 0, dutiesMinor: 0, expiresAt: futureIso() },
    });
    assert.equal(requote.status, 200);
  };
  const raced = await ctx.upload(order.orderId, { proofToken: order.proofToken });
  assert.equal(raced.status, 409);
  assert.equal(raced.body.code, "STALE_QUOTE");
  assert.equal(ctx.orderDoc(order.orderId).status, "awaiting_payment");
  assert.equal(ctx.models.PaymentProof.docs.length, 0);
  assert.deepEqual(filesIn(ctx.proofDir), []);

  pause = async () => {
    pause = null;
    assert.equal((await ctx.act(order.orderId, "cancel", { expectedStatus: "awaiting_payment", reason: "out of stock" })).status, 200);
  };
  const afterCancel = await ctx.upload(order.orderId, { proofToken: order.proofToken, quoteVersion: 2 });
  assert.equal(afterCancel.status, 409);
  assert.equal(ctx.orderDoc(order.orderId).status, "cancelled");
  assert.deepEqual(filesIn(ctx.proofDir), []);
});

// --- review, verification and fulfilment gate ---------------------------------------------

test("upload never unlocks fulfilment; only bank-attested verify-payment does, and accepts the proof", async (t) => {
  const ctx = await setup(t);
  const order = await quotedOrder(ctx);
  await ctx.upload(order.orderId, { proofToken: order.proofToken });

  const early = await ctx.act(order.orderId, "fulfilment", { expectedStatus: "payment_review", toStatus: "processing" });
  assert.equal(early.status, 409, "processing is not a step from payment_review");
  assert.equal(early.body.code, "ILLEGAL_TRANSITION");
  // Even if status were tampered to confirmed, unverified payment blocks sourcing.
  ctx.orderDoc(order.orderId).status = "confirmed";
  const tampered = await ctx.act(order.orderId, "fulfilment", { expectedStatus: "confirmed", toStatus: "processing" });
  assert.equal(tampered.status, 409);
  assert.equal(tampered.body.code, "PAYMENT_NOT_VERIFIED");
  ctx.orderDoc(order.orderId).status = "payment_review";

  const noAttest = await ctx.act(order.orderId, "verify-payment", {
    expectedStatus: "payment_review",
    amountReceivedGHSMinor: 200000,
    bankReference: "MP241027.1234.A5678",
    receivedAt: new Date(Date.now() - 60000).toISOString(),
  });
  assert.equal(noAttest.status, 422);
  const wrongAmount = await ctx.act(order.orderId, "verify-payment", {
    expectedStatus: "payment_review",
    amountReceivedGHSMinor: 199000,
    bankReference: "MP241027.1234.A5678",
    receivedAt: new Date(Date.now() - 60000).toISOString(),
    bankReceiptConfirmed: true,
  });
  assert.equal(wrongAmount.body.code, "AMOUNT_MISMATCH");

  const verified = await ctx.act(order.orderId, "verify-payment", {
    expectedStatus: "payment_review",
    amountReceivedGHSMinor: 200000,
    bankReference: "MP241027.1234.A5678",
    receivedAt: new Date(Date.now() - 60000).toISOString(),
    bankReceiptConfirmed: true,
  });
  assert.equal(verified.status, 200);
  assert.equal(ctx.models.PaymentProof.docs[0].reviewStatus, "accepted");
  assert.equal(ctx.models.EmailOutbox.docs.filter((entry) => entry.kind === "order_confirmed").length, 1);

  const sourcing = await ctx.act(order.orderId, "fulfilment", { expectedStatus: "confirmed", toStatus: "processing", supplierReference: "UK-RETAILER-1" });
  assert.equal(sourcing.status, 200);
  const duplicate = await ctx.act(order.orderId, "fulfilment", { expectedStatus: "confirmed", toStatus: "processing", supplierReference: "UK-RETAILER-1" });
  assert.equal(duplicate.status, 409, "no duplicate purchase transition");
});

test("payment issue rejects the proof, customer resubmits, admin verifies; mismatch and duplicate references flagged", async (t) => {
  const ctx = await setup(t);
  const order = await quotedOrder(ctx);
  const first = await ctx.upload(order.orderId, { proofToken: order.proofToken, reference: "DUP-REF-1111" });
  assert.equal(first.status, 201);

  const issue = await ctx.act(order.orderId, "payment-issue", {
    expectedStatus: "payment_review",
    customerMessage: "We received GHS 1,900.00, not GHS 2,000.00. Please send the remaining GHS 100.00 and upload the new receipt.",
  });
  assert.equal(issue.status, 200);
  assert.equal(ctx.models.PaymentProof.docs[0].reviewStatus, "rejected");
  const issueMail = ctx.models.EmailOutbox.docs.find((entry) => entry.kind === "payment_issue");
  assert.match(issueMail.payload.text, /not confirmed and we will not buy your items/);

  const viewed = await ctx.view(order.orderId, order.readToken);
  assert.equal(viewed.body.payment.canSubmitProof, true);
  assert.equal(viewed.body.statusLabel, "Payment needs attention");
  // The rejected upload is history only: not shown to the customer as current.
  assert.equal(viewed.body.payment.proof, null);
  const rejectedDetail = await ctx.request("GET", `/api/admin/orders/${order.orderId}`, { token: ctx.adminToken });
  assert.deepEqual(rejectedDetail.body.paymentProofs.map((proof) => [proof.reviewStatus, proof.active]), [["rejected", false]]);

  const resubmitted = await ctx.upload(order.orderId, { proofToken: order.proofToken, reference: "TOPUP-2222", image: await png(260, 520) });
  assert.equal(resubmitted.status, 201);
  assert.equal(ctx.orderDoc(order.orderId).status, "payment_review");
  assert.equal(ctx.models.EmailOutbox.docs.filter((entry) => entry.kind === "payment_proof_received").length, 2);

  // Another order reusing a reference is flagged for the admin, not silently accepted.
  const other = await quotedOrder(ctx);
  assert.equal((await ctx.upload(other.orderId, { proofToken: other.proofToken, reference: "dup-ref-1111" })).status, 201);
  const otherDetail = await ctx.request("GET", `/api/admin/orders/${other.orderId}`, { token: ctx.adminToken });
  assert.deepEqual(otherDetail.body.paymentProofs[0].duplicateReferenceOrderIds, [order.orderId]);

  const detail = await ctx.request("GET", `/api/admin/orders/${order.orderId}`, { token: ctx.adminToken });
  assert.deepEqual(detail.body.paymentProofs.map((proof) => [proof.reviewStatus, proof.active]), [["pending", true], ["rejected", false]]);
});

test("cancellation with refund from review, sourcing failure → refund, delivery issue and customer updates", async (t) => {
  const ctx = await setup(t);
  const verifyBody = { amountReceivedGHSMinor: 200000, bankReference: "BANK-1", receivedAt: new Date(Date.now() - 60000).toISOString(), bankReceiptConfirmed: true };

  // Money arrived but order cancelled while under review → refund path.
  const a = await quotedOrder(ctx);
  await ctx.upload(a.orderId, { proofToken: a.proofToken });
  const cancelNoAnswer = await ctx.act(a.orderId, "cancel", { expectedStatus: "payment_review", reason: "customer cancelled" });
  assert.equal(cancelNoAnswer.status, 422, "must state whether funds arrived");
  assert.equal((await ctx.act(a.orderId, "cancel", { expectedStatus: "payment_review", reason: "customer cancelled", refundRequired: true })).status, 200);
  assert.equal(ctx.orderDoc(a.orderId).status, "refund_pending");
  assert.equal((await ctx.act(a.orderId, "refund", { expectedStatus: "refund_pending", amountRefundedGHSMinor: 200000, refundReference: "RF-1", refundSentConfirmed: true })).status, 200);

  // Paid, UK shoes unavailable → sourcing failed → refund.
  const b = await quotedOrder(ctx);
  await ctx.upload(b.orderId, { proofToken: b.proofToken });
  assert.equal((await ctx.act(b.orderId, "verify-payment", { expectedStatus: "payment_review", ...verifyBody })).status, 200);
  assert.equal((await ctx.act(b.orderId, "fulfilment", { expectedStatus: "confirmed", toStatus: "sourcing_failed", note: "size sold out at all approved UK retailers" })).status, 200);
  assert.equal((await ctx.act(b.orderId, "cancel", { expectedStatus: "sourcing_failed", reason: "customer chose refund" })).status, 200);
  assert.equal(ctx.orderDoc(b.orderId).status, "refund_pending");

  // Paid → processing (with estimate) → dispatched → delay update → delivery issue → replacement dispatched → delivered → completed.
  const c = await quotedOrder(ctx, {}, undefined);
  await ctx.upload(c.orderId, { proofToken: c.proofToken });
  await ctx.act(c.orderId, "verify-payment", { expectedStatus: "payment_review", ...verifyBody });
  const estimate = new Date(Date.now() + 14 * 86400000).toISOString();
  assert.equal((await ctx.act(c.orderId, "fulfilment", { expectedStatus: "confirmed", toStatus: "processing", supplierReference: "JD-1", estimatedDeliveryAt: estimate })).status, 200);
  assert.equal((await ctx.act(c.orderId, "fulfilment", { expectedStatus: "processing", toStatus: "dispatched", carrier: "DHL", trackingNumber: "DHL123", trackingUrl: "https://dhl.example/track/DHL123" })).status, 200);
  const update = await ctx.act(c.orderId, "customer-update", { expectedStatus: "dispatched", customerMessage: "Customs clearance in Accra is taking two extra days." });
  assert.equal(update.status, 200);
  assert.equal(update.body.email.queued, true);
  assert.equal((await ctx.act(c.orderId, "customer-update", { expectedStatus: "dispatched", customerMessage: "short" })).status, 422);
  assert.equal((await ctx.act(c.orderId, "fulfilment", { expectedStatus: "dispatched", toStatus: "delivery_issue" })).status, 422, "issue description required");
  assert.equal((await ctx.act(c.orderId, "fulfilment", { expectedStatus: "dispatched", toStatus: "delivery_issue", issue: "Parcel reported lost by courier" })).status, 200);
  assert.equal((await ctx.act(c.orderId, "fulfilment", { expectedStatus: "delivery_issue", toStatus: "dispatched", carrier: "DHL", trackingNumber: "DHL456" })).status, 200);
  assert.equal((await ctx.act(c.orderId, "fulfilment", { expectedStatus: "dispatched", toStatus: "delivered" })).status, 200);
  assert.equal((await ctx.act(c.orderId, "fulfilment", { expectedStatus: "delivered", toStatus: "completed" })).status, 200);

  const viewed = await ctx.view(c.orderId, c.readToken);
  assert.equal(viewed.body.status, "completed");
  assert.equal(viewed.body.fulfilment.estimatedDeliveryAt, estimate);
  const labels = viewed.body.history.map((entry) => entry.label);
  assert.ok(labels.includes("Update from EscoWear"));
  assert.ok(labels.includes("Delivery issue — we are looking into it"));
  assert.ok(viewed.body.history.some((entry) => entry.message === "Customs clearance in Accra is taking two extra days."));
  assert.ok(!JSON.stringify(viewed.body).includes("JD-1"), "supplier reference stays internal");
  const kinds = ctx.models.EmailOutbox.docs.filter((entry) => String(entry.orderId) === c.orderId).map((entry) => entry.dedupeKey.split(":")[0] + ":" + (entry.dedupeKey.split(":")[2] || ""));
  assert.equal(new Set(ctx.models.EmailOutbox.docs.map((entry) => entry.dedupeKey)).size, ctx.models.EmailOutbox.docs.length, "every email once");
  assert.ok(kinds.includes("update:1"));
  // The replacement dispatch gets its own email with the new tracking number.
  const keys = ctx.models.EmailOutbox.docs.map((entry) => entry.dedupeKey);
  assert.ok(keys.includes(`status:${c.orderId}:dispatched`));
  assert.ok(keys.includes(`status:${c.orderId}:dispatched:2`));
});

// --- instructions, email resilience, notices ------------------------------------------------

test("payment instructions: owner sees quote and configured details; unconfigured channel says so", async (t) => {
  const ctx = await setup(t, { config: { supportEmail: "help@example.test" } });
  const order = await quotedOrder(ctx);
  const response = await ctx.request("GET", `/api/orders/${order.orderId}/payment-instructions`, { headers: { "X-Order-Proof-Token": order.proofToken } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.body.available, true);
  assert.equal(response.body.instructions, "TEST MOMO CHANNEL\nNot a real account");
  assert.equal(response.body.paymentReference, order.orderNumber);
  assert.equal(response.body.quote.totalMinor, 200000);
  assert.equal(response.body.quote.quoteVersion, 1);
  assert.equal(response.body.supportEmail, "help@example.test");

  // The customer order view itself never carries payment-channel details.
  assert.ok(!JSON.stringify((await ctx.view(order.orderId, order.readToken)).body).includes("TEST MOMO"));

  const bare = await setup(t, { env: {} });
  const placed = await bare.placeOrder();
  const info = await bare.request("GET", `/api/orders/${placed.orderId}/payment-instructions`, { headers: { "X-Order-Proof-Token": placed.trackingHandoff.proofToken } });
  assert.equal(info.body.available, false);
  assert.equal(info.body.reason, "NO_QUOTE");
});

test("email outage does not lose the proof or the review state; admin notice has no image or contact data", async (t) => {
  const ctx = await setup(t, { config: { adminNotifyEmail: "ops@example.test" } });
  const order = await quotedOrder(ctx);
  const originalCreate = ctx.models.EmailOutbox.create;
  ctx.models.EmailOutbox.create = async () => {
    throw new Error("outbox unavailable");
  };
  const response = await ctx.upload(order.orderId, { proofToken: order.proofToken });
  ctx.models.EmailOutbox.create = originalCreate;
  assert.equal(response.status, 201);
  assert.equal(ctx.orderDoc(order.orderId).status, "payment_review");
  assert.equal(ctx.models.PaymentProof.docs[0].reviewStatus, "pending");
  assert.equal(filesIn(ctx.proofDir).length, 1);

  const other = await quotedOrder(ctx);
  await ctx.upload(other.orderId, { proofToken: other.proofToken });
  const notice = ctx.models.EmailOutbox.docs.find((entry) => entry.kind === "payment_proof_admin_notice");
  assert.equal(notice.to, "ops@example.test");
  assert.ok(!/ama|024 123|MP241027|Ring Road/i.test(notice.payload.text), "no customer contact data or full reference");
  assert.match(notice.payload.text, /never proof of payment/);
});

test("proof survives an application restart: a new app instance serves the stored file", async (t) => {
  const { tempProofDir } = require("./helpers/testApp");
  const dir = tempProofDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const first = await setup(t, { config: { proofUploadDir: dir } });
  const order = await quotedOrder(first);
  const uploaded = await first.upload(order.orderId, { proofToken: order.proofToken });
  await first.close();

  const second = await startTestApp({ config: { proofUploadDir: dir }, models: first.models });
  t.after(second.close);
  const response = await fetch(`${second.base}/api/admin/orders/${order.orderId}/payment-proof/${uploaded.body.proofId}`, {
    headers: { authorization: `Bearer ${first.adminToken}` },
  });
  assert.equal(response.status, 200);
  assert.equal((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).format, "png");
});

test("missing stored file is reported to the admin, not served as something else", async (t) => {
  const ctx = await setup(t);
  const order = await quotedOrder(ctx);
  const uploaded = await ctx.upload(order.orderId, { proofToken: order.proofToken });
  fs.rmSync(path.join(ctx.proofDir, filesIn(ctx.proofDir)[0]));
  const response = await ctx.request("GET", `/api/admin/orders/${order.orderId}/payment-proof/${uploaded.body.proofId}`, { token: ctx.adminToken });
  assert.equal(response.status, 410);
  assert.equal(response.body.code, "PROOF_FILE_MISSING");
});

test("upload rate limits apply per order", async (t) => {
  const ctx = await setup(t);
  const order = await quotedOrder(ctx);
  let last;
  for (let attempt = 0; attempt < 11; attempt += 1) last = await ctx.upload(order.orderId, { proofToken: order.proofToken, reference: "<bad>" });
  assert.equal(last.status, 429);
});

test("unauthorised upload attempts do not use up the owner's per-order budget", async (t) => {
  const ctx = await setup(t);
  const order = await quotedOrder(ctx);
  for (let attempt = 0; attempt < 11; attempt += 1) {
    assert.equal((await ctx.upload(order.orderId, { reference: "<bad>" })).status, 404);
  }
  const owner = await ctx.upload(order.orderId, { proofToken: order.proofToken });
  assert.equal(owner.status, 201);
});
