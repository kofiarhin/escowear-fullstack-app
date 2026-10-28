// Customer payment-proof submission and admin access to the stored screenshot.
//
// A website upload moves the order to payment_review / payment.status
// under_review — never further. Only the admin verify-payment action, with an
// explicit attestation that the funds arrived in the receiving account, can
// set payment.status verified (see orderWorkflow.verifyPayment).
//
// Commit order, so the database never points at a missing file:
//   1. validate + re-encode image   2. write file (atomic rename)
//   3. insert PaymentProof (staged) 4. atomic Order transition (status, quote
//      version and expiry re-checked in the same update)
//   5. mark proof pending, record event, queue emails (best effort).
// If step 3 or 4 fails the file and staged record are removed.
const crypto = require("crypto");
const { ORDER_STATUS: S, PAYMENT_STATUS: P } = require("./orderStatus");
const { enqueueEmail, isDuplicateKey } = require("./emailOutbox");
const { OrderError } = require("./orderService");
const { ProofImageError, processProofImage } = require("./proofImage");
const { isObjectId, isValidIdempotencyKey } = require("../validators/orderValidator");

const SUBMITTABLE = [S.AWAITING_PAYMENT, S.PAYMENT_ISSUE];
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9 ._:#/-]{2,63}$/;

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const normalizeReference = (value) => value.replace(/\s+/g, "").toUpperCase();
const maskReference = (value) => {
  const compact = String(value || "").replace(/\s+/g, "");
  return compact.length <= 4 ? "••••" : `••••${compact.slice(-4)}`;
};

const notFound = () => new OrderError(404, "NOT_FOUND", "Order not found");

const quoteState = (order, time) => {
  const quote = order.pricing?.finalGHS;
  if (!quote?.totalMinor || !quote.quoteVersion) return { quote: null, expired: false };
  return { quote, expired: !quote.expiresAt || new Date(quote.expiresAt) <= time };
};

const createPaymentProofService = ({ Order, OrderEvent, EmailOutbox, PaymentProof, storage, config, env = process.env, now = () => new Date(), logger = console, processImage = processProofImage }) => {
  const paymentInstructions = () => (env.ESCOWEAR_PAYMENT_INSTRUCTIONS || "").replace(/\\n/g, "\n").trim();

  // The caller must be the logged-in owner, or hold a proof capability for
  // exactly this order. Anything else is a 404 so order ids cannot be probed.
  const authorize = async (orderId, { user, proofOrderId }) => {
    if (!isObjectId(orderId)) throw notFound();
    const order = await Order.findOne({ _id: orderId }).lean();
    if (!order || !order.orderNumber) throw notFound();
    const isOwner = Boolean(user && order.user && String(order.user) === String(user._id));
    const hasCapability = proofOrderId === String(order._id);
    if (!isOwner && !hasCapability) throw notFound();
    return order;
  };

  const assertSubmittable = (order, quoteVersion) => {
    if (order.status === S.PAYMENT_REVIEW) {
      throw new OrderError(409, "PROOF_ALREADY_SUBMITTED", "We already have your payment proof and are checking it. Your order is not confirmed yet.");
    }
    if (!SUBMITTABLE.includes(order.status)) {
      throw new OrderError(409, "NOT_AWAITING_PAYMENT", "This order is not waiting for payment proof", { currentStatus: order.status });
    }
    const { quote, expired } = quoteState(order, now());
    if (!quote) throw new OrderError(409, "NO_QUOTE", "There is no GHS quote for this order yet");
    if (quoteVersion !== quote.quoteVersion) {
      throw new OrderError(409, "STALE_QUOTE", "Your quote has changed. Reload the page to see the current amount before submitting.", {
        currentQuoteVersion: quote.quoteVersion,
      });
    }
    if (expired) {
      throw new OrderError(410, "QUOTE_EXPIRED", "This quote has expired. Please contact us for an updated quote before paying.");
    }
    return quote;
  };

  const parseFields = (fields = {}) => {
    const errors = {};
    const reference = typeof fields.transactionReference === "string" ? fields.transactionReference.replace(/\s+/g, " ").trim() : "";
    if (!REFERENCE.test(reference)) errors.transactionReference = "Enter the Mobile Money transaction ID from your payment message (letters and numbers)";
    const quoteVersion = Number(fields.quoteVersion);
    if (!Number.isSafeInteger(quoteVersion) || quoteVersion < 1) errors.quoteVersion = "Reload the page and try again";
    if (Object.keys(errors).length) throw new OrderError(422, "VALIDATION_FAILED", "Please correct the highlighted fields", errors);
    return { reference, quoteVersion };
  };

  const proofResponse = (proof, httpStatus) => ({
    httpStatus,
    body: {
      proofId: String(proof._id),
      submittedAt: proof.createdAt,
      status: P.UNDER_REVIEW,
      orderStatus: S.PAYMENT_REVIEW,
      referenceMasked: maskReference(proof.transactionReference),
    },
  });

  // A staged proof is live once its order references it (the pending mark can
  // fail after the order transition commits); unreferenced staged proofs are not.
  const isLive = (proof, order) =>
    proof.reviewStatus !== "staged" || String(order?.payment?.proof?.id || "") === String(proof._id);

  // Retry with the same Idempotency-Key: same proof back, or 409 if the key
  // was used for a different upload.
  const replay = async (existing, fingerprint) => {
    if (existing.requestFingerprint !== fingerprint) {
      throw new OrderError(409, "IDEMPOTENCY_CONFLICT", "This upload attempt was already used for a different screenshot. Reload and try again.");
    }
    if (existing.reviewStatus === "staged") {
      const order = await Order.findOne({ _id: existing.orderId }).lean();
      if (!isLive(existing, order)) {
        throw new OrderError(409, "UPLOAD_IN_PROGRESS", "Your upload is still being processed. Reload the page in a moment.");
      }
      return proofResponse({ ...existing, reviewStatus: "pending" }, 200);
    }
    return proofResponse(existing, 200);
  };

  const discard = async (proofId, storageKey) => {
    if (proofId) await PaymentProof.deleteOne({ _id: proofId, reviewStatus: "staged" }).catch((error) => logger.error(`Staged proof ${proofId} not removed: ${error.message}`));
    if (storageKey) await storage.remove(storageKey).catch((error) => logger.error(`Proof file not removed: ${error.message}`));
  };

  const queueSideEffects = async (order, proof, fromStatus, duplicates) => {
    const details = {
      proofId: String(proof._id),
      quoteVersion: proof.quoteVersion,
      proofChannel: "website_upload",
      referenceMasked: maskReference(proof.transactionReference),
      duplicateReference: duplicates.length > 0 || undefined,
    };
    try {
      await OrderEvent.create({
        orderId: order._id,
        actorType: "customer",
        actorId: proof.submitter?.userId,
        type: "payment_proof_submitted",
        fromStatus,
        toStatus: S.PAYMENT_REVIEW,
        customerVisible: true,
        details,
        dedupeKey: `proof_submitted:${proof._id}`,
      });
    } catch (error) {
      if (!isDuplicateKey(error)) logger.error(`Order ${order._id} proof event not recorded: ${error.message}`);
    }
    const context = { order, baseUrl: config.publicBaseUrl, referenceMasked: details.referenceMasked, submittedAt: proof.createdAt };
    try {
      await enqueueEmail(EmailOutbox, {
        dedupeKey: `proof_received:${proof._id}`,
        orderId: order._id,
        kind: "payment_proof_received",
        to: order.customer.emailNormalized,
        context,
      });
    } catch (error) {
      logger.error(`Order ${order._id} proof receipt email not queued: ${error.message}`);
    }
    if (config.adminNotifyEmail) {
      try {
        await enqueueEmail(EmailOutbox, {
          dedupeKey: `proof_admin:${proof._id}`,
          orderId: order._id,
          kind: "payment_proof_admin_notice",
          to: config.adminNotifyEmail,
          context: { ...context, duplicateReference: duplicates.length > 0 },
        });
      } catch (error) {
        logger.error(`Order ${order._id} admin proof notice not queued: ${error.message}`);
      }
    }
  };

  const submit = async ({ order: authorizedOrder, user, idempotencyKey, fields, file }) => {
    if (!isValidIdempotencyKey(idempotencyKey)) {
      throw new OrderError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required");
    }
    const { reference, quoteVersion } = parseFields(fields);
    const orderId = authorizedOrder._id;
    const keyHash = sha256(`proof:${orderId}:${idempotencyKey}`);
    const originalSha256 = sha256(file.buffer);
    const fingerprint = sha256(JSON.stringify({ originalSha256, reference, quoteVersion }));

    const existing = await PaymentProof.findOne({ idempotencyKeyHash: keyHash }).lean();
    if (existing) return replay(existing, fingerprint);

    const order = await Order.findOne({ _id: orderId }).lean();
    if (!order) throw notFound();
    assertSubmittable(order, quoteVersion);

    let image;
    try {
      image = await processImage(file.buffer);
    } catch (error) {
      if (error instanceof ProofImageError) throw new OrderError(error.status, error.code, error.message, { proofImage: error.message });
      throw error;
    }

    const storageKey = await storage.save(orderId, image.buffer, image.extension);
    let proof;
    let duplicates = [];
    // Once the order points at the proof, its record and file must be kept.
    let committed = false;
    try {
      const referenceNormalized = normalizeReference(reference);
      duplicates = (
        await PaymentProof.find({ referenceNormalized, orderId: { $ne: orderId }, reviewStatus: { $in: ["pending", "accepted", "rejected"] } })
          .limit(10)
          .lean()
      ).map((entry) => entry.orderId);
      try {
        const created = await PaymentProof.create({
          orderId,
          quoteVersion,
          transactionReference: reference,
          referenceNormalized,
          storageKey,
          contentType: image.contentType,
          sizeBytes: image.buffer.length,
          width: image.width,
          height: image.height,
          sha256: sha256(image.buffer),
          originalSha256,
          channel: "website_upload",
          submitter: user && order.user && String(order.user) === String(user._id) ? { type: "customer", userId: user._id } : { type: "guest" },
          reviewStatus: "staged",
          duplicateReferenceOrderIds: duplicates.length ? duplicates : undefined,
          idempotencyKeyHash: keyHash,
          requestFingerprint: fingerprint,
        });
        proof = created.toObject ? created.toObject() : created;
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        // A concurrent retry with the same key won the race.
        await discard(null, storageKey);
        const raced = await PaymentProof.findOne({ idempotencyKeyHash: keyHash }).lean();
        if (raced) return replay(raced, fingerprint);
        throw error;
      }

      const time = now();
      const before = await Order.findOneAndUpdate(
        {
          _id: orderId,
          status: { $in: SUBMITTABLE },
          "pricing.finalGHS.quoteVersion": quoteVersion,
          "pricing.finalGHS.expiresAt": { $gt: time },
        },
        {
          $set: {
            status: S.PAYMENT_REVIEW,
            "payment.status": P.UNDER_REVIEW,
            "payment.proof": {
              id: proof._id,
              submittedAt: proof.createdAt,
              quoteVersion,
              referenceMasked: maskReference(reference),
              channel: "website_upload",
            },
          },
        },
        { new: false }
      ).lean();
      if (!before) {
        // Lost a race (another upload, re-quote, cancellation or expiry).
        await discard(proof._id, storageKey);
        const current = await Order.findOne({ _id: orderId }).lean();
        assertSubmittable(current || order, quoteVersion);
        throw new OrderError(409, "STALE_STATUS", "This order changed while you were uploading. Reload the page.");
      }
      committed = true;

      // If this fails the proof stays "staged", but the order references it, so
      // readers treat it as pending (see isLive) and admin settles it normally.
      await PaymentProof.updateOne({ _id: proof._id, reviewStatus: "staged" }, { $set: { reviewStatus: "pending" } }).catch((error) =>
        logger.error(`Proof ${proof._id} not marked pending: ${error.message}`)
      );
      proof.reviewStatus = "pending";
      const updated = await Order.findOne({ _id: orderId }).lean();
      await queueSideEffects(updated || order, proof, before.status, duplicates);
      return proofResponse(proof, 201);
    } catch (error) {
      if (!committed) await discard(proof?._id, storageKey);
      throw error;
    }
  };

  // Website copy of the payment instructions, for the proven owner only.
  const getPaymentInstructions = async (order) => {
    const { quote, expired } = quoteState(order, now());
    const base = {
      orderNumber: order.orderNumber,
      status: order.status,
      supportEmail: config.supportEmail || null,
    };
    if (!quote) return { ...base, available: false, reason: "NO_QUOTE" };
    const summary = {
      quoteVersion: quote.quoteVersion,
      currency: "GHS",
      subtotalMinor: quote.subtotalMinor,
      feesMinor: quote.feesMinor,
      shippingMinor: quote.shippingMinor,
      dutiesMinor: quote.dutiesMinor,
      totalMinor: quote.totalMinor,
      expiresAt: quote.expiresAt,
      expired,
    };
    if (!SUBMITTABLE.includes(order.status)) return { ...base, available: false, reason: "NOT_AWAITING_PAYMENT", quote: summary };
    if (expired) return { ...base, available: false, reason: "QUOTE_EXPIRED", quote: summary };
    const instructions = paymentInstructions();
    if (!instructions) return { ...base, available: false, reason: "NOT_CONFIGURED", quote: summary };
    return { ...base, available: true, quote: summary, instructions, paymentReference: order.orderNumber, maxUploadBytes: config.proofMaxBytes };
  };

  // --- admin -------------------------------------------------------------------

  const adminProof = (proof, activeId) => ({
    id: String(proof._id),
    quoteVersion: proof.quoteVersion,
    transactionReference: proof.transactionReference,
    contentType: proof.contentType,
    sizeBytes: proof.sizeBytes,
    width: proof.width,
    height: proof.height,
    sha256: proof.sha256,
    channel: proof.channel,
    submitterType: proof.submitter?.type,
    reviewStatus: proof.reviewStatus,
    reviewedAt: proof.reviewedAt,
    submittedAt: proof.createdAt,
    active: activeId ? String(proof._id) === String(activeId) : false,
    duplicateReferenceOrderIds: (proof.duplicateReferenceOrderIds || []).map(String),
  });

  const listForAdmin = async (order) => {
    const proofs = await PaymentProof.find({ orderId: order._id }).sort({ createdAt: -1 }).lean();
    return proofs
      .filter((proof) => isLive(proof, order))
      .map((proof) => adminProof(proof.reviewStatus === "staged" ? { ...proof, reviewStatus: "pending" } : proof, order.payment?.proof?.id));
  };

  const readForAdmin = async (orderId, proofId) => {
    if (!isObjectId(orderId) || !isObjectId(proofId)) throw new OrderError(404, "NOT_FOUND", "Proof not found");
    const proof = await PaymentProof.findOne({ _id: proofId, orderId }).lean();
    if (!proof) throw new OrderError(404, "NOT_FOUND", "Proof not found");
    if (proof.reviewStatus === "staged" && !isLive(proof, await Order.findOne({ _id: orderId }).lean())) {
      throw new OrderError(404, "NOT_FOUND", "Proof not found");
    }
    let buffer;
    try {
      buffer = await storage.read(proof.storageKey);
    } catch (error) {
      logger.error(`Proof ${proof._id} file unavailable: ${error.code || error.message}`);
      throw new OrderError(410, "PROOF_FILE_MISSING", "The screenshot file is missing from storage");
    }
    return { buffer, contentType: proof.contentType };
  };

  // Called by the admin workflow after verify-payment / payment-issue.
  const settleActiveProof = async (order, reviewStatus, admin) => {
    const proofId = order.payment?.proof?.id;
    if (!proofId) return;
    await PaymentProof.updateOne({ _id: proofId, reviewStatus: { $in: ["staged", "pending"] } }, { $set: { reviewStatus, reviewedAt: now(), reviewedBy: admin._id } }).catch((error) =>
      logger.error(`Proof ${proofId} review status not updated: ${error.message}`)
    );
  };

  return { authorize, getPaymentInstructions, listForAdmin, readForAdmin, settleActiveProof, submit };
};

module.exports = { SUBMITTABLE, createPaymentProofService, maskReference, normalizeReference };
