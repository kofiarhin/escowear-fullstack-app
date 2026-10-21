const mongoose = require("mongoose");

const { Schema } = mongoose;

// Legacy orders only have user/products/status. Every new field is optional at
// the schema level so those records stay readable without a migration.
const legacyProductSchema = new Schema(
  {
    productId: Schema.Types.ObjectId,
    size: String,
    name: String,
    price: Number,
  },
  { _id: true }
);

const minorUnits = { type: Number, min: 0, validate: Number.isSafeInteger };

const itemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    brand: String,
    image: String,
    size: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    unitPriceGBPMinor: { ...minorUnits, required: true },
    lineTotalGBPMinor: { ...minorUnits, required: true },
    retailerSnapshot: {
      slug: String,
      name: String,
      productUrl: String,
    },
  },
  { _id: false }
);

const finalQuoteSchema = new Schema(
  {
    currency: { type: String, default: "GHS" },
    subtotalMinor: minorUnits,
    feesMinor: minorUnits,
    shippingMinor: minorUnits,
    dutiesMinor: minorUnits,
    totalMinor: minorUnits,
    rateSnapshot: String,
    quoteVersion: { type: Number, min: 1 },
    quotedAt: Date,
    quotedBy: { type: Schema.Types.ObjectId, ref: "User" },
    expiresAt: Date,
  },
  { _id: false }
);

const orderSchema = new Schema(
  {
    // Legacy fields (kept as-is).
    user: { type: Schema.Types.ObjectId, ref: "User" },
    products: { type: [legacyProductSchema], default: undefined },
    status: { type: String, default: "Pending" },

    // Guest checkout fields.
    orderNumber: { type: String, immutable: true },
    source: { type: String, immutable: true },
    customer: {
      name: String,
      email: String,
      emailNormalized: String,
      phone: String,
    },
    shippingAddress: {
      recipient: String,
      phone: String,
      line1: String,
      line2: String,
      landmark: String,
      city: String,
      region: String,
      country: String,
    },
    items: { type: [itemSchema], default: undefined },
    pricing: {
      currency: String,
      subtotalGBPMinor: minorUnits,
      estimatedOnly: Boolean,
      finalGHS: { type: finalQuoteSchema, default: undefined },
    },
    payment: {
      method: String,
      status: String,
      reference: String,
      amountReceivedGHSMinor: minorUnits,
      bankReference: String,
      receivedAt: Date,
      verifiedBy: { type: Schema.Types.ObjectId, ref: "User" },
      verifiedAt: Date,
      reviewNote: String,
      refundReference: String,
      refundedAt: Date,
    },
    fulfilment: {
      supplierReference: String,
      purchaseRecordedAt: Date,
      carrier: String,
      trackingNumber: String,
      trackingUrl: String,
      dispatchedAt: Date,
      deliveredAt: Date,
    },
    email: {
      acknowledgementState: String,
      paymentInstructionState: String,
      confirmationState: String,
      lastError: String,
    },
    termsVersion: { type: String, immutable: true },
    // Hash only; the raw key never leaves the request.
    idempotencyKeyHash: { type: String, immutable: true, select: false },
    requestFingerprint: { type: String, immutable: true, select: false },
    // Never serialized to customers.
    internalNotes: {
      type: [
        new Schema(
          {
            body: String,
            authorId: { type: Schema.Types.ObjectId, ref: "User" },
            createdAt: { type: Date, default: Date.now },
          },
          { _id: true }
        ),
      ],
      default: undefined,
      select: false,
    },
  },
  { timestamps: true }
);

const stringPresent = (field) => ({ [field]: { $type: "string" } });

orderSchema.index(
  { orderNumber: 1 },
  { name: "unique_order_number", unique: true, partialFilterExpression: stringPresent("orderNumber") }
);
orderSchema.index(
  { idempotencyKeyHash: 1 },
  {
    name: "unique_order_idempotency_key",
    unique: true,
    partialFilterExpression: stringPresent("idempotencyKeyHash"),
  }
);
orderSchema.index({ "customer.emailNormalized": 1, createdAt: -1 }, { name: "customer_email_created" });
orderSchema.index({ user: 1, createdAt: -1 }, { name: "user_created" });
orderSchema.index({ status: 1, createdAt: -1 }, { name: "status_created" });

const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);

module.exports = Order;
