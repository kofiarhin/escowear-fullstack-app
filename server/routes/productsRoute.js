const { Router } = require("express");
const {
  getProducts,
  getProduct,
  createProductsController,
} = require("../controllers/productsController");

const buildRouter = ({ getProducts, getProduct }) => {
  const router = Router();

  //@desc get products
  //@access public
  //@path /api/products
  router.get("/", getProducts);
  router.get("/:id", getProduct);
  return router;
};

// Tests and the isolated e2e harness can inject an in-memory Product model.
const createProductsRouter = (ProductModel) => buildRouter(createProductsController(ProductModel));

module.exports = buildRouter({ getProducts, getProduct });
module.exports.createProductsRouter = createProductsRouter;
