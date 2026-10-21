// Small fixed-window, in-process rate limiter (no new dependency). Limits are
// per Node process; the Beast deployment runs a single container.
const createRateLimiter = ({ windowMs, max, keyFn = (req) => req.ip, message = "Too many requests, please try again later", now = Date.now }) => {
  const hits = new Map();

  const sweep = (time) => {
    for (const [key, entry] of hits) if (entry.resetAt <= time) hits.delete(key);
  };

  const consume = (key) => {
    const time = now();
    if (hits.size > 10000) sweep(time);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= time) {
      entry = { count: 0, resetAt: time + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    return { allowed: entry.count <= max, retryAfterSeconds: Math.ceil((entry.resetAt - time) / 1000) };
  };

  const middleware = (req, res, next) => {
    const key = keyFn(req);
    if (key === null || key === undefined) return next();
    const result = consume(String(key));
    if (!result.allowed) {
      res.set("Retry-After", String(result.retryAfterSeconds));
      return res.status(429).json({ error: message, code: "RATE_LIMITED" });
    }
    return next();
  };

  middleware.consume = consume;
  middleware.reset = () => hits.clear();
  return middleware;
};

module.exports = { createRateLimiter };
