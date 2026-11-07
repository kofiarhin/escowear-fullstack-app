// Removes Cloudinary assets orphaned for at least 24 hours. This is deliberately
// opt-in: preview first, then schedule `--apply` in an approved maintenance job.
require("dotenv").config();
const { connectDB } = require("../db/db");
const Product = require("../Models/Product.model");
const ProductImageUpload = require("../Models/ProductImageUpload.model");
const { createProductImageStorage } = require("../services/productImageStorage");

const apply = process.argv.includes("--apply");
const run = async () => {
  await connectDB();
  const storage = createProductImageStorage();
  const candidates = await ProductImageUpload.find({ orphanedAt: { $ne: null }, expiresAt: { $lte: new Date() } }).limit(100).lean();
  let removed = 0;
  for (const upload of candidates) {
    if (await Product.countDocuments({ "managedImages.publicId": upload.publicId })) continue;
    if (!apply) { console.log(`Would remove ${upload.publicId}`); continue; }
    if (await storage.destroy(upload.publicId)) { await ProductImageUpload.deleteOne({ _id: upload._id }); removed += 1; }
  }
  console.log(apply ? `Removed ${removed} orphaned product image upload(s)` : `Found ${candidates.length} expired orphaned product image upload(s); rerun with --apply to remove`);
};
run().then(() => process.exit(0)).catch((error) => { console.error(`Product image cleanup failed: ${error.message}`); process.exit(1); });
