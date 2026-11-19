// Shared rules for the Classics editor. Limits mirror the server's validation
// in server/controllers/classicsController.js.
export const MAX_CLASSICS = 6;
export const TITLE_MAX = 40;
export const SEARCH_TERM_MAX = 60;

export const productId = (product) => String(product?._id ?? product?.id ?? "").toLowerCase();
export const productName = (product) => product?.name || product?.title || "Untitled product";
export const storePath = (term) => `/store?search=${encodeURIComponent(term.trim())}`;

const textError = (value, label, max) => {
  const text = value.trim();
  if (!text) return `${label} is required.`;
  if (text.length > max) return `${label} must be ${max} characters or fewer.`;
  return null;
};

export const cardErrors = (card) => ({
  title: textError(card.title, "Title", TITLE_MAX),
  searchTerm: textError(card.searchTerm, "Search term", SEARCH_TERM_MAX),
  product: card.productId ? null : "Choose a product for this card's image.",
});

export const hasErrors = (errors) => Object.values(errors).some(Boolean);
