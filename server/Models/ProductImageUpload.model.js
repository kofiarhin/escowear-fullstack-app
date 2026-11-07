const mongoose = require("mongoose");

// Server-side ownership ledger for Cloudinary uploads. Product documents only
// retain the safe delivery URL and public id; this collection lets the API
// reject guessed public ids and clean up abandoned uploads later.
const productImageUploadSchema = new mongoose.Schema(
  {
    publicId: { type: String, required: true, unique: true },
    secureUrl: { type: String, required: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    orphanedAt: { type: Date, default: null, index: true },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true, collection: "productImageUploads" }
);

module.exports = mongoose.model("ProductImageUpload", productImageUploadSchema);
