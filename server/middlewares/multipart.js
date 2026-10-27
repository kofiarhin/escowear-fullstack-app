// Minimal, bounded multipart/form-data reader for one image plus a few short
// text fields. Streams with hard limits: the file is cut off at maxBytes + 1
// (reported as too large), extra files/fields are refused, and the whole body
// is capped so an oversized request never sits in memory.
const Busboy = require("busboy");

class MultipartError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const FIELD_OVERHEAD = 64 * 1024;

const readMultipart = (req, { maxBytes, fileField = "proofImage", allowedFields = [] }) =>
  new Promise((resolve, reject) => {
    if (!/^multipart\/form-data/i.test(req.headers["content-type"] || "")) {
      reject(new MultipartError(415, "MULTIPART_REQUIRED", "Send the screenshot as a file upload (multipart/form-data)"));
      return;
    }
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes + FIELD_OVERHEAD) {
      reject(new MultipartError(413, "FILE_TOO_LARGE", `The screenshot must be ${Math.floor(maxBytes / (1024 * 1024))} MB or smaller`));
      return;
    }

    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: maxBytes, fields: allowedFields.length, fieldSize: 1024, headerPairs: 50 },
      });
    } catch {
      reject(new MultipartError(400, "INVALID_MULTIPART", "The upload could not be read. Please try again."));
      return;
    }

    const fields = {};
    let file = null;
    let failure = null;
    let received = 0;
    const fail = (error) => {
      if (!failure) failure = error;
    };

    parser.on("field", (name, value, info) => {
      if (!allowedFields.includes(name)) return fail(new MultipartError(400, "UNEXPECTED_FIELD", `Unexpected field ${String(name).slice(0, 40)}`));
      if (info.valueTruncated) return fail(new MultipartError(422, "FIELD_TOO_LONG", "A form field is too long"));
      fields[name] = value;
      return undefined;
    });

    parser.on("file", (name, stream) => {
      if (name !== fileField || file) {
        fail(new MultipartError(400, "UNEXPECTED_FILE", "Upload exactly one screenshot"));
        stream.resume();
        return;
      }
      const chunks = [];
      stream.on("data", (chunk) => {
        received += chunk.length;
        if (!failure) chunks.push(chunk);
      });
      stream.on("limit", () => fail(new MultipartError(413, "FILE_TOO_LARGE", `The screenshot must be ${Math.floor(maxBytes / (1024 * 1024))} MB or smaller`)));
      stream.on("end", () => {
        file = { buffer: Buffer.concat(chunks), size: received };
      });
    });

    parser.on("filesLimit", () => fail(new MultipartError(400, "UNEXPECTED_FILE", "Upload exactly one screenshot")));
    parser.on("fieldsLimit", () => fail(new MultipartError(400, "UNEXPECTED_FIELD", "Too many form fields")));
    parser.on("error", () => {
      fail(new MultipartError(400, "INVALID_MULTIPART", "The upload could not be read. Please try again."));
      req.unpipe(parser);
      req.resume();
      reject(failure);
    });
    parser.on("close", () => {
      if (failure) return reject(failure);
      if (!file || file.size === 0) return reject(new MultipartError(422, "FILE_REQUIRED", "Choose a screenshot of your payment to upload"));
      return resolve({ fields, file });
    });
    req.on("aborted", () => fail(new MultipartError(400, "UPLOAD_ABORTED", "The upload was interrupted")));
    req.pipe(parser);
  });

module.exports = { MultipartError, readMultipart };
