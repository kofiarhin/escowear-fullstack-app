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

module.exports = { enqueueEmail, isDuplicateKey };
