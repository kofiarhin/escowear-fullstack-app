const { renderEmail } = require("../emails/templates");

const isDuplicateKey = (error) => error?.code === 11000;

// Queues one logical email. Re-queuing the same dedupeKey returns the existing
// message instead of creating a second one.
const enqueueEmail = async (EmailOutbox, { dedupeKey, orderId, kind, to, context }) => {
  const existing = await EmailOutbox.findOne({ dedupeKey }).lean();
  if (existing) return { message: existing, created: false };

  const { subject, text, templateVersion } = renderEmail(kind, context);
  try {
    const message = await EmailOutbox.create({
      dedupeKey,
      orderId,
      kind,
      to,
      templateVersion,
      payload: { subject, text },
      state: "queued",
      attempts: 0,
      nextAttemptAt: new Date(),
    });
    return { message: message.toObject ? message.toObject() : message, created: true };
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    return { message: await EmailOutbox.findOne({ dedupeKey }).lean(), created: false };
  }
};

// --- Delivery worker -----------------------------------------------------------

const ORDER_EMAIL_FIELD = {
  order_received: "email.acknowledgementState",
  payment_instructions: "email.paymentInstructionState",
  order_confirmed: "email.confirmationState",
};
// Bodies that carry payment-channel details or one-time codes are dropped once sent.
const PURGE_BODY_AFTER_SEND = ["payment_instructions", "tracking_code"];

const backoffMs = (attempts) => Math.min(60 * 60 * 1000, 60 * 1000 * 2 ** Math.max(0, attempts - 1));
const safeError = (error) => String(error?.message || error || "send failed").replace(/\s+/g, " ").slice(0, 200);

// Sends due messages one at a time. Each message is claimed atomically
// (queued -> sending), so concurrent workers never send the same message.
// A message stuck in "sending" (crash mid-send) is marked failed for an admin
// to review rather than resent automatically, because the provider may have
// accepted it already.
const processOutboxBatch = async ({ EmailOutbox, Order, transport, now = () => new Date(), limit = 10, maxAttempts = 5, logger = console }) => {
  const results = { sent: 0, retried: 0, failed: 0, stuck: 0 };
  const time = now();

  const stuck = await EmailOutbox.find({ state: "sending", lockedUntil: { $lte: time } }).limit(limit).lean();
  for (const message of stuck) {
    const updated = await EmailOutbox.findOneAndUpdate(
      { _id: message._id, state: "sending" },
      { $set: { state: "failed", lastError: "Send interrupted; check the provider before retrying" } },
      { new: true }
    ).lean();
    if (updated) results.stuck += 1;
  }

  for (let index = 0; index < limit; index += 1) {
    const claimed = await EmailOutbox.findOneAndUpdate(
      { state: "queued", nextAttemptAt: { $lte: time } },
      { $set: { state: "sending", lockedUntil: new Date(time.getTime() + 2 * 60 * 1000) }, $inc: { attempts: 1 } },
      { new: true, sort: { nextAttemptAt: 1 } }
    ).lean();
    if (!claimed) break;

    const field = ORDER_EMAIL_FIELD[claimed.kind];
    try {
      const { providerMessageId } = await transport.send({
        to: claimed.to,
        subject: claimed.payload?.subject,
        text: claimed.payload?.text,
        idempotencyKey: claimed.dedupeKey,
      });
      const set = { state: "sent", sentAt: now(), providerMessageId: providerMessageId ? String(providerMessageId) : undefined };
      if (PURGE_BODY_AFTER_SEND.includes(claimed.kind)) set["payload.text"] = "[removed after sending]";
      await EmailOutbox.updateOne(
        { _id: claimed._id },
        { $set: Object.fromEntries(Object.entries(set).filter(([, value]) => value !== undefined)), $unset: { lockedUntil: 1, lastError: 1 } }
      );
      if (field && claimed.orderId) await Order.updateOne({ _id: claimed.orderId }, { $set: { [field]: "sent" } });
      results.sent += 1;
    } catch (error) {
      const lastError = safeError(error);
      if (claimed.attempts >= maxAttempts) {
        await EmailOutbox.updateOne({ _id: claimed._id }, { $set: { state: "failed", lastError }, $unset: { lockedUntil: 1 } });
        if (field && claimed.orderId) await Order.updateOne({ _id: claimed.orderId }, { $set: { [field]: "failed", "email.lastError": lastError } });
        results.failed += 1;
      } else {
        await EmailOutbox.updateOne(
          { _id: claimed._id },
          { $set: { state: "queued", lastError, nextAttemptAt: new Date(time.getTime() + backoffMs(claimed.attempts)) }, $unset: { lockedUntil: 1 } }
        );
        results.retried += 1;
      }
      logger.error(`Email ${claimed.kind} ${claimed._id} attempt ${claimed.attempts} failed: ${lastError}`);
    }
  }
  return results;
};

// Admin action: put a failed message back in the queue.
const retryFailedEmail = async (EmailOutbox, messageId, now = () => new Date()) =>
  EmailOutbox.findOneAndUpdate(
    { _id: messageId, state: "failed" },
    { $set: { state: "queued", nextAttemptAt: now(), attempts: 0 }, $unset: { lockedUntil: 1 } },
    { new: true }
  ).lean();

module.exports = { backoffMs, enqueueEmail, isDuplicateKey, processOutboxBatch, retryFailedEmail };
