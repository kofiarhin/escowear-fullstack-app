const { Router } = require("express");
const Order = require("../Models/Order.model");
const OrderEvent = require("../Models/OrderEvent.model");
const EmailOutbox = require("../Models/EmailOutbox.model");
const Product = require("../Models/Product.model");
const TrackingChallenge = require("../Models/TrackingChallenge.model");
const CheckoutEmailChallenge = require("../Models/CheckoutEmailChallenge.model");
const User = require("../Models/User.model");
const PaymentProof = require("../Models/PaymentProof.model");
const { createAuth } = require("../middlewares/auth.middleware");
const { createRateLimiter } = require("../middlewares/rateLimit");
const { createOrderService } = require("../services/orderService");
const { createTrackingService } = require("../services/trackingService");
const { createCheckoutEmailService } = require("../services/checkoutEmailService");
const { createPaymentProofService } = require("../services/paymentProofService");
const { createProofStorage } = require("../services/proofStorage");
const { createOrdersController } = require("../controllers/ordersController");
const { getOrderConfig } = require("../config/orders");

const createOrdersRouter = (deps = {}) => {
  const models = { Order, OrderEvent, EmailOutbox, Product, User, TrackingChallenge, CheckoutEmailChallenge, PaymentProof, ...deps.models };
  const config = deps.config || getOrderConfig();
  const { auth, optionalAuth } = createAuth(models.User);
  const checkoutEmailService =
    deps.checkoutEmailService ||
    createCheckoutEmailService({ ...models, now: deps.now, randomInt: deps.randomInt, logger: deps.logger });
  const orderService =
    deps.orderService ||
    createOrderService({ ...models, config, logger: deps.logger, randomBytes: deps.randomBytes, checkoutEmail: checkoutEmailService });
  const trackingService = deps.trackingService || createTrackingService({ ...models, config, logger: deps.logger, now: deps.now });
  const storage = deps.proofStorage || createProofStorage({ rootDir: config.proofUploadDir });
  const proofService =
    deps.proofService ||
    createPaymentProofService({ ...models, storage, config, env: deps.env, now: deps.now, logger: deps.logger, processImage: deps.processImage });
  const controller = createOrdersController(orderService, {
    logger: deps.logger,
    trackingService,
    proofService,
    checkoutEmailService,
    proofMaxBytes: config.proofMaxBytes,
    maxConcurrentUploads: deps.maxConcurrentUploads,
  });
  const createLimiter =
    deps.createLimiter || createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20, message: "Too many orders from this connection. Please try again later." });

  const minutes = (count) => count * 60 * 1000;
  const trackingRequestLimiter = createRateLimiter({ windowMs: minutes(15), max: 10, message: "Too many code requests. Please wait and try again." });
  const trackingRequestPerOrderLimiter = createRateLimiter({
    windowMs: minutes(60),
    max: 5,
    keyFn: (req) => (typeof req.body?.orderNumber === "string" ? req.body.orderNumber.trim().toUpperCase().slice(0, 32) : null),
    message: "Too many code requests for this order. Please wait and try again.",
  });
  // Guest checkout email codes: per connection and per address.
  const emailCodeRequestLimiter = createRateLimiter({ windowMs: minutes(15), max: 10, message: "Too many code requests. Please wait and try again." });
  const emailCodeRequestPerEmailLimiter = createRateLimiter({
    windowMs: minutes(60),
    max: 5,
    keyFn: (req) => (typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase().slice(0, 254) : null),
    message: "Too many code requests for this email. Please wait and try again.",
  });
  const emailCodeVerifyLimiter = createRateLimiter({ windowMs: minutes(15), max: 30, message: "Too many attempts. Please wait and try again." });
  const trackingVerifyLimiter = createRateLimiter({ windowMs: minutes(15), max: 20, message: "Too many attempts. Please wait and try again." });
  const proofIpLimiter =
    deps.proofIpLimiter || createRateLimiter({ windowMs: minutes(15), max: 15, message: "Too many uploads. Please wait and try again." });
  const proofOrderLimiter =
    deps.proofOrderLimiter ||
    createRateLimiter({ windowMs: minutes(60), max: 10, keyFn: (req) => String(req.params.id).slice(0, 32), message: "Too many uploads for this order. Please wait and try again." });

  const router = Router();
  router.get("/", auth, controller.getOrders);
  router.get("/checkout-status", controller.checkoutStatus);
  router.post("/", createLimiter, optionalAuth, controller.createOrder);
  router.post("/checkout-email/request", emailCodeRequestLimiter, emailCodeRequestPerEmailLimiter, controller.requestCheckoutEmailCode);
  router.post("/checkout-email/verify", emailCodeVerifyLimiter, controller.verifyCheckoutEmailCode);
  router.post("/tracking/request", trackingRequestLimiter, trackingRequestPerOrderLimiter, controller.requestTrackingCode);
  router.post("/tracking/verify", trackingVerifyLimiter, controller.verifyTrackingCode);
  router.get("/:id/payment-instructions", optionalAuth, controller.getPaymentInstructions);
  router.post("/:id/payment-proof", proofIpLimiter, optionalAuth, controller.authorizePaymentProof, proofOrderLimiter, controller.submitPaymentProof);
  router.get("/:id", optionalAuth, controller.getOrder);
  router.orderService = orderService;
  return router;
};

module.exports = createOrdersRouter();
module.exports.createOrdersRouter = createOrdersRouter;
