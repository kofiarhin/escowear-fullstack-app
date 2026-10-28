// Plain-text transactional email templates. Rendered once when the message is
// queued so the sent content always matches the committed order state.
// Bank/payment-channel details are never in source: they come from private
// server configuration (ESCOWEAR_PAYMENT_INSTRUCTIONS) at send-queue time.

const TEMPLATE_VERSION = "2026-10-27.1";
const { business } = require("../../client/src/policies/review.json");
const { ORDER_STATUS: S } = require("../services/orderStatus");

const formatMinor = (minor, currency) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);

const formatDate = (value) =>
  new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Accra" }) +
  " (Ghana time)";

const trackingLine = (order, baseUrl) =>
  baseUrl
    ? `Track your order: ${baseUrl}/track-order?order=${encodeURIComponent(order.orderNumber)}`
    : `Track your order on our website using order number ${order.orderNumber} and this email address.`;

const itemLines = (order) =>
  (order.items || []).map(
    (item) =>
      `- ${item.name} (${item.size}) x${item.quantity} — ${formatMinor(item.lineTotalGBPMinor, "GBP")}`
  );

// Every message comes from, and replies go to, the one configured support
// mailbox (EMAIL_FROM / EMAIL_REPLY_TO), so "reply to this email" is the contact.
const signOff = ["", "Questions? Just reply to this email.", "", "Thank you,", "EscoWear"];

const formatDay = (value) =>
  new Date(value).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "Africa/Accra" });

const estimateLine = (order) =>
  order.fulfilment?.estimatedDeliveryAt ? [`Estimated delivery: ${formatDay(order.fulfilment.estimatedDeliveryAt)}`] : [];

// Where to pay and upload proof. No access token is ever put in a link.
const paymentPageLine = (order, baseUrl) =>
  baseUrl
    ? `Open your order to see these details and upload your payment screenshot: ${baseUrl}/track-order?order=${encodeURIComponent(order.orderNumber)}`
    : `On our website, open "Track order" with order number ${order.orderNumber} and this email address to upload your payment screenshot.`;

// Statuses where the parcel is still on its way to the customer.
const EN_ROUTE = new Set([S.PROCESSING, S.DISPATCHED]);
// Visible tail of a masked reference ("••••1234" → "1234"); empty when fully masked.
const referenceEnding = (masked) => String(masked || "").replace(/•/g, "");

// Policy promises appear in emails only once the reviewed policies are
// published (ESCOWEAR_POLICIES_STATUS=published).
const DELIVERY_DETAILS = business.delivery;
const policyLines = (published, baseUrl, lines) =>
  published ? ["", ...lines, ...(baseUrl ? [`Shop policies: ${baseUrl}/policies`] : [])] : [];

const templates = {
  order_received: ({ order, baseUrl, policiesPublished }) => ({
    subject: `EscoWear order received — #${order.orderNumber}`,
    text: [
      `Hi ${order.customer.name},`,
      "",
      `We have received your order #${order.orderNumber}.`,
      "",
      "This is not a payment request and your order is not yet confirmed.",
      "We will check availability and costs, then email you the final amount in Ghana cedis (GHS) with Mobile Money payment instructions.",
      "After paying, you will upload your payment screenshot and transaction ID on our website.",
      "",
      "Items:",
      ...itemLines(order),
      "",
      `Indicative subtotal: ${formatMinor(order.pricing.subtotalGBPMinor, "GBP")} (estimate in GBP only)`,
      ...policyLines(policiesPublished, baseUrl, [
        "Your final GHS quote will include shipping, import duties, taxes and delivery, so you won't pay anything extra on arrival.",
        DELIVERY_DETAILS,
      ]),
      "",
      "Delivery to:",
      order.shippingAddress.recipient,
      order.shippingAddress.line1,
      ...(order.shippingAddress.line2 ? [order.shippingAddress.line2] : []),
      ...(order.shippingAddress.landmark ? [`Landmark: ${order.shippingAddress.landmark}`] : []),
      `${order.shippingAddress.city}, ${order.shippingAddress.region}, Ghana`,
      "",
      trackingLine(order, baseUrl),
      ...signOff,
    ].join("\n"),
  }),

  payment_instructions: ({ order, baseUrl, paymentInstructions, message, policiesPublished }) => {
    const quote = order.pricing.finalGHS;
    return {
      subject: `EscoWear payment details — #${order.orderNumber}`,
      text: [
        `Hi ${order.customer.name},`,
        "",
        `Good news — we have checked availability for order #${order.orderNumber}.`,
        "",
        `Amount to pay: ${formatMinor(quote.totalMinor, "GHS")}`,
        `  Items: ${formatMinor(quote.subtotalMinor, "GHS")}`,
        `  Fees: ${formatMinor(quote.feesMinor, "GHS")}`,
        `  Shipping: ${formatMinor(quote.shippingMinor, "GHS")}`,
        `  Duties: ${formatMinor(quote.dutiesMinor, "GHS")}`,
        `This quote is valid until ${formatDate(quote.expiresAt)}.`,
        ...estimateLine(order),
        ...policyLines(policiesPublished, null, [
          "This total includes shipping, import duties, taxes and delivery. You won't pay anything extra on arrival.",
        ]),
        "",
        "How to pay:",
        paymentInstructions,
        "",
        `Send the exact amount above and use your order number as the payment reference: ${order.orderNumber}`,
        "",
        "After paying:",
        "1. Take a screenshot of the Mobile Money confirmation.",
        "2. " + paymentPageLine(order, baseUrl),
        "3. Enter the transaction ID from your payment message and submit.",
        "",
        "Uploading a screenshot does not confirm your order. We confirm it only after we have checked that the money has arrived in our account.",
        "If this quote expires before you pay, please reply to ask for an updated quote before paying.",
        ...policyLines(policiesPublished, baseUrl, [DELIVERY_DETAILS]),
        ...(message ? ["", message] : []),
        "",
        trackingLine(order, baseUrl),
        ...signOff,
      ].join("\n"),
    };
  },

  payment_issue: ({ order, baseUrl, message }) => ({
    subject: `Action needed on your EscoWear payment — #${order.orderNumber}`,
    text: [
      `Hi ${order.customer.name},`,
      "",
      `We could not verify the payment for order #${order.orderNumber} yet.`,
      "",
      message,
      "",
      "Your order is not confirmed and we will not buy your items until this is resolved.",
      "If we ask you to, you can upload a new screenshot and transaction ID from your order page.",
      paymentPageLine(order, baseUrl),
      ...signOff,
    ].join("\n"),
  }),

  order_confirmed: ({ order, baseUrl }) => ({
    subject: `EscoWear order confirmed — #${order.orderNumber}`,
    text: [
      `Hi ${order.customer.name},`,
      "",
      `We have verified your payment of ${formatMinor(order.payment.amountReceivedGHSMinor, "GHS")} for order #${order.orderNumber}.`,
      "Your order is confirmed. We will now buy your items from the UK retailer and email you when they are dispatched to Ghana.",
      ...estimateLine(order),
      "",
      trackingLine(order, baseUrl),
      ...signOff,
    ].join("\n"),
  }),

  order_status: ({ order, baseUrl, headline, message }) => ({
    subject: `EscoWear order update — #${order.orderNumber}`,
    text: [
      `Hi ${order.customer.name},`,
      "",
      `${headline} (order #${order.orderNumber}).`,
      ...(message ? ["", message] : []),
      // Only while the order is on its way; never on cancellation, refund or issue emails.
      ...(EN_ROUTE.has(order.status) && order.fulfilment?.estimatedDeliveryAt ? ["", ...estimateLine(order)] : []),
      ...(order.fulfilment?.carrier ? ["", `Carrier: ${order.fulfilment.carrier}`] : []),
      ...(order.fulfilment?.trackingNumber ? [`Tracking number: ${order.fulfilment.trackingNumber}`] : []),
      ...(order.fulfilment?.trackingUrl ? [`Carrier tracking: ${order.fulfilment.trackingUrl}`] : []),
      "",
      trackingLine(order, baseUrl),
      ...signOff,
    ].join("\n"),
  }),

  payment_proof_received: ({ order, baseUrl, referenceMasked, submittedAt }) => ({
    subject: `EscoWear payment proof received — #${order.orderNumber}`,
    text: [
      `Hi ${order.customer.name},`,
      "",
      `We have received your payment screenshot for order #${order.orderNumber}${referenceEnding(referenceMasked) ? ` (transaction ID ending ${referenceEnding(referenceMasked)})` : ""}.`,
      `Submitted: ${formatDate(submittedAt || new Date())}`,
      "",
      "Your payment is now under review. Your order is NOT confirmed yet.",
      "We will check that the money has arrived in our Mobile Money account, then email you to confirm your order.",
      "",
      trackingLine(order, baseUrl),
      ...signOff,
    ].join("\n"),
  }),

  // Operations notice. Never contains the screenshot, the full reference or customer contact details.
  payment_proof_admin_notice: ({ order, baseUrl, referenceMasked, duplicateReference }) => ({
    subject: `New payment proof to review — #${order.orderNumber}`,
    text: [
      `A customer uploaded payment proof for order #${order.orderNumber} (reference ${referenceMasked}).`,
      `Quote total: ${formatMinor(order.pricing.finalGHS.totalMinor, "GHS")}`,
      ...(duplicateReference ? ["", "WARNING: this transaction reference was also used on another order."] : []),
      "",
      "Check the receiving Mobile Money account before verifying. A screenshot is never proof of payment.",
      ...(baseUrl ? [`Review: ${baseUrl}/admin/orders/${order._id}`] : []),
    ].join("\n"),
  }),

  tracking_code: ({ order, code, ttlMinutes }) => ({
    subject: `Your EscoWear tracking code — #${order.orderNumber}`,
    text: [
      `Your code to view order #${order.orderNumber} is: ${code}`,
      "",
      `It expires in ${ttlMinutes} minutes and can be used once.`,
      "If you did not request this, you can ignore this email.",
      ...signOff,
    ].join("\n"),
  }),
};

const renderEmail = (kind, context) => {
  const template = templates[kind];
  if (!template) throw new Error(`Unknown email template ${kind}`);
  return { ...template(context), templateVersion: TEMPLATE_VERSION };
};

module.exports = { TEMPLATE_VERSION, formatMinor, renderEmail };
