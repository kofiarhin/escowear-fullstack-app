export const getProductImage = (product = {}) => {
  const remoteImage = product.image || product.images?.find(Boolean);
  if (remoteImage) return remoteImage;

  if (product.category && product.name) {
    return `/images/${product.category}/${product.name}/1.jpg`;
  }

  return "/images/default.jpg";
};

export const useFallbackProductImage = (event) => {
  event.currentTarget.onerror = null;
  event.currentTarget.src = "/images/default.jpg";
};

export const formatProductPrice = (product = {}) => {
  const price = Number(product.price);
  if (!Number.isFinite(price)) return null;

  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: product.currency || "GBP",
    }).format(price);
  } catch {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
    }).format(price);
  }
};

export const formatProductCategory = (product = {}) => {
  const category = product.source?.category || product.category || "Sneakers";
  const label = String(category).replace(/-/g, " ").trim();
  return label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : "Sneakers";
};

export const formatProductSize = (size) => {
  const label = String(size || "").trim();
  if (!label) return null;
  return /^UK\b/i.test(label) ? label : `UK ${label}`;
};

export const getAvailabilityLabel = (product = {}) => {
  if (product.inStock === false) return "Sold out";
  const sizeCount = Array.isArray(product.sizes) ? product.sizes.length : 0;
  return sizeCount ? `${sizeCount} sizes available` : "Available";
};
