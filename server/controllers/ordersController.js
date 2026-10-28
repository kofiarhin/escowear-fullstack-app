const { OrderError } = require("../services/orderService");
const { verifyOrderAccessToken, verifyPaymentProofToken } = require("../services/orderAccess");
const { MultipartError, readMultipart } = require("../middlewares/multipart");

const sendError = (res, error, logger = console) => {
  if (error instanceof OrderError || error instanceof MultipartError) {
    const body = { error: error.message, code: error.code };
    if (error.fields) body.fields = error.fields;
    return res.status(error.status).json(body);
  }
  logger.error(`Order request failed: ${error.message}`);
  return res.status(500).json({ error: "Something went wrong. Your cart has not been changed.", code: "SERVER_ERROR" });
};

const createOrdersController = (orderService, { logger = console, trackingService, proofService, proofMaxBytes, maxConcurrentUploads = 4 } = {}) => {
  let uploadsInFlight = 0;
  const proofViewer = (req) => ({ user: req.user, proofOrderId: verifyPaymentProofToken(req.get("X-Order-Proof-Token")) });
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

  const checkoutStatus = (req, res) => {
    res.set("Cache-Control", "no-store");
    return res.status(200).json(orderService.checkoutStatus());
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

  // Always 202 with the same body for well-formed requests (no enumeration).
  const requestTrackingCode = async (req, res) => {
    try {
      const { message } = await trackingService.requestCode(req.body);
      return res.status(202).json({ message });
    } catch (error) {
      return sendError(res, error, logger);
    }
  };

  const verifyTrackingCode = async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      return res.status(200).json(await trackingService.verifyCode(req.body));
    } catch (error) {
      return sendError(res, error, logger);
    }
  };

  // Payment details for the proven owner (login or proof capability) only.
  const getPaymentInstructions = async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const order = await proofService.authorize(req.params.id, proofViewer(req));
      return res.status(200).json(await proofService.getPaymentInstructions(order));
    } catch (error) {
      return sendError(res, error, logger);
    }
  };

  // Ownership is checked before the body is read, so strangers never get to
  // stream an upload. The order state is re-checked atomically on commit.
  // Stop reading an upload we have rejected; close so it is not reused.
  const abandonUpload = (req, res) => {
    if (!req.complete) {
      res.set("Connection", "close");
      req.unpipe();
      req.resume();
    }
  };

  // Runs before the per-order upload limiter, so only the owner (or a holder of
  // the proof capability) can use up an order's upload budget.
  const authorizePaymentProof = async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    try {
      req.proofOrder = await proofService.authorize(req.params.id, proofViewer(req));
      return next();
    } catch (error) {
      abandonUpload(req, res);
      return sendError(res, error, logger);
    }
  };

  const submitPaymentProof = async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (uploadsInFlight >= maxConcurrentUploads) {
      res.set("Retry-After", "10");
      req.resume();
      return res.status(503).json({ error: "We're busy processing uploads. Please try again in a moment.", code: "UPLOADS_BUSY" });
    }
    uploadsInFlight += 1;
    try {
      const order = req.proofOrder || (await proofService.authorize(req.params.id, proofViewer(req)));
      const { fields, file } = await readMultipart(req, { maxBytes: proofMaxBytes, allowedFields: ["transactionReference", "quoteVersion"] });
      const result = await proofService.submit({ order, user: req.user, idempotencyKey: req.get("Idempotency-Key"), fields, file });
      return res.status(result.httpStatus).json(result.body);
    } catch (error) {
      abandonUpload(req, res);
      return sendError(res, error, logger);
    } finally {
      uploadsInFlight -= 1;
    }
  };

  return { authorizePaymentProof, checkoutStatus, createOrder, getOrder, getOrders, getPaymentInstructions, requestTrackingCode, submitPaymentProof, verifyTrackingCode };
};

module.exports = { createOrdersController, sendError };
