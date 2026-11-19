const { VERIFICATION } = require("../config/verification");
const { unverifiedNewCustomer } = require("./emailVerificationService");

// Day-6 final warning, Day-7 expiry and guarded deletion of new accounts that
// never verified their email (IDE-152). Runs independently of mail delivery.
//
// Deletion requires, in one atomic predicate on the user document: a new
// customer account, still unverified, past its deadline, and SMTP acceptance
// recorded for the first verification email to its current address. Anything
// else (queued, failed, interrupted or disabled delivery) pauses deletion.
// Existing, verified and admin accounts can never match. Orders are separate
// documents with their own customer snapshot and are never touched.

const BATCH = 100;

const runAccountLifecycleTick = async ({ User, EmailOutbox, verificationService, now = () => new Date(), dryRun = false, logger = console }) => {
  const time = now();
  const result = { accepted: 0, warned: 0, expired: 0, deleted: 0, wouldDelete: 0, paused: 0 };

  // 1. Record SMTP acceptance of the delivery-check email on the user, so the
  //    delete predicate below needs no cross-collection read.
  const awaiting = await User.find({
    ...unverifiedNewCustomer(),
    verificationEmailAcceptedAt: { $exists: false },
    verificationDeliveryEmailId: { $exists: true },
  })
    .limit(BATCH)
    .lean();
  if (awaiting.length) {
    const messages = await EmailOutbox.find({ _id: { $in: awaiting.map((user) => user.verificationDeliveryEmailId) }, state: "sent" }).lean();
    const sentById = new Map(messages.map((message) => [String(message._id), message]));
    for (const user of awaiting) {
      const message = sentById.get(String(user.verificationDeliveryEmailId));
      // A correction may have replaced the address since; the match on both
      // the message id and the address keeps acceptance tied to that address.
      if (!message || message.to !== user.email) continue;
      const updated = await User.updateOne(
        { _id: user._id, email: user.email, verificationDeliveryEmailId: user.verificationDeliveryEmailId, verificationEmailAcceptedAt: { $exists: false } },
        { $set: { verificationEmailAcceptedAt: message.sentAt || time } }
      );
      if (updated.modifiedCount) result.accepted += 1;
    }
  }

  // 2. Final warning about 24 hours before the deadline.
  const warnBefore = new Date(time.getTime() + VERIFICATION.finalWarningBeforeMs);
  const dueWarnings = await User.find({
    ...unverifiedNewCustomer(),
    finalWarningQueuedAt: { $exists: false },
    verificationDeadline: { $gt: time, $lte: warnBefore },
  })
    .limit(BATCH)
    .lean();
  for (const user of dueWarnings) {
    try {
      if (await verificationService.queueFinalWarning(user, time)) result.warned += 1;
    } catch (error) {
      logger.error(`Final verification warning for account ${user._id} failed: ${error.message}`);
    }
  }

  // 3. Expire: links stop working and the account can no longer sign in, even
  //    while deletion is paused or delayed.
  const expireFilter = { ...unverifiedNewCustomer(), verificationDeadline: { $lte: time }, verificationExpiredAt: { $exists: false } };
  const expired = await User.updateMany(expireFilter, {
    $set: { verificationExpiredAt: time },
    $unset: { emailVerificationTokenHash: 1, emailVerificationExpires: 1 },
  });
  result.expired = expired.modifiedCount || 0;

  // 4. Delete eligible expired accounts.
  const deletable = { ...unverifiedNewCustomer(), verificationDeadline: { $lte: time }, verificationEmailAcceptedAt: { $exists: true } };
  result.paused = await User.countDocuments({ ...unverifiedNewCustomer(), verificationDeadline: { $lte: time }, verificationEmailAcceptedAt: { $exists: false } });
  const candidates = await User.find(deletable).limit(BATCH).lean();
  for (const user of candidates) {
    if (dryRun) {
      result.wouldDelete += 1;
      continue;
    }
    // Re-checked inside the delete, so a verification that lands between the
    // read and the delete keeps the account.
    const removed = await User.deleteOne({ _id: user._id, ...deletable });
    if (!removed.deletedCount) continue;
    result.deleted += 1;
    await verificationService.withdrawQueuedLinks(user._id, "Account removed after verification deadline");
  }

  if (Object.values(result).some(Boolean)) {
    // Counts only: no addresses, names or tokens.
    logger.log(`Account lifecycle${dryRun ? " (dry run)" : ""}: ${Object.entries(result).map(([key, value]) => `${key}=${value}`).join(" ")}`);
  }
  return result;
};

const startAccountLifecycle = ({ intervalMs, logger = console, ...deps }) => {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runAccountLifecycleTick({ ...deps, logger });
    } catch (error) {
      logger.error(`Account lifecycle tick failed: ${error.message}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
  return { stop: () => clearInterval(timer), tick };
};

module.exports = { runAccountLifecycleTick, startAccountLifecycle };
