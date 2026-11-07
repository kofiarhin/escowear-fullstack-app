const crypto = require("crypto");
const sharp = require("sharp");
const { ProofImageError, sniffFormat, MAX_INPUT_PIXELS } = require("./proofImage");

const MAX_BYTES = 5 * 1024 * 1024;
const CLOUDINARY_HOST = "res.cloudinary.com";

const configuration = (env = process.env) => ({
  cloudName: env.CLOUDINARY_CLOUD_NAME,
  apiKey: env.CLOUDINARY_API_KEY,
  apiSecret: env.CLOUDINARY_API_SECRET,
  folder: env.CLOUDINARY_PRODUCT_FOLDER || "escowear/manual-products",
});

const configured = (env) => {
  const config = configuration(env);
  return Boolean(config.cloudName && config.apiKey && config.apiSecret);
};

const prepareProductImage = async (buffer) => {
  const format = sniffFormat(buffer);
  if (!format) throw new ProofImageError(415, "UNSUPPORTED_IMAGE", "Upload a JPEG, PNG or WebP image");
  try {
    const options = { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", animated: false };
    const metadata = await sharp(buffer, options).metadata();
    if (metadata.format !== format || !metadata.width || !metadata.height || metadata.width * metadata.height > MAX_INPUT_PIXELS) throw new Error("invalid image");
    const output = await sharp(buffer, options).rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).webp({ quality: 86 }).toBuffer({ resolveWithObject: true });
    return { buffer: output.data, width: output.info.width, height: output.info.height };
  } catch (error) {
    if (error instanceof ProofImageError) throw error;
    throw new ProofImageError(422, "UNREADABLE_IMAGE", "We could not read that image. Choose a valid JPEG, PNG or WebP file.");
  }
};

const deliveryUrlIsTrusted = (url, cloudName) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === CLOUDINARY_HOST && parsed.pathname.startsWith(`/${cloudName}/`);
  } catch { return false; }
};

const createProductImageStorage = ({ env = process.env, fetchImpl = global.fetch } = {}) => ({
  configured: () => configured(env),
  async upload(buffer) {
    const config = configuration(env);
    if (!configured(env)) {
      const error = new Error("Cloudinary product image storage is not configured");
      error.status = 503; error.code = "IMAGE_STORAGE_UNAVAILABLE";
      throw error;
    }
    const image = await prepareProductImage(buffer);
    const timestamp = Math.floor(Date.now() / 1000);
    const assetId = crypto.randomBytes(18).toString("hex");
    const publicId = `${config.folder}/${assetId}`;
    const signature = crypto.createHash("sha1").update(`folder=${config.folder}&public_id=${assetId}&timestamp=${timestamp}${config.apiSecret}`).digest("hex");
    const form = new FormData();
    form.set("file", new Blob([image.buffer], { type: "image/webp" }), "product.webp");
    form.set("api_key", config.apiKey); form.set("timestamp", String(timestamp)); form.set("folder", config.folder); form.set("public_id", assetId); form.set("signature", signature);
    let response;
    try { response = await fetchImpl(`https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/upload`, { method: "POST", body: form }); } catch {
      const error = new Error("Image storage is unavailable"); error.status = 503; error.code = "IMAGE_STORAGE_UNAVAILABLE"; throw error;
    }
    if (!response.ok) { const error = new Error("Image storage rejected the upload"); error.status = 502; error.code = "IMAGE_STORAGE_FAILED"; throw error; }
    const result = await response.json().catch(() => null);
    if (!result || typeof result.public_id !== "string" || typeof result.secure_url !== "string" || result.public_id !== publicId || !deliveryUrlIsTrusted(result.secure_url, config.cloudName)) {
      const error = new Error("Image storage returned an invalid asset"); error.status = 502; error.code = "IMAGE_STORAGE_FAILED"; throw error;
    }
    return { publicId: result.public_id, secureUrl: result.secure_url, width: image.width, height: image.height };
  },
  async destroy(publicId) {
    const config = configuration(env);
    if (!configured(env) || typeof publicId !== "string") return false;
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHash("sha1").update(`public_id=${publicId}&timestamp=${timestamp}${config.apiSecret}`).digest("hex");
    const form = new URLSearchParams({ public_id: publicId, timestamp: String(timestamp), api_key: config.apiKey, signature });
    try {
      const response = await fetchImpl(`https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/destroy`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
      const result = response.ok ? await response.json().catch(() => null) : null;
      return result?.result === "ok" || result?.result === "not found";
    } catch { return false; }
  },
});

module.exports = { MAX_BYTES, createProductImageStorage, deliveryUrlIsTrusted, prepareProductImage };
