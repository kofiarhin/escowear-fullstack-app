export const CART_KEY = "escowear-cart-v1";
const MAX_QUANTITY = 10;
export const readCart = () => {
  try {
    const data = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    if (!Array.isArray(data)) return [];
    return data.filter(item => item && typeof item.productId === "string" && typeof item.size === "string" && Number.isSafeInteger(item.quantity) && item.quantity > 0 && item.quantity <= MAX_QUANTITY && Number.isFinite(item.price) && item.price >= 0);
  } catch { return []; }
};
export const saveCart = items => localStorage.setItem(CART_KEY, JSON.stringify(items));
export const addCartItem = (items, product, size, quantity) => {
  if (!product?._id || !size || !Array.isArray(product.sizes) || !product.sizes.map(value => { const label = String(value).trim(); return /^UK\b/i.test(label) ? label : `UK ${label}`; }).includes(size) || product.inStock === false || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY || !Number.isFinite(Number(product.price)) || Number(product.price) < 0 || (product.currency && product.currency !== "GBP")) return items;
  const key = String(product._id);
  const existing = items.find(item => item.productId === key && item.size === size);
  if (existing) return items.map(item => item === existing ? { ...item, quantity: Math.min(MAX_QUANTITY, item.quantity + quantity) } : item);
  return [...items, { productId: key, size, quantity, name: product.name, image: product.image, images: product.images, price: Number(product.price), currency: "GBP" }];
};
export const cartSubtotal = items => items.reduce((total, item) => total + Math.round(item.price * 100) * item.quantity, 0);
export const MAX_CART_QUANTITY = MAX_QUANTITY;
