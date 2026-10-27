const { sendError } = require("./ordersController");
const { OrderError, parsePage } = require("../services/orderService");
const { allowedActions } = require("../services/orderWorkflow");
const { retryFailedEmail } = require("../services/emailOutbox");
const { customerStatusLabel } = require("../services/orderStatus");
const { isObjectId } = require("../validators/orderValidator");

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const adminSummary = (order) => ({
  id: String(order._id),
  orderNumber: order.orderNumber,
  status: order.status,
  statusLabel: customerStatusLabel(order.status),
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
  customer: order.customer ? { name: order.customer.name, email: order.customer.email } : null,
  itemCount: (order.items || []).reduce((total, item) => total + item.quantity, 0),
  subtotalGBPMinor: order.pricing?.subtotalGBPMinor,
  quoteTotalGHSMinor: order.pricing?.finalGHS?.totalMinor ?? null,
  paymentStatus: order.payment?.status,
  // A website proof is waiting for the admin to check the receiving account.
  proofAwaitingReview: order.status === "payment_review" && Boolean(order.payment?.proof?.id),
  email: order.email || {},
});

const adminDetail = (order, events, emails, paymentChannelConfigured, paymentProofs = []) => {
  // Hashes used for idempotency never leave the server.
  const { idempotencyKeyHash, requestFingerprint, ...rest } = order;
  return {
    ...rest,
    id: String(order._id),
    statusLabel: customerStatusLabel(order.status),
    allowedActions: allowedActions(order.status),
    paymentChannelConfigured,
    paymentProofs,
    events: events.map((event) => ({
      id: String(event._id),
      type: event.type,
      actorType: event.actorType,
      actorId: event.actorId ? String(event.actorId) : null,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      customerVisible: Boolean(event.customerVisible),
      createdAt: event.createdAt,
      details: event.details ? { ...event.details, email: event.details.email ? { kind: event.details.email.kind, dedupeKey: event.details.email.dedupeKey } : undefined } : {},
    })),
    emails: emails.map((message) => ({
      id: String(message._id),
      kind: message.kind,
      dedupeKey: message.dedupeKey,
      to: message.to,
      subject: message.payload?.subject,
      state: message.state,
      attempts: message.attempts,
      lastError: message.lastError,
      nextAttemptAt: message.nextAttemptAt,
      sentAt: message.sentAt,
      createdAt: message.createdAt,
    })),
  };
};

const createAdminOrdersController = ({ Order, OrderEvent, EmailOutbox, workflow, proofs, logger = console }) => {
  const handle = (action) => async (req, res) => {
    try {
      return await action(req, res);
    } catch (error) {
      return sendError(res, error, logger);
    }
  };

  const listOrders = handle(async (req, res) => {
    const { page, limit, skip } = parsePage(req.query);
    const filter = { orderNumber: { $type: "string" } };
    if (typeof req.query.status === "string" && /^[a-z_]{3,40}$/.test(req.query.status)) filter.status = req.query.status;
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
    if (q) {
      filter.$or = q.includes("@")
        ? [{ "customer.emailNormalized": q.toLowerCase() }]
        : [{ orderNumber: { $regex: `^${escapeRegex(q.toUpperCase())}` } }, { "customer.name": { $regex: escapeRegex(q), $options: "i" } }];
    }
    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Order.countDocuments(filter),
    ]);
    res.set("Cache-Control", "no-store");
    return res.json({ items: orders.map(adminSummary), pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
  });

  const getOrder = handle(async (req, res) => {
    if (!isObjectId(req.params.id)) throw new OrderError(404, "NOT_FOUND", "Order not found");
    const order = await Order.findOne({ _id: req.params.id }).select("+internalNotes").lean();
    if (!order || !order.orderNumber) throw new OrderError(404, "NOT_FOUND", "Order not found");
    const [events, emails, paymentProofs] = await Promise.all([
      OrderEvent.find({ orderId: order._id }).sort({ createdAt: 1 }).lean(),
      EmailOutbox.find({ orderId: order._id }).sort({ createdAt: 1 }).lean(),
      proofs ? proofs.listForAdmin(order) : [],
    ]);
    res.set("Cache-Control", "no-store");
    return res.json(adminDetail(order, events, emails, workflow.paymentChannelConfigured(), paymentProofs));
  });

  // Streams one stored screenshot to an admin. Never cached, never sniffed,
  // never rendered as a document, so a crafted file cannot run in our origin.
  const paymentProofImage = handle(async (req, res) => {
    const { buffer, contentType } = await proofs.readForAdmin(req.params.id, req.params.proofId);
    res.set({
      "Content-Type": contentType,
      "Content-Length": String(buffer.length),
      "Cache-Control": "no-store, private",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
      "Content-Disposition": "inline; filename=\"payment-proof\"",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
    });
    return res.status(200).end(buffer);
  });

  const action = (method) =>
    handle(async (req, res) => {
      const result = await workflow[method](req.params.id, req.user, req.body || {});
      return res.json({ ok: true, status: result.order?.status, email: result.email || null });
    });

  const addNote = handle(async (req, res) => res.status(201).json(await workflow.addNote(req.params.id, req.user, req.body || {})));

  const requeueEventEmail = handle(async (req, res) =>
    res.json(await workflow.requeueEventEmail(req.params.id, req.params.eventId, req.user))
  );

  const retryEmail = handle(async (req, res) => {
    if (!isObjectId(req.params.emailId)) throw new OrderError(404, "NOT_FOUND", "Email not found");
    const message = await retryFailedEmail(EmailOutbox, req.params.emailId);
    if (!message) throw new OrderError(409, "NOT_RETRYABLE", "Only failed emails can be retried");
    await OrderEvent.create({
      orderId: message.orderId,
      actorType: "admin",
      actorId: req.user._id,
      type: "email_retry_requested",
      details: { dedupeKey: message.dedupeKey },
    });
    return res.json({ ok: true, state: message.state });
  });

  return {
    addNote,
    cancel: action("cancelOrder"),
    customerUpdate: action("sendCustomerUpdate"),
    paymentProofImage,
    fulfilment: action("updateFulfilment"),
    getOrder,
    listOrders,
    awaitingCustomer: action("markAwaitingCustomer"),
    paymentInstructions: action("sendPaymentInstructions"),
    paymentIssue: action("recordPaymentIssue"),
    paymentReview: action("markPaymentReview"),
    refund: action("recordRefund"),
    requeueEventEmail,
    retryEmail,
    verifyPayment: action("verifyPayment"),
  };
};

module.exports = { adminDetail, adminSummary, createAdminOrdersController };
