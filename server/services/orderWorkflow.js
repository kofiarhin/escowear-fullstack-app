// Admin-driven manual payment and fulfilment workflow. Every action:
//   1. checks the caller-supplied expectedStatus against the transition table,
//   2. applies an atomic conditional update (stale/concurrent writes get 409),
//   3. appends an OrderEvent, and
//   4. queues the matching customer email with a deterministic dedupe key.
// Payment can only become "verified" through verifyPayment, which requires an
// explicit bank-receipt attestation; an emailed screenshot is never enough.
const { ORDER_STATUS: S, PAYMENT_STATUS: P, EMAIL_STATE } = require("./orderStatus");
const { enqueueEmail } = require("./emailOutbox");
const { OrderError } = require("./orderService");
const { isObjectId } = require("../validators/orderValidator");

const TRANSITIONS = Object.freeze({
  [S.PENDING_CONTACT]: [S.AWAITING_CUSTOMER, S.AWAITING_PAYMENT, S.CANCELLED],
  [S.AWAITING_CUSTOMER]: [S.AWAITING_PAYMENT, S.CANCELLED],
  [S.AWAITING_PAYMENT]: [S.AWAITING_PAYMENT, S.AWAITING_CUSTOMER, S.PAYMENT_REVIEW, S.PAYMENT_ISSUE, S.CONFIRMED, S.CANCELLED],
  [S.PAYMENT_REVIEW]: [S.PAYMENT_ISSUE, S.CONFIRMED],
  [S.PAYMENT_ISSUE]: [S.AWAITING_PAYMENT, S.PAYMENT_REVIEW, S.CONFIRMED, S.CANCELLED],
  [S.CONFIRMED]: [S.PROCESSING, S.SOURCING_FAILED, S.REFUND_PENDING],
  [S.PROCESSING]: [S.DISPATCHED, S.SOURCING_FAILED, S.REFUND_PENDING],
  [S.DISPATCHED]: [S.DELIVERED],
  [S.DELIVERED]: [S.COMPLETED],
  [S.SOURCING_FAILED]: [S.PROCESSING, S.REFUND_PENDING],
  [S.REFUND_PENDING]: [S.REFUNDED],
  [S.COMPLETED]: [],
  [S.REFUNDED]: [],
  [S.CANCELLED]: [],
});

const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

const PAID_STATUSES = [S.CONFIRMED, S.PROCESSING, S.SOURCING_FAILED];
const FULFILMENT_TARGETS = [S.PROCESSING, S.DISPATCHED, S.DELIVERED, S.COMPLETED, S.SOURCING_FAILED];

// Which admin actions the UI may offer for a status (the server re-checks).
const allowedActions = (status) => {
  const next = TRANSITIONS[status] || [];
  const actions = [];
  if (next.includes(S.AWAITING_PAYMENT)) actions.push("payment-instructions");
  if (next.includes(S.AWAITING_CUSTOMER)) actions.push("awaiting-customer");
  if (next.includes(S.PAYMENT_REVIEW)) actions.push("payment-review");
  if (next.includes(S.CONFIRMED)) actions.push("verify-payment");
  if (next.includes(S.PAYMENT_ISSUE)) actions.push("payment-issue");
  if (FULFILMENT_TARGETS.some((target) => next.includes(target))) actions.push("fulfilment");
  if (next.includes(S.CANCELLED) || (PAID_STATUSES.includes(status) && next.includes(S.REFUND_PENDING))) actions.push("cancel");
  if (next.includes(S.REFUNDED)) actions.push("refund");
  return actions;
};

const STATUS_EMAILS = {
  [S.PROCESSING]: { headline: "We are now sourcing your order" },
  [S.DISPATCHED]: { headline: "Your order has been dispatched" },
  [S.DELIVERED]: { headline: "Your order has been delivered" },
  [S.SOURCING_FAILED]: { headline: "We could not source an item in your order and will contact you about options" },
  [S.CANCELLED]: { headline: "Your order has been cancelled" },
  [S.REFUND_PENDING]: { headline: "Your order has been cancelled and a refund is being arranged" },
  [S.REFUNDED]: { headline: "Your refund has been processed" },
};

// --- input helpers -----------------------------------------------------------
const text = (value, max) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max + 1) : "");
const multiline = (value, max) => (typeof value === "string" ? value.replace(/\r\n/g, "\n").trim().slice(0, max + 1) : "");
const minor = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
const date = (value) => {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const fail = (fields) => {
  throw new OrderError(422, "VALIDATION_FAILED", "Please correct the highlighted fields", fields);
};
const optionalUrl = (value) => {
  const raw = text(value, 500);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
};

const createOrderWorkflow = ({ Order, OrderEvent, EmailOutbox, config, env = process.env, now = () => new Date(), logger = console }) => {
  const paymentInstructions = () => (env.ESCOWEAR_PAYMENT_INSTRUCTIONS || "").replace(/\\n/g, "\n").trim();

  const loadOrder = async (orderId) => {
    if (!isObjectId(orderId)) throw new OrderError(404, "NOT_FOUND", "Order not found");
    const order = await Order.findOne({ _id: orderId }).lean();
    if (!order || !order.orderNumber) throw new OrderError(404, "NOT_FOUND", "Order not found");
    return order;
  };

  const assertTransition = (order, expectedStatus, toStatus) => {
    if (typeof expectedStatus !== "string" || !expectedStatus) {
      throw new OrderError(400, "EXPECTED_STATUS_REQUIRED", "expectedStatus is required");
    }
    if (order.status !== expectedStatus) {
      throw new OrderError(409, "STALE_STATUS", `Order is now ${order.status}; reload before acting`, { currentStatus: order.status });
    }
    if (!canTransition(order.status, toStatus)) {
      throw new OrderError(409, "ILLEGAL_TRANSITION", `Cannot move an order from ${order.status} to ${toStatus}`);
    }
  };

  // Atomic compare-and-set on status (plus any extra guard conditions).
  const commit = async (order, toStatus, set, guard = {}) => {
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, status: order.status, ...guard },
      { $set: { ...set, status: toStatus } },
      { new: true }
    ).lean();
    if (!updated) {
      const current = await Order.findOne({ _id: order._id }).lean();
      throw new OrderError(409, "STALE_STATUS", "This order was changed by someone else; reload before acting", {
        currentStatus: current?.status,
      });
    }
    return updated;
  };

  const recordEvent = (order, admin, type, fromStatus, toStatus, details, customerVisible = true) =>
    OrderEvent.create({
      orderId: order._id,
      actorType: "admin",
      actorId: admin._id,
      type,
      fromStatus,
      toStatus,
      customerVisible,
      details,
    });

  const EMAIL_STATE_FIELD = {
    order_received: "email.acknowledgementState",
    payment_instructions: "email.paymentInstructionState",
    order_confirmed: "email.confirmationState",
  };

  // Queues the email described by an event. Safe to call again (dedupeKey).
  const queueEventEmail = async (order, event) => {
    const spec = event.details?.email;
    if (!spec) return null;
    const context = {
      order: { ...order, ...(spec.snapshot || {}) },
      baseUrl: config.publicBaseUrl,
      message: spec.message,
      headline: spec.headline,
      paymentInstructions: spec.kind === "payment_instructions" ? paymentInstructions() : undefined,
    };
    if (spec.kind === "payment_instructions" && !context.paymentInstructions) {
      throw new OrderError(409, "PAYMENT_CHANNEL_NOT_CONFIGURED", "Payment instructions are not configured on the server");
    }
    const { message } = await enqueueEmail(EmailOutbox, {
      dedupeKey: spec.dedupeKey,
      orderId: order._id,
      kind: spec.kind,
      to: order.customer.emailNormalized,
      context,
    });
    const field = EMAIL_STATE_FIELD[spec.kind];
    if (field && message.state !== "sent") await Order.updateOne({ _id: order._id }, { $set: { [field]: EMAIL_STATE.QUEUED } });
    return message;
  };

  // Commit + event + email. Email failures never undo the committed change;
  // the admin sees `email.queued: false` and can requeue from the event.
  const transition = async ({ order, admin, toStatus, set, guard, type, details, email, customerVisible }) => {
    const updated = await commit(order, toStatus, set, guard);
    const event = await recordEvent(updated, admin, type, order.status, toStatus, { ...details, ...(email ? { email } : {}) }, customerVisible);
    let emailResult = null;
    if (email) {
      try {
        const message = await queueEventEmail(updated, event);
        emailResult = { queued: true, state: message.state, id: String(message._id) };
      } catch (error) {
        logger.error(`Order ${updated._id} email ${email.kind} not queued: ${error.message}`);
        await Order.updateOne({ _id: updated._id }, { $set: { "email.lastError": String(error.message).slice(0, 200) } }).catch(() => {});
        emailResult = { queued: false, error: "Email could not be queued; retry from the order history" };
      }
    }
    return { order: updated, event, email: emailResult };
  };

  const statusEmail = (order, toStatus, message) =>
    STATUS_EMAILS[toStatus]
      ? { kind: "order_status", dedupeKey: `status:${order._id}:${toStatus}`, headline: STATUS_EMAILS[toStatus].headline, message: message || undefined }
      : null;

  // --- actions ---------------------------------------------------------------

  const sendPaymentInstructions = async (orderId, admin, body = {}) => {
    const order = await loadOrder(orderId);
    assertTransition(order, body.expectedStatus, S.AWAITING_PAYMENT);
    if (!paymentInstructions()) {
      throw new OrderError(409, "PAYMENT_CHANNEL_NOT_CONFIGURED", "Payment instructions are not configured on the server (ESCOWEAR_PAYMENT_INSTRUCTIONS)");
    }
    const quoteInput = body.quote || {};
    const fields = {};
    const amounts = {};
    ["subtotalMinor", "feesMinor", "shippingMinor", "dutiesMinor"].forEach((key) => {
      amounts[key] = minor(quoteInput[key]);
      if (amounts[key] === null) fields[`quote.${key}`] = "Enter a whole number of pesewas (0 or more)";
    });
    const expiresAt = date(quoteInput.expiresAt);
    if (!expiresAt || expiresAt <= now()) fields["quote.expiresAt"] = "Quote expiry must be in the future";
    const rateSnapshot = text(quoteInput.rateSnapshot, 200);
    if (rateSnapshot.length > 200) fields["quote.rateSnapshot"] = "Keep the rate note under 200 characters";
    const message = multiline(body.message, 2000);
    if (message.length > 2000) fields.message = "Keep the message under 2000 characters";
    if (Object.keys(fields).length) fail(fields);
    const totalMinor = amounts.subtotalMinor + amounts.feesMinor + amounts.shippingMinor + amounts.dutiesMinor;
    if (totalMinor <= 0 || !Number.isSafeInteger(totalMinor)) fail({ "quote.subtotalMinor": "The quote total must be more than zero" });

    const previousVersion = order.pricing?.finalGHS?.quoteVersion || 0;
    const quote = {
      currency: "GHS",
      ...amounts,
      totalMinor,
      rateSnapshot: rateSnapshot || undefined,
      quoteVersion: previousVersion + 1,
      quotedAt: now(),
      quotedBy: admin._id,
      expiresAt,
    };
    return transition({
      order,
      admin,
      toStatus: S.AWAITING_PAYMENT,
      set: { "pricing.finalGHS": quote, "payment.status": P.AWAITING_PAYMENT, "payment.reference": order.orderNumber },
      // Guards a concurrent re-quote racing on the same status.
      guard: { "pricing.finalGHS.quoteVersion": previousVersion || { $exists: false } },
      type: previousVersion ? "quote_revised" : "quote_sent",
      details: { quoteVersion: quote.quoteVersion, totalMinor, expiresAt },
      email: {
        kind: "payment_instructions",
        dedupeKey: `payment_instructions:${order._id}:v${quote.quoteVersion}`,
        message: message || undefined,
        snapshot: { pricing: { ...order.pricing, finalGHS: quote } },
      },
    });
  };

  const markAwaitingCustomer = async (orderId, admin, body = {}) => {
    const order = await loadOrder(orderId);
    assertTransition(order, body.expectedStatus, S.AWAITING_CUSTOMER);
    const note = multiline(body.note, 2000);
    if (!note || note.length > 2000) fail({ note: "Describe what you are waiting for from the customer" });
    return transition({ order, admin, toStatus: S.AWAITING_CUSTOMER, set: {}, type: "awaiting_customer", details: { note } });
  };

  const markPaymentReview = async (orderId, admin, body = {}) => {
    const order = await loadOrder(orderId);
    assertTransition(order, body.expectedStatus, S.PAYMENT_REVIEW);
    const note = multiline(body.note, 2000);
    if (note.length > 2000) fail({ note: "Keep the note under 2000 characters" });
    return transition({
      order,
      admin,
      toStatus: S.PAYMENT_REVIEW,
      set: { "payment.status": P.UNDER_REVIEW, "payment.reviewNote": note || undefined },
      type: "payment_proof_received",
      // The screenshot itself stays in the business mailbox; nothing is stored here.
      details: { note: note || undefined, proofChannel: "external_email" },
    });
  };

  const verifyPayment = async (orderId, admin, body = {}) => {
    const order = await loadOrder(orderId);
    assertTransition(order, body.expectedStatus, S.CONFIRMED);
    const quote = order.pricing?.finalGHS;
    if (!quote?.totalMinor) throw new OrderError(409, "NO_QUOTE", "Send a GHS quote before verifying payment");
    const fields = {};
    if (body.bankReceiptConfirmed !== true)
      fields.bankReceiptConfirmed = "Confirm you have seen the funds in the receiving account (a screenshot is not enough)";
    const amount = minor(body.amountReceivedGHSMinor);
    if (amount === null || amount === 0) fields.amountReceivedGHSMinor = "Enter the amount received in pesewas";
    const bankReference = text(body.bankReference, 100);
    if (bankReference.length < 2 || bankReference.length > 100) fields.bankReference = "Enter the bank transaction reference";
    const receivedAt = date(body.receivedAt);
    if (!receivedAt || receivedAt > now()) fields.receivedAt = "Enter when the funds were received (not in the future)";
    if (Object.keys(fields).length) fail(fields);
    if (amount !== quote.totalMinor) {
      throw new OrderError(422, "AMOUNT_MISMATCH", "The amount received does not match the quote. Record a payment issue instead.", {
        amountReceivedGHSMinor: `Quote total is ${quote.totalMinor} pesewas`,
      });
    }
    const verifiedAt = now();
    return transition({
      order,
      admin,
      toStatus: S.CONFIRMED,
      set: {
        "payment.status": P.VERIFIED,
        "payment.amountReceivedGHSMinor": amount,
        "payment.bankReference": bankReference,
        "payment.receivedAt": receivedAt,
        "payment.verifiedBy": admin._id,
        "payment.verifiedAt": verifiedAt,
      },
      type: "payment_verified",
      details: {
        amountReceivedGHSMinor: amount,
        bankReference,
        receivedAt,
        quoteVersion: quote.quoteVersion,
        receivedAfterQuoteExpiry: quote.expiresAt ? receivedAt > new Date(quote.expiresAt) : undefined,
      },
      email: {
        kind: "order_confirmed",
        dedupeKey: `order_confirmed:${order._id}`,
        snapshot: { payment: { ...order.payment, amountReceivedGHSMinor: amount } },
      },
    });
  };

  const recordPaymentIssue = async (orderId, admin, body = {}) => {
    const order = await loadOrder(orderId);
    assertTransition(order, body.expectedStatus, S.PAYMENT_ISSUE);
    const customerMessage = multiline(body.customerMessage, 2000);
    const note = multiline(body.note, 2000);
    const fields = {};
    if (customerMessage.length < 10 || customerMessage.length > 2000)
      fields.customerMessage = "Explain to the customer what is wrong and what to do next";
    if (note.length > 2000) fields.note = "Keep the note under 2000 characters";
    if (Object.keys(fields).length) fail(fields);
    const issueNumber = (await OrderEvent.countDocuments({ orderId: order._id, type: "payment_issue" })) + 1;
    return transition({
      order,
      admin,
      toStatus: S.PAYMENT_ISSUE,
      set: { "payment.status": P.REJECTED },
      type: "payment_issue",
      details: { note: note || undefined, issueNumber },
      email: { kind: "payment_issue", dedupeKey: `payment_issue:${order._id}:${issueNumber}`, message: customerMessage },
    });
  };

  const updateFulfilment = async (orderId, admin, body = {}) => {
    const order = await loadOrder(orderId);
    const toStatus = body.toStatus;
    if (!FULFILMENT_TARGETS.includes(toStatus)) fail({ toStatus: "Choose a fulfilment step" });
    assertTransition(order, body.expectedStatus, toStatus);
    if (order.payment?.status !== P.VERIFIED) throw new OrderError(409, "PAYMENT_NOT_VERIFIED", "Payment must be verified before fulfilment");
    const fields = {};
    const set = {};
    const details = {};
    if (toStatus === S.PROCESSING) {
      const supplierReference = text(body.supplierReference, 200);
      if (supplierReference.length > 200) fields.supplierReference = "Keep the supplier reference under 200 characters";
      if (supplierReference) set["fulfilment.supplierReference"] = supplierReference;
      set["fulfilment.purchaseRecordedAt"] = now();
      details.supplierReference = supplierReference || undefined;
    }
    if (toStatus === S.DISPATCHED) {
      const carrier = text(body.carrier, 100);
      const trackingNumber = text(body.trackingNumber, 100);
      const trackingUrl = optionalUrl(body.trackingUrl);
      if (carrier.length > 100) fields.carrier = "Keep the carrier under 100 characters";
      if (trackingNumber.length > 100) fields.trackingNumber = "Keep the tracking number under 100 characters";
      if (trackingUrl === null) fields.trackingUrl = "Enter a valid http(s) tracking link";
      Object.assign(set, {
        "fulfilment.carrier": carrier || undefined,
        "fulfilment.trackingNumber": trackingNumber || undefined,
        "fulfilment.trackingUrl": trackingUrl || undefined,
        "fulfilment.dispatchedAt": now(),
      });
      Object.assign(details, { carrier: carrier || undefined, trackingNumber: trackingNumber || undefined });
    }
    if (toStatus === S.DELIVERED) set["fulfilment.deliveredAt"] = now();
    const customerMessage = multiline(body.customerMessage, 2000);
    if (customerMessage.length > 2000) fields.customerMessage = "Keep the message under 2000 characters";
    if (toStatus === S.SOURCING_FAILED && !multiline(body.note, 2000)) fields.note = "Record why sourcing failed";
    if (Object.keys(fields).length) fail(fields);
    if (body.note) details.note = multiline(body.note, 2000);
    const cleanSet = Object.fromEntries(Object.entries(set).filter(([, value]) => value !== undefined));
    return transition({
      order,
      admin,
      toStatus,
      set: cleanSet,
      type: `fulfilment_${toStatus}`,
      details,
      email: statusEmail(order, toStatus, customerMessage),
    });
  };

  const cancelOrder = async (orderId, admin, body = {}) => {
    const order = await loadOrder(orderId);
    const paid = order.payment?.status === P.VERIFIED;
    const toStatus = paid ? S.REFUND_PENDING : S.CANCELLED;
    assertTransition(order, body.expectedStatus, toStatus);
    const reason = multiline(body.reason, 2000);
    const customerMessage = multiline(body.customerMessage, 2000);
    if (reason.length < 3 || reason.length > 2000) fail({ reason: "Record why the order is being cancelled" });
    return transition({
      order,
      admin,
      toStatus,
      set: paid ? { "payment.status": P.REFUND_PENDING } : {},
      type: paid ? "cancelled_refund_pending" : "cancelled",
      details: { reason },
      email: statusEmail(order, toStatus, customerMessage),
    });
  };

  const recordRefund = async (orderId, admin, body = {}) => {
    const order = await loadOrder(orderId);
    assertTransition(order, body.expectedStatus, S.REFUNDED);
    const refundReference = text(body.refundReference, 100);
    const amount = minor(body.amountRefundedGHSMinor);
    const fields = {};
    if (body.refundSentConfirmed !== true) fields.refundSentConfirmed = "Confirm the refund has actually been sent";
    if (refundReference.length < 2 || refundReference.length > 100) fields.refundReference = "Enter the refund transaction reference";
    if (amount === null || amount === 0) fields.amountRefundedGHSMinor = "Enter the amount refunded in pesewas";
    if (Object.keys(fields).length) fail(fields);
    return transition({
      order,
      admin,
      toStatus: S.REFUNDED,
      set: { "payment.status": P.REFUNDED, "payment.refundReference": refundReference, "payment.refundedAt": now() },
      type: "refunded",
      details: { refundReference, amountRefundedGHSMinor: amount, note: multiline(body.note, 2000) || undefined },
      email: statusEmail(order, S.REFUNDED, multiline(body.customerMessage, 2000)),
    });
  };

  const addNote = async (orderId, admin, body = {}) => {
    const order = await loadOrder(orderId);
    const note = multiline(body.body, 2000);
    if (!note || note.length > 2000) fail({ body: "Write a note (up to 2000 characters)" });
    await Order.updateOne(
      { _id: order._id },
      { $push: { internalNotes: { body: note, authorId: admin._id, createdAt: now() } } }
    );
    await recordEvent(order, admin, "note_added", undefined, undefined, { note }, false);
    return { ok: true };
  };

  // Re-queues the email described by a past event (e.g. after a queue outage).
  const requeueEventEmail = async (orderId, eventId, admin) => {
    const order = await loadOrder(orderId);
    if (!isObjectId(eventId)) throw new OrderError(404, "NOT_FOUND", "Event not found");
    const event = await OrderEvent.findOne({ _id: eventId, orderId: order._id }).lean();
    if (!event?.details?.email) throw new OrderError(404, "NOT_FOUND", "This event has no email");
    const message = await queueEventEmail(order, event);
    await recordEvent(order, admin, "email_requeued", undefined, undefined, { dedupeKey: event.details.email.dedupeKey }, false);
    return { queued: true, state: message.state, id: String(message._id) };
  };

  return {
    addNote,
    cancelOrder,
    markAwaitingCustomer,
    markPaymentReview,
    paymentChannelConfigured: () => Boolean(paymentInstructions()),
    recordPaymentIssue,
    recordRefund,
    requeueEventEmail,
    sendPaymentInstructions,
    updateFulfilment,
    verifyPayment,
  };
};

module.exports = { TRANSITIONS, allowedActions, canTransition, createOrderWorkflow };
