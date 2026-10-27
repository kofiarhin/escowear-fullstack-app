// Central order/payment state vocabulary shared by order, admin and tracking code.
const ORDER_STATUS = Object.freeze({
  PENDING_CONTACT: "pending_contact",
  AWAITING_CUSTOMER: "awaiting_customer",
  AWAITING_PAYMENT: "awaiting_payment",
  PAYMENT_REVIEW: "payment_review",
  PAYMENT_ISSUE: "payment_issue",
  CONFIRMED: "confirmed",
  PROCESSING: "processing",
  DISPATCHED: "dispatched",
  DELIVERED: "delivered",
  // Lost, damaged or wrong item reported: investigated and resolved manually.
  DELIVERY_ISSUE: "delivery_issue",
  COMPLETED: "completed",
  SOURCING_FAILED: "sourcing_failed",
  REFUND_PENDING: "refund_pending",
  REFUNDED: "refunded",
  CANCELLED: "cancelled",
});

const PAYMENT_STATUS = Object.freeze({
  NOT_REQUESTED: "not_requested",
  AWAITING_PAYMENT: "awaiting_payment",
  UNDER_REVIEW: "under_review",
  VERIFIED: "verified",
  REJECTED: "rejected",
  REFUND_PENDING: "refund_pending",
  REFUNDED: "refunded",
});

const EMAIL_STATE = Object.freeze({
  NOT_QUEUED: "not_queued",
  QUEUED: "queued",
  SENT: "sent",
  FAILED: "failed",
});

// Customer-facing wording never claims payment or confirmation before it happens.
const CUSTOMER_STATUS_LABELS = Object.freeze({
  [ORDER_STATUS.PENDING_CONTACT]: "Order received — awaiting our email",
  [ORDER_STATUS.AWAITING_CUSTOMER]: "Waiting for your reply",
  [ORDER_STATUS.AWAITING_PAYMENT]: "Quote ready — awaiting your payment",
  [ORDER_STATUS.PAYMENT_REVIEW]: "Payment submitted — under review",
  [ORDER_STATUS.PAYMENT_ISSUE]: "Payment needs attention",
  [ORDER_STATUS.CONFIRMED]: "Payment verified — order confirmed",
  [ORDER_STATUS.PROCESSING]: "Sourcing your order",
  [ORDER_STATUS.DISPATCHED]: "Dispatched",
  [ORDER_STATUS.DELIVERED]: "Delivered",
  [ORDER_STATUS.DELIVERY_ISSUE]: "Delivery issue — we are looking into it",
  [ORDER_STATUS.COMPLETED]: "Completed",
  [ORDER_STATUS.SOURCING_FAILED]: "Item unavailable — we will contact you",
  [ORDER_STATUS.REFUND_PENDING]: "Refund in progress",
  [ORDER_STATUS.REFUNDED]: "Refunded",
  [ORDER_STATUS.CANCELLED]: "Cancelled",
});

const customerStatusLabel = (status) =>
  CUSTOMER_STATUS_LABELS[status] || (status ? String(status) : "Unknown");

module.exports = {
  ORDER_STATUS,
  PAYMENT_STATUS,
  EMAIL_STATE,
  CUSTOMER_STATUS_LABELS,
  customerStatusLabel,
};
