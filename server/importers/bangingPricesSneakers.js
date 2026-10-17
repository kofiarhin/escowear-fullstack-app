const SOURCE_PROVIDER = "banging-prices";
const SOURCE_DATABASE_NAME = "price_pulse_test";
const DESTINATION_DATABASE_NAME = "escowear-sneaker-import-test";
const PRODUCTS_COLLECTION = "products";

const SNEAKER_CATEGORIES = Object.freeze([
  "trainers",
  "running-shoes",
  "gym-shoes",
  "lifestyle-shoes",
]);

const LEGACY_SNEAKER_TERMS = /\b(?:sneakers?|trainers?)\b/i;

const cleanString = (value) => {
  if (value == null) return null;
  const cleaned = String(value).trim();
  return cleaned || null;
};

const uniqueStrings = (values = []) => {
  if (!Array.isArray(values)) return [];

  const seen = new Set();
  const result = [];

  values.forEach((value) => {
    const cleaned = cleanString(value);
    if (!cleaned || seen.has(cleaned)) return;
    seen.add(cleaned);
    result.push(cleaned);
  });

  return result;
};

const normalizeCategory = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const isSneakerSourceProduct = (product = {}) => {
  const category = normalizeCategory(product.category);

  if (SNEAKER_CATEGORIES.includes(category)) return true;
  if (category !== "shoes") return false;

  return LEGACY_SNEAKER_TERMS.test(
    [product.title, product.name, product.productUrl]
      .filter(Boolean)
      .join(" "),
  );
};

const buildSneakerQuery = () => ({
  $or: [
    {
      category: {
        $in: SNEAKER_CATEGORIES.map(
          (category) => new RegExp(`^${category}$`, "i"),
        ),
      },
    },
    {
      $and: [
        { category: /^shoes$/i },
        {
          $or: [
            { title: LEGACY_SNEAKER_TERMS },
            { name: LEGACY_SNEAKER_TERMS },
            { productUrl: LEGACY_SNEAKER_TERMS },
          ],
        },
      ],
    },
  ],
});

const inferBrand = (product = {}) => {
  const explicitBrand = cleanString(product.brand);
  if (explicitBrand) return explicitBrand;

  return normalizeCategory(product.store) === "nike" ? "Nike" : null;
};

const optionalNumber = (value) => {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const mapSourceProduct = (product, now = new Date()) => {
  const sourceProductId = cleanString(product?._id);
  const canonicalKey = cleanString(product?.canonicalKey);
  const name = cleanString(product?.title || product?.name);
  const productUrl = cleanString(product?.productUrl);
  const price = Number(product?.price);
  const images = uniqueStrings([
    product?.image,
    ...(Array.isArray(product?.images) ? product.images : []),
  ]);

  const missing = [];
  if (!sourceProductId) missing.push("source product id");
  if (!canonicalKey) missing.push("canonical key");
  if (!name) missing.push("name");
  if (!Number.isFinite(price) || price < 0) missing.push("valid price");
  if (!images.length) missing.push("image");
  if (!productUrl) missing.push("product URL");

  if (missing.length) {
    return {
      error: `Missing ${missing.join(", ")}`,
      product: null,
    };
  }

  const colors = uniqueStrings(product.colors);
  const sizesRaw = uniqueStrings(product.sizesRaw);
  const sizes = uniqueStrings(
    Array.isArray(product.sizes) && product.sizes.length
      ? product.sizes
      : sizesRaw,
  );
  const retailerSlug = cleanString(product.store);
  const retailerName = cleanString(product.storeName) || retailerSlug;

  return {
    error: null,
    product: {
      name,
      price,
      currency: cleanString(product.currency) || "GBP",
      originalPrice: optionalNumber(product.originalPrice),
      discountPercent: optionalNumber(product.discountPercent),
      image: images[0],
      images,
      sizes,
      sizesRaw,
      color: colors[0] || null,
      colors,
      category: "shoes",
      brand: inferBrand(product),
      retailer: {
        slug: retailerSlug,
        name: retailerName,
      },
      productUrl,
      saleUrl: cleanString(product.saleUrl),
      gender: cleanString(product.gender),
      inStock:
        typeof product.inStock === "boolean" ? product.inStock : true,
      status: cleanString(product.status) || "active",
      source: {
        provider: SOURCE_PROVIDER,
        productId: sourceProductId,
        canonicalKey,
        category: normalizeCategory(product.category) || null,
      },
      sourceLastSeenAt: product.lastSeenAt || null,
      createdAt: now,
      updatedAt: now,
    },
  };
};

const planImport = (sourceProducts, existingCanonicalKeys, now = new Date()) => {
  const existing = new Set(existingCanonicalKeys || []);
  const seen = new Set();
  const documents = [];
  const invalid = [];
  let alreadyImported = 0;
  let duplicateSourceRecords = 0;

  sourceProducts.forEach((sourceProduct) => {
    const mapped = mapSourceProduct(sourceProduct, now);

    if (mapped.error) {
      invalid.push(mapped.error);
      return;
    }

    const canonicalKey = mapped.product.source.canonicalKey;

    if (seen.has(canonicalKey)) {
      duplicateSourceRecords += 1;
      return;
    }

    seen.add(canonicalKey);

    if (existing.has(canonicalKey)) {
      alreadyImported += 1;
      return;
    }

    documents.push(mapped.product);
  });

  return {
    documents,
    summary: {
      candidates: sourceProducts.length,
      valid: sourceProducts.length - invalid.length,
      invalid: invalid.length,
      duplicateSourceRecords,
      alreadyImported,
      wouldInsert: documents.length,
    },
  };
};

module.exports = {
  DESTINATION_DATABASE_NAME,
  PRODUCTS_COLLECTION,
  SNEAKER_CATEGORIES,
  SOURCE_DATABASE_NAME,
  SOURCE_PROVIDER,
  buildSneakerQuery,
  isSneakerSourceProduct,
  mapSourceProduct,
  planImport,
};
