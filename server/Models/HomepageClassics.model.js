const mongoose = require("mongoose");

// One singleton document ("homepage") holds the ordered Classics cards. Each
// card stores only its own copy (title, search term) plus a Product reference;
// the representative product is resolved on every read so imagery never goes
// stale. `version` is the compare-and-set token for admin saves.
const classicEntrySchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    searchTerm: { type: String, required: true, trim: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  },
  { _id: false }
);

const homepageClassicsSchema = new mongoose.Schema(
  {
    _id: { type: String },
    entries: { type: [classicEntrySchema], default: [] },
    version: { type: Number, required: true, min: 1 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "homepageClassics" }
);

module.exports = mongoose.model("HomepageClassics", homepageClassicsSchema);
