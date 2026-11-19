const { EMAIL_STATE } = require("./orderStatus");
const { processOutboxBatch } = require("./emailOutbox");
const { GUEST_EMAIL_CODE, VERIFICATION } = require("../config/verification");

// One worker tick: repair any guest order whose acknowledgement was never
// queued (e.g. the outbox write failed after the order was saved), then send
// due messages.
const runEmailWorkerTick = async ({ Order, EmailOutbox, orderService, transport, logger = console, now = () => new Date(), trackingCodeTtlMinutes = 10 }) => {
  // Never deliver a tracking code after it has expired; drop its body.
  const expireQueued = (kind, ttlMs, lastError) =>
    EmailOutbox.updateMany(
      { kind, state: "queued", createdAt: { $lte: new Date(now().getTime() - ttlMs) } },
      { $set: { state: "failed", lastError, "payload.text": "[removed: expired]" } }
    );
  await expireQueued("tracking_code", trackingCodeTtlMinutes * 60 * 1000, "Code expired before it could be sent");
  await expireQueued("checkout_email_code", GUEST_EMAIL_CODE.ttlMs, "Code expired before it could be sent");
  // A verification link is never delivered after it has expired.
  await expireQueued("account_verification", VERIFICATION.linkTtlMs, "Link expired before it could be sent");
  await expireQueued("account_final_warning", VERIFICATION.linkTtlMs, "Link expired before it could be sent");

  const missing = await Order.find({ source: "guest_checkout", "email.acknowledgementState": EMAIL_STATE.NOT_QUEUED })
    .limit(20)
    .lean();
  for (const order of missing) {
    try {
      await orderService.ensureCreationSideEffects(order);
    } catch (error) {
      logger.error(`Acknowledgement repair failed for order ${order._id}: ${error.message}`);
    }
  }
  return processOutboxBatch({ EmailOutbox, Order, transport, logger, now });
};

const startEmailWorker = ({ intervalMs = 30000, logger = console, ...deps }) => {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runEmailWorkerTick({ ...deps, logger });
    } catch (error) {
      logger.error(`Email worker tick failed: ${error.message}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer), tick };
};

module.exports = { runEmailWorkerTick, startEmailWorker };
