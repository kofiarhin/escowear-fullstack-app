const retryAfterSeconds = (resetAt, time) => Math.max(1, Math.ceil((new Date(resetAt).getTime() - time.getTime()) / 1000));

const createPersistentRateLimiter = ({ RateLimit, windowMs, max, keyFn = (req) => req.ip, message = "Too many requests, please try again later", now = () => new Date() }) => {
  if (!RateLimit) throw new Error("RateLimit model is required");

  const consume = async (key) => {
    // A duplicate-key race can happen when a new window receives its first
    // concurrent requests. Retry until an atomic operation either consumes a
    // slot or the persisted counter proves the active window is full. A fixed
    // retry budget would incorrectly reject an under-limit request under load.
    for (;;) {
      const time = now();
      const expires = new Date(time.getTime() + windowMs);
      const incremented = await RateLimit.findOneAndUpdate(
        { key, resetAt: { $gt: time }, count: { $lt: max } },
        { $inc: { count: 1 } },
        { new: true }
      );
      if (incremented) return { allowed: true, retryAfterSeconds: retryAfterSeconds(incremented.resetAt, time) };

      const renewed = await RateLimit.findOneAndUpdate(
        { key, resetAt: { $lte: time } },
        { $set: { count: 1, resetAt: expires } },
        { new: true }
      );
      if (renewed) return { allowed: true, retryAfterSeconds: retryAfterSeconds(renewed.resetAt, time) };

      try {
        const created = await RateLimit.create({ key, count: 1, resetAt: expires });
        return { allowed: true, retryAfterSeconds: retryAfterSeconds(created.resetAt, time) };
      } catch (error) {
        if (error?.code !== 11000) throw error;
      }

      const current = await RateLimit.findOne({ key });
      if (current && new Date(current.resetAt) > time && current.count >= max) {
        return { allowed: false, retryAfterSeconds: retryAfterSeconds(current.resetAt, time) };
      }
      // The record was created, renewed, or incremented by another request
      // while this request raced it. Re-evaluate its real persisted state.
    }
  };

  const middleware = async (req, res, next) => {
    const rawKey = keyFn(req);
    if (rawKey === null || rawKey === undefined) return next();
    try {
      const result = await consume(String(rawKey));
      if (!result.allowed) {
        res.set("Retry-After", String(result.retryAfterSeconds));
        return res.status(429).json({ error: message, code: "RATE_LIMITED" });
      }
      return next();
    } catch {
      return res.status(503).json({ error: "Request protection is temporarily unavailable. Please try again.", code: "RATE_LIMIT_UNAVAILABLE" });
    }
  };

  middleware.consume = consume;
  return middleware;
};

module.exports = { createPersistentRateLimiter, retryAfterSeconds };
