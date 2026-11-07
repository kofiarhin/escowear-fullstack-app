const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { prepareProductImage, createProductImageStorage } = require("../services/productImageStorage");

test("product image processing accepts real PNG bytes, strips metadata and normalizes to WebP", async () => {
  const png = await sharp({ create: { width: 120, height: 90, channels: 3, background: "#336699" } }).png().toBuffer();
  const processed = await prepareProductImage(png);
  assert.equal((await sharp(processed.buffer).metadata()).format, "webp");
  assert.equal(processed.width, 120);
  await assert.rejects(() => prepareProductImage(Buffer.from("not an image")), (error) => error.status === 415);
});

test("Cloudinary storage only accepts a trusted returned delivery URL", async () => {
  const png = await sharp({ create: { width: 80, height: 80, channels: 3, background: "#445566" } }).png().toBuffer();
  const storage = createProductImageStorage({ env: { CLOUDINARY_CLOUD_NAME: "demo", CLOUDINARY_API_KEY: "key", CLOUDINARY_API_SECRET: "secret" }, fetchImpl: async () => ({ ok: true, json: async () => ({ public_id: "wrong", secure_url: "https://attacker.example/image.webp" }) }) });
  await assert.rejects(() => storage.upload(png), (error) => error.status === 502 && error.code === "IMAGE_STORAGE_FAILED");
});
