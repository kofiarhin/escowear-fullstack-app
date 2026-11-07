const mongoose = require("mongoose");

const retailerSchema = new mongoose.Schema(
  {
    slug: String,
    name: String,
  },
  { _id: false }
);

const sourceSchema = new mongoose.Schema(
  {
    provider: String,
    productId: String,
    canonicalKey: String,
    category: String,
  },
  { _id: false }
);

const managedImageSchema = new mongoose.Schema(
  {
    publicId: { type: String, required: true },
    secureUrl: { type: String, required: true },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    // Legacy imported documents retain title; no migration is required.
    title: String,
    name: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
    },
    sizes: [String],
    sizesRaw: [String],
    color: String,
    colors: [String],
    category: String,
    currency: {
      type: String,
      default: "GBP",
    },
    originalPrice: Number,
    discountPercent: Number,
    image: String,
    images: [String],
    brand: String,
    retailer: retailerSchema,
    productUrl: String,
    saleUrl: String,
    gender: String,
    inStock: Boolean,
    status: String,
    source: sourceSchema,
    sourceLastSeenAt: Date,
    // Manual drafts intentionally permit incomplete catalogue fields. Imported
    // products retain their historical required validation contract.
    description: { type: String, maxlength: 2000 },
    managedImages: [managedImageSchema],
  },
  {
    timestamps: true,
  }
);

for (const field of ["name", "price"]) {
  productSchema.path(field).required(function requiredProductField() {
    return this.status === "active" || this.source?.provider !== "manual";
  });
}

productSchema.index(
  { "source.provider": 1, "source.canonicalKey": 1 },
  {
    name: "unique_source_product",
    unique: true,
    partialFilterExpression: {
      "source.provider": { $type: "string" },
      "source.canonicalKey": { $type: "string" },
    },
  }
);

const Product = mongoose.model("Product", productSchema);

module.exports = Product;
