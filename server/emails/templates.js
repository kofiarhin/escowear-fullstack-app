// Plain-text transactional email templates. Rendered once when the message is
// queued so the sent content always matches the committed order state.
// Bank/payment-channel details are never in source: they come from private
// server configuration (ESCOWEAR_PAYMENT_INSTRUCTIONS) at send-queue time.

const TEMPLATE_VERSION = "2026-10-21.1";

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

const signOff = ["", "Thank you,", "EscoWear"];

const templates = {
  order_received: ({ order, baseUrl }) => ({
    subject: `EscoWear order received — #${order.orderNumber}`,
    text: [
      `Hi ${order.customer.name},`,
      "",
      `We have received your order #${order.orderNumber}.`,
      "",
      "This is not a payment request and your order is not yet confirmed.",
      "We will check availability and costs, then email you the final amount in Ghana cedis (GHS) with payment instructions.",
      "",
      "Items:",
      ...itemLines(order),
      "",
      `Indicative subtotal: ${formatMinor(order.pricing.subtotalGBPMinor, "GBP")} (estimate in GBP only)`,
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

  payment_instructions: ({ order, baseUrl, paymentInstructions, message }) => {
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
        "",
        "How to pay:",
        paymentInstructions,
        "",
        `Use this payment reference: ${order.orderNumber}`,
        "",
        "After paying, reply to this email with a screenshot of your payment.",
        "We will confirm your order only after the funds are verified in our account.",
        "If the quote expires before payment, reply and we will send an updated quote.",
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
      "Please reply to this email if you have any questions.",
      "",
      trackingLine(order, baseUrl),
      ...signOff,
    ].join("\n"),
  }),

  order_confirmed: ({ order, baseUrl }) => ({
    subject: `EscoWear order confirmed — #${order.orderNumber}`,
    text: [
      `Hi ${order.customer.name},`,
      "",
      `We have verified your payment of ${formatMinor(order.payment.amountReceivedGHSMinor, "GHS")} for order #${order.orderNumber}.`,
      "Your order is confirmed and we are now sourcing your items. We will email you when it is dispatched.",
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
      ...(order.fulfilment?.carrier ? ["", `Carrier: ${order.fulfilment.carrier}`] : []),
      ...(order.fulfilment?.trackingNumber ? [`Tracking number: ${order.fulfilment.trackingNumber}`] : []),
      ...(order.fulfilment?.trackingUrl ? [`Carrier tracking: ${order.fulfilment.trackingUrl}`] : []),
      "",
      trackingLine(order, baseUrl),
      ...signOff,
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
