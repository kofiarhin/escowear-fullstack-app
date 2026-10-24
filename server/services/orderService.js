const crypto = require("crypto");
const { ORDER_STATUS, PAYMENT_STATUS, EMAIL_STATE, customerStatusLabel } = require("./orderStatus");
const { issueOrderAccessToken } = require("./orderAccess");
const { enqueueEmail, isDuplicateKey } = require("./emailOutbox");
const { isObjectId, isValidIdempotencyKey, normalizeSize, validateGuestOrder } = require("../validators/orderValidator");

class OrderError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

// Crockford base32 without I, L, O, U: unambiguous when read aloud or typed.
const ORDER_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const generateOrderNumber = (randomBytes = crypto.randomBytes) => {
  const bytes = randomBytes(10);
  let out = "";
  for (let index = 0; index < 10; index += 1) out += ORDER_ALPHABET[bytes[index] & 31];
  return `EW-${out.slice(0, 5)}-${out.slice(5)}`;
};

const toMinor = (price) => {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0) return null;
  const minor = Math.round(value * 100);
  return Number.isSafeInteger(minor) ? minor : null;
};

const productUnavailableReason = (product, size) => {
  if (!product) return "This product is no longer available";
  if (product.inStock === false) return "This product is out of stock";
  if (product.status && product.status !== "active") return "This product is no longer available";
  if (product.currency && product.currency !== "GBP") return "This product cannot be ordered online";
  if (toMinor(product.price) === null) return "This product cannot be ordered online";
  const sizes = Array.isArray(product.sizes) ? product.sizes.map(normalizeSize).filter(Boolean) : [];
  if (!sizes.includes(size)) return "This size is not available";
  return null;
};

const isLegacyOrder = (order) => !Array.isArray(order.items) || order.items.length === 0;

const toCustomerOrder = (order, events = []) => {
  const legacy = isLegacyOrder(order);
  const quote = order.pricing?.finalGHS;
  return {
    id: String(order._id),
    orderNumber: order.orderNumber || null,
    status: order.status,
    statusLabel: customerStatusLabel(order.status),
    legacy,
    createdAt: order.createdAt,
    items: legacy
      ? (order.products || []).map((product) => ({ name: product.name, size: product.size, quantity: 1 }))
      : order.items.map((item) => ({
          productId: String(item.productId),
          name: item.name,
          brand: item.brand,
          image: item.image,
          size: item.size,
          quantity: item.quantity,
          unitPriceGBPMinor: item.unitPriceGBPMinor,
          lineTotalGBPMinor: item.lineTotalGBPMinor,
        })),
    pricing: legacy
      ? null
      : {
          currency: "GBP",
          subtotalGBPMinor: order.pricing.subtotalGBPMinor,
          estimatedOnly: true,
          finalGHS:
            quote && quote.totalMinor !== undefined
              ? {
                  subtotalMinor: quote.subtotalMinor,
                  feesMinor: quote.feesMinor,
                  shippingMinor: quote.shippingMinor,
                  dutiesMinor: quote.dutiesMinor,
                  totalMinor: quote.totalMinor,
                  expiresAt: quote.expiresAt,
                }
              : null,
        },
    customer: order.customer ? { name: order.customer.name, email: order.customer.email } : null,
    shippingAddress: order.shippingAddress?.city
      ? {
          recipient: order.shippingAddress.recipient,
          city: order.shippingAddress.city,
          region: order.shippingAddress.region,
          country: order.shippingAddress.country,
        }
      : null,
    fulfilment: {
      carrier: order.fulfilment?.carrier || null,
      trackingNumber: order.fulfilment?.trackingNumber || null,
      trackingUrl: order.fulfilment?.trackingUrl || null,
      dispatchedAt: order.fulfilment?.dispatchedAt || null,
      deliveredAt: order.fulfilment?.deliveredAt || null,
    },
    history: events
      .filter((event) => event.customerVisible && event.toStatus)
      .map((event) => ({ status: event.toStatus, label: customerStatusLabel(event.toStatus), at: event.createdAt })),
  };
};

const parsePage = (query = {}) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

const createOrderService = ({ Order, Product, OrderEvent, EmailOutbox, config, logger = console, randomBytes }) => {
  const baseUrl = () => config.publicBaseUrl;

  const ensureCreationSideEffects = async (order, actor) => {
    const dedupeKey = `order_created:${order._id}`;
    const existingEvent = await OrderEvent.findOne({ dedupeKey }).lean();
    if (!existingEvent) {
      // A concurrent retry may insert the same event; the unique dedupeKey
      // index makes the second insert fail harmlessly.
      await OrderEvent.create({
        orderId: order._id,
        actorType: actor ? "customer" : "system",
        actorId: actor?._id,
        type: "order_created",
        toStatus: ORDER_STATUS.PENDING_CONTACT,
        customerVisible: true,
        details: { itemCount: order.items.length, source: order.source },
        dedupeKey,
      }).catch((error) => {
        if (!isDuplicateKey(error)) throw error;
      });
    }
    if (order.email?.acknowledgementState === EMAIL_STATE.NOT_QUEUED || !order.email?.acknowledgementState) {
      await enqueueEmail(EmailOutbox, {
        dedupeKey: `order_received:${order._id}`,
        orderId: order._id,
        kind: "order_received",
        to: order.customer.emailNormalized,
        context: { order, baseUrl: baseUrl(), policiesPublished: Boolean(config.policiesPublished) },
      });
      await Order.updateOne(
        { _id: order._id, "email.acknowledgementState": { $ne: EMAIL_STATE.SENT } },
        { $set: { "email.acknowledgementState": EMAIL_STATE.QUEUED } }
      );
    }
  };

  const creationResponse = (order, httpStatus) => ({
    httpStatus,
    body: {
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      status: order.status,
      statusLabel: customerStatusLabel(order.status),
      trackingHandoff: {
        accessToken: issueOrderAccessToken(order._id, config.checkoutAccessTtlMinutes, { via: "checkout" }),
        expiresInMinutes: config.checkoutAccessTtlMinutes,
      },
      order: toCustomerOrder(order),
    },
  });

  const replay = async (existing, fingerprint, user) => {
    if (existing.requestFingerprint !== fingerprint) {
      throw new OrderError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "This checkout attempt was already used for a different order. Refresh the page and try again."
      );
    }
    try {
      await ensureCreationSideEffects(existing, user);
    } catch (error) {
      logger.error(`Order ${existing._id} side-effect recovery failed: ${error.message}`);
    }
    return creationResponse(existing, 200);
  };

  const findByIdempotency = (keyHash) =>
    Order.findOne({ idempotencyKeyHash: keyHash }).select("+idempotencyKeyHash +requestFingerprint").lean();

  const createGuestOrder = async ({ body, idempotencyKey, user }) => {
    if (!isValidIdempotencyKey(idempotencyKey)) {
      throw new OrderError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required");
    }
    const validation = validateGuestOrder(body);
    if (!validation.ok) {
      throw new OrderError(422, "VALIDATION_FAILED", "Please correct the highlighted fields", validation.errors);
    }
    const input = validation.value;
    const keyHash = sha256(`order:${idempotencyKey}`);
    const fingerprint = sha256(JSON.stringify({ ...input, user: user ? String(user._id) : null }));

    const existing = await findByIdempotency(keyHash);
    if (existing) return replay(existing, fingerprint, user);

    // New orders must be placed against the published policy version, so a
    // stale or altered client cannot record terms the customer was not shown.
    if (config.policiesPublished && input.termsVersion !== config.policyVersion) {
      const message = "Our shop policies have been updated. Please refresh the page and review them before ordering.";
      throw new OrderError(422, "POLICY_VERSION_CHANGED", message, { termsVersion: message });
    }

    const ids = [...new Set(input.items.map((item) => item.productId))];
    const products = await Product.find({ _id: { $in: ids } }).lean();
    const byId = new Map(products.map((product) => [String(product._id).toLowerCase(), product]));

    const fieldErrors = {};
    const items = input.items.map((line, index) => {
      const product = byId.get(line.productId);
      const reason = productUnavailableReason(product, line.size);
      if (reason) {
        fieldErrors[`items.${index}`] = reason;
        return null;
      }
      const unitPriceGBPMinor = toMinor(product.price);
      return {
        productId: product._id,
        name: product.name || product.title,
        brand: product.brand || product.retailer?.name,
        image: product.image || product.images?.[0],
        size: line.size,
        quantity: line.quantity,
        unitPriceGBPMinor,
        lineTotalGBPMinor: unitPriceGBPMinor * line.quantity,
        retailerSnapshot: product.retailer || product.productUrl
          ? { slug: product.retailer?.slug, name: product.retailer?.name, productUrl: product.productUrl }
          : undefined,
      };
    });
    if (Object.keys(fieldErrors).length) {
      throw new OrderError(422, "ITEMS_UNAVAILABLE", "Some items in your cart can no longer be ordered", fieldErrors);
    }
    const subtotalGBPMinor = items.reduce((total, item) => total + item.lineTotalGBPMinor, 0);

    let order;
    for (let attempt = 0; attempt < 5 && !order; attempt += 1) {
      try {
        const created = await Order.create({
          orderNumber: generateOrderNumber(randomBytes),
          source: "guest_checkout",
          user: user?._id,
          status: ORDER_STATUS.PENDING_CONTACT,
          customer: {
            name: input.customer.name,
            email: input.customer.email,
            emailNormalized: input.customer.email,
            phone: input.customer.phone,
          },
          shippingAddress: input.shippingAddress,
          items,
          pricing: { currency: "GBP", subtotalGBPMinor, estimatedOnly: true },
          payment: { method: "manual_transfer", status: PAYMENT_STATUS.NOT_REQUESTED },
          email: { acknowledgementState: EMAIL_STATE.NOT_QUEUED },
          termsVersion: input.termsVersion,
          idempotencyKeyHash: keyHash,
          requestFingerprint: fingerprint,
        });
        order = created.toObject ? created.toObject() : created;
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        // A concurrent request with the same key won the race: replay its result.
        const raced = await findByIdempotency(keyHash);
        if (raced) return replay(raced, fingerprint, user);
        // Otherwise the order number collided; loop and draw a new one.
      }
    }
    if (!order) throw new OrderError(503, "ORDER_NUMBER_UNAVAILABLE", "Please try again in a moment");

    try {
      await ensureCreationSideEffects(order, user);
    } catch (error) {
      // The order itself is durable. A retry with the same key, or the outbox
      // sweep, re-runs these idempotent steps.
      logger.error(`Order ${order._id} created but side effects failed: ${error.message}`);
    }
    return creationResponse(order, 201);
  };

  const listOwnerOrders = async (user, query) => {
    const { page, limit, skip } = parsePage(query);
    const filter = { user: user._id };
    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Order.countDocuments(filter),
    ]);
    return {
      items: orders.map((order) => toCustomerOrder(order)),
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  };

  // Returns a sanitized order only for its linked customer or a holder of a
  // matching order access token; everyone else gets null (served as 404).
  const getOrderForViewer = async (orderId, { user, accessOrderId }) => {
    if (!isObjectId(orderId)) return null;
    const order = await Order.findOne({ _id: orderId }).lean();
    if (!order) return null;
    const isOwner = Boolean(user && order.user && String(order.user) === String(user._id));
    const hasToken = accessOrderId === String(order._id);
    if (!isOwner && !hasToken) return null;
    const events = await OrderEvent.find({ orderId: order._id, customerVisible: true }).sort({ createdAt: 1 }).lean();
    return toCustomerOrder(order, events);
  };

  return { createGuestOrder, ensureCreationSideEffects, getOrderForViewer, listOwnerOrders };
};

module.exports = {
  OrderError,
  createOrderService,
  generateOrderNumber,
  parsePage,
  productUnavailableReason,
  toCustomerOrder,
  toMinor,
};
