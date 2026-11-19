const mongoose = require("mongoose");

// One singleton document ("homepage") holds the ordered Latest Releases
// selection. Only Product references are stored; catalogue details are
// resolved on every read so price, imagery and stock never go stale here.
// `version` is the compare-and-set token for admin saves. Until this document
// exists the homepage shows the newest catalogue products.
const homepageLatestReleasesSchema = new mongoose.Schema(
  {
    _id: { type: String },
    productIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }], default: [] },
    version: { type: Number, required: true, min: 1 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "homepageLatestReleases" }
);

module.exports = mongoose.model("HomepageLatestReleases", homepageLatestReleasesSchema);
