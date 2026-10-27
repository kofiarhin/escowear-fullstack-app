// IDE-126: email wording follows the agreed MVP policies; the policy promises
// stay out of emails until ESCOWEAR_POLICIES_STATUS=published.
const test = require("node:test");
const assert = require("node:assert/strict");
const { renderEmail } = require("../emails/templates");
const { getOrderConfig } = require("../config/orders");

const order = {
  orderNumber: "EW-AAAAA-BBBBB",
  customer: { name: "Ama" },
  items: [{ name: "Shoe", size: "UK 9", quantity: 1, lineTotalGBPMinor: 10000 }],
  pricing: {
    subtotalGBPMinor: 10000,
    finalGHS: { subtotalMinor: 150000, feesMinor: 0, shippingMinor: 30000, dutiesMinor: 20000, totalMinor: 200000, expiresAt: "2026-10-25T12:00:00.000Z" },
  },
  shippingAddress: { recipient: "Ama", line1: "1 Road", city: "Accra", region: "Greater Accra" },
};
const instructions = (policiesPublished) =>
  renderEmail("payment_instructions", { order, baseUrl: "https://escowear.com", paymentInstructions: "MTN Mobile Money\nNumber: TEST", policiesPublished }).text;

test("payment instructions: MoMo reference, exact amount, Ghana-time expiry and re-quote rule", () => {
  const text = instructions(false);
  assert.match(text, /GH₵2,000\.00|GHS\s?2,000\.00/);
  assert.match(text, /valid until 25 Oct 2026, 12:00 \(Ghana time\)/);
  assert.match(text, /Send the exact amount above and use your order number as the payment reference: EW-AAAAA-BBBBB/);
  assert.match(text, /If this quote expires before you pay, please reply to ask for an updated quote before paying\./);
  assert.match(text, /only after we have checked that the money has arrived in our account/);
});

test("policy promises are absent while unpublished and present once published", () => {
  const draft = instructions(false);
  assert.doesNotMatch(draft, /nothing extra|anything extra on arrival|Delivery is confirmed individually|\/policies/);
  const published = instructions(true);
  assert.match(published, /This total includes shipping, import duties, taxes and delivery\. You won't pay anything extra on arrival\./);
  assert.match(published, /Delivery is confirmed individually after ordering\./);
  assert.doesNotMatch(published, /10–21 days|support@escowear\.com/);
  assert.match(published, /Shop policies: https:\/\/escowear\.com\/policies/);

  const receivedDraft = renderEmail("order_received", { order, baseUrl: "https://escowear.com", policiesPublished: false }).text;
  const receivedPublished = renderEmail("order_received", { order, baseUrl: "https://escowear.com", policiesPublished: true }).text;
  assert.doesNotMatch(receivedDraft, /Delivery is confirmed individually|\/policies/);
  assert.match(receivedPublished, /won't pay anything extra on arrival/);
  assert.match(receivedPublished, /Delivery is confirmed individually after ordering\./);
  assert.doesNotMatch(receivedPublished, /10–21 days/);
});

test("ESCOWEAR_POLICIES_STATUS defaults to unpublished", () => {
  assert.equal(getOrderConfig({}).policiesPublished, false);
  assert.equal(getOrderConfig({ ESCOWEAR_POLICIES_STATUS: "draft" }).policiesPublished, false);
  // Match the build-time policy switch exactly, so site and emails agree.
  assert.equal(getOrderConfig({ ESCOWEAR_POLICIES_STATUS: "Published" }).policiesPublished, false);
  assert.equal(getOrderConfig({ ESCOWEAR_POLICIES_STATUS: "published" }).policiesPublished, true);
});
