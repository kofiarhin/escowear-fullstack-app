const { Router } = require("express");
const Order = require("../Models/Order.model");
const OrderEvent = require("../Models/OrderEvent.model");
const EmailOutbox = require("../Models/EmailOutbox.model");
const User = require("../Models/User.model");
const { createAuth } = require("../middlewares/auth.middleware");
const { createRateLimiter } = require("../middlewares/rateLimit");
const { createOrderWorkflow } = require("../services/orderWorkflow");
const { createAdminOrdersController } = require("../controllers/adminOrdersController");
const { getOrderConfig } = require("../config/orders");

// Every route here requires a logged-in user whose stored role is "admin".
const createAdminRouter = (deps = {}) => {
  const models = { Order, OrderEvent, EmailOutbox, User, ...deps.models };
  const config = deps.config || getOrderConfig();
  const { auth, requireAdmin } = createAuth(models.User);
  const workflow = deps.workflow || createOrderWorkflow({ ...models, config, env: deps.env, now: deps.now, logger: deps.logger });
  const controller = createAdminOrdersController({ ...models, workflow, logger: deps.logger });
  const limiter = createRateLimiter({ windowMs: 60 * 1000, max: 120, keyFn: (req) => String(req.user?._id || req.ip) });

  const router = Router();
  router.use(auth, requireAdmin, limiter);
  router.get("/orders", controller.listOrders);
  router.get("/orders/:id", controller.getOrder);
  router.post("/orders/:id/payment-instructions", controller.paymentInstructions);
  router.post("/orders/:id/awaiting-customer", controller.awaitingCustomer);
  router.post("/orders/:id/payment-review", controller.paymentReview);
  router.post("/orders/:id/verify-payment", controller.verifyPayment);
  router.post("/orders/:id/payment-issue", controller.paymentIssue);
  router.post("/orders/:id/fulfilment", controller.fulfilment);
  router.post("/orders/:id/cancel", controller.cancel);
  router.post("/orders/:id/refund", controller.refund);
  router.post("/orders/:id/notes", controller.addNote);
  router.post("/orders/:id/events/:eventId/requeue-email", controller.requeueEventEmail);
  router.post("/emails/:emailId/retry", controller.retryEmail);
  return router;
};

module.exports = { createAdminRouter };
