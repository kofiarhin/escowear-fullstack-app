const CONTROL = /[\u0000-\u001f\u007f]/;

const displayBrand = (value) => {
  if (typeof value !== "string") return "";
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized && !CONTROL.test(normalized) ? normalized : "";
};

const brandKey = (value) => displayBrand(value).toLocaleLowerCase("en-US");

// These are manufacturer aliases, not dropdown data. The catalogue's persisted
// Product.brand values remain the API's source of truth after import/migration.
const MANUFACTURERS = Object.freeze([
  ["Nike", /^(?:nike|nikecourt|nikeskims|nikelab|nikesb)(?=\s|$|[A-Z])/i],
  ["Jordan", /^(?:air\s+)?jordan(?=\s|$)/i],
  ["adidas", /^adidas(?=\s|$)/i],
  ["New Balance", /^new\s+balance(?=\s|$)/i],
  ["ASICS", /^asics(?=\s|$)/i],
  ["On", /^(?:on|on\s+running)(?=\s|$)/i],
  ["PUMA", /^puma(?=\s|$)/i],
  ["Under Armour", /^under\s+armour(?=\s|$)/i],
  ["The North Face", /^the\s+north\s+face(?=\s|$)/i],
  ["Polo Ralph Lauren", /^polo\s+ralph\s+lauren(?=\s|$)/i],
  ["DC Shoes", /^dc\s+shoes?(?=\s|$)/i],
  ["ASOS DESIGN", /^asos\s+design(?=\s|$)/i],
  ["Mallet LDN", /^mallet\s+ldn(?=\s|$)/i],
  ["Steve Madden", /^steve\s+madden(?=\s|$)/i],
  ["Fred Perry", /^fred\s+perry(?=\s|$)/i],
  ["Air Jordan", /^air\s+jordan(?=\s|$)/i],
  ["Bershka", /^bershka(?=\s|$)/i],
  ["Birkenstock", /^birkenstock(?=\s|$)/i],
  ["Converse", /^converse(?=\s|$)/i],
  ["CRUYFF", /^cruyff(?=\s|$)/i],
  ["EA7", /^ea7(?=\s|$)/i],
  ["Fila", /^fila(?=\s|$)/i],
  ["Havaianas", /^havaianas(?=\s|$)/i],
  ["HOKA", /^hoka(?=\s|$)/i],
  ["Lacoste", /^lacoste(?=\s|$)/i],
  ["Lorenzo", /^lorenzo(?=\s|$)/i],
  ["McKenzie", /^mckenzie(?=\s|$)/i],
  ["Merrell", /^merrell(?=\s|$)/i],
  ["OYSHO", /^oysho(?=\s|$)/i],
  ["Pull&Bear", /^pull&bear(?=\s|$)/i],
  ["Reebok", /^reebok(?=\s|$)/i],
  ["Salomon", /^salomon(?=\s|$)/i],
  ["Saucony", /^saucony(?=\s|$)/i],
  ["Stradivarius", /^stradivarius(?=\s|$)/i],
  ["Timberland", /^timberland(?=\s|$)/i],
  ["UGG", /^ugg(?=\s|$)/i],
  ["Vans", /^vans(?=\s|$)/i],
]);

const exactManufacturer = (value) => {
  const normalized = displayBrand(value);
  if (!normalized) return null;
  return MANUFACTURERS.find(([, pattern]) => pattern.test(normalized) && pattern.exec(normalized)?.[0].length === normalized.length)?.[0] || null;
};

const titleManufacturer = (value) => {
  const title = displayBrand(value);
  if (!title) return null;
  return MANUFACTURERS.find(([, pattern]) => pattern.test(title))?.[0] || null;
};

const isManualProduct = (product) => product?.source?.provider === "manual";

const extractProductBrand = (product = {}) => {
  const explicit = exactManufacturer(product.brand);
  if (explicit) return explicit;
  if (isManualProduct(product)) return displayBrand(product.brand) || null;
  return titleManufacturer(product.title || product.name) || exactManufacturer(product.storeName || product.retailer?.name);
};

const preferredBrand = (values) => [...values.entries()].sort(([left, leftCount], [right, rightCount]) => {
  const count = rightCount - leftCount;
  return count || left.localeCompare(right, "en", { sensitivity: "variant" });
})[0][0];

const getAvailableBrands = async (Product) => {
  const query = Product.find({ $or: [{ brand: { $type: "string" } }, { title: { $type: "string" } }, { name: { $type: "string" } }, { storeName: { $type: "string" } }] });
  if (typeof query.select === "function") query.select({ brand: 1, title: 1, name: 1, storeName: 1, retailer: 1, source: 1 });
  const products = await (typeof query.lean === "function" ? query.lean() : query);
  const groups = new Map();
  for (const product of products) {
    const brand = extractProductBrand(product);
    if (!brand) continue;
    const key = brandKey(brand);
    if (!groups.has(key)) groups.set(key, new Map());
    groups.get(key).set(brand, (groups.get(key).get(brand) || 0) + 1);
  }
  return [...groups.values()]
    .map(preferredBrand)
    .sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }));
};

const canonicalBrand = async (Product, value) => {
  const requested = brandKey(value);
  if (!requested) return "";
  const brands = await getAvailableBrands(Product);
  return brands.find((brand) => brandKey(brand) === requested) || null;
};

module.exports = { brandKey, canonicalBrand, displayBrand, exactManufacturer, extractProductBrand, getAvailableBrands, titleManufacturer };
