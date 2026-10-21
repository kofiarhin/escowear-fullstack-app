const { EMAIL_STATE } = require("./orderStatus");
const { processOutboxBatch } = require("./emailOutbox");

// One worker tick: repair any guest order whose acknowledgement was never
// queued (e.g. the outbox write failed after the order was saved), then send
// due messages.
const runEmailWorkerTick = async ({ Order, EmailOutbox, orderService, transport, logger = console, now }) => {
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
