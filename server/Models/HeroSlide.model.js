const mongoose = require("mongoose");

// This collection deliberately stores presentation choices only. Catalogue
// details remain on Product and are resolved when the slide is read.
const heroSlideSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    headline: { type: String, required: true, trim: true, minlength: 1, maxlength: 90 },
    description: { type: String, default: "", trim: true, maxlength: 180 },
    desktopImage: { type: String, default: "", maxlength: 2048 },
    mobileImage: { type: String, default: "", maxlength: 2048 },
    order: { type: Number, required: true, min: 0, max: 999 },
    isActive: { type: Boolean, default: false },
  },
  { timestamps: true, collection: "heroSlides" }
);

heroSlideSchema.index({ isActive: 1, order: 1, _id: 1 }, { name: "hero_public_order" });
heroSlideSchema.index({ order: 1, _id: 1 }, { name: "hero_admin_order" });
heroSlideSchema.index({ productId: 1 }, { name: "unique_hero_product", unique: true });

module.exports = mongoose.model("HeroSlide", heroSlideSchema);
