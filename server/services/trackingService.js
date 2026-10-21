const crypto = require("crypto");
const { enqueueEmail } = require("./emailOutbox");
const { issueOrderAccessToken } = require("./orderAccess");
const { OrderError } = require("./orderService");
const { normalizeEmail } = require("../validators/orderValidator");

const ORDER_NUMBER = /^EW-[0-9A-Z]{5}-[0-9A-Z]{5}$/;
const CODE = /^\d{6}$/;

// Same message whether or not the order exists, so responses cannot be used
// to discover order numbers or which email placed them.
const GENERIC_REQUEST_MESSAGE = "If the order number and email match an order, we have emailed a 6-digit code.";
const INVALID_CODE = () => new OrderError(400, "INVALID_CODE", "That code is not valid or has expired. Request a new code.");

const normalizeOrderNumber = (value) => (typeof value === "string" ? value.trim().toUpperCase() : "");

const createTrackingService = ({ Order, OrderEvent, EmailOutbox, TrackingChallenge, config, secret = process.env.JWT_SECRET, now = () => new Date(), randomInt = crypto.randomInt, logger = console }) => {
  const hashCode = (orderId, code) =>
    crypto.createHmac("sha256", `${secret}:tracking-code:v1`).update(`${orderId}:${code}`).digest("hex");

  const parse = (body = {}) => {
    const orderNumber = normalizeOrderNumber(body.orderNumber);
    const email = normalizeEmail(body.email);
    const fields = {};
    if (!ORDER_NUMBER.test(orderNumber)) fields.orderNumber = "Enter the order number from your email, e.g. EW-AB12C-34DEF";
    if (!email || email.length > 254 || !email.includes("@")) fields.email = "Enter the email used for the order";
    if (Object.keys(fields).length) throw new OrderError(422, "VALIDATION_FAILED", "Please correct the highlighted fields", fields);
    return { orderNumber, email };
  };

  const findOrder = ({ orderNumber, email }) => Order.findOne({ orderNumber, "customer.emailNormalized": email }).lean();

  // Validates synchronously, then does the lookup and code issue in the
  // background, so response time does not reveal whether the order exists.
  const requestCode = async (body) => {
    const input = parse(body);
    const done = issueCode(input).catch((error) => logger.error(`Tracking code request failed: ${error.message}`));
    return { message: GENERIC_REQUEST_MESSAGE, done };
  };

  const issueCode = async (input) => {
    const order = await findOrder(input);
    if (!order) return { message: GENERIC_REQUEST_MESSAGE };

    const time = now();
    const recent = await TrackingChallenge.countDocuments({ orderId: order._id, createdAt: { $gte: new Date(time.getTime() - 60 * 60 * 1000) } });
    if (recent >= config.trackingCodesPerOrderPerHour) return { message: GENERIC_REQUEST_MESSAGE };

    // A new code replaces any earlier unused one.
    await TrackingChallenge.updateMany({ orderId: order._id, consumedAt: { $exists: false } }, { $set: { consumedAt: time, consumedReason: "superseded" } });
    const code = String(randomInt(0, 1000000)).padStart(6, "0");
    const challenge = await TrackingChallenge.create({
      orderId: order._id,
      codeHash: hashCode(order._id, code),
      expiresAt: new Date(time.getTime() + config.trackingCodeTtlMinutes * 60 * 1000),
      attempts: 0,
    });
    try {
      await enqueueEmail(EmailOutbox, {
        dedupeKey: `tracking_code:${challenge._id}`,
        orderId: order._id,
        kind: "tracking_code",
        to: order.customer.emailNormalized,
        context: { order, code, ttlMinutes: config.trackingCodeTtlMinutes },
      });
    } catch (error) {
      logger.error(`Tracking code email for order ${order._id} not queued: ${error.message}`);
    }
    return { message: GENERIC_REQUEST_MESSAGE };
  };

  const verifyCode = async (body = {}) => {
    const input = parse(body);
    const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
    if (!CODE.test(code)) throw new OrderError(422, "VALIDATION_FAILED", "Enter the 6-digit code", { code: "Enter the 6-digit code from your email" });

    const order = await findOrder(input);
    if (!order) throw INVALID_CODE();
    const time = now();
    const [latest] = await TrackingChallenge.find({ orderId: order._id, consumedAt: { $exists: false }, expiresAt: { $gt: time } })
      .sort({ createdAt: -1 })
      .limit(1)
      .lean();
    if (!latest) throw INVALID_CODE();

    // Count the attempt before comparing, atomically, so parallel guesses
    // cannot exceed the limit.
    const attempt = await TrackingChallenge.findOneAndUpdate(
      { _id: latest._id, consumedAt: { $exists: false }, attempts: { $lt: config.trackingCodeMaxAttempts } },
      { $inc: { attempts: 1 } },
      { new: true }
    ).lean();
    if (!attempt) throw INVALID_CODE();

    const expected = Buffer.from(attempt.codeHash, "hex");
    const actual = Buffer.from(hashCode(order._id, code), "hex");
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      if (attempt.attempts >= config.trackingCodeMaxAttempts) {
        await TrackingChallenge.updateOne({ _id: attempt._id, consumedAt: { $exists: false } }, { $set: { consumedAt: time, consumedReason: "too_many_attempts" } });
      }
      throw INVALID_CODE();
    }

    const consumed = await TrackingChallenge.findOneAndUpdate(
      { _id: attempt._id, consumedAt: { $exists: false } },
      { $set: { consumedAt: time, consumedReason: "verified" } },
      { new: true }
    ).lean();
    if (!consumed) throw INVALID_CODE();

    await OrderEvent.create({ orderId: order._id, actorType: "customer", type: "tracking_access_granted", customerVisible: false, details: {} }).catch(() => {});
    return {
      orderId: String(order._id),
      accessToken: issueOrderAccessToken(order._id, config.trackingAccessTtlMinutes, { secret, via: "tracking" }),
      expiresInMinutes: config.trackingAccessTtlMinutes,
    };
  };

  return { requestCode, verifyCode };
};

module.exports = { GENERIC_REQUEST_MESSAGE, createTrackingService };
