const { Router } = require("express");
const Order = require("../Models/Order.model");
const OrderEvent = require("../Models/OrderEvent.model");
const EmailOutbox = require("../Models/EmailOutbox.model");
const Product = require("../Models/Product.model");
const TrackingChallenge = require("../Models/TrackingChallenge.model");
const User = require("../Models/User.model");
const { createAuth } = require("../middlewares/auth.middleware");
const { createRateLimiter } = require("../middlewares/rateLimit");
const { createOrderService } = require("../services/orderService");
const { createTrackingService } = require("../services/trackingService");
const { createOrdersController } = require("../controllers/ordersController");
const { getOrderConfig } = require("../config/orders");

const createOrdersRouter = (deps = {}) => {
  const models = { Order, OrderEvent, EmailOutbox, Product, User, TrackingChallenge, ...deps.models };
  const config = deps.config || getOrderConfig();
  const { auth, optionalAuth } = createAuth(models.User);
  const orderService =
    deps.orderService || createOrderService({ ...models, config, logger: deps.logger, randomBytes: deps.randomBytes });
  const trackingService = deps.trackingService || createTrackingService({ ...models, config, logger: deps.logger, now: deps.now });
  const controller = createOrdersController(orderService, { logger: deps.logger, trackingService });
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
  const trackingVerifyLimiter = createRateLimiter({ windowMs: minutes(15), max: 20, message: "Too many attempts. Please wait and try again." });

  const router = Router();
  router.get("/", auth, controller.getOrders);
  router.post("/", createLimiter, optionalAuth, controller.createOrder);
  router.post("/tracking/request", trackingRequestLimiter, trackingRequestPerOrderLimiter, controller.requestTrackingCode);
  router.post("/tracking/verify", trackingVerifyLimiter, controller.verifyTrackingCode);
  router.get("/:id", optionalAuth, controller.getOrder);
  router.orderService = orderService;
  return router;
};

module.exports = createOrdersRouter();
module.exports.createOrdersRouter = createOrdersRouter;
