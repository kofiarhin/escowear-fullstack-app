const { OrderError } = require("../services/orderService");
const { verifyOrderAccessToken } = require("../services/orderAccess");

const sendError = (res, error, logger = console) => {
  if (error instanceof OrderError) {
    const body = { error: error.message, code: error.code };
    if (error.fields) body.fields = error.fields;
    return res.status(error.status).json(body);
  }
  logger.error(`Order request failed: ${error.message}`);
  return res.status(500).json({ error: "Something went wrong. Your cart has not been changed.", code: "SERVER_ERROR" });
};

const createOrdersController = (orderService, { logger = console } = {}) => {
  const createOrder = async (req, res) => {
    try {
      const result = await orderService.createGuestOrder({
        body: req.body,
        idempotencyKey: req.get("Idempotency-Key"),
        user: req.user,
      });
      return res.status(result.httpStatus).json(result.body);
    } catch (error) {
      return sendError(res, error, logger);
    }
  };

  const getOrders = async (req, res) => {
    try {
      return res.status(200).json(await orderService.listOwnerOrders(req.user, req.query));
    } catch (error) {
      return sendError(res, error, logger);
    }
  };

  const getOrder = async (req, res) => {
    try {
      const order = await orderService.getOrderForViewer(req.params.id, {
        user: req.user,
        accessOrderId: verifyOrderAccessToken(req.get("X-Order-Access-Token")),
      });
      // 404 for both "missing" and "not yours" so ids cannot be probed.
      if (!order) return res.status(404).json({ error: "Order not found", code: "NOT_FOUND" });
      res.set("Cache-Control", "no-store");
      return res.status(200).json(order);
    } catch (error) {
      return sendError(res, error, logger);
    }
  };

  return { createOrder, getOrder, getOrders };
};

module.exports = { createOrdersController, sendError };
