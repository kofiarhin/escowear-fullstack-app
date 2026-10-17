const Product = require("../Models/Product.model");

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parsePagination = ({ page, limit }) => {
  const parsedPage = Number.parseInt(page, 10);
  const parsedLimit = Number.parseInt(limit, 10);
  const safePage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(parsedLimit, 60)
    : 24;

  return {
    page: safePage,
    limit: safeLimit,
    skip: (safePage - 1) * safeLimit,
  };
};

const buildProductFilter = ({ search, category }) => {
  const clauses = [];
  const normalizedCategory = String(category || "").trim();
  const normalizedSearch = String(search || "").trim();

  if (normalizedCategory) {
    clauses.push({
      category: new RegExp(`^${escapeRegex(normalizedCategory)}$`, "i"),
    });
  }

  if (normalizedSearch) {
    const expression = new RegExp(escapeRegex(normalizedSearch), "i");
    clauses.push({
      $or: [
        { name: expression },
        { brand: expression },
        { "retailer.name": expression },
        { "source.category": expression },
      ],
    });
  }

  if (clauses.length === 0) return {};
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
};

const createProductsController = (ProductModel) => {
  const getProducts = async (req, res) => {
    try {
      const { page, limit, skip } = parsePagination(req.query || {});
      const filter = buildProductFilter(req.query || {});
      const [items, total] = await Promise.all([
        ProductModel.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        ProductModel.countDocuments(filter),
      ]);

      return res.status(200).json({
        items,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      return res.status(500).json({ error: "Unable to load products" });
    }
  };

  const getProduct = async (req, res) => {
    try {
      const product = await ProductModel.findById(req.params.id).lean();

      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      return res.status(200).json(product);
    } catch (error) {
      if (error?.name === "CastError") {
        return res.status(400).json({ error: "Invalid product id" });
      }

      return res.status(500).json({ error: "Unable to load product" });
    }
  };

  return { getProduct, getProducts };
};

const { getProduct, getProducts } = createProductsController(Product);

module.exports = {
  buildProductFilter,
  createProductsController,
  getProducts,
  getProduct,
  parsePagination,
};
