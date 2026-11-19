const test = require("node:test");
const assert = require("node:assert/strict");
const { Types } = require("mongoose");
const { createModels, silentLogger } = require("./helpers/testApp");
const { createEmailVerificationService } = require("../services/emailVerificationService");
const { runAccountLifecycleTick } = require("../services/accountLifecycle");
const { processOutboxBatch } = require("../services/emailOutbox");

const DAY = 24 * 60 * 60 * 1000;
const START = new Date("2026-11-20T10:00:00Z");

const setup = () => {
  const models = createModels();
  const clock = { now: new Date(START) };
  const now = () => new Date(clock.now);
  const service = createEmailVerificationService({ User: models.User, EmailOutbox: models.EmailOutbox, publicBaseUrl: "https://shop.example.test", now, logger: silentLogger });
  const tick = (options = {}) =>
    runAccountLifecycleTick({ User: models.User, EmailOutbox: models.EmailOutbox, verificationService: service, now, logger: silentLogger, ...options });
  const at = (ms) => {
    clock.now = new Date(START.getTime() + ms);
  };
  const register = async (email = "ama@example.test") => {
    const { user } = await service.register({ name: "Ama", email, password: "a-secure-password", passwordConfirmation: "a-secure-password" });
    return user;
  };
  const accept = () =>
    processOutboxBatch({ EmailOutbox: models.EmailOutbox, Order: models.Order, transport: { send: async () => ({ providerMessageId: "ok" }) }, now, logger: silentLogger });
  const find = (id) => models.User.docs.find((user) => String(user._id) === String(id));
  return { models, service, tick, at, register, accept, find, now };
};

test("Day 6 queues one final warning with a fresh link; Day 7 deletes the account once delivery was accepted", async () => {
  const ctx = setup();
  const user = await ctx.register();
  await ctx.accept();
  const oldHash = ctx.find(user._id).emailVerificationTokenHash;

  ctx.at(5 * DAY);
  const day5 = await ctx.tick();
  assert.equal(day5.warned, 0);
  assert.equal(day5.accepted, 1, "SMTP acceptance is recorded on the account");

  ctx.at(6 * DAY + 60 * 1000);
  const day6 = await ctx.tick();
  assert.equal(day6.warned, 1);
  assert.equal((await ctx.tick()).warned, 0, "warning is queued only once");
  const warnings = ctx.models.EmailOutbox.docs.filter((message) => message.kind === "account_final_warning");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].payload.text, /verify-email\?token=[a-f0-9]{64}/);
  assert.notEqual(ctx.find(user._id).emailVerificationTokenHash, oldHash);

  ctx.at(7 * DAY);
  const day7 = await ctx.tick();
  assert.equal(day7.expired, 1);
  assert.equal(day7.deleted, 1);
  assert.equal(ctx.find(user._id), undefined);
  assert.equal(warnings[0].state, "failed", "queued reminder is withdrawn with the account");
});

test("deletion is paused while the first verification email was not accepted (queued, failed, interrupted or no transport)", async () => {
  const ctx = setup();
  const queued = await ctx.register("queued@example.test");
  const failed = await ctx.register("failed@example.test");
  const stuck = await ctx.register("stuck@example.test");
  const failedMessage = ctx.models.EmailOutbox.docs.find((message) => message.to === "failed@example.test");
  failedMessage.state = "failed";
  const stuckMessage = ctx.models.EmailOutbox.docs.find((message) => message.to === "stuck@example.test");
  stuckMessage.state = "sending";

  ctx.at(7 * DAY);
  const result = await ctx.tick();
  assert.equal(result.expired, 3);
  assert.equal(result.deleted, 0);
  assert.equal(result.paused, 3);
  for (const user of [queued, failed, stuck]) {
    const stored = ctx.find(user._id);
    assert.ok(stored, "account kept");
    assert.ok(stored.verificationExpiredAt);
    assert.equal(stored.emailVerificationTokenHash, undefined, "links stop working on expiry");
  }
});

test("existing, verified and admin accounts are never warned, expired or deleted", async () => {
  const ctx = setup();
  const legacy = await ctx.models.User.create({ name: "Existing", email: "existing@example.test", password: "x", role: "customer", createdAt: new Date(START.getTime() - 30 * DAY) });
  const admin = await ctx.models.User.create({ name: "Admin", email: "admin@example.test", password: "x", role: "admin", verificationRequired: true, verificationDeadline: START, verificationEmailAcceptedAt: START });
  const verified = await ctx.register("verified@example.test");
  await ctx.accept();
  ctx.find(verified._id).emailVerifiedAt = new Date(START.getTime() + 1000);

  for (const day of [6.5, 7, 30]) {
    ctx.at(day * DAY);
    const result = await ctx.tick();
    assert.equal(result.warned + result.expired + result.deleted, 0);
  }
  assert.ok(ctx.find(legacy._id));
  assert.ok(ctx.find(admin._id));
  assert.ok(ctx.find(verified._id));
  assert.equal(ctx.find(legacy._id).verificationExpiredAt, undefined);
});

test("orders linked to a removed account are kept", async () => {
  const ctx = setup();
  const user = await ctx.register();
  await ctx.accept();
  const order = await ctx.models.Order.create({ orderNumber: "EW-AAAAA-BBBBB", user: user._id, customer: { name: "Ama", email: "ama@example.test" } });
  ctx.at(7 * DAY);
  assert.equal((await ctx.tick()).deleted, 1);
  assert.ok(ctx.models.Order.docs.find((entry) => String(entry._id) === String(order._id)));
});

test("dry run reports eligible accounts without deleting them", async () => {
  const ctx = setup();
  const user = await ctx.register();
  await ctx.accept();
  ctx.at(7 * DAY);
  const result = await ctx.tick({ dryRun: true });
  assert.equal(result.wouldDelete, 1);
  assert.equal(result.deleted, 0);
  assert.ok(ctx.find(user._id));
});

test("a verification that lands during cleanup keeps the account", async () => {
  const ctx = setup();
  const user = await ctx.register();
  await ctx.accept();
  ctx.at(7 * DAY);
  const original = ctx.models.User.deleteOne;
  ctx.models.User.deleteOne = async (filter) => {
    // Simulate the customer verifying between the candidate read and the delete.
    ctx.find(user._id).emailVerifiedAt = ctx.now();
    return original(filter);
  };
  const result = await ctx.tick();
  assert.equal(result.deleted, 0);
  assert.ok(ctx.find(user._id));
});

test("an email correction pauses deletion again until the new address accepts an email", async () => {
  const ctx = setup();
  const user = await ctx.register("ama@exmaple.test");
  await ctx.accept();
  ctx.at(60 * 1000);
  assert.equal((await ctx.tick()).accepted, 1);
  assert.ok(ctx.find(user._id).verificationEmailAcceptedAt);

  ctx.at(2 * 60 * 1000);
  const pending = ctx.service.pendingResponse(ctx.find(user._id)).pendingToken;
  await ctx.service.changeEmail(pending, { email: "ama@example.test" });
  const stored = ctx.find(user._id);
  assert.equal(stored.verificationEmailAcceptedAt, undefined);

  ctx.at(7 * DAY);
  const paused = await ctx.tick();
  assert.equal(paused.deleted, 0);
  assert.equal(paused.paused, 1);

  // Once the corrected address has accepted the email, cleanup proceeds.
  await ctx.accept();
  ctx.at(7 * DAY + 60 * 1000);
  const resumed = await ctx.tick();
  assert.equal(resumed.accepted, 1);
  assert.equal(resumed.deleted, 1);
});

test("a resend becomes the delivery check only while no email to the address was accepted", async () => {
  const ctx = setup();
  const user = await ctx.register();
  const initialId = String(ctx.find(user._id).verificationDeliveryEmailId);
  ctx.at(2 * 60 * 1000);
  const pending = ctx.service.pendingResponse(ctx.find(user._id)).pendingToken;
  await ctx.service.resend(pending);
  const afterResend = String(ctx.find(user._id).verificationDeliveryEmailId);
  assert.notEqual(afterResend, initialId, "the never-sent initial email was withdrawn, so the resend is checked instead");

  await ctx.accept();
  ctx.at(4 * 60 * 1000);
  await ctx.service.resend(pending);
  assert.equal(String(ctx.find(user._id).verificationDeliveryEmailId), afterResend, "an accepted email to this address stays the check");
});

test("expired queued verification emails are never sent", async () => {
  const ctx = setup();
  await ctx.register();
  const { runEmailWorkerTick } = require("../services/emailWorker");
  ctx.at(DAY + 1000);
  const sent = [];
  await runEmailWorkerTick({
    Order: ctx.models.Order,
    EmailOutbox: ctx.models.EmailOutbox,
    orderService: { ensureCreationSideEffects: async () => {} },
    transport: { send: async (message) => (sent.push(message), { providerMessageId: "x" }) },
    logger: silentLogger,
    now: () => new Date(START.getTime() + DAY + 1000),
  });
  assert.equal(sent.length, 0);
  const [message] = ctx.models.EmailOutbox.docs;
  assert.equal(message.state, "failed");
  assert.equal(message.payload.text, "[removed: expired]");
  assert.ok(Types.ObjectId.isValid(String(message.userId)));
});

test("cleanup still reaches accepted accounts when more than a batch of paused accounts has built up", async () => {
  const ctx = setup();
  for (let index = 0; index < 120; index += 1) {
    await ctx.models.User.create({
      name: "Paused", email: `paused-${index}@example.test`, password: "x", role: "customer",
      verificationRequired: true, verificationDeadline: new Date(START.getTime() + 7 * 24 * 60 * 60 * 1000),
      verificationDeliveryEmailId: new Types.ObjectId(),
    });
  }
  const accepted = await ctx.register("accepted@example.test");
  await ctx.accept();
  ctx.at(7 * DAY);
  const result = await ctx.tick();
  assert.equal(result.accepted, 1);
  assert.equal(result.deleted, 1);
  assert.equal(result.paused, 120);
  assert.equal(ctx.find(accepted._id), undefined);
});

test("one-time link and code bodies are removed when delivery fails for good, and cannot be retried", async () => {
  const ctx = setup();
  await ctx.register("fails@example.test");
  await ctx.register("stuck@example.test");
  const failing = { send: async () => { throw new Error("SMTP down"); } };
  const stuck = ctx.models.EmailOutbox.docs.find((message) => message.to === "stuck@example.test");
  stuck.state = "sending";
  stuck.lockedUntil = new Date(START.getTime() - 1000);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    ctx.at(attempt * 2 * 60 * 60 * 1000);
    await processOutboxBatch({ EmailOutbox: ctx.models.EmailOutbox, Order: ctx.models.Order, transport: failing, now: ctx.now, logger: silentLogger });
  }
  for (const message of ctx.models.EmailOutbox.docs) {
    assert.equal(message.state, "failed");
    assert.equal(message.payload.text, "[removed: not delivered]");
  }
  const { retryFailedEmail } = require("../services/emailOutbox");
  assert.equal(await retryFailedEmail(ctx.models.EmailOutbox, ctx.models.EmailOutbox.docs[0]._id), null);
});

test("a failed reminder is undone and retried; a reminder never overrides a concurrent resend", async () => {
  const ctx = setup();
  const user = await ctx.register();
  ctx.at(6 * DAY + 60 * 1000);
  const originalCreate = ctx.models.EmailOutbox.create;
  ctx.models.EmailOutbox.create = async () => {
    throw new Error("database unavailable");
  };
  assert.equal((await ctx.tick()).warned, 0);
  assert.equal(ctx.find(user._id).finalWarningQueuedAt, undefined, "claim undone so the next run retries");
  ctx.models.EmailOutbox.create = originalCreate;
  assert.equal((await ctx.tick()).warned, 1);

  // A reminder working from a stale read loses to a resend that landed first.
  const other = await ctx.register("other@example.test");
  const stale = { ...ctx.find(other._id) };
  ctx.at(6 * DAY + 3 * 60 * 1000);
  await ctx.service.resend(ctx.service.pendingResponse(ctx.find(other._id)).pendingToken);
  assert.equal(await ctx.service.queueFinalWarning(stale, ctx.now()), false);
});

test("a blocked, expired account is not replaced by a new registration", async () => {
  const ctx = setup();
  const user = await ctx.register();
  ctx.find(user._id).blocked = true;
  ctx.at(7 * DAY);
  await assert.rejects(ctx.register(), (error) => error.code === "EMAIL_IN_USE");
  assert.ok(ctx.find(user._id));
});
