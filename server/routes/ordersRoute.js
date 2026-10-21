const { Router } = require("express");
const Order = require("../Models/Order.model");
const OrderEvent = require("../Models/OrderEvent.model");
const EmailOutbox = require("../Models/EmailOutbox.model");
const Product = require("../Models/Product.model");
const User = require("../Models/User.model");
const { createAuth } = require("../middlewares/auth.middleware");
const { createRateLimiter } = require("../middlewares/rateLimit");
const { createOrderService } = require("../services/orderService");
const { createOrdersController } = require("../controllers/ordersController");
const { getOrderConfig } = require("../config/orders");

const createOrdersRouter = (deps = {}) => {
  const models = { Order, OrderEvent, EmailOutbox, Product, User, ...deps.models };
  const config = deps.config || getOrderConfig();
  const { auth, optionalAuth } = createAuth(models.User);
  const orderService =
    deps.orderService || createOrderService({ ...models, config, logger: deps.logger, randomBytes: deps.randomBytes });
  const controller = createOrdersController(orderService, { logger: deps.logger });
  const createLimiter =
    deps.createLimiter || createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20, message: "Too many orders from this connection. Please try again later." });

  const router = Router();
  router.get("/", auth, controller.getOrders);
  router.post("/", createLimiter, optionalAuth, controller.createOrder);
  router.get("/:id", optionalAuth, controller.getOrder);
  router.orderService = orderService;
  return router;
};

module.exports = createOrdersRouter();
module.exports.createOrdersRouter = createOrdersRouter;
