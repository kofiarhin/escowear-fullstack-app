// Client helpers for uploading a Mobile Money payment screenshot. The server
// re-validates everything; these only give fast, friendly feedback.
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
// Larger screenshots/photos are scaled down before upload so they pass
// conservative proxy body limits and upload quickly on mobile data.
const DOWNSCALE_ABOVE_BYTES = 900 * 1024;
const MAX_EDGE = 2000;

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9 ._:#/-]{2,63}$/;

export const validateReference = (value) => {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "Enter the transaction ID from your Mobile Money confirmation message";
  if (!REFERENCE.test(cleaned)) return "Use only the letters and numbers of the transaction ID (4–64 characters)";
  return null;
};

export const validateProofFile = (file, maxBytes = DEFAULT_MAX_BYTES) => {
  if (!file) return "Choose a screenshot of your payment";
  if (!ACCEPTED_TYPES.includes(file.type)) return "Upload a JPEG, PNG or WebP screenshot";
  if (file.size === 0) return "That file is empty. Choose your payment screenshot";
  if (file.size > maxBytes) return `The screenshot must be ${Math.floor(maxBytes / (1024 * 1024))} MB or smaller`;
  return null;
};

const loadImage = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode failed"));
    };
    image.src = url;
  });

// Returns a smaller JPEG for large images, or the original file. Any failure
// (old browser, no canvas) falls back to the original; the server decides.
export const prepareProofImage = async (file) => {
  if (!file || file.size <= DOWNSCALE_ABOVE_BYTES || typeof document === "undefined") return file;
  try {
    const image = await loadImage(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], "payment-proof.jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
};

export const newUploadKey = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

// XHR (not fetch) so the customer sees real upload progress on slow networks.
// Resolves {ok, status, data}; rejects only on a network failure.
export const uploadPaymentProof = ({ orderId, file, transactionReference, quoteVersion, headers = {}, idempotencyKey, onProgress }) =>
  new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("transactionReference", transactionReference);
    form.append("quoteVersion", String(quoteVersion));
    form.append("proofImage", file, file.name || "payment-proof");
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/orders/${encodeURIComponent(orderId)}/payment-proof`);
    Object.entries({ ...headers, "Idempotency-Key": idempotencyKey }).forEach(([name, value]) => xhr.setRequestHeader(name, value));
    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      };
    }
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data });
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.ontimeout = () => reject(new Error("Timed out"));
    xhr.timeout = 120000;
    xhr.send(form);
  });

// Server error code -> what the customer should do.
export const uploadErrorMessage = (response) => {
  const code = response?.data?.code;
  const fallback = response?.data?.error || "We couldn't upload your screenshot. Please try again.";
  switch (code) {
    case "QUOTE_EXPIRED":
      return "This quote has expired. Please contact us for an updated quote before paying.";
    case "STALE_QUOTE":
      return "Your quote has changed. We've reloaded the latest amount — please check it before submitting.";
    case "PROOF_ALREADY_SUBMITTED":
      return "We already have your payment proof and are checking it.";
    case "RATE_LIMITED":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "UPLOADS_BUSY":
      return "We're busy right now. Please try again in a moment.";
    case "NOT_FOUND":
      return "Your secure upload session has expired. Confirm your email again to continue.";
    default:
      if (response?.status === 413) return "That image is too large. Upload a normal screenshot (5 MB or smaller).";
      return fallback;
  }
};
