const { Router } = require("express");
const {
  getProducts,
  getProduct,
} = require("../controllers/productsController");
const router = Router();

//@desc get products
//@access public
//@path /api/products
router.get("/", getProducts);
router.get("/:id", getProduct);

module.exports = router;
