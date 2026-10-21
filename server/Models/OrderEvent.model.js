const mongoose = require("mongoose");

const { Schema } = mongoose;

// Append-only audit trail. Never store screenshots, credentials or bank account
// numbers in `details`; callers pass already-sanitized values.
const orderEventSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, immutable: true },
    actorType: {
      type: String,
      enum: ["system", "admin", "customer"],
      required: true,
      immutable: true,
    },
    actorId: { type: Schema.Types.ObjectId, ref: "User", immutable: true },
    type: { type: String, required: true, immutable: true },
    fromStatus: { type: String, immutable: true },
    toStatus: { type: String, immutable: true },
    // Customer-visible events appear in tracking history; the rest are admin-only.
    customerVisible: { type: Boolean, default: false, immutable: true },
    details: { type: Schema.Types.Mixed, immutable: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

orderEventSchema.index({ orderId: 1, createdAt: 1 }, { name: "order_created" });

const blockMutation = function () {
  throw new Error("Order events are append-only");
};
["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete", "findOneAndRemove"].forEach(
  (operation) => orderEventSchema.pre(operation, blockMutation)
);

const OrderEvent = mongoose.models.OrderEvent || mongoose.model("OrderEvent", orderEventSchema);

module.exports = OrderEvent;
