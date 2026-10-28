// Validates an uploaded payment screenshot and re-encodes it to clean bytes.
// The declared filename/content type are ignored: the format comes from the
// file's magic bytes and must decode fully as that same format. Re-encoding
// drops EXIF/GPS and any appended or embedded non-image payload (polyglots).
const sharp = require("sharp");

const FORMATS = {
  jpeg: { contentType: "image/jpeg", extension: "jpg" },
  png: { contentType: "image/png", extension: "png" },
  webp: { contentType: "image/webp", extension: "webp" },
};

// Decompression-bomb guard: refuse images larger than this many pixels.
const MAX_INPUT_PIXELS = 40 * 1000 * 1000;
const MIN_DIMENSION = 50;
// Long screenshots are kept readable; larger photos are scaled down.
const MAX_OUTPUT = { width: 2000, height: 6000 };

class ProofImageError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const sniffFormat = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buffer.toString("latin1", 0, 4) === "RIFF" && buffer.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
};

const unsupported = () => new ProofImageError(415, "UNSUPPORTED_IMAGE", "Upload a JPEG, PNG or WebP screenshot of your payment");
const unreadable = () => new ProofImageError(422, "UNREADABLE_IMAGE", "We couldn't read that image. Take a new screenshot and try again.");

const processProofImage = async (buffer) => {
  const format = sniffFormat(buffer);
  if (!format) throw unsupported();
  const options = { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", animated: false };
  let metadata;
  try {
    metadata = await sharp(buffer, options).metadata();
  } catch (error) {
    if (/pixel limit/i.test(error.message)) throw new ProofImageError(413, "IMAGE_TOO_LARGE", "That image is too large. Upload a normal screenshot.");
    throw unreadable();
  }
  if (metadata.format !== format) throw unsupported();
  if (!metadata.width || !metadata.height || metadata.width < MIN_DIMENSION || metadata.height < MIN_DIMENSION) throw unreadable();
  if (metadata.width * metadata.height > MAX_INPUT_PIXELS) {
    throw new ProofImageError(413, "IMAGE_TOO_LARGE", "That image is too large. Upload a normal screenshot.");
  }

  let output;
  try {
    let pipeline = sharp(buffer, options)
      .rotate() // apply EXIF orientation before the metadata is dropped
      .resize({ ...MAX_OUTPUT, fit: "inside", withoutEnlargement: true });
    if (format === "jpeg") pipeline = pipeline.jpeg({ quality: 85, mozjpeg: true });
    if (format === "png") pipeline = pipeline.png({ compressionLevel: 9 });
    if (format === "webp") pipeline = pipeline.webp({ quality: 85 });
    output = await pipeline.toBuffer({ resolveWithObject: true });
  } catch {
    throw unreadable();
  }
  return {
    buffer: output.data,
    width: output.info.width,
    height: output.info.height,
    ...FORMATS[format],
  };
};

module.exports = { FORMATS, MAX_INPUT_PIXELS, ProofImageError, processProofImage, sniffFormat };
