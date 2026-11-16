const mongoose = require("mongoose");

// One singleton document ("homepage") holds the ordered selection. Only
// Product references are stored; catalogue details are resolved on every read
// so price, imagery and stock never go stale here. `version` is the
// compare-and-set token for admin saves.
const featuredSneakersSchema = new mongoose.Schema(
  {
    _id: { type: String },
    productIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }], default: [] },
    version: { type: Number, required: true, min: 1 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "featuredSneakers" }
);

module.exports = mongoose.model("FeaturedSneakers", featuredSneakersSchema);
